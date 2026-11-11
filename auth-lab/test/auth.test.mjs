import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { keys, token, lab, desktopConfig, signIn } from './helpers.mjs';
import { parseConfig } from '../backend/config.mjs';
import { requestOrigin } from '../backend/server.mjs';

test('explicit empty configuration disables authentication while health and static preview work', async t => {
  const app = await lab(t, {}, { preview: true });
  assert.equal((await app.request('/api/health')).status, 200);
  assert.equal((await app.request('/')).status, 200);
  const status = await (await app.request('/api/auth/status')).json(); assert.equal(status.oidc, false); assert.equal(status.desktop, false);
  assert.equal((await app.request('/api/me')).status, 401);
  assert.equal((await app.request('/api/note')).status, 401);
  const result = await signIn(app, 'invalid.fake.token'); assert.equal(result.response.status, 503); assert.equal(result.cookie, undefined);
});

test('Desktop verifies signature, issuer, audience, expiry and required claims', async t => {
  const key = await keys(), bad = await keys(), app = await lab(t, desktopConfig(key));
  for (const [name, extra, signer] of [
    ['wrong audience', { aud: 'desktop-only' }], ['wrong issuer', { iss: 'https://evil.test' }], ['expired', { exp: 1 }],
    ['future nbf', { nbf: Math.floor(Date.now() / 1000) + 1000 }], ['no subject', { sub: '' }], ['missing expiry', { exp: undefined }],
    ['wrong signature', {}, bad.privateKey]
  ]) await t.test(name, async () => {
    const result = await signIn(app, await token(signer || key.privateKey, extra)); assert.equal(result.response.status, 401); assert.equal(result.cookie, undefined);
    assert.doesNotMatch(await result.response.text(), /eyJ|fixture-access-token/);
  });
  const jwt = await token(key.privateKey), signed = await signIn(app, jwt);
  assert.equal(signed.response.status, 200); assert.match(signed.cookie, /^zm_auth_lab_/);
  assert.match(signed.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const identity = await (await app.request('/api/me', { headers: { Cookie: signed.cookie } })).json();
  assert.equal(identity.user.subject, 'alice'); assert.equal(identity.method, 'desktop'); assert.ok(identity.csrf);
  assert.ok(!JSON.stringify(identity).includes(jwt));
});

test('per-user notes, CSRF, origin, revisions, logout and restart isolation', async t => {
  const key = await keys(), directory = await mkdtemp(path.join(os.tmpdir(), 'auth-lab-persistence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await lab(t, desktopConfig(key), { directory });
  const alice = await signIn(app, await token(key.privateKey));
  const identity = await (await app.request('/api/me', { headers: { Cookie: alice.cookie } })).json();
  const headers = { Cookie: alice.cookie, Origin: app.origin, 'Content-Type': 'application/json', 'X-Auth-Lab-CSRF': identity.csrf };
  const post = (value, extra = {}) => app.request('/api/note', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(value) });
  assert.equal((await post({ text: 'private note', revision: 0 }, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post({ text: 'private note', revision: 0 }, { 'X-Auth-Lab-CSRF': 'bad' })).status, 403);
  assert.equal((await post({ text: 'private note', revision: 0, userId: 'someone' })).status, 400);
  assert.equal((await post({ text: 'private note', revision: 0 })).status, 200);
  assert.equal((await post({ text: 'stale note', revision: 0 })).status, 409);
  const bob = await signIn(app, await token(key.privateKey, { sub: 'bob' }));
  assert.equal((await (await app.request('/api/note', { headers: { Cookie: bob.cookie } })).json()).text, '');
  assert.equal((await (await app.request('/api/note', { headers: { Cookie: alice.cookie } })).json()).text, 'private note');
  const logout = await app.request('/api/auth/logout', { method: 'POST', headers, body: '{}' }); assert.equal(logout.status, 200);
  assert.equal((await app.request('/api/me', { headers: { Cookie: alice.cookie } })).status, 401);
  await app.server.shutdown();
  const next = await lab(t, desktopConfig(key), { directory });
  assert.equal((await next.request('/api/me', { headers: { Cookie: bob.cookie } })).status, 401);
  const again = await signIn(next, await token(key.privateKey));
  assert.equal((await (await next.request('/api/note', { headers: { Cookie: again.cookie } })).json()).text, 'private note');
  assert.equal((await readFile(path.join(directory, 'notes.sqlite'))).subarray(0,16).toString(), 'SQLite format 3\0');
});

test('HTTPS remote session cookies and explicit user allowlist', async t => {
  const key = await keys(), app = await lab(t, desktopConfig(key, { publicOrigin: 'https://auth.example.test', allowedUsers: [{ issuer: 'https://identity.example.test', subject: 'alice' }] }));
  const alice = await signIn(app, await token(key.privateKey));
  assert.equal(alice.response.status, 200); assert.match(alice.response.headers.get('set-cookie'), /; Secure/); assert.doesNotMatch(alice.response.headers.get('set-cookie'), /Domain=/i);
  const bob = await signIn(app, await token(key.privateKey, { sub: 'bob' })); assert.equal(bob.response.status, 403);
  assert.throws(() => requestOrigin({ headers: { host: '192.168.1.25:4000' } }, parseConfig()), /HTTPS/);
  assert.throws(() => requestOrigin({ headers: { host: '127.0.0.1:22,evil.test' } }, parseConfig()), /无效/);
  assert.throws(() => parseConfig({ desktop: { issuer: 'https://id.test', audience: 'app' } }));
  assert.equal(parseConfig({ desktop: { issuer: 'https://id.test/realm/', audienceSha256: ['0'.repeat(64)], publicKeyPem: key.pem } }).desktop.issuer, 'https://id.test/realm/');
});

test('different loopback gateway ports have distinct cookie names and select their own session', async t => {
  const key = await keys(), app = await lab(t, desktopConfig(key));
  const first = await signIn(app, await token(key.privateKey));
  const secondOrigin = 'http://127.0.0.1:45000';
  const second = await app.request('/api/auth/desktop-session', { method: 'POST', headers: {
    'x-forwarded-host': '127.0.0.1:45000', Origin: secondOrigin, Authorization: 'Bearer ' + await token(key.privateKey, { sub: 'bob' }), 'Content-Type': 'application/json'
  }, body: '{}' });
  assert.equal(second.status, 200);
  const secondCookie = second.headers.get('set-cookie').split(';')[0];
  assert.notEqual(first.cookie.split('=')[0], secondCookie.split('=')[0]);
  const combined = first.cookie + '; ' + secondCookie;
  const alice = await (await app.request('/api/me', { headers: { Cookie: combined } })).json();
  const bob = await (await app.request('/api/me', { headers: { Cookie: combined, 'x-forwarded-host': '127.0.0.1:45000' } })).json();
  assert.equal(alice.user.subject, 'alice'); assert.equal(bob.user.subject, 'bob');
  assert.equal((await app.request('/api/me', { headers: { Cookie: first.cookie, 'x-forwarded-host': '127.0.0.1:45000' } })).status, 401);
});




test('shared SQLite notes, authenticated ownership flags, ordering and restart persistence', async t => {
  const key = await keys(), directory = await mkdtemp(path.join(os.tmpdir(), 'auth-lab-list-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await lab(t, desktopConfig(key), { directory });
  const alice = await signIn(app, await token(key.privateKey, { name: 'Alice' }));
  const identity = await (await app.request('/api/me', { headers: { Cookie: alice.cookie } })).json();
  const headers = { Cookie: alice.cookie, Origin: app.origin, 'Content-Type': 'application/json', 'X-Auth-Lab-CSRF': identity.csrf };
  const add = value => app.request('/api/notes', { method: 'POST', headers, body: JSON.stringify(value) });
  assert.equal((await add({text:'  '})).status,400);
  assert.equal((await add({text:'spoof',author:'Bob'})).status,400);
  assert.equal((await add({text:'first <script>alert(1)</script>'})).status,201);
  const second = await (await add({text:'second\nline'})).json();
  assert.equal(second.author,'Alice');assert.equal(second.subject,'alice');assert.ok(Number.isFinite(Date.parse(second.createdAt)));
  const notes = await (await app.request('/api/notes', {headers:{Cookie:alice.cookie}})).json();
  assert.deepEqual(notes.notes.map(n=>n.text),['second\nline','first <script>alert(1)</script>']);
  const bob = await signIn(app, await token(key.privateKey,{sub:'bob'}));
  const bobNotes = await (await app.request('/api/notes',{headers:{Cookie:bob.cookie}})).json();
  assert.equal(bobNotes.notes.length,2);assert.ok(bobNotes.notes.every(n=>n.isMine===false));
  assert.ok(notes.notes.every(n=>n.isMine===true));
  const bobIdentity = await (await app.request('/api/me',{headers:{Cookie:bob.cookie}})).json();
  const bobAdd = await app.request('/api/notes',{method:'POST',headers:{Cookie:bob.cookie,Origin:app.origin,'Content-Type':'application/json','X-Auth-Lab-CSRF':bobIdentity.csrf},body:JSON.stringify({text:'bob shared note'})});
  assert.equal(bobAdd.status,201);
  const aliceList = await (await app.request('/api/notes',{headers:{Cookie:alice.cookie}})).json();
  assert.equal(aliceList.notes[0].text,'bob shared note');assert.equal(aliceList.notes[0].isMine,false);
  const bobList = await (await app.request('/api/notes',{headers:{Cookie:bob.cookie}})).json();
  assert.equal(bobList.notes[0].isMine,true);
  assert.equal((await app.request('/api/notes')).status,401);
  await app.server.shutdown();
  const next = await lab(t, desktopConfig(key),{directory});
  const again = await signIn(next,await token(key.privateKey));
  assert.equal((await (await next.request('/api/notes',{headers:{Cookie:again.cookie}})).json()).notes.length,3);
});
