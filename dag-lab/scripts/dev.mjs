import path from 'node:path';
import os from 'node:os';
import { createServer } from '../backend/server.mjs';
// Preview data is outside the repository on both macOS and Windows; no host credentials or mock Agent.
const directory = process.env.DAG_LAB_PREVIEW_DATA || path.join(os.tmpdir(), 'zenmind-dag-lab-preview');
const server = await createServer({ directory, preview: true, env: { DAG_LAB_PLATFORM_URL: process.env.DAG_LAB_PLATFORM_URL, DAG_LAB_PLATFORM_TOKEN: process.env.DAG_LAB_PLATFORM_TOKEN } });
server.listen(Number(process.env.PORT || 4186), '127.0.0.1', () => console.log(`DAG Lab preview: http://127.0.0.1:${server.address().port}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.shutdown(); });
