import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, chmod, rm, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { parseConfig } from '../backend/config.mjs';

async function privateFile(file, data) {
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') await chmod(file, 0o600);
    else if (process.platform === 'win32') {
      const user = execFileSync('whoami.exe', [], { encoding: 'utf8' }).trim();
      execFileSync('icacls.exe', [file, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore', windowsHide: true });
    } else throw Error('Unsupported configuration platform');
  } catch (error) { await rm(file, { force: true }); throw error; }
}
export async function configureBroker({ dataDirectory, brokerFile }) {
  let incoming;
  try { incoming = JSON.parse(await readFile(brokerFile, 'utf8')); } catch { throw Error('Cannot read valid Broker instance configuration; contents were not printed.'); }
  if (!incoming.broker) throw Error('Expected generated Broker instance configuration.');
  parseConfig({ publicOrigin: incoming.publicOrigin, broker: incoming.broker });
  const directory = path.resolve(dataDirectory), file = path.join(directory, 'auth-config.json');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let existing = null;
  try { existing = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('Existing configuration is invalid; correct it before migration.'); }
  // There is no automatic identity translation between enterprise pairwise sub and Broker sub.
  if (existing?.allowedUsers?.some(user => user.issuer !== incoming.broker.origin && user.issuer !== existing.desktop?.issuer)) throw Error('Migrate allowedUsers using verified identity mappings before switching issuer.');
  const merged = { ...(existing || {}), publicOrigin: incoming.publicOrigin, broker: incoming.broker };
  if (!existing) merged.sessionSeconds = incoming.sessionSeconds ?? 3600;
  delete merged.oidc;
  if (merged.desktop?.audience !== undefined) {
    const values = typeof merged.desktop.audience === 'string' ? [merged.desktop.audience] : merged.desktop.audience;
    merged.desktop = { ...merged.desktop, audienceSha256: values.map(value => createHash('sha256').update(value).digest('hex')) };
    delete merged.desktop.audience;
  }
  parseConfig(merged);
  const backup = ''; // No credential-bearing pre-migration backups are created.
  const temporary = path.join(directory, `auth-config-${randomUUID()}.tmp`);
  try {
    await privateFile(temporary, merged);
    // Both platforms rename a closed file in the same directory; an OS rejection preserves the old file.
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
  return { file, backup };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}, args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      if (!['--data-dir', '--broker-config'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw Error('Use --data-dir <WEBAPP_DATA_DIR> --broker-config <generated auth-config.json>.');
      options[args[i]] = args[i + 1];
    }
    if (!options['--data-dir'] || !options['--broker-config']) throw Error('Both --data-dir and --broker-config are required.');
    console.log(JSON.stringify(await configureBroker({ dataDirectory: options['--data-dir'], brokerFile: options['--broker-config'] }), null, 2));
    console.log('Broker configuration saved; existing Desktop trust preserved. Restart Auth Lab when ready.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
