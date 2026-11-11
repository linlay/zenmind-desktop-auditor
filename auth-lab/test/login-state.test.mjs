import test from 'node:test';
import assert from 'node:assert/strict';
import { loginState } from '../frontend/login-state.mjs';
import { parseConfig } from '../backend/config.mjs';
import { keys, desktopConfig, lab } from './helpers.mjs';

test('plain browser with only Desktop auth gives a real Desktop handoff without claiming it can log in', () => {
  const state = loginState({ desktop: true, oidc: false, desktopOpenUrl: 'cutej://open' }, false, 'http://127.0.0.1:51731/');
  assert.equal(state.desktopLogin, false);
  assert.equal(state.oidcLogin, false);
  assert.equal(state.title, '请在 Desktop 中继续');
  assert.equal(state.openDesktopUrl, 'cutej://open');
  assert.match(state.help, /内置浏览器中打开当前网址/);
  assert.doesNotMatch(state.help, /HTTPS/);
});

test('remote browser explains the Website HTTPS path and refuses arbitrary launch URLs', () => {
  const state = loginState({ desktop: true, oidc: false, desktopOpenUrl: 'javascript:alert(1)' }, false, 'https://app.example.test');
  assert.equal(state.openDesktopUrl, '');
  assert.match(state.help, /内置浏览器或工作面板.*HTTPS/);
  assert.throws(() => parseConfig({ desktopOpenUrl: 'cutej://open?route=arbitrary' }));
});

test('actual Desktop and configured OIDC show only login methods usable in that host', () => {
  assert.equal(loginState({ desktop: true }, true, 'http://localhost:1234').desktopLogin, true);
  const browser = loginState({ desktop: true, oidc: true }, false, 'https://app.example.test');
  assert.equal(browser.oidcLogin, true); assert.equal(browser.desktopLogin, false);
  assert.equal(browser.message, '选择一种方式登录。');
  const missing = loginState({ issue: '尚未配置认证' }, false, 'http://localhost:1234');
  assert.equal(missing.title, '登录尚未配置'); assert.equal(missing.oidcLogin, false); assert.equal(missing.desktopLogin, false);
});

test('preview exposes the shared login-state module and only the configured public Desktop launch URL', async t => {
  const key = await keys(), app = await lab(t, desktopConfig(key, { desktopOpenUrl: 'cutej://open' }), { preview: true });
  const status = await (await app.request('/api/auth/status')).json();
  assert.equal(status.desktopOpenUrl, 'cutej://open'); assert.equal(status.oidc, false);
  const response = await app.request('/login-state.mjs'); assert.equal(response.status, 200);
  assert.match(await response.text(), /export function loginState/);
  assert.equal((await app.request('/api/me')).status, 401);
});
