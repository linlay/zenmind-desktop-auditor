import os from 'node:os';
import path from 'node:path';
import { createServer } from '../backend/server.mjs';
// These portable APIs resolve the actual temporary directory on macOS and Windows.
const directory = process.env.AUTH_LAB_DATA_DIR || path.join(os.tmpdir(), 'zenmind-auth-lab-preview');
const server = await createServer({ directory, preview: true });
server.listen(Number(process.env.PORT || 4192), '127.0.0.1', () => {
  console.log(`Auth Lab preview: http://127.0.0.1:${server.address().port}/`);
  console.log(`External configuration: ${path.join(directory, 'auth-config.json')}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.shutdown(); });
