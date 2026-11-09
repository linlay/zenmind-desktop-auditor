import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { createServer } from '../backend/server.mjs';
import { template } from '../frontend/core/graph.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function fixture(t, options = {}) { const directory = await mkdtemp(path.join(os.tmpdir(), 'dag-http-')); const server = await createServer({ directory, env: {}, ...options }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { await server.shutdown(); await rm(directory, { recursive: true, force: true }); }); const origin = 'http://127.0.0.1:' + server.address().port;
  return { server, origin, request: async (endpoint, value, method = value === undefined ? 'GET' : 'POST', override = {}) => { const response = await fetch(origin + endpoint, { method, headers: { Origin: origin, 'X-DAG-Lab': '1', 'Content-Type': 'application/json', ...override }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }); return { status: response.status, ...await response.json() }; } };
}
test('HTTP workflow save/start/poll/delete is durable and enforces revisions and local origins', async t => {
  const { server, request } = await fixture(t);
  let workspace = await request('/api/workspace'); assert.equal(workspace.result.agentConfigured, false);
  const saved = await request('/api/graph', { graph: template('data'), revision: 0 }, 'PUT'); assert.equal(saved.result.revision, 1);
  assert.equal((await request('/api/graph', { graph: template(), revision: 0 }, 'PUT')).status, 409);
  assert.equal((await request('/api/runs', { revision: 1 }, 'POST', { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await request('/api/workspace', undefined, 'GET', { 'X-DAG-Lab': '' })).status, 403);
  assert.equal((await request('/api/workspace', undefined, 'GET', { 'X-Forwarded-Host': 'remote.example' })).status, 403);
  assert.equal((await request('/api/runs', { revision: 1, action: 'anything' })).status, 400);
  const started = await request('/api/runs', { revision: 1 }); assert.equal(started.status, 202); await server.engine.completion;
  const record = await request('/api/runs/' + started.result.id); assert.equal(record.result.status, 'succeeded');
  assert.equal((await request('/api/runs/' + started.result.id, undefined, 'DELETE')).result.deleted, true);
  assert.equal((await request('/api/runs/' + started.result.id)).status, 404);
});
test('browser APIs connect directly to Platform, choose Agent per node, read owned chat and keep token in memory', async t => {
  const calls = [], secret = 'synthetic-platform-token';
  const upstream = http.createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer ' + secret) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 401, msg: 'unauthorized' })); return; }
    let data;
    if (req.url.startsWith('/api/agents')) data = [{ key: 'agent-a', name: 'A', engine: 'native' }, { key: 'agent-b', name: 'B', engine: 'native' }, { key: 'external', engine: 'acp' }];
    else if (req.url.startsWith('/api/chat?')) data = { chatId: 'platform-chat-1', events: [{ type: 'content.message', text: '真实对话' }], resourceTicket: 'must-not-return' };
    else { assert.equal(req.url, '/api/execute'); const chunks = []; for await (const chunk of req) chunks.push(chunk); const input = JSON.parse(Buffer.concat(chunks)); calls.push(input); data = { chatId: 'platform-chat-' + calls.length, status: 'success', output: { summary: 'platform-result', items: [] } }; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 0, msg: 'success', data }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); t.after(async () => { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });
  const { server, request, origin } = await fixture(t);
  const address = 'http://127.0.0.1:' + upstream.address().port;
  assert.equal((await request('/api/platform/connect', { baseUrl: address, token: 'wrong' })).status, 401);
  const connected = await request('/api/platform/connect', { baseUrl: address, token: secret }); assert.equal(connected.result.agents.length, 2);
  assert.ok(!JSON.stringify(await request('/api/workspace')).includes(secret)); assert.ok(!JSON.stringify(server.store.value).includes(secret));
  const graph = template(); graph.nodes.find(node => node.id === 'risks').config.agentKey = 'agent-b';
  await request('/api/graph', { graph, revision: 0 }, 'PUT'); const start = await request('/api/runs', { revision: 1 }); await server.engine.completion;
  const run = (await request('/api/runs/' + start.result.id)).result; assert.equal(run.status, 'succeeded'); assert.deepEqual(calls.map(call => call.agentKey), ['agent-a','agent-b','agent-a']); assert.equal(calls[2].input.upstream.merge.extract.summary, 'platform-result');
  const chat = await request('/api/platform/chat?chatId=platform-chat-1'); assert.equal(chat.result.chatId, 'platform-chat-1'); assert.equal(chat.result.resourceTicket, undefined);
  assert.equal((await request('/api/platform/chat?chatId=unknown')).status, 403);
  const html = await fetch(origin).then(response => response.text()); assert.ok(html.includes('platform-dialog'));
});
test('final ZIP is valid, portable, has a direct Platform Bridge and no dependencies or execution data', async () => {
  const zip = await JSZip.loadAsync(await readFile(path.join(root, 'build/dag-lab.zip')), { checkCRC32: true }); const names = Object.keys(zip.files).filter(name => !zip.files[name].dir), ids = new Set(names.map(name => name.split('/')[0])); assert.equal(ids.size, 1); const id = [...ids][0];
  const manifest = JSON.parse(await zip.file(id + '/webapp.json').async('string')); assert.equal(manifest.id, id); assert.equal(manifest.target, 'any'); assert.equal(manifest.backend.command.type, 'electron-node');
  for (const file of ['frontend/app.mjs', 'frontend/core/graph.mjs', 'backend/engine.mjs', 'backend/server.mjs', 'backend/store.mjs']) assert.equal(await zip.file(id + '/' + file).async('string'), await readFile(path.join(root, file), 'utf8'));
  assert.ok(names.every(name => !/(?:^|\/)(?:node_modules|\.git|test-output|workspace\.json|\.env)(?:\/|$)/.test(name)));
  const info = JSON.parse(await zip.file(id + '/frontend/build-info.json').async('string')); assert.equal(info.platformBridge, 'Platform HTTP API'); assert.equal(zip.file(id + '/backend/bridge.mjs'), null); assert.ok(zip.file(id + '/backend/platform-bridge.mjs'));
  assert.ok(!JSON.stringify(info).includes('/Users/')); assert.equal(manifest.userConfig, undefined); assert.ok(!(await zip.file(id + '/frontend/app.mjs').async('string')).includes('/__desktop/'));
});

test('a connection verification in flight blocks new DAG execution until its identity is committed', async t => {
  let entered, release; const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const { request } = await fixture(t, { fetchImpl: async () => { entered(); await gate; return new Response(JSON.stringify({ code:0,data:[{key:'agent-a',engine:'native'}] })); } });
  const connecting = request('/api/platform/connect', { baseUrl:'http://127.0.0.1:11949',token:'fixture' });
  await started; assert.equal((await request('/api/runs',{revision:0})).status,409); release(); assert.equal((await connecting).status,200);
});
