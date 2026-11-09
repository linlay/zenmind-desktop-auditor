import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createLabServer } from '../backend/server.mjs';
import { bundlePath, listen, headers, deferred, deadline } from './helpers.mjs';

async function lab(t, options) {
  const server = createLabServer(options); t.after(() => server.closeLab());
  const origin = await listen(server);
  const call = async (action, args = {}, extra = {}, overrides = {}) => {
    const response = await fetch(origin + '/api/backend-call', { method: 'POST', headers: { ...headers(origin), ...overrides }, body: JSON.stringify({ action, args, ...extra }) });
    return { status: response.status, payload: await response.json() };
  };
  return { origin, call, server };
}

test('environment diagnostics return presence only, and no backend API exports bridge secrets', async t => {
  const secret = 'a-sensitive-test-token', url = 'http://127.0.0.1:54321/webapps';
  const { origin, call } = await lab(t, { env: { PORT: '4321', HOST: '127.0.0.1', WEBAPP_DATA_DIR: '/a/private/location', DESKTOP_ACTION_BRIDGE_TOKEN: secret, DESKTOP_ACTION_BRIDGE_URL: url },
    loadClient: () => ({ connector: { list() { throw Object.assign(Error(secret + url), { code: 'connector_failed', details: { token: secret } }); } } }) });
  const health = await fetch(origin + '/api/health').then(r => r.json()); assert.equal(health.ok, true);
  const env = await fetch(origin + '/api/env', { headers: { 'X-Bridge-Lab': '1' } }).then(r => r.json());
  assert.equal(env.presence.DESKTOP_ACTION_BRIDGE_TOKEN, true); assert.equal(env.presence.WEBAPP_DATA_DIR, true);
  const failed = await call('connector.list');
  assert.equal(failed.payload.error.code, 'connector_failed');
  const all = JSON.stringify([health, env, failed]);
  for (const value of [secret, url, '/a/private/location', '4321']) assert.equal(all.includes(value), false, value);
});

