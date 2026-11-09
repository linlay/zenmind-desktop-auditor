import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Enumerate in JS: Windows cmd does not expand the shell glob used by Unix shells.
const tests = readdirSync(path.join(root, 'test')).filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join(root, 'test', name));
const child = spawn(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
