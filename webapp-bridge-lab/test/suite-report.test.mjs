import test from 'node:test';
import assert from 'node:assert/strict';
import { runSuite, withTimeout, resultStatus } from '../frontend/suite.mjs';
import { buildReport } from '../frontend/report.mjs';
import { catalog } from '../frontend/catalog.mjs';
import { validateResult, Workflow } from '../frontend/workflow.mjs';

const values = path => path === 'desktop.capabilities.list' ? { bridgeVersion: 2, capabilities: [] }
  : ['auth.isAvailable', 'desktop.capabilities.has'].includes(path) ? true
  : path.endsWith('.list') ? { items: [] }
  : path === 'desktop.theme.get' ? { themeMode: 'system', resolvedTheme: 'light' }
  : path === 'desktop.locale.get' ? { locale: 'zh-CN' }
  : path === 'desktop.microphone.getPermission' ? { permission: 'granted' }
  : path === 'desktop.requestAccess' ? { status: 'granted' } : {};

test('one-click suite calls only read methods; empty directories block details and each run counts independently', async () => {
  const calls = [];
  const options = { probes: { 'environment.host': async () => ({ methods: 64 }) }, call: async (scope, path, args) => { calls.push({ scope, path, args }); return values(path); } };
  const first = await runSuite(options), second = await runSuite(options);
  assert.deepEqual(first.summary, second.summary);
  assert.ok(calls.every(call => catalog.find(def => def.path === call.path).mode === 'read'));
  for (const check of first.checks.filter(check => ['connector.describe', 'skill.describe', 'kanban.issues.get'].includes(check.method))) { assert.equal(check.status, 'blocked'); assert.equal(check.executed, false); }
  for (const method of ['desktop.chat.open', 'desktop.copilot.open', 'desktop.copilot.close', 'assistant.chat', 'assistant.execute', 'connector.invoke']) assert.ok(first.checks.some(check => check.method === method && check.status === 'manual' && !check.executed));
  assert.ok(first.checks.filter(check => check.kind === 'reserved').every(check => !check.executed));
});

test('details use the same round and scope inventory, even when prior or other-scope IDs differ', async () => {
  const seen = [];
  const result = await runSuite({ probes: {}, call: async (scope, path, args) => {
    if (path === 'connector.list') return { items: [{ connectorId: scope + '-fresh' }] };
    if (path === 'connector.describe') { seen.push([scope, args.connectorId]); return { connectorId: args.connectorId }; }
    return values(path);
  } });
  assert.deepEqual(seen, [['page', 'page-fresh'], ['backend', 'backend-fresh']]);
  assert.equal(result.summary.failed, 0);
});

test('stop cancels a pending test and leaves later tests unexecuted; timeout prevents late completion', async () => {
  const controller = new AbortController(); let started = false;
  const promise = runSuite({ probes: { 'pending-probe': async () => { started = true; queueMicrotask(() => controller.abort(Object.assign(Error('stop'), { code: 'cancelled' }))); return new Promise(() => {}); } }, call: async () => { throw Error('Must not run'); }, signal: controller.signal });
  const suite = await promise; assert.equal(started, true); assert.equal(suite.state, 'cancelled'); assert.equal(suite.summary.executed, 1);
  assert.ok(suite.checks.filter(check => check.kind === 'automatic').every(check => check.status === 'cancelled'));
  let release; const pending = new Promise(resolve => { release = resolve; });
  await assert.rejects(withTimeout(() => pending, undefined, 5), { code: 'test_timeout' }); release({ ok: true });
});

test('default report excludes business bodies and error messages; optional details redact nested credentials', () => {
  const input = { records: [{ id: 'assistant.execute', status: 'failed', request: { text: 'PRIVATE BODY', nested: { accessToken: 'fixture-secret' } }, result: { output: 'PRIVATE RESULT' }, error: { code: 'fixture', message: 'PRIVATE ERROR Bearer fixture-secret' } }], contract: { sdkSha256: 'hash' }, workflow: [{ privateText: 'PRIVATE FLOW' }], events: ['PRIVATE EVENT'], suite: { state: 'completed', checks: [{ method: 'assistant.execute', kind: 'manual', status: 'manual', executed: false, result: 'PRIVATE RESULT', reason: 'PRIVATE REASON' }] } };
  const minimal = JSON.stringify(buildReport(input));
  assert.ok(!minimal.includes('PRIVATE')); assert.ok(!minimal.includes('fixture-secret'));
  const detailed = JSON.stringify(buildReport({ ...input, details: true }));
  assert.ok(detailed.includes('PRIVATE BODY')); assert.ok(!detailed.includes('fixture-secret')); assert.ok(detailed.includes('已隐藏'));
});

test('MCP replies use MCP validation, CLI failures and MCP isError stay business failures', () => {
  const args = { connectorId: 'c', adapter: 'mcp' }, good = { ...args, mcp: { isError: false } };
  validateResult('connector.invoke', good, args); assert.equal(resultStatus('connector.invoke', good), 'passed');
  assert.equal(resultStatus('connector.invoke', { ...good, mcp: { isError: true } }), 'business-failed');
  assert.equal(resultStatus('connector.invoke', { connectorId: 'c', adapter: 'cli', exitCode: 2 }), 'business-failed');
  assert.throws(() => validateResult('connector.invoke', { ...args, mcp: [] }, args), { code: 'invalid_response' });
});

test('history and Copilot validate exact receipts, are page-only and require human observation', () => {
  validateResult('desktop.chat.open', { chatId: 'c', status: 'opened' }, { chatId: 'c' });
  assert.throws(() => validateResult('desktop.chat.open', { chatId: 'other', status: 'opened' }, { chatId: 'c' }), { code: 'invalid_response' });
  for (const [method, open] of [['desktop.copilot.open', true], ['desktop.copilot.close', false]]) {
    validateResult(method, { open }, {}); assert.throws(() => validateResult(method, { open: !open }, {}), { code: 'invalid_response' });
    assert.equal(resultStatus(method, { open }), 'observe');
  }
});

test('pagination cannot invent or repeat cursors, and refreshing invalidates late read evidence', () => {
  const flow = new Workflow(); flow.remember({ chatId: 'c', runId: 'r' }, { kind: 'chat', channel: 'page' });
  const file = { chatId: 'c', runId: 'r', artifactId: 'a', name: 'a.txt' };
  flow.acceptList(flow.beginList({ chatId: 'c' }), { items: [file], nextCursor: 'opaque' });
  assert.throws(() => flow.beginList({ chatId: 'c', cursor: 'invented' }), { code: 'prerequisite_required' });
  const oldRead = { chatId: 'c', revision: flow.chat().revision };
  assert.throws(() => flow.checkArtifactArgs({ chatId: 'c', artifactId: 'a' }), { code: 'prerequisite_required' });
  assert.throws(() => validateResult('artifact.get', { chatId: 'c', artifactId: 'a', name: 'a.txt' }, file), { code: 'invalid_response' });
  const page = flow.beginList({ chatId: 'c', cursor: 'opaque' });
  assert.throws(() => flow.acceptList(page, { items: [], nextCursor: 'opaque' }), { code: 'invalid_response' });
  assert.throws(() => flow.assertCurrent(oldRead), { code: 'stale_result' });
});
