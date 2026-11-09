import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function bundlePath() {
  let index;
  try { index = JSON.parse(await readFile(path.join(root, 'build/bundle.json'), 'utf8')); }
  catch { throw Error('Build the ZIP first: npm run build -- --desktop-repo <checkout>'); }
  const dir = path.resolve(root, 'build', index.packagePath);
  if (!dir.startsWith(path.join(root, 'build') + path.sep)) throw Error('Invalid bundle path.');
  return dir;
}
export async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}
export function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
export async function deadline(promise, ms = 3000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Timed out')), ms); })]); }
  finally { clearTimeout(timer); }
}
export function headers(origin) { return { Origin: origin, 'X-Bridge-Lab': '1', 'Content-Type': 'application/json' }; }
