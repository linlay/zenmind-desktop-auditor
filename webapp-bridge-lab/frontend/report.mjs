const sensitive = /^(?:authorization|proxy.authorization|cookie|set.cookie|password|passwd|secret|client.?secret|api.?key|access.?token|refresh.?token|id.?token|token|credentials?|session.?id)$/i;
export function redact(value, depth = 0) {
  if (depth > 12) return '[超过显示深度]';
  if (typeof value === 'string') return value.replace(/\bBearer\s+[^\s"<>]+/gi, 'Bearer [已隐藏]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT 已隐藏]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*)[^\s&,;"']+/gi, '$1[已隐藏]')
    .replace(/(https?:\/\/[^\s/:]+:)[^\s@]+@/gi, '$1[已隐藏]@').slice(0, 16000);
  if (Array.isArray(value)) return value.slice(0, 200).map(entry => redact(entry, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, entry]) => [key,
    sensitive.test(key) ? '[已隐藏]' : /^(?:dataBase64|base64|dataUrl)$/i.test(key) ? '[二进制内容]' : redact(entry, depth + 1)]));
  return value;
}
export function buildReport({ records, contract, suite, details = false, workflow, events }) {
  return { application: 'WebApp Bridge Lab', schemaVersion: 2, generatedAt: new Date().toISOString(),
    contract: redact(contract), includesDetails: details,
    note: '仅实际调用算作执行；自动检查不包括模型、原生界面和预留方法。详情可能包含业务内容。',
    ...(suite ? { oneClickTest: { ...suite, checks: suite.checks.map(({ result, error, reason, ...check }) => ({ ...check,
      ...(error ? { errorCode: error.code } : {}), ...(details && reason ? { reason: redact(reason) } : {}) })) } } : {}),
    records: records.filter(entry => !['idle', 'running'].includes(entry.status)).map(entry => ({
      method: entry.id, scope: entry.channel || (entry.id.startsWith('backend.') ? 'backend' : 'page'),
      status: entry.status, at: entry.at, durationMs: entry.ms,
      ...(entry.error ? { errorCode: entry.error.code } : {}),
      ...(details ? { request: redact(entry.request), result: redact(entry.result), error: redact(entry.error), note: redact(entry.note) } : {})
    })), ...(details ? { workflow: redact(workflow), events: redact(events) } : {}) };
}
