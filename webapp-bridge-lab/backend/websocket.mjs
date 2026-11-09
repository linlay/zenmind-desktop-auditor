import { createHash } from 'node:crypto';

export const WEBSOCKET_MESSAGE_MAX_BYTES = 64 * 1024;
const MAX_FRAME_BYTES = WEBSOCKET_MESSAGE_MAX_BYTES + 14;
const MAX_QUEUED_BYTES = WEBSOCKET_MESSAGE_MAX_BYTES * 4;
const MAX_CONNECTIONS = 32;
const decoder = new TextDecoder('utf-8', { fatal: true });

function frame(opcode, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(payload.length < 126 ? 2 : payload.length <= 65535 ? 4 : 10);
  header[0] = 0x80 | opcode;
  if (header.length === 2) header[1] = payload.length;
  else if (header.length === 4) { header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  return Buffer.concat([header, payload]);
}

function reject(socket, status, title) {
  socket.on('error', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${title}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`);
  const timer = setTimeout(() => socket.destroy(), 1000);
  timer.unref(); socket.once('close', () => clearTimeout(timer));
}

function oneHeader(req, name) {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) count++;
  return count === 1;
}

// Adapted from the supplied Bridge Lab fixture. This protocol handler only
// echoes caller-supplied bytes; it has no SDK, session, config or file access.
export function acceptEcho(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== 'websocket' ||
      !String(req.headers.connection).toLowerCase().split(/\s*,\s*/u).includes('upgrade') ||
      req.headers['sec-websocket-version'] !== '13' || !oneHeader(req, 'sec-websocket-version') ||
      typeof key !== 'string' || !oneHeader(req, 'sec-websocket-key') ||
      !/^[A-Za-z0-9+/]{22}==$/u.test(key) || Buffer.from(key, 'base64').length !== 16 ||
      Buffer.from(key, 'base64').toString('base64') !== key || req.headers['transfer-encoding'] ||
      (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) {
    reject(socket, 400, 'Bad Request'); return false;
  }
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let pending = Buffer.alloc(0);
  let closed = false;
  let closeTimer;
  function finish(payload) {
    if (closed) return;
    closed = true;
    pending = Buffer.alloc(0);
    socket.end(frame(8, payload));
    closeTimer = setTimeout(() => socket.destroy(), 1000);
    closeTimer.unref();
  }
  function close(code) {
    const payload = Buffer.alloc(2); payload.writeUInt16BE(code);
    finish(payload);
  }
  function send(opcode, payload) {
    if (socket.writableLength + payload.length + 10 > MAX_QUEUED_BYTES) { close(1008); return; }
    socket.write(frame(opcode, payload));
  }
  socket.setTimeout(60_000, () => close(1001));
  socket.on('error', () => socket.destroy());
  // An upgraded socket can remain half-open after an abrupt peer FIN. Release its connection slot immediately.
  socket.once('end', () => { if (!closed) socket.destroy(); });
  socket.once('close', () => { closed = true; pending = Buffer.alloc(0); clearTimeout(closeTimer); });

  function parseFrames() {
    while (pending.length >= 2 && !closed) {
      const first = pending[0], second = pending[1], opcode = first & 15;
      if ((first & 0x70) || !(second & 0x80)) return close(1002);
      if (!(first & 0x80) || opcode === 0 || opcode === 2) return close(1003);
      if (![1, 8, 9, 10].includes(opcode)) return close(1002);
      let size = second & 127, offset = 2;
      if (opcode >= 8 && size > 125) return close(1002);
      if (size === 126) {
        if (pending.length < 4) return;
        size = pending.readUInt16BE(2); offset = 4;
        if (size < 126) return close(1002);
      } else if (size === 127) {
        if (pending.length < 10) return;
        if (pending[2] & 0x80) return close(1002);
        const large = pending.readBigUInt64BE(2);
        if (large > BigInt(WEBSOCKET_MESSAGE_MAX_BYTES)) return close(1009);
        if (large < 65536n) return close(1002);
        size = Number(large); offset = 10;
      }
      if (size > WEBSOCKET_MESSAGE_MAX_BYTES) return close(1009);
      if (pending.length < offset + 4 + size) return;
      const mask = pending.subarray(offset, offset + 4);
      const payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + size));
      for (let i = 0; i < size; i++) payload[i] ^= mask[i % 4];
      pending = pending.subarray(offset + 4 + size);
      if (opcode === 1) {
        try { decoder.decode(payload); } catch { return close(1007); }
        send(1, payload);
      } else if (opcode === 9) send(10, payload);
      else if (opcode === 10) { /* Browser/CLI pong is a control frame, not a host command. */ }
      else {
        if (payload.length === 1) return close(1002);
        if (payload.length >= 2) {
          const code = payload.readUInt16BE(0);
          if (!((code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
              (code >= 3000 && code <= 4999))) return close(1002);
          try { decoder.decode(payload.subarray(2)); } catch { return close(1007); }
        }
        finish(payload);
      }
    }
  }

  function consume(chunk) {
    // The socket may coalesce multiple frames. Bound the accumulated partial
    // frame without rejecting a valid batch merely because the batch is large.
    let offset = 0;
    while (offset < chunk.length && !closed) {
      const available = MAX_FRAME_BYTES - pending.length;
      if (available <= 0) { close(1009); return; }
      const count = Math.min(available, chunk.length - offset);
      pending = Buffer.concat([pending, chunk.subarray(offset, offset + count)]);
      offset += count;
      parseFrames();
    }
  }
  socket.on('data', consume);
  if (head.length) consume(head);
  return true;
}
