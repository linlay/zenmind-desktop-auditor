import { randomUUID } from 'node:crypto';
import { requireGraph, validateGraph, jsonBytes, problem } from '../frontend/core/graph.mjs';
const active = run => ['running', 'cancelling'].includes(run?.status);
export class Engine {
  constructor({ store, getClient, configured = false, secrets = [] }) { this.secrets = secrets; this.store = store; this.getClient = getClient; this.configured = configured; this.current = null; this.completion = Promise.resolve(); }
  async start(graph) {
    if (this.current) throw problem('run_in_progress', '已有流程正在运行，请等待结束或取消。', 409);
    const snapshot = requireGraph(graph);
    if (snapshot.nodes.some(node => node.type === 'agent') && !this.configured) throw problem('agent_unavailable', '智能体节点需在 Desktop 中运行，并选择具备 result_submit 的 Native Agent。', 409);
    if (this.store.value.runs.length >= 30) throw problem('history_full', '已保留 30 次运行，请先清理旧记录。', 409);
    const run = { id: randomUUID(), name: snapshot.name, graph: snapshot, startedAt: Date.now(), finishedAt: null, status: 'running', mode: snapshot.nodes.some(node => node.type === 'agent') ? 'desktop-agent' : 'data-only', nodes: Object.fromEntries(snapshot.nodes.map(node => [node.id, { status: 'pending' }])), outputs: {} };
    const controller = new AbortController(); this.current = { run, controller }; this.store.value.runs.unshift(run);
    try { await this.store.save(); } catch (error) { this.current = null; this.store.value.runs.shift(); throw error; }
    this.completion = this.execute(run, controller).finally(() => { this.current = null; });
    // All execution errors are normalized within execute; avoid process-level unhandled failures.
    this.completion.catch(() => {}); return run;
  }
  async execute(run, controller) {
    let currentNode;
    try {
      for (const id of validateGraph(run.graph).order) {
        controller.signal.throwIfAborted(); const node = run.graph.nodes.find(node => node.id === id); currentNode = run.nodes[id];
        Object.assign(currentNode, { status: 'running', startedAt: Date.now() }); await this.store.save(); controller.signal.throwIfAborted();
        const parents = run.graph.edges.filter(edge => edge.target === id).map(edge => edge.source);
        const upstream = Object.fromEntries(parents.map(parent => [parent, run.nodes[parent].output]));
        let output;
        if (node.type === 'input') output = node.config.value;
        else if (node.type === 'merge') output = upstream;
        else if (node.type === 'output') output = parents.length === 1 ? upstream[parents[0]] : upstream;
        else {
          const args = { message: node.config.message, input: { upstream }, outputSchema: node.config.outputSchema };
          if (jsonBytes({ action: 'assistant.execute', args }) > 240 * 1024) throw problem('input_too_large', '上游内容超过后端请求上限，请减少输入或节点输出。');
          const sdk = await this.getClient(); controller.signal.throwIfAborted();
          const response = await sdk.assistant.execute(args, { signal: controller.signal });
          controller.signal.throwIfAborted();
          if (typeof response?.chatId !== 'string' || !response.chatId) throw problem('invalid_response', '宿主没有返回真实 Chat ID。');
          currentNode.chatId = response.chatId;
          if (response.status === 'failure') throw problem('agent_business_failure', typeof response.reason === 'string' ? response.reason : '智能体未能完成任务。');
          if (response.status !== 'success' || !response.output || typeof response.output !== 'object' || Array.isArray(response.output)) throw problem('invalid_response', '智能体未返回有效结构化交卷。');
          output = response.output;
        }
        if (jsonBytes(output) > 1024 * 1024) throw problem('output_too_large', '单节点结果超过 1 MiB。');
        if (jsonBytes(run) + jsonBytes(output) > 4 * 1024 * 1024) throw problem('run_too_large', '本轮结果超过 4 MiB。');
        Object.assign(currentNode, { output: structuredClone(output), status: 'succeeded', finishedAt: Date.now() });
        if (node.type === 'output') run.outputs[id] = currentNode.output;
        await this.store.save();
      }
      controller.signal.throwIfAborted(); run.status = 'succeeded';
    } catch (error) {
      const cancelled = controller.signal.aborted;
      run.status = cancelled ? 'cancelled' : 'failed';
      if (currentNode?.status === 'running') Object.assign(currentNode, { status: cancelled ? 'cancelled' : 'failed', finishedAt: Date.now(), error: this.safeError(error) });
      run.error = this.safeError(error);
      for (const node of Object.values(run.nodes)) if (node.status === 'pending') node.status = 'skipped';
    } finally {
      run.finishedAt = Date.now();
      try { await this.store.save(); } catch { run.status = 'failed'; run.error = { code: 'storage_failed', message: '运行记录保存失败，请检查磁盘空间。' }; }
    }
    return run;
  }
  safeError(error) {
    let message = error.message || '节点执行失败。';
    for (const secret of this.secrets) if (secret) message = message.split(secret).join('[已隐藏]');
    return { code: /^[a-z][a-z0-9_]{0,79}$/.test(error.code) ? error.code : 'execution_failed', message: message.replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').slice(0, 1000) };
  }
  async cancel(id) {
    if (!this.current || this.current.run.id !== id) throw problem('run_not_active', '该运行已结束。', 409);
    this.current.run.status = 'cancelling'; this.current.controller.abort(problem('cancelled', '用户取消了本次流程。')); await this.store.save(); return this.current.run;
  }
  async shutdown() { if (this.current) this.current.controller.abort(problem('cancelled', '应用停止，流程已取消。')); await this.completion; }
}
export { active };
