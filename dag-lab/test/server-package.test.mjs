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
test('official backend SDK carries exact Agent inputs and token only on its own upstream request', async t => {
  const bundle = JSON.parse(await readFile(path.join(root, 'build/bundle.json'))); const sdkPath = path.join(root, 'build', bundle.packagePath, 'backend/bridge.mjs');
  const { createBackendClient } = await import(pathToFileURL(sdkPath)); const calls = [];
  const upstream = http.createServer(async (req, res) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); const call = JSON.parse(Buffer.concat(chunks)); calls.push(call); assert.equal(req.headers.authorization, 'Bearer synthetic-dag-token'); assert.equal(call.action, 'assistant.execute'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: { chatId: 'fixture-chat-' + calls.length, status: 'success', output: { summary: 'fixture-only', items: ['real-wire-output'] } } })); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); t.after(async () => { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });
  const sdk = createBackendClient({ url: 'http://127.0.0.1:' + upstream.address().port + '/webapps', token: 'synthetic-dag-token' });
  const { server, request } = await fixture(t, { configured: true, getClient: async () => sdk });
  await request('/api/graph', { graph: template(), revision: 0 }, 'PUT'); const start = await request('/api/runs', { revision: 1 }); await server.engine.completion;
  const run = (await request('/api/runs/' + start.result.id)).result; assert.equal(run.status, 'succeeded'); assert.equal(calls.length, 3);
  assert.equal(calls[2].args.input.upstream.merge.extract.summary, 'fixture-only'); assert.ok(!JSON.stringify(run).includes('synthetic-dag-token'));
});
test('final ZIP is valid, portable, has the exact SDK fingerprint and no dependencies or execution data', async () => {
  const zip = await JSZip.loadAsync(await readFile(path.join(root, 'build/dag-lab.zip')), { checkCRC32: true }); const names = Object.keys(zip.files).filter(name => !zip.files[name].dir), ids = new Set(names.map(name => name.split('/')[0])); assert.equal(ids.size, 1); const id = [...ids][0];
  const manifest = JSON.parse(await zip.file(id + '/webapp.json').async('string')); assert.equal(manifest.id, id); assert.equal(manifest.target, 'any'); assert.equal(manifest.backend.command.type, 'electron-node');
  for (const file of ['frontend/app.mjs', 'frontend/core/graph.mjs', 'backend/engine.mjs', 'backend/server.mjs', 'backend/store.mjs']) assert.equal(await zip.file(id + '/' + file).async('string'), await readFile(path.join(root, file), 'utf8'));
  assert.ok(names.every(name => !/(?:^|\/)(?:node_modules|\.git|test-output|workspace\.json|\.env)(?:\/|$)/.test(name)));
  const info = JSON.parse(await zip.file(id + '/frontend/build-info.json').async('string')); assert.equal(info.sdkSha256, createHash('sha256').update(await zip.file(id + '/backend/bridge.mjs').async('nodebuffer')).digest('hex'));
  assert.ok(!JSON.stringify(info).includes('/Users/')); assert.equal(manifest.userConfig.fields[0].source, 'desktop.agents');
});
