import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, chmod, rm } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseConfig, trustedUrl } from '../backend/config.mjs';

const options = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (!['--data-dir', '--public-origin', '--profile'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Usage: npm run configure -- --profile <cutej-enterprise|transit-hub-dev> --data-dir <WEBAPP_DATA_DIR> [--public-origin <https://domain>]');
  options[args[i]] = args[++i];
}
if (!options['--data-dir']) throw Error('--data-dir must be the actual Auth Lab data directory, not the program directory.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profiles = { 'cutej-enterprise': 'cutej-enterprise.desktop.example.json', 'transit-hub-dev': 'transit-hub-dev.desktop.example.json' };
const profile = profiles[options['--profile']];
if (!profile) throw Error('--profile is required: cutej-enterprise and transit-hub-dev trust different identity providers. Select the one matching the visiting Desktop.');
const data = JSON.parse(await readFile(path.join(root, 'config', profile), 'utf8'));
if (options['--public-origin']) data.publicOrigin = trustedUrl(options['--public-origin'], { originOnly: true });
parseConfig(data);
if (data.desktop.publicKeyPem) createPublicKey(data.desktop.publicKeyPem);
const directory = path.resolve(options['--data-dir']), file = path.join(directory, 'auth-config.json');
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
try {
  if (process.platform === 'darwin' || process.platform === 'linux') await chmod(file, 0o600);
  else if (process.platform === 'win32') {
    const identity = execFileSync('whoami.exe', [], { encoding: 'utf8' }).trim();
    execFileSync('icacls.exe', [file, '/inheritance:r', '/grant:r', identity + ':F'], { stdio: 'ignore', windowsHide: true });
  } else throw Error('Unsupported configuration platform');
} catch (error) { await rm(file); throw error; }
console.log('Created external Desktop trust configuration. Restart Auth Lab.');
console.log(file);
