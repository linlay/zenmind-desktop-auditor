import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';
import { problem, isPrivateHttpOrigin } from './config.mjs';

export const SESSION_COOKIE = 'zm_auth_lab_8c439d21';
export const TX_COOKIE = 'zm_auth_lab_oidc_8c439d21';
const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
// Chromium cookies are scoped to a host, not a TCP port. Each Desktop gateway
// origin needs its own name so a new runtime never overwrites an older grant.
export const sessionCookieName = origin => SESSION_COOKIE + '_' + hash(origin).slice(0, 12);
export const transactionCookieName = origin => TX_COOKIE + '_' + hash(origin).slice(0, 12);
export function cookies(req) {
  const result = new Map();
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      const name = part.slice(0, index).trim();
      if (result.has(name)) throw problem('invalid_cookie', '会话 Cookie 重复，请清理本站 Cookie 后重试。');
      result.set(name, part.slice(index + 1).trim());
    }
  }
  return result;
}
export function cookie(name, value, origin, seconds) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(seconds))}${origin.startsWith('https:') ? '; Secure' : ''}`;
}

export function createAuth(config, { testing = false } = {}) {
  const sessions = new Map(), transactions = new Map();
  // A package default can follow a local Desktop gateway; remote deployments require an explicit HTTPS origin.
  const allowedOrigin = origin => config.publicOrigin ? origin === config.publicOrigin : (['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname) || config.allowPrivateHttpForTesting && isPrivateHttpOrigin(origin));
  let desktopKey;
  const clean = map => { const now = Date.now(); for (const [key, value] of map) if (value.expiresAt <= now) map.delete(key); };
  function identity(claims) {
    if (typeof claims.iss !== 'string' || typeof claims.sub !== 'string' || !claims.sub || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) throw problem('invalid_identity', '身份凭据不完整或已过期。', 401);
    if (config.allowedUsers.length && !config.allowedUsers.some(user => user.issuer === claims.iss && user.subject === claims.sub)) throw problem('user_forbidden', '当前账号未获准访问此应用。', 403);
    const text = key => typeof claims[key] === 'string' ? claims[key].slice(0, 256) : '';
    return { id: hash(JSON.stringify([claims.iss, claims.sub])), issuer: claims.iss, subject: claims.sub,
      name: text('name') || text('preferred_username') || claims.sub.slice(0, 256), email: text('email') };
  }
  function establish(claims, method, origin, sessionDeadline = claims.exp * 1000) {
    clean(sessions);
    if (sessions.size >= 512) throw problem('session_capacity', '登录会话已达上限，请稍后重试。', 503);
    const user = identity(claims), value = random();
    const expiresAt = Math.min(Date.now() + config.sessionSeconds * 1000, sessionDeadline);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw problem('login_expired', '登录认证已到期，请重新登录。', 401);
    const session = { user, method, origin, expiresAt, csrf: random() };
    sessions.set(hash(value), session);
    return { session, header: cookie(sessionCookieName(origin), value, origin, (expiresAt - Date.now()) / 1000) };
  }
  return {
    async start(origin) {
      if (!allowedOrigin(origin) || !config.broker) throw problem('broker_unconfigured', '统一认证未配置。', 503);
      clean(transactions);
      if (transactions.size >= 128) throw problem('login_capacity', '登录请求过多。', 429);
      const id = random(), state = random(), nonce = random(), verifier = random();
      const url = new URL(config.broker.origin + '/api/login');
      const callback = origin + '/api/auth/oidc/callback';
      for (const [key, value] of Object.entries({ app_id: config.broker.appId, callback, state, nonce, challenge: createHash('sha256').update(verifier).digest('base64url') })) url.searchParams.set(key, value);
      transactions.set(hash(id), { state, nonce, verifier, origin, expiresAt: Date.now() + 600000 });
      return { url: url.href, header: cookie(transactionCookieName(origin), id, origin, 600) };
    },
    async complete(req, url, origin) {
      if (!allowedOrigin(origin) || !config.broker) throw problem('invalid_callback', '认证回调无效。', 401);
      clean(transactions);
      const key = hash(cookies(req).get(transactionCookieName(origin)) || ''), tx = transactions.get(key);
      transactions.delete(key);
      const responseUrl = new URL(url, origin), code = responseUrl.searchParams.get('code');
      if (!tx || tx.origin !== origin || responseUrl.searchParams.get('state') !== tx.state || !code || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw problem('login_expired', '登录请求已失效。', 401);
      const callback = origin + '/api/auth/oidc/callback';
      const response = await fetch(config.broker.origin + '/api/ticket/exchange', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, verifier: tx.verifier, appId: config.broker.appId, callback }) });
      if (!response.ok) { await response.body?.cancel(); throw problem('authentication_failed', '统一认证失败。', 401); }
      const text = await response.text();
      if (text.length > 16384) throw problem('invalid_identity', '认证结果无效。', 401);
      const result = JSON.parse(text), claims = result.identity, now = Math.floor(Date.now() / 1000);
      if (result.appId !== config.broker.appId || result.callback !== callback || result.nonce !== tx.nonce ||
          !claims || claims.iss !== config.broker.origin || !Number.isInteger(claims.iat) || claims.iat > now ||
          !Number.isInteger(claims.exp) || claims.exp > claims.iat + 3600) throw problem('invalid_identity', '认证结果无效。', 401);
      return establish(claims, 'broker', origin);
    },
    async exchange(token, origin) {
      if (!config.desktop) throw problem('desktop_unconfigured', 'Desktop OneID 验证尚未配置。', 503);
      if (typeof token !== 'string' || token.length > 16384 || token.split('.').length !== 3) throw problem('invalid_token', 'OneID 凭据无效。', 401);
      const value = config.desktop;
      if (!desktopKey) desktopKey = value.publicKeyPem ? await importSPKI(value.publicKeyPem, value.algorithms[0]) : createRemoteJWKSet(new URL(value.jwksUri), { timeoutDuration: 10000 });
      const { payload } = await jwtVerify(token, desktopKey, { issuer: value.issuer,
        algorithms: value.algorithms, requiredClaims: ['iss', 'sub', 'iat', 'exp'], clockTolerance: 0 });
      const audiences = typeof payload.aud === 'string' ? [payload.aud] : payload.aud;
      if (!Array.isArray(audiences) || !audiences.every(item => typeof item === 'string') || !audiences.some(item => value.audienceSha256.includes(hash(item)))) throw problem('invalid_audience', 'OneID 凭据用途不匹配。', 401);
      return establish(payload, 'desktop', origin);
    },
    current(req, origin) {
      clean(sessions);
      const session = sessions.get(hash(cookies(req).get(sessionCookieName(origin)) || ''));
      if (!session || session.origin !== origin) throw problem('sign_in_required', '请先登录。', 401);
      return session;
    },
    logout(req, origin) {
      sessions.delete(hash(cookies(req).get(sessionCookieName(origin)) || ''));
      return cookie(sessionCookieName(origin), '', origin, 0);
    },
    close() { sessions.clear(); transactions.clear(); }
  };
}