test('backend refuses cross-origin, public forwarded hosts, missing headers and unlisted actions before using the SDK', async t => {
  let loads = 0;
  const { origin, call } = await lab(t, { loadClient: () => { loads++; return {}; } });
  assert.equal((await call('connector.list', {}, {}, { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await call('connector.list', {}, {}, { 'x-forwarded-host': 'published.example.com' })).status, 403);
  assert.equal((await call('connector.list', {}, {}, { 'X-Bridge-Lab': '' })).status, 403);
  assert.equal((await call('connector.list', {}, {}, { Origin: '' })).status, 403);
  assert.equal((await call('connector.list', {}, {}, { 'x-forwarded-proto': 'https' })).status, 403);
  for (const action of ['desktop.theme.set', 'connector.__proto__', 'constructor', 'issue.transition']) {
    const response = await call(action); assert.equal(response.payload.error.code, 'action_forbidden');
  }
  assert.equal(loads, 0);
  const response = await fetch(origin + '/api/backend-call', { method: 'POST', headers: headers(origin), body: '{bad json' });
  assert.equal((await response.json()).error.code, 'invalid_json');
});

test('side-effecting calls require explicit opt-in while read-only actions never gain write access', async t => {
  const seen = [];
  const { call } = await lab(t, { loadClient: () => ({ connector: { list: () => ({ items: [] }), invoke: args => { seen.push(args); return { exitCode: 0 }; } } }) });
  assert.equal((await call('connector.list')).payload.ok, true);
  const denied = await call('connector.invoke', { connectorId: 'fixture' });
  assert.equal(denied.status, 403); assert.equal(denied.payload.error.code, 'manual_only'); assert.equal(seen.length, 0);
  assert.equal((await call('connector.invoke', { connectorId: 'fixture' }, { allowSideEffects: true })).payload.result.exitCode, 0);
  assert.deepEqual(seen, [{ connectorId: 'fixture' }]);
});

test('large or non-JSON requests are rejected and auth exchange cannot mint unverified sessions', async t => {
  const { origin } = await lab(t, { loadClient: () => { throw Error('Must not execute'); } });
  const large = await fetch(origin + '/api/backend-call', { method: 'POST', headers: headers(origin), body: JSON.stringify({ action: 'assistant.chat', args: { message: 'x'.repeat(270000) } }) });
  assert.equal(large.status, 413); assert.equal((await large.json()).error.code, 'body_too_large');
  const plain = await fetch(origin + '/api/backend-call', { method: 'POST', headers: { ...headers(origin), 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(plain.status, 415);
  const auth = await fetch(origin + '/api/auth/session', { method: 'POST', headers: { Authorization: 'Bearer not-a-verified-token' } });
  assert.equal(auth.status, 501); assert.equal(auth.headers.get('set-cookie'), null);
});

test('real copied backend SDK sends credentials only to its Desktop bridge; artifacts are consumed as bounded streams', async t => {
  const { createBackendClient } = await import(pathToFileURL(path.join(await bundlePath(), 'backend/bridge.mjs')));
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks)); seen.push({ request, auth: req.headers.authorization, path: req.url });
    let result;
    if (request.action === 'connector.list') result = { items: [{ connectorId: 'fixture', name: 'Fixture' }] };
    else if (request.action === 'artifact.read') result = { dataBase64: Buffer.from('测试产物内容').toString('base64') };
    else if (request.action === 'assistant.execute') result = { chatId: 'execute-chat', status: 'success', output: { amount: 128 } };
    else result = {};
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result }));
  });
  const upstreamOrigin = await listen(upstream); t.after(() => { upstream.closeAllConnections(); return new Promise(r => upstream.close(r)); });
  const client = createBackendClient({ url: upstreamOrigin + '/webapps', token: 'synthetic-backend-token' });
  const { call } = await lab(t, { loadClient: () => client });
  assert.equal((await call('connector.list')).payload.result.items[0].connectorId, 'fixture');
  const artifact = await call('artifact.read', { chatId: 'chat-1', artifactId: 'artifact-1' });
  assert.equal(artifact.payload.result.text, '测试产物内容'); assert.equal(artifact.payload.result.byteLength, Buffer.byteLength('测试产物内容'));
  const executed = await call('assistant.execute', { message: '提取金额', input: { text: '128 元' }, outputSchema: { type: 'object' } }, { allowSideEffects: true });
  assert.deepEqual(executed.payload.result, { chatId: 'execute-chat', status: 'success', output: { amount: 128 } });
  assert.equal(seen.length, 3); assert.ok(seen.every(row => row.path === '/webapps/actions/call' && row.auth === 'Bearer synthetic-backend-token'));
  const reserved = await call('artifact.open', { chatId: 'chat-1', artifactId: 'artifact-1' });
  assert.equal(reserved.payload.error.code, 'not_implemented'); assert.equal(seen.length, 3);
});

test('cancelling a backend execution disconnects the real copied SDK HTTP request', async t => {
  const { createBackendClient } = await import(pathToFileURL(path.join(await bundlePath(), 'backend/bridge.mjs')));
  const started = deferred(), disconnected = deferred();
  const upstream = http.createServer(async (req, res) => {
    for await (const chunk of req) { /* drain */ }
    res.on('close', () => disconnected.resolve()); started.resolve();
  });
  const upstreamOrigin = await listen(upstream); t.after(() => { upstream.closeAllConnections(); return new Promise(r => upstream.close(r)); });
  const { origin } = await lab(t, { loadClient: () => createBackendClient({ url: upstreamOrigin + '/webapps', token: 'synthetic' }) });
  const controller = new AbortController();
  const request = fetch(origin + '/api/backend-call', { method: 'POST', headers: headers(origin), signal: controller.signal,
    body: JSON.stringify({ action: 'assistant.execute', args: { message: 'Wait', outputSchema: { type: 'object' } }, allowSideEffects: true }) });
  const rejected = assert.rejects(request, error => error.name === 'AbortError');
  await deadline(started.promise); controller.abort(); await rejected; await deadline(disconnected.promise);
});

test('backend subscription streams events and does not confuse unsubscribing with stopping a run', async t => {
  const stopped = [];
  const { origin } = await lab(t, { loadClient: () => ({ assistant: { async *subscribe(args, { signal }) {
    yield { type: 'text.delta', text: '你好', cursor: 1 }; yield { type: 'run.finished', cursor: 2 };
  }, stop: args => { stopped.push(args); } } }) });
  const response = await fetch(origin + '/api/backend-subscribe', { method: 'POST', headers: headers(origin),
    body: JSON.stringify({ action: 'assistant.subscribe', args: { runId: 'run-1' }, allowSideEffects: true }) });
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.map(event => event.type), ['text.delta', 'run.finished']); assert.equal(stopped.length, 0);
});
