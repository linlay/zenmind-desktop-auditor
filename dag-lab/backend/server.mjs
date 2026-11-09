import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { Engine, active } from './engine.mjs';
import { requireGraph, problem } from '../frontend/core/graph.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
function localAuthority(value) { try { const url = new URL('http://' + value); return typeof value === 'string' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.host === value && !url.username && !url.password; } catch { return false; } }
export function guard(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!localAuthority(host) || req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'http') throw problem('local_only', '工作流只允许本机 Desktop 页面访问。', 403);
  if (req.headers['x-dag-lab'] !== '1') throw problem('request_forbidden', '缺少应用请求标识。', 403);
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw problem('origin_forbidden', '不接受跨源调用。', 403);
  if (req.headers.origin && req.headers.origin !== 'http://' + host || req.method !== 'GET' && !req.headers.origin) throw problem('origin_forbidden', '写请求需要精确同源 Origin。', 403);
}
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw problem('content_type', '请求需要 JSON。', 415);
  const chunks = []; let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) { bytes += chunk.length; if (bytes > 600 * 1024) { req.resume(); throw problem('body_too_large', '请求超过 600 KiB。', 413); } chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { throw problem('invalid_json', '请求不是合法 JSON 对象。'); }
}
function fields(value, allowed) { if (Object.keys(value).some(key => !allowed.includes(key))) throw problem('invalid_args', '请求包含未支持的字段。'); }
export async function createServer({ env = process.env, directory, preview = false, frontendRoot = path.join(root, 'frontend'), getClient, configured } = {}) {
  const storage = directory || env.WEBAPP_DATA_DIR;
  if (!storage) throw problem('data_directory_required', '需要 Desktop 注入 WEBAPP_DATA_DIR；本地预览请运行 npm run dev。');
  const store = await new Store(storage).init();
  let client;
  const load = getClient || (async () => {
    if (!env.DESKTOP_ACTION_BRIDGE_URL || !env.DESKTOP_ACTION_BRIDGE_TOKEN) throw problem('agent_unavailable', '受管后端 SDK 未配置。');
    if (!client) { const { createBackendClient } = await import('./bridge.mjs'); client = createBackendClient({ url: env.DESKTOP_ACTION_BRIDGE_URL, token: env.DESKTOP_ACTION_BRIDGE_TOKEN }); } return client;
  });
  const engine = new Engine({ store, secrets: [env.DESKTOP_ACTION_BRIDGE_TOKEN], getClient: load, configured: configured ?? Boolean(env.DESKTOP_ACTION_BRIDGE_URL && env.DESKTOP_ACTION_BRIDGE_TOKEN) });
  const send = (res, status, result, error) => {
    if (res.destroyed || res.writableEnded) return;
    let text = JSON.stringify(error ? { ok: false, error } : { ok: true, result });
    if (env.DESKTOP_ACTION_BRIDGE_TOKEN) text = text.split(env.DESKTOP_ACTION_BRIDGE_TOKEN).join('[已隐藏]');
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(text);
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1'), endpoint = url.pathname;
      if (endpoint === '/api/health' && req.method === 'GET') return send(res, 200, { healthy: true });
      if (endpoint.startsWith('/api/')) {
        guard(req);
        if (endpoint === '/api/workspace' && req.method === 'GET') return send(res, 200, { graph: store.value.graph, revision: store.value.revision || 0, agentConfigured: engine.configured, activeRunId: engine.current?.run.id || null,
          runs: store.value.runs.map(({ id, name, status, startedAt, finishedAt, mode }) => ({ id, name, status, startedAt, finishedAt, mode })) });
        if (endpoint === '/api/graph' && req.method === 'PUT') {
          const value = await body(req); fields(value, ['graph', 'revision']);
          if (value.revision !== (store.value.revision || 0)) throw problem('revision_conflict', '另一页面已更新流程，请刷新后重试；本页可先导出草稿。', 409);
          const graph = requireGraph(value.graph, { draft: true }), previous = store.value.graph, revision = store.value.revision || 0;
          store.value.graph = graph; store.value.revision = revision + 1;
          try { await store.save(); } catch (error) { store.value.graph = previous; store.value.revision = revision; throw error; }
          return send(res, 200, { revision: store.value.revision });
        }
        if (endpoint === '/api/runs' && req.method === 'POST') { const value = await body(req); fields(value, ['revision']); if (value.revision !== (store.value.revision || 0)) throw problem('revision_conflict', '流程已更新，请先刷新。', 409); const run = await engine.start(store.value.graph); return send(res, 202, { id: run.id }); }
        const match = endpoint.match(/^\/api\/runs\/([a-f0-9-]{36})(\/cancel)?$/);
        if (match) {
          const run = store.value.runs.find(run => run.id === match[1]); if (!run) throw problem('run_not_found', '运行记录不存在。', 404);
          if (req.method === 'POST' && match[2]) { const value = await body(req); fields(value, []); await engine.cancel(run.id); return send(res, 200, { id: run.id, status: run.status }); }
          if (req.method === 'GET' && !match[2]) return send(res, 200, run);
          if (req.method === 'DELETE' && !match[2]) { if (active(run)) throw problem('run_in_progress', '请先取消该运行。', 409); const previous = store.value.runs; store.value.runs = previous.filter(row => row.id !== run.id); try { await store.save(); } catch (error) { store.value.runs = previous; throw error; } return send(res, 200, { deleted: true }); }
        }
        throw problem('not_found', '接口不存在。', 404);
      }
      if (preview && req.method === 'GET') {
        const name = endpoint === '/' ? 'index.html' : endpoint.slice(1);
        if (!['index.html', 'app.mjs', 'styles.css', 'favicon.svg', 'core/graph.mjs', 'build-info.json'].includes(name)) throw problem('not_found', '文件不存在。', 404);
        const bytes = await readFile(path.join(frontendRoot, name)); res.writeHead(200, { 'Content-Type': mime[path.extname(name)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes); return;
      }
      throw problem('not_found', '接口不存在。', 404);
    } catch (error) { const normalized = engine.safeError(error); send(res, error.status || (error.code === 'ENOENT' ? 404 : 500), undefined, error.status ? normalized : { code: 'server_error', message: '本地服务处理失败，请检查应用日志和数据目录。' }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.engine = engine; server.store = store;
  server.shutdown = async () => { await engine.shutdown(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); };
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT);
  if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('Desktop must inject loopback HOST and PORT.');
  const server = await createServer(); server.listen(port, host, () => console.log('DAG Lab ready'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.shutdown(); });
}
