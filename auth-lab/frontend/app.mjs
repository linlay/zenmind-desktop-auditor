import { loginState } from './login-state.mjs';
const $ = id => document.getElementById(id);
let bridge, status, me, expiresTimer;
const pausedKey = 'auth-lab:pause-auto-login';
const paused = () => { try { return sessionStorage.getItem(pausedKey) === '1'; } catch { return true; } };
const pause = value => { try { value ? sessionStorage.setItem(pausedKey, '1') : sessionStorage.removeItem(pausedKey); } catch { /* Manual sign-in remains available. */ } };
function message(text, error = false) { $('login-status').textContent = text; $('login-status').classList.toggle('error', error); }
function busy(value) { for (const id of ['desktop-login', 'oidc-login', 'retry', 'logout', 'save', 'new-note', 'note-close', 'note-cancel']) $(id).disabled = value; }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, credentials: 'same-origin', headers: { ...options.headers }, cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error?.message || '请求失败。'), { code: value.error?.code, status: response.status });
  return value;
}
function loggedOut(text = '选择一种方式登录。', error = false) {
  clearTimeout(expiresTimer); me = undefined;
  $('notes-list').replaceChildren(); $('note-count').textContent = '';
  for (const id of ['identity-dialog', 'note-dialog']) if ($(id).open) $(id).close();
  $('note').value = '';
  for (const id of ['user-name','identity-name','method','subject','issuer','email','expires','workspace-status']) $(id).textContent = '';
  $('workspace-view').hidden = true; $('login-view').hidden = false;
  message(text, error);
}
async function workspace(identity) {
  const result = await api('/api/notes');
  me = identity;
  $('user-name').textContent = me.user.name;
  $('identity-name').textContent = me.user.name; $('email').textContent = me.user.email || '未提供';
  $('method').textContent = me.method === 'desktop' ? 'Desktop OneID' : me.method === 'broker' ? '企业统一登录' : 'OIDC 统一认证';
  $('subject').textContent = me.user.subject; $('issuer').textContent = me.user.issuer;
  $('expires').textContent = new Date(me.expiresAt).toLocaleString();
  renderNotes(result.notes); $('note-status').textContent = '最多 8000 字';
  $('login-view').hidden = true; $('workspace-view').hidden = false; pause(false);
  clearTimeout(expiresTimer);
  expiresTimer = setTimeout(() => { pause(true); loggedOut('会话已到期，请重新登录。'); }, Math.max(0, me.expiresAt - Date.now()));
}
async function desktopLogin() {
  busy(true); message('请在 Desktop 提示中确认使用当前 OneID…');
  try {
    await bridge.auth.createSession({ exchangePath: '/api/auth/desktop-session' });
    await workspace(await api('/api/me'));
  } catch (error) {
    pause(true);
    const explanations = { sign_in_required: '请先在 Desktop 登录 OneID，然后重试。', cancelled: '已取消登录。你可以再次使用 OneID，或选择统一认证。',
      insecure_origin: '远端 OneID 登录需要 HTTPS。请在 Desktop 的网站入口打开此应用的 HTTPS 地址。', forbidden: '请从 Desktop 的网站入口或已安装的 WebApp 打开。',
      unavailable: '当前页面没有 Desktop 登录能力，请选择统一认证。' };
    loggedOut(explanations[error.code] || error.message || '登录失败，请重试。', true);
  } finally { busy(false); }
}
function startOidcLogin() {
  if (!status?.oidcLoginUrl) { message('当前地址无法发起统一认证，请使用管理员提供的认证访问地址。', true); return; }
  pause(true); location.assign(status.oidcLoginUrl);
}
async function initialize() {
  busy(true); message('正在检查登录状态…');
  $('retry').hidden = true;
  $('desktop-login').hidden = true;
  $('oidc-login').hidden = true;
  $('open-desktop').hidden = true;
  try {
    try { bridge = await import('./auth-sdk.mjs'); } catch { bridge = undefined; }
    const available = Boolean(bridge?.auth?.isAvailable());
    $('environment').textContent = available ? 'DESKTOP' : 'BROWSER';
    status = await api('/api/auth/status');
    const state = loginState(status, available, location.href);
    $('login-title').textContent = state.title;
    $('desktop-login').hidden = !state.desktopLogin;
    $('oidc-login').hidden = !state.oidcLogin;
    $('open-desktop').hidden = !state.openDesktopUrl;
    if (state.openDesktopUrl) $('open-desktop').href = state.openDesktopUrl;
    $('configuration').hidden = !state.help; $('configuration').textContent = state.help;
    $('browser-route').textContent = status.oidc ? '跳转 OIDC 统一认证，完成登录后返回。' : '尚未启用。管理员需先配置 OIDC 登录。';
    const failed = new URL(location.href).searchParams.has('login_error');
    if (failed) { pause(true); history.replaceState(null, '', '/'); }
    if (!status.canonicalRequired) {
      try { await workspace(await api('/api/me')); return; }
      catch (error) { if (error.status !== 401) throw error; }
    }
    loggedOut(failed ? '统一认证未完成，请重新登录；如持续失败，请检查应用配置。' : state.message, failed);
    if (!paused() && !status.issue) {
      pause(true); // Prevent loops after provider errors, cancellation or reload.
      if (state.desktopLogin) { await desktopLogin(); return; }
      if (state.oidcLogin) { startOidcLogin(); return; }
    }
  } catch (error) {
    loggedOut(error.message || '无法连接应用，请检查应用是否仍在运行。', true);
    // Reconnecting can fix a failed request. It cannot enable an unconfigured login method.
    $('retry').hidden = false;
  }
  finally { busy(false); }
}
$('desktop-login').addEventListener('click', desktopLogin);
$('oidc-login').addEventListener('click', startOidcLogin);
$('retry').addEventListener('click', () => { pause(false); void initialize(); });
function renderNotes(notes) {
  const rows = notes.map(note => {
    const row = document.createElement('tr');
    for (const text of [note.author, new Date(note.createdAt).toLocaleString(), note.text]) {
      const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
    }
    if (note.isMine) { const badge = document.createElement('span'); badge.className = 'mine-badge'; badge.textContent = '我的'; row.firstElementChild.append(' ', badge); }
    return row;
  });
  $('notes-list').replaceChildren(...rows);
  $('notes-empty').hidden = notes.length > 0; $('notes-table').hidden = notes.length === 0;
  $('note-count').textContent = notes.length + ' 条';
}
$('user-name').addEventListener('click', () => { if (me) $('identity-dialog').showModal(); });
$('identity-close').addEventListener('click', () => $('identity-dialog').close());
$('new-note').addEventListener('click', () => { if (!me) return; $('note').value = ''; $('note-status').textContent = '最多 8000 字'; $('note-dialog').showModal(); $('note').focus(); });
for (const id of ['note-close','note-cancel']) $(id).addEventListener('click', () => $('note-dialog').close());
$('note-dialog').addEventListener('cancel', event => { if ($('save').disabled) event.preventDefault(); });
$('note-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!me || $('save').disabled) return;
  if (!$('note').value.trim()) { $('note-status').textContent = '请先输入便签内容。'; $('note').focus(); return; }
  const current = me;
  busy(true); $('note-status').textContent = '正在保存…';
  try {
    await api('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Lab-CSRF': current.csrf }, body: JSON.stringify({ text: $('note').value }) });
    if (me !== current) return;
    $('note').value = ''; $('note-dialog').close(); $('workspace-status').textContent = '便签已保存。';
    const result = await api('/api/notes');
    if (me === current) renderNotes(result.notes);
  } catch (error) {
    if (error.status === 401) { pause(true); loggedOut('会话已失效，请重新登录。', true); }
    else if (me === current) ($('note-dialog').open ? $('note-status') : $('workspace-status')).textContent = error.message;
  } finally { busy(false); }
});
$('logout').addEventListener('click', async () => {
  if (!me) return;
  busy(true);
  try {
    await api('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Lab-CSRF': me.csrf }, body: '{}' });
    pause(true); loggedOut('已退出 Auth Lab。');
  } catch (error) {
    if (error.status === 401) { pause(true); loggedOut('会话已结束。'); }
    else $('workspace-status').textContent = error.message;
  } finally { busy(false); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && me) void api('/api/me').then(identity => {
    if (identity.user.id !== me?.user.id) { pause(true); loggedOut('登录账号已变化，请重新进入。'); }
  }).catch(error => { if (error.status === 401) { pause(true); loggedOut('会话已失效，请重新登录。'); } });
});
void initialize();
