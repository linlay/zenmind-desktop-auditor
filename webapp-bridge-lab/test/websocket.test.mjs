import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createLabServer } from '../backend/server.mjs';
import { listen, deadline } from './helpers.mjs';

function encoded(opcode, data, masked = true) {
  const payload = Buffer.from(data), mask = randomBytes(4);
  const extended = payload.length < 126 ? 0 : payload.length < 65536 ? 2 : 8;
  const header = Buffer.alloc(2 + extended + (masked ? 4 : 0)); header[0] = 0x80 | opcode;
  header[1] = (masked ? 0x80 : 0) | (extended === 0 ? payload.length : extended === 2 ? 126 : 127);
  if (extended === 2) header.writeUInt16BE(payload.length, 2);
  if (extended === 8) header.writeBigUInt64BE(BigInt(payload.length), 2);
  if (masked) { mask.copy(header, 2 + extended); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; }
  return Buffer.concat([header, payload]);
}
async function connect(t, origin) {
  const request = http.request(origin + '/api/ws', { headers: { Upgrade: 'websocket', Connection: 'Upgrade', Origin: origin,
    'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') } });
  const upgraded = once(request, 'upgrade'); request.end();
  const [, socket, head] = await deadline(upgraded); t.after(() => socket.destroy());
  let pending = head; const queue = []; let wake;
  socket.on('data', data => { queue.push(data); wake?.(); });
  async function frame() {
    async function need(bytes) { while (pending.length < bytes) {
      if (!queue.length) await deadline(new Promise(resolve => { wake = resolve; }));
      wake = null; while (queue.length) pending = Buffer.concat([pending, queue.shift()]);
    } }
    await need(2); const opcode = pending[0] & 15; let length = pending[1] & 127, offset = 2;
    if (length === 126) { await need(4); length = pending.readUInt16BE(2); offset = 4; }
    else if (length === 127) { await need(10); length = Number(pending.readBigUInt64BE(2)); offset = 10; }
    await need(offset + length); const payload = pending.subarray(offset, offset + length); pending = pending.subarray(offset + length); return { opcode, payload };
  }
  return { socket, frame };
}

test('WebSocket handles TCP-split masked UTF-8 frames, coalesced frames, ping/pong, and the 64 KiB boundary', async t => {
  const server = createLabServer(); const origin = await listen(server); t.after(() => server.closeLab());
  const { socket, frame } = await connect(t, origin);
  const message = encoded(1, '你好 Bridge Lab'); socket.write(message.subarray(0, 3)); socket.write(message.subarray(3));
  assert.equal((await frame()).payload.toString(), '你好 Bridge Lab');
  socket.write(Buffer.concat([encoded(9, 'ping'), encoded(1, 'second')]));
  const pong = await frame(); assert.equal(pong.opcode, 10); assert.equal(pong.payload.toString(), 'ping');
  assert.equal((await frame()).payload.toString(), 'second');
  socket.write(encoded(1, 'a'.repeat(65536))); assert.equal((await frame()).payload.length, 65536);
  const close = Buffer.alloc(2); close.writeUInt16BE(1000); socket.write(encoded(8, close)); assert.equal((await frame()).payload.readUInt16BE(), 1000);
});

test('WebSocket rejects unmasked frames, invalid UTF-8 and oversized payload declarations', async t => {
  const server = createLabServer(); const origin = await listen(server); t.after(() => server.closeLab());
  for (const [bytes, expected] of [[encoded(1, 'bad', false), 1002], [encoded(1, Buffer.from([0xff])), 1007], [encoded(1, 'x'.repeat(65537)).subarray(0, 14), 1009]]) {
    const connection = await connect(t, origin); connection.socket.write(bytes);
    const response = await connection.frame(); assert.equal(response.opcode, 8); assert.equal(response.payload.readUInt16BE(), expected);
    connection.socket.destroy();
  }
});

test('WebSocket does not accept a foreign Origin', async t => {
  const server = createLabServer(); const origin = await listen(server); t.after(() => server.closeLab());
  const request = http.request(origin + '/api/ws', { headers: { Upgrade: 'websocket', Connection: 'Upgrade', Origin: 'https://other.example',
    'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') } });
  const result = once(request, 'response'); request.end(); const [response] = await result;
  response.resume(); assert.equal(response.statusCode, 403);
});

test('WebSocket bounds connections at 32 and frees a slot when a peer closes', async t => {
  const server = createLabServer(); const origin = await listen(server); t.after(() => server.closeLab());
  const connections = [];
  for (let index = 0; index < 32; index++) connections.push(await connect(t, origin));
  const request = http.request(origin + '/api/ws', { headers: { Upgrade: 'websocket', Connection: 'Upgrade', Origin: origin,
    'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') } });
  const response = once(request, 'response'); request.end(); const [rejected] = await deadline(response);
  rejected.resume(); assert.equal(rejected.statusCode, 503);
  const closing = once(connections[0].socket, 'close'); connections[0].socket.destroy(); await closing;
  // Order a regular round trip after closing so the server processes the EOF first.
  await fetch(origin + '/api/health');
  const next = await connect(t, origin); next.socket.write(encoded(1, 'slot reused'));
  assert.equal((await next.frame()).payload.toString(), 'slot reused');
});
