import { readFile } from 'node:fs/promises';
import path from 'node:path';
import desktopDefaults from '../config/cutej-enterprise.desktop.example.json' with { type: 'json' };

export function problem(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
const loopback = url => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
export function isPrivateHttpOrigin(value) {
  const url = new URL(value), parts = url.hostname.split('.');
  if (url.protocol !== 'http:' || parts.length !== 4 || parts.some(p => !/^(0|[1-9][0-9]{0,2})$/.test(p) || Number(p) > 255)) return false;
  const [a,b] = parts.map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254;
}
export const DEFAULT_BROKER_ORIGIN = 'https://auth-test.zenmind.cc';
export const AUTH_LAB_APP_ID = '6a1f1ea6-eec4-4fca-9a3c-a2e2024f56bd';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function trustedUrl(value, { originOnly = false, allowLocalHttp = false, allowPrivateHttpForTesting = false } = {}) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search ||
      (url.protocol !== 'https:' && !(allowLocalHttp && url.protocol === 'http:' && loopback(url) || allowPrivateHttpForTesting && isPrivateHttpOrigin(url.origin))) ||
      (originOnly && url.pathname !== '/')) throw Error('Invalid trusted URL');
  return originOnly ? url.origin : value;
}

export function parseConfig(raw = {}, { testing = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid configuration');
  const forbidden = value => value && typeof value === 'object' && Object.entries(value).some(([key, item]) => /client.?id|secret/i.test(key) || forbidden(item));
  if (forbidden(raw)) throw Error('Client identifiers and secrets are forbidden in Auth Lab configuration');
  if (raw.allowPrivateHttpForTesting !== undefined && typeof raw.allowPrivateHttpForTesting !== 'boolean') throw Error('Invalid private HTTP testing policy');
  const allowPrivateHttpForTesting = raw.allowPrivateHttpForTesting === true;
  const publicOrigin = raw.publicOrigin ? trustedUrl(raw.publicOrigin, { originOnly: true, allowLocalHttp: true, allowPrivateHttpForTesting }) : '';
  const sessionSeconds = raw.sessionSeconds ?? 3600;
  if (!Number.isInteger(sessionSeconds) || sessionSeconds < 60 || sessionSeconds > 28800) throw Error('Invalid sessionSeconds');
  if (raw.oidc !== undefined || Object.keys(raw).some(key => /client.?id|secret/i.test(key))) throw Error('Legacy OIDC credentials are forbidden in Auth Lab');
  let broker, desktop;
  if (raw.broker) {
    const value = raw.broker;
    if (Object.keys(value).some(key => /client.?id|secret/i.test(key)) || value.appId !== AUTH_LAB_APP_ID) throw Error('Invalid ticket configuration');
    broker = { origin: trustedUrl(value.origin, { originOnly: true, allowLocalHttp: true }), appId: value.appId };
  }
  if (raw.desktop) {
    const value = raw.desktop;
    const issuer = trustedUrl(value.issuer, { allowLocalHttp: testing });
    if (value.audience !== undefined) throw Error('Use an Audience fingerprint, never the original client identifier');
    const audienceSha256 = value.audienceSha256;
    const algorithms = value.algorithms ?? ['RS256'];
    if (!Array.isArray(audienceSha256) || !audienceSha256.length || audienceSha256.some(item => typeof item !== 'string' || !/^[a-f0-9]{64}$/.test(item)) ||
        !Array.isArray(algorithms) || !algorithms.length || algorithms.some(item => !['RS256', 'PS256', 'ES256'].includes(item)) ||
        Boolean(value.jwksUri) === Boolean(value.publicKeyPem)) throw Error('Desktop requires audience and exactly one key source');
    if (value.publicKeyPem && algorithms.length !== 1) throw Error('PEM requires exactly one algorithm');
    desktop = { issuer, audienceSha256, algorithms,
      jwksUri: value.jwksUri ? trustedUrl(value.jwksUri, { allowLocalHttp: testing }) : '', publicKeyPem: value.publicKeyPem || '' };
  }
  const allowedUsers = raw.allowedUsers ?? [];
  if (!Array.isArray(allowedUsers) || allowedUsers.some(item => !item || typeof item.issuer !== 'string' || typeof item.subject !== 'string' || !item.subject)) throw Error('Invalid allowedUsers');
  const desktopOpenUrl = raw.desktopOpenUrl ?? '';
  if (desktopOpenUrl && !/^(?:cutej|zenmind):\/\/open$/u.test(desktopOpenUrl)) throw Error('Invalid Desktop open URL');
  return { publicOrigin, sessionSeconds, broker, desktop, allowedUsers, desktopOpenUrl, allowPrivateHttpForTesting };
}

export async function loadConfig(directory) {
  try {
    return { config: parseConfig(JSON.parse(await readFile(path.join(directory, 'auth-config.json'), 'utf8'))), issue: '' };
  } catch (error) {
    if (error.code === 'ENOENT') return { config: parseConfig({ ...desktopDefaults, allowPrivateHttpForTesting: true, broker: { origin: DEFAULT_BROKER_ORIGIN, appId: AUTH_LAB_APP_ID } }), issue: '' };
    return { config: parseConfig(), issue: error.code === 'ENOENT' ? '尚未配置认证。请按接入指南准备包外 auth-config.json，然后重启应用。' : '认证配置无效。请核对包外 auth-config.json，然后重启应用。' };
  }
}
