import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAuth, cookie, transactionCookieName } from './auth.mjs';
import { loadConfig, parseConfig, problem, isPrivateHttpOrigin } from './config.mjs';
import { createStore } from './store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function requestOrigin(req, config) {
  const authority = req.headers['x-forwarded-host'] || req.headers.host;
  if (typeof authority !== 'string' || /[\s,/@\\?#]/u.test(authority)) throw problem('invalid_host', '访问地址无效。', 403);
  let url;
  try { url = new URL('http://' + authority); } catch { throw problem('invalid_host', '访问地址无效。', 403); }
  if (url.host !== authority || url.pathname !== '/') throw problem('invalid_host', '访问地址无效。', 403);
  if (config.publicOrigin && authority === new URL(config.publicOrigin).host) return config.publicOrigin;
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return url.origin;
  if (config.allowPrivateHttpForTesting && isPrivateHttpOrigin(url.origin)) return url.origin;
  throw problem('canonical_origin_required', '请使用配置的 HTTPS 入口登录。', 403);
}
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/iu.test(req.headers['content-type'] || '')) throw problem('content_type', '请求需要 JSON。', 415);
  let length = 0; const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 32768) { req.resume(); throw problem('body_too_large', '请求内容过大。', 413); }
    chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw problem('invalid_json', '请求不是合法 JSON 对象。'); }
}
function sameOrigin(req, origin) {
  if (req.headers.origin !== origin || req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw problem('origin_forbidden', '请求来源与应用不匹配。', 403);
}
function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
  res.end(JSON.stringify(value));
}
function redirect(res, url, headers = {}) {
  res.writeHead(303, { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers }); res.end();
}
export async function createServer({ directory = process.env.WEBAPP_DATA_DIR, rawConfig, preview = false, testing = false } = {}) {
  if (!directory) throw Error('WEBAPP_DATA_DIR is required; use npm run dev for local preview.');
  const loaded = rawConfig === undefined ? await loadConfig(directory) : { config: parseConfig(rawConfig, { testing }), issue: '' };
  let { config, issue } = loaded;
  let auth = createAuth(config, { testing });
  const store = await createStore(directory);
  let refreshPromise;
  async function refreshConfiguration() {
    if (rawConfig !== undefined) return;
    if (!refreshPromise) refreshPromise = (async () => {
      const next = await loadConfig(directory);
      if (JSON.stringify(next.config) !== JSON.stringify(config) || next.issue !== issue) {
        auth.close(); config = next.config; issue = next.issue; auth = createAuth(config, { testing });
      }
    })().finally(() => { refreshPromise = undefined; });
    await refreshPromise;
  }
  const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
    '/login-state.mjs': ['login-state.mjs', 'text/javascript; charset=utf-8'],
    '/auth-sdk.mjs': ['auth-sdk.mjs', 'text/javascript; charset=utf-8'] };
  const attempts = new Map();
  function limit(req) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const key = req.socket.remoteAddress || 'unknown';
    const value = attempts.get(key) || { count: 0, until: now + 60000 };
    if (attempts.size >= 512 && !attempts.has(key) || ++value.count > 60) throw problem('too_many_attempts', '登录请求过多，请稍后重试。', 429);
    attempts.set(key, value);
  }
  const server = http.createServer(async (req, res) => {
    let endpoint = '', origin = '';
    try {
      await refreshConfiguration();
      if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.length > 8192) throw problem('invalid_request', '请求地址无效。');
      const url = new URL(req.url, 'http://127.0.0.1'); endpoint = url.pathname;
      if (req.method === 'GET' && endpoint === '/api/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && endpoint === '/api/auth/status') {
        let canonicalRequired = false, loginOrigin = config.publicOrigin;
        try { loginOrigin ||= requestOrigin(req, config); } catch { canonicalRequired = true; }
        return json(res, 200, { oidc: Boolean(config.broker), oidcMode: config.broker ? 'ticket' : '', desktop: Boolean(config.desktop), issue,
          oidcLoginUrl: config.broker && loginOrigin ? loginOrigin + '/api/auth/oidc/start' : '', canonicalRequired,
          desktopOpenUrl: config.desktop ? config.desktopOpenUrl : '' });
      }
      if (endpoint.startsWith('/api/')) {
        origin = requestOrigin(req, config);
        if (req.method === 'GET' && endpoint === '/api/auth/oidc/start') {
          limit(req);
          if (origin !== config.publicOrigin && config.publicOrigin) return redirect(res, config.publicOrigin + '/api/auth/oidc/start');
          const started = await auth.start(origin);
          return redirect(res, started.url, { 'Set-Cookie': started.header });
        }
        if (req.method === 'GET' && endpoint === '/api/auth/oidc/callback') {
          const result = await auth.complete(req, req.url, origin);
          return redirect(res, origin + '/', { 'Set-Cookie': [result.header, cookie(transactionCookieName(origin), '', origin, 0)] });
        }
        if (req.method === 'POST' && endpoint === '/api/auth/desktop-session') {
          limit(req); sameOrigin(req, origin);
          const value = await body(req);
          if (Object.keys(value).length) throw problem('invalid_args', '身份交换不接受页面传入的用户信息。');
          const header = req.headers.authorization;
          if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw problem('sign_in_required', '需要 Desktop 提交 OneID 凭据。', 401);
          const result = await auth.exchange(header.slice(7), origin);
          return json(res, 200, { ok: true }, { 'Set-Cookie': result.header });
        }
        const session = auth.current(req, origin);
        if (req.method === 'GET' && endpoint === '/api/me') return json(res, 200, { user: session.user, method: session.method, expiresAt: session.expiresAt, csrf: session.csrf });
        if (req.method === 'GET' && endpoint === '/api/notes') return json(res, 200, { notes: store.list(session.user.id) });
        if (req.method === 'GET' && endpoint === '/api/note') return json(res, 200, store.get(session.user.id));
        if (req.method === 'POST') {
          sameOrigin(req, origin);
          if (req.headers['x-auth-lab-csrf'] !== session.csrf) throw problem('csrf_forbidden', '会话校验失败，请刷新后重试。', 403);
          const value = await body(req);
          if (endpoint === '/api/auth/logout') {
            if (Object.keys(value).length) throw problem('invalid_args', '退出请求不接受额外参数。');
            return json(res, 200, { ok: true }, { 'Set-Cookie': auth.logout(req, origin) });
          }
          if (endpoint === '/api/notes') {
            if (Object.keys(value).some(key => key !== 'text') || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 8000) throw problem('invalid_note', '请输入 1 至 8000 字的便签内容。');
            return json(res, 201, store.add(session.user, value.text.trim()));
          }
          if (endpoint === '/api/note') {
            if (Object.keys(value).some(key => !['text', 'revision'].includes(key)) || typeof value.text !== 'string' ||
                value.text.length > 8000 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw problem('invalid_note', '便签最多 8000 字，且需要有效版本。');
            return json(res, 200, await store.save(session.user.id, value.text, value.revision));
          }
        }
        throw problem('not_found', '接口不存在。', 404);
      }
      if (preview && req.method === 'GET' && staticFiles[endpoint]) {
        const [name, contentType] = staticFiles[endpoint];
        const bytes = await readFile(path.join(root, 'frontend', name));
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes); return;
      }
      throw problem('not_found', '页面不存在。', 404);
    } catch (error) {
      // No upstream error messages, claims, tokens, authorization codes or response bodies cross this boundary.
      const known = Number.isInteger(error.status) && typeof error.code === 'string';
      const authentication = endpoint === '/api/auth/desktop-session' || endpoint.startsWith('/api/auth/oidc/');
      if (endpoint.startsWith('/api/auth/oidc/') && origin && (!config.publicOrigin || origin === config.publicOrigin)) return redirect(res, origin + '/?login_error=1', { 'Set-Cookie': cookie(transactionCookieName(origin), '', origin, 0) });
      json(res, known ? error.status : authentication ? 401 : 500, { ok: false, error: known ? { code: error.code, message: error.message } :
        { code: authentication ? 'authentication_failed' : 'server_error', message: authentication ? '认证失败，请核对认证配置或重新登录。' : '服务处理失败，请检查应用数据目录。' } });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 50;
  server.shutdown = async () => { auth.close(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); await store.close(); };
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT);
  if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('Desktop must inject loopback HOST and PORT.');
  const server = await createServer();
  server.listen(port, host, () => console.log('Auth Lab ready; authentication configuration stays outside the application package.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.shutdown(); });
}
