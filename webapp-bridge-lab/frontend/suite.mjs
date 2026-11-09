import { catalog } from './catalog.mjs';
import { BACKEND_METHODS, validateResult } from './workflow.mjs';
export const relations = { 'connector.describe': ['connector.list', 'connectorId'], 'skill.describe': ['skill.list', 'skillId'], 'kanban.issues.get': ['kanban.issues.list', 'id', 'issueId'] };
export const resultStatus = (path, value) => value?.cancelled === true || value?.canceled === true || value?.status === 'cancelled' ? 'cancelled'
  : ['failure', 'failed'].includes(value?.status) || path === 'connector.invoke' && (typeof value.exitCode === 'number' && value.exitCode !== 0 || value.mcp?.isError === true) ? 'business-failed'
  : ['auth.isAvailable', 'desktop.capabilities.has'].includes(path) && value === false || ['denied', 'restricted', 'unavailable'].includes(value?.permission) ? 'blocked'
  : ['desktop.chat.open', 'desktop.copilot.open', 'desktop.copilot.close', 'desktop.notification.show', 'desktop.browser.openExternal', 'artifact.open', 'desktop.clipboard.writeText'].includes(path) ? 'observe' : 'passed';
const conditionCodes = new Set(['bridge_unavailable', 'sdk_unavailable', 'assistant_agent_unavailable', 'assistant_agent_unsupported', 'desktop_identity_required', 'kanban_unavailable', 'service_unavailable', 'connector_auth_required', 'connector_auth_expired', 'permission_denied', 'unavailable', 'not_implemented', 'webapp_ui_unavailable', 'copilot_disabled']);
export function errorStatus(error) { return ['cancelled', 'aborted'].includes(error.code) || error.name === 'AbortError' ? 'cancelled' : conditionCodes.has(error.code) || error.code === 'prerequisite_required' ? 'blocked' : 'failed'; }
export async function withTimeout(work, signal, timeoutMs = 12000) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason || Object.assign(Error('测试已停止'), { code: 'cancelled' }));
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(Object.assign(Error('单项测试超时'), { code: 'test_timeout' })), timeoutMs);
  let rejectAbort;
  const ended = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', rejectAbort, { once: true }); if (controller.signal.aborted) rejectAbort(); });
  try { return await Promise.race([ended, Promise.resolve().then(() => { controller.signal.throwIfAborted(); return work(controller.signal); })]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', rejectAbort); }
}
export function summarize(checks) {
  const summary = { automatic: 0, completed: 0, executed: 0, passed: 0, failed: 0, blocked: 0, cancelled: 0, manual: 0, reserved: 0 };
  for (const check of checks) { if (check.kind === 'automatic') { summary.automatic++; if (!['pending', 'running'].includes(check.status)) summary.completed++; } if (check.executed) summary.executed++; if (check.status in summary) summary[check.status]++; }
  return summary;
}
export async function runSuite({ probes, call, signal, onUpdate = () => {}, onRecord = () => {}, timeoutMs = 12000, environment = 'desktop' }) {
  const checks = Object.keys(probes).map(method => ({ id: method, method, scope: 'environment', kind: 'automatic', status: 'pending', executed: false }));
  for (const scope of ['page', 'backend']) for (const def of catalog) {
    if (scope === 'backend' && !BACKEND_METHODS.has(def.path)) continue;
    const kind = def.mode === 'reserved' ? 'reserved' : def.mode === 'read' ? 'automatic' : 'manual';
    checks.push({ id: scope + ':' + def.path, method: def.path, scope, kind, status: kind === 'automatic' ? 'pending' : kind, executed: false });
  }
  const suite = { startedAt: new Date().toISOString(), environment, state: 'running', checks };
  const results = new Map();
  const update = () => onUpdate({ ...suite, checks: checks.map(check => ({ ...check })), summary: summarize(checks) });
  update();
  for (const check of checks.filter(check => check.kind === 'automatic')) {
    if (signal?.aborted) break;
    const relation = relations[check.method]; let args = structuredClone(catalog.find(def => def.path === check.method)?.args);
    if (relation) {
      const parent = results.get(check.scope + ':' + relation[0]); const item = parent?.items?.[0];
      if (!item) { Object.assign(check, { status: 'blocked', reason: parent ? '目录为空，没有可读取详情的条目' : '本轮前置列表检查未通过' }); update(); continue; }
      args = { [relation[2] || relation[1]]: item[relation[1]] };
    }
    check.status = 'running'; update(); const start = performance.now();
    try {
      const value = await withTimeout(async currentSignal => {
        check.executed = true;
        return check.scope === 'environment' ? probes[check.method](currentSignal) : call(check.scope, check.method, args, currentSignal);
      }, signal, timeoutMs);
      if (check.scope !== 'environment') validateResult(check.method, value, args);
      check.status = resultStatus(check.method, value); if (check.status === 'passed') results.set(check.id, value);
      check.result = value; if (check.method === 'environment.host') suite.compatibility = value;
    } catch (error) { check.status = errorStatus(error); check.error = { code: error.code || 'lab_error' }; check.reason = error.message; }
    check.durationMs = Math.round(performance.now() - start); onRecord({ ...check, request: args }); update();
  }
  for (const check of checks) if (check.status === 'pending') { check.status = 'cancelled'; check.reason = '测试停止，此项未调用'; }
  suite.state = signal?.aborted ? 'cancelled' : 'completed'; suite.finishedAt = new Date().toISOString(); update();
  return { ...suite, summary: summarize(checks) };
}
export function websocketEcho(url, signal, WebSocketImpl = globalThis.WebSocket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url); const message = 'Bridge Lab echo ' + Date.now();
    let finished = false;
    function finish(error) { if (finished) return; finished = true; signal.removeEventListener('abort', aborted); socket.close(); error ? reject(error) : resolve({ echoMatches: true }); }
    const aborted = () => finish(signal.reason || Object.assign(Error('测试已取消'), { code: 'cancelled' }));
    signal.addEventListener('abort', aborted, { once: true });
    socket.onopen = () => { if (finished) socket.close(); else socket.send(message); };
    socket.onmessage = event => finish(event.data === message ? null : Object.assign(Error('WebSocket 回声不匹配'), { code: 'echo_mismatch' }));
    socket.onerror = () => finish(Object.assign(Error('WebSocket 连接失败'), { code: 'websocket_failed' }));
    socket.onclose = () => { if (!finished) finish(Object.assign(Error('WebSocket 未返回回声即关闭'), { code: 'connection_closed' })); };
    if (signal.aborted) aborted();
  });
}
