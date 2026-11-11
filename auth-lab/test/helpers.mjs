import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, exportSPKI, SignJWT } from 'jose';
import { createServer } from '../backend/server.mjs';

export async function keys() {
  const pair = await generateKeyPair('RS256', { extractable: true });
  return { ...pair, pem: await exportSPKI(pair.publicKey), jwk: { ...await exportJWK(pair.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' } };
}
export function token(key, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: 'https://identity.example.test', aud: 'auth-lab-fixture', sub: 'alice', iat: now, exp: now + 600, name: 'Alice', ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' }).sign(key);
}
export async function lab(t, rawConfig = {}, options = {}) {
  const directory = options.directory || await mkdtemp(path.join(os.tmpdir(), 'auth-lab-test-'));
  const server = await createServer({ directory, rawConfig, testing: true, preview: options.preview ?? false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { await server.shutdown(); if (!options.directory) await rm(directory, { recursive: true, force: true }); });
  const origin = rawConfig.publicOrigin || 'http://127.0.0.1:44999';
  const request = (route, settings = {}) => fetch(base + route, { ...settings, redirect: 'manual', headers: { 'x-forwarded-host': new URL(origin).host, ...settings.headers } });
  return { base, origin, directory, server, request };
}
export function desktopConfig(key, extra = {}) {
  return { desktop: { issuer: 'https://identity.example.test', audienceSha256: [createHash('sha256').update('auth-lab-fixture').digest('hex')], publicKeyPem: key.pem }, ...extra };
}
export async function signIn(app, jwt) {
  const response = await app.request('/api/auth/desktop-session', { method: 'POST', headers: { Origin: app.origin, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' }, body: '{}' });
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
