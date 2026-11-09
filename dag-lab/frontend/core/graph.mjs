export const TYPES = { input: { label: '输入', icon: '↳', color: 'blue' }, agent: { label: '智能体', icon: '✦', color: 'violet' }, merge: { label: '汇总', icon: '⋈', color: 'amber' }, output: { label: '输出', icon: '↗', color: 'green' } };
export const DEFAULT_SCHEMA = { type: 'object', properties: { summary: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'items'], additionalProperties: false };
export const problem = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function jsonBytes(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
export function validateGraph(graph, { draft = false } = {}) {
  const errors = [];
  const fail = text => errors.push(text);
  if (!object(graph) || graph.version !== 1 || typeof graph.name !== 'string' || !graph.name.trim() || graph.name.length > 80 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return { valid: false, errors: ['流程格式错误：需要 version:1、名称、nodes 和 edges。'], order: [] };
  if (graph.nodes.length > 40 || graph.edges.length > 160 || jsonBytes(graph) > 512 * 1024) return { valid: false, errors: ['流程最多 40 个节点、160 条连线和 512 KiB。'], order: [] };
  const byId = new Map();
  for (const node of graph.nodes) {
    if (!object(node) || !/^[a-zA-Z][\w-]{0,63}$/.test(node.id) || ['__proto__', 'constructor', 'prototype'].includes(node.id) || !Object.hasOwn(TYPES, node.type) || typeof node.label !== 'string' || !node.label.trim() || node.label.length > 80 || !object(node.config) || !Number.isFinite(node.x) || !Number.isFinite(node.y) || node.x < 0 || node.y < 0 || node.x > 5000 || node.y > 5000) { fail('节点格式、名称或位置不合法。'); continue; }
    if (byId.has(node.id)) fail(`节点 ID 重复：${node.id}`);
    byId.set(node.id, node);
    if (node.type === 'agent') {
      if (node.config.agentKey !== undefined && (typeof node.config.agentKey !== 'string' || node.config.agentKey.length > 256)) fail(`${node.label}：Agent key 不合法。`);
      if (typeof node.config.message !== 'string' || (!draft && !node.config.message.trim()) || node.config.message.length > 12000) fail(`${node.label}：任务说明需要 1–12000 个字符。`);
      if (!object(node.config.outputSchema) || node.config.outputSchema.type !== 'object' || jsonBytes(node.config.outputSchema) > 65536) fail(`${node.label}：结果 Schema 根类型必须为 object，且不超过 64 KiB。`);
    }
    if (node.type === 'input' && !Object.hasOwn(node.config, 'value')) fail(`${node.label}：缺少输入值。`);
  }
  const incoming = new Map([...byId.keys()].map(id => [id, []])), outgoing = new Map([...byId.keys()].map(id => [id, []])), seen = new Set();
  for (const edge of graph.edges) {
    if (!object(edge) || !byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target) { fail('连线必须连接两个不同的已有节点。'); continue; }
    const key = edge.source + ':' + edge.target;
    if (seen.has(key)) fail('存在重复连线。'); seen.add(key);
    incoming.get(edge.target).push(edge.source); outgoing.get(edge.source).push(edge.target);
    if (byId.get(edge.source).type === 'output' || byId.get(edge.target).type === 'input') fail('输入节点不能有上游，输出节点不能有下游。');
  }
  const degree = new Map([...incoming].map(([id, parents]) => [id, parents.length]));
  const queue = [...degree].filter(([, count]) => count === 0).map(([id]) => id), order = [];
  while (queue.length) { const id = queue.shift(); order.push(id); for (const next of outgoing.get(id)) { degree.set(next, degree.get(next) - 1); if (degree.get(next) === 0) queue.push(next); } }
  if (order.length !== byId.size) fail('流程存在环：请移除循环依赖。');
  if (!draft) {
    if (!graph.nodes.some(node => node.type === 'input') || !graph.nodes.some(node => node.type === 'output')) fail('流程至少需要一个输入和一个输出节点。');
    for (const [id, node] of byId) { if (node.type !== 'input' && !incoming.get(id).length) fail(`${node.label}：请连接上游节点。`); if (node.type !== 'output' && !outgoing.get(id).length) fail(`${node.label}：请连接下游或输出节点。`); }
  }
  return { valid: errors.length === 0, errors, order };
}
export function requireGraph(graph, options) {
  const validation = validateGraph(graph, options);
  if (!validation.valid) throw problem('invalid_graph', validation.errors.join('\n'));
  // JSON transport is intentional; no executable expressions or custom node code.
  return JSON.parse(JSON.stringify(graph));
}
export function createNode(type, index = 0) {
  if (!Object.hasOwn(TYPES, type)) throw problem('invalid_node', '未知节点类型。');
  return { id: type + '-' + globalThis.crypto.randomUUID().slice(0, 8), type, label: TYPES[type].label + ' ' + (index + 1), x: 100 + index % 4 * 260, y: 90 + Math.floor(index / 4) * 200,
    config: type === 'input' ? { value: { text: '请输入要处理的内容' } } : type === 'agent' ? { message: '根据 input.upstream 的内容完成分析，使用 result_submit 提交结果。', outputSchema: structuredClone(DEFAULT_SCHEMA) } : {} };
}
export function template(kind = 'review') {
  const node = (id, type, label, x, y, config = {}) => ({ id, type, label, x, y, config });
  const edge = (source, target) => ({ source, target });
  if (kind === 'data') return { version: 1, name: '数据汇总 · 无模型', nodes: [node('input-a', 'input', '项目资料', 80, 110, { value: { project: '新产品发布', budget: 12000 } }), node('input-b', 'input', '交付要求', 80, 340, { value: { deadline: '两周', format: '方案文档' } }), node('merge', 'merge', '汇总上下文', 390, 220), node('output', 'output', '最终输出', 710, 220)], edges: [edge('input-a', 'merge'), edge('input-b', 'merge'), edge('merge', 'output')] };
  if (kind === 'blank') return { version: 1, name: '未命名流程', nodes: [node('input', 'input', '输入资料', 100, 220, { value: { text: '' } }), node('output', 'output', '最终输出', 440, 220)], edges: [edge('input', 'output')] };
  return { version: 1, name: '需求评审工作流', nodes: [node('input', 'input', '需求资料', 60, 250, { value: { text: '我们计划为中小团队做一个 AI 周报工具。支持导入任务记录，自动汇总成果与风险，人工审核后导出。首期两周完成，暂不接入企业 IM。' } }), node('extract', 'agent', '提取核心需求', 340, 110, { message: '从 input.upstream 中提取核心需求。summary 为一句话概括，items 为需求清单。仅依据输入，使用 result_submit 交卷。', outputSchema: structuredClone(DEFAULT_SCHEMA) }), node('risks', 'agent', '识别实施风险', 340, 390, { message: '从 input.upstream 中识别实施风险，重点检查范围、时间和人工审核。summary 为概括，items 为风险清单。使用 result_submit 交卷。', outputSchema: structuredClone(DEFAULT_SCHEMA) }), node('merge', 'merge', '合并两路分析', 620, 250), node('plan', 'agent', '生成执行建议', 900, 250, { message: '结合 input.upstream 中的需求和风险，给出两周内可执行的方案。summary 为整体建议，items 为按顺序排列的行动步骤。使用 result_submit 交卷，不调用外部服务。', outputSchema: structuredClone(DEFAULT_SCHEMA) }), node('output', 'output', '评审结果', 1180, 250)], edges: [edge('input', 'extract'), edge('input', 'risks'), edge('extract', 'merge'), edge('risks', 'merge'), edge('merge', 'plan'), edge('plan', 'output')] };
}
