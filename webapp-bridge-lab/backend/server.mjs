import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { acceptEcho } from './websocket.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const READ = new Set(['connector.list', 'connector.describe', 'skill.list', 'skill.describe',
  'kanban.boards.list', 'kanban.issues.list', 'kanban.issues.get', 'artifact.list', 'artifact.get', 'artifact.read']);
const WRITE = new Set(['assistant.upload', 'assistant.resource.read', 'assistant.steer', 'assistant.send', 'assistant.interrupt', 'assistant.submit', 'assistant.chat', 'assistant.execute', 'assistant.stop', 'connector.invoke']);
const RESERVED = new Set(['assistant.image', 'artifact.open', 'artifact.saveAs', 'automation.list', 'automation.get',
  'automation.create', 'automation.update', 'automation.pause', 'automation.resume', 'automation.remove', 'automation.runs.list', 'automation.runs.get']);
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
export class LabError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function json(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function localAuthority(authority) {
  if (typeof authority !== 'string' || !authority || authority.includes(',') || /[\s/@?#]/.test(authority)) return false;
  try {
    const url = new URL('http://' + authority);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.host === authority.toLowerCase();
  } catch { return false; }
}
export function checkLocalRequest(req, { mutation = false, websocket = false } = {}) {
  const authority = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  if (!localAuthority(authority) || (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'http')) {
    throw new LabError('local_only', 'Backend tests are available only from the local Desktop gateway.', 403);
  }
  const origin = req.headers.origin;
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new LabError('origin_forbidden', 'Invalid Origin.', 403); }
    // Gateway rewrites Host during a WS upgrade but leaves the browser Origin intact.
    if (parsed.protocol !== 'http:' || !localAuthority(parsed.host) || parsed.origin !== origin ||
        (!websocket && parsed.host.toLowerCase() !== authority.toLowerCase())) {
      throw new LabError('origin_forbidden', 'Use this page from its exact local gateway origin.', 403);
    }
  } else if (mutation || websocket) throw new LabError('origin_required', 'Origin is required.', 403);
  if (!websocket && req.headers['x-bridge-lab'] !== '1') throw new LabError('lab_header_required', 'X-Bridge-Lab: 1 is required.', 403);
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin' && !websocket) {
    throw new LabError('origin_forbidden', 'Cross-site calls are disabled.', 403);
  }
}
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']))) throw new LabError('content_type', 'Use application/json.', 415);
  if (Number(req.headers['content-length']) > 262144) { req.resume(); throw new LabError('body_too_large', 'Request exceeds 256 KiB.', 413); }
  const chunks = []; let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 262144) { req.resume(); throw new LabError('body_too_large', 'Request exceeds 256 KiB.', 413); }
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new LabError('invalid_json', 'Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LabError('invalid_args', 'Use a JSON object.');
  return value;
}
function resolveMethod(client, action) {
  const parts = action.split('.');
  let owner = client;
  for (const part of parts.slice(0, -1)) owner = Object.hasOwn(owner || {}, part) ? owner[part] : undefined;
  const name = parts.at(-1);
  if (!owner || !Object.hasOwn(owner, name) || typeof owner[name] !== 'function') throw new LabError('sdk_unavailable', 'This backend SDK does not provide that method.', 409);
  return owner[name].bind(owner);
}
async function normalizeResult(value) {
  if (value && typeof value.getReader === 'function') {
    const reader = value.getReader(); const chunks = []; let bytes = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 1048576) throw new LabError('artifact_too_large', 'Artifact exceeds 1 MiB.');
        chunks.push(Buffer.from(next.value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const all = Buffer.concat(chunks);
    const preview = all.subarray(0, 8192), meta = { byteLength: bytes, previewBytes: preview.length };
    try { const text = new TextDecoder('utf-8', { fatal: true }).decode(all); if (text.includes('\0')) throw Error('binary'); return { ...meta, encoding: 'utf-8', text, complete: true, previewText: new TextDecoder().decode(preview) }; }
    catch { return { ...meta, encoding: 'base64', base64: preview.toString('base64') }; }
  }
  return value ?? null;
}

export function createLabServer({ env = process.env, preview = false, loadClient, frontendRoot = path.join(projectRoot, 'frontend') } = {}) {
  let clientPromise;
  const getClient = () => {
    if (!clientPromise) clientPromise = Promise.resolve().then(async () => {
      if (loadClient) return loadClient();
      if (!env.DESKTOP_ACTION_BRIDGE_URL || !env.DESKTOP_ACTION_BRIDGE_TOKEN) throw new LabError('bridge_unavailable', 'Run the ZIP inside Desktop to use the backend SDK.', 503);
      const { createBackendClient } = await import('./bridge.mjs');
      return createBackendClient({ url: env.DESKTOP_ACTION_BRIDGE_URL, token: env.DESKTOP_ACTION_BRIDGE_TOKEN });
    }).catch(error => { clientPromise = null; throw error; });
    return clientPromise;
  };
  const server = http.createServer(async (req, res) => {
    const start = performance.now(); let action = 'backend', timer;
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once('aborted', abort); res.once('close', abort);
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
      // Auth is intentionally unconfigured: never accept an unverified real Bearer to mint a Cookie.
      if (url.pathname === '/api/auth/session') return json(res, 501, { ok: false, error: { code: 'auth_fixture_unconfigured', message: 'Configure a token-verifying exchange backend before testing auth.createSession.' } });
      if (url.pathname.startsWith('/api/')) {
        checkLocalRequest(req, { mutation: req.method !== 'GET' });
        if (url.pathname === '/api/env' && req.method === 'GET') {
          const presence = Object.fromEntries(Object.keys(env).filter(key => /^(?:HOST$|PORT$|WEBAPP_|DESKTOP_ACTION_BRIDGE_)/.test(key)).sort().map(key => [key, true]));
          return json(res, 200, { ok: true, presence, versions: { node: process.versions.node, electron: process.versions.electron || null } });
        }
        if (url.pathname === '/api/echo' && req.method === 'POST') {
          const input = await body(req);
          if (Object.keys(input).some(key => key !== 'message') || typeof input.message !== 'string') throw new LabError('invalid_args', 'Use a message string.');
          const byteLength = Buffer.byteLength(input.message);
          if (byteLength > 16384) throw new LabError('message_too_large', 'Echo exceeds 16 KiB.', 413);
          return json(res, 200, { ok: true, result: { message: input.message, byteLength } });
        }
        if (!['/api/backend-call', '/api/backend-subscribe'].includes(url.pathname)) throw new LabError('not_found', 'No such endpoint.', 404);
        if (req.method !== 'POST') throw new LabError('method_not_allowed', 'Use POST.', 405);
        const input = await body(req);
        action = typeof input.action === 'string' ? input.action : 'unknown';
        if (url.pathname === '/api/backend-subscribe') {
          if (action !== 'assistant.subscribe' || input.allowSideEffects !== true) throw new LabError('manual_only', 'Subscription requires an explicit manual request.', 403);
          if (typeof input.args?.runId !== 'string' || !input.args.runId) throw new LabError('invalid_args', 'runId is required.');
          const subscribe = resolveMethod(await getClient(), action);
          timer = setTimeout(abort, 30 * 60 * 1000); timer.unref();
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          for await (const event of subscribe(input.args, { signal: controller.signal })) {
            if (controller.signal.aborted) break;
            if (!res.write(JSON.stringify(event) + '\n')) await once(res, 'drain', { signal: controller.signal });
          }
          return res.end();
        }
        if (!READ.has(action) && !WRITE.has(action) && !RESERVED.has(action)) throw new LabError('action_forbidden', 'Action is outside the backend test allowlist.', 403);
        if (WRITE.has(action) && input.allowSideEffects !== true) throw new LabError('manual_only', 'Enable side effects before this manual backend call.', 403);
        const method = resolveMethod(await getClient(), action);
        timer = setTimeout(abort, action === 'assistant.execute' ? 620000 : 120000); timer.unref();
        if (action === 'assistant.upload') { const { text, ...args } = input.args || {}; if (typeof text !== 'string') throw new LabError('invalid_args', 'Supply text for the upload fixture.'); input.args = { ...args, file: new Blob([text], { type: 'text/plain' }) }; }
        const value = action === 'assistant.execute' ? await method(input.args, { signal: controller.signal }) : await method(input.args ?? {});
        if (controller.signal.aborted) throw new LabError('cancelled', 'Request ended.', 408);
        const result = await normalizeResult(value);
        if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1048576) throw new LabError('result_too_large', 'Result exceeds 2 MiB.');
        return json(res, 200, { ok: true, result, ms: Math.round(performance.now() - start) });
      }
      if (preview && req.method === 'GET') {
        const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        // Preview serves only named frontend files; it never supplies a mock Desktop SDK.
        if (!['index.html', 'app.mjs', 'catalog.mjs', 'workflow.mjs', 'suite.mjs', 'report.mjs', 'styles.css', 'build-info.json'].includes(relative)) throw new LabError('not_found', 'No such file.', 404);
        let bytes;
        try { bytes = await readFile(path.join(frontendRoot, relative)); } catch { throw new LabError('not_found', 'File unavailable. Import the built ZIP in Desktop.', 404); }
        res.writeHead(200, { 'Content-Type': mime[path.extname(relative)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(bytes);
      }
      throw new LabError('not_found', 'No such endpoint.', 404);
    } catch (error) {
      const code = typeof error.code === 'string' && /^[a-z][a-z0-9_]{0,80}$/.test(error.code) ? error.code : 'backend_failed';
      // Desktop failures may contain service-owned details. Do not echo them or credentials through this proxy.
      const payload = { ok: false, error: { code, action, message: error instanceof LabError ? error.message : 'Backend SDK call failed (' + code + '). Inspect Desktop diagnostics for details.' }, ms: Math.round(performance.now() - start) };
      if (res.headersSent) { if (!res.destroyed) res.end(JSON.stringify(payload) + '\n'); }
      else json(res, error.status || (code === 'not_implemented' ? 501 : 400), payload);
    } finally { clearTimeout(timer); req.off('aborted', abort); res.off('close', abort); }
  });
  const sockets = new Set();
  const webSockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    try {
      if (req.url !== '/api/ws') throw Error('not_found');
      checkLocalRequest(req, { websocket: true });
      if (webSockets.size >= 32) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
      if (acceptEcho(req, socket, head)) { webSockets.add(socket); socket.once('close', () => webSockets.delete(socket)); }
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  server.closeLab = async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  };
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Desktop injects loopback HOST on both macOS and Windows; reject a public bind explicitly.
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw Error('Bridge Lab must bind to loopback.');
  const server = createLabServer();
  server.listen(Number(process.env.PORT || 0), host, () => console.log('Bridge Lab backend ready'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void server.closeLab());
}
