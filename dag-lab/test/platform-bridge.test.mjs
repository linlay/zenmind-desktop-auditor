import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformBridge, normalizeBase } from '../backend/platform-bridge.mjs';
test('Platform connection rejects credential URLs, redirects and unsafe plain HTTP targets', async () => {
  for (const url of ['file:///tmp/a', 'http://user:pass@127.0.0.1:123', 'http://169.254.169.254', 'http://127.0.0.1:123?token=a']) assert.throws(() => normalizeBase(url));
  const client = new PlatformBridge({ fetchImpl: async (url, options) => { assert.equal(options.redirect, 'error'); return new Response(JSON.stringify({ code: 401, msg: 'unauthorized' }), { status: 401 }); } });
  await assert.rejects(client.listAgents(), { code: 'platform_auth_required' }); assert.equal(client.connected, false);
});
test('Platform errors preserve explicit business codes without echoing credentials', async () => {
  const client = new PlatformBridge({ token: 'private-fixture', fetchImpl: async () => new Response(JSON.stringify({ code: 422, msg: 'output_missing', data: { error: { code: 'output_missing', message: 'private-fixture missing' } } }), { status: 422 }) });
  await assert.rejects(client.execute({}), error => error.code === 'output_missing' && !error.message.includes('private-fixture'));
});
test('direct execute cancellation propagates the original abort signal and never retries', async () => {
  const controller = new AbortController(); let calls = 0;
  const client = new PlatformBridge({ fetchImpl: async (url, options) => { calls++; return new Promise((resolve,reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))); } });
  const pending = client.execute({}, { signal: controller.signal }); controller.abort(Object.assign(Error('cancelled'), { code: 'cancelled' }));
  await assert.rejects(pending, { code: 'cancelled' }); assert.equal(calls, 1);
});
