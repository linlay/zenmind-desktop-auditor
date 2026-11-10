import { readFile, writeFile, mkdir, cp, mkdtemp, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function options(argv) {
  const result = { skills: [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!['--desktop-repo', '--agent', '--skill'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw Error('Usage: npm run build -- --desktop-repo <checkout> [--agent <key>] [--skill <id>]');
    }
    const value = argv[++i];
    if (key === '--skill') result.skills.push(value);
    else result[key.slice(2)] = value;
  }
  if (!result['desktop-repo']) throw Error('--desktop-repo is required; use the Desktop checkout being tested.');
  return result;
}

export async function buildLab(settings) {
  const desktopRepo = path.resolve(settings['desktop-repo']);
  const contractDir = path.join(desktopRepo, 'contracts/webapp');
  const { webappManifestSchema } = await import(pathToFileURL(path.join(contractDir, 'webapp-manifest-validator.mjs')));
  const require = createRequire(import.meta.url);
  const { validateWebappArchiveLayout, validateWebappPackageDirectory } = require(path.join(desktopRepo, 'src/main/modules/webs/webapps/package-validation.js'));
  const source = JSON.parse(await readFile(path.join(projectRoot, 'webapp.json'), 'utf8'));
  if (settings.agent) source.userConfig.fields.find(field => field.source === 'desktop.agents').default = settings.agent;
  if (settings.skills?.length) source.copilot = { agentKey: settings.agent || 'desktopAssistant', references: settings.skills.map(id => ({ type: 'skill', id })) };
  const manifest = webappManifestSchema.parse(source);
  const sdk = await readFile(path.join(contractDir, 'bridge.mjs'));
  let revision = null, dirty = null;
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: desktopRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    dirty = !!execFileSync('git', ['status', '--porcelain', '--', 'contracts/webapp'], { cwd: desktopRepo, encoding: 'utf8' }).trim();
  } catch { /* Exported source trees can have no Git metadata; SHA256 still identifies the SDK. */ }
  const desktopVersion = JSON.parse(await readFile(path.join(desktopRepo, 'package.json'), 'utf8')).version;
  const info = { desktopVersion, app: 'Agent Lab', version: manifest.version, desktopRevision: revision, contractDirty: dirty,
    sdkSha256: createHash('sha256').update(sdk).digest('hex'), builtAt: new Date().toISOString(), target: manifest.target,
    copilot: manifest.copilot, defaultAgent: manifest.userConfig.fields.find(field => field.source === 'desktop.agents')?.default };
  const buildDir = path.join(projectRoot, 'build');
  await mkdir(path.join(buildDir, 'staging'), { recursive: true });
  const temp = await mkdtemp(path.join(buildDir, 'staging', 'bundle-'));
  const packageDir = path.join(temp, manifest.id);
  try {
    await mkdir(packageDir);
    for (const name of ['frontend', 'backend', 'docs']) await cp(path.join(projectRoot, name), path.join(packageDir, name), { recursive: true });
    await cp(path.join(contractDir, 'README.md'), path.join(packageDir, 'docs/sdk-guide.md'));
    await writeFile(path.join(packageDir, 'webapp.json'), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(path.join(packageDir, 'backend/bridge.mjs'), sdk);
    await writeFile(path.join(packageDir, 'frontend/build-info.json'), JSON.stringify(info, null, 2) + '\n');
    const checked = validateWebappPackageDirectory(packageDir, manifest);
    const zip = new JSZip();
    for (const file of checked.files) zip.file(manifest.id + '/' + file.relativePath, await readFile(file.absolutePath));
    validateWebappArchiveLayout(Object.keys(zip.files), /^webapp-[a-f0-9]{16}$/u);
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'DOS' });
    // Reopen the final bytes so the output itself, including the copied SDK, is checked.
    const reopened = await JSZip.loadAsync(bytes, { checkCRC32: true });
    validateWebappArchiveLayout(Object.keys(reopened.files), /^webapp-[a-f0-9]{16}$/u);
    if (!(await reopened.file(manifest.id + '/backend/bridge.mjs').async('nodebuffer')).equals(sdk)) throw Error('SDK copy mismatch.');
    const zipTemp = path.join(temp, 'agent-lab.zip');
    await writeFile(zipTemp, bytes);
    const zipPath = path.join(buildDir, 'agent-lab.zip');
    // Windows cannot reliably rename over an existing destination; remove only this generated ZIP.
    if (process.platform === 'win32' && existsSync(zipPath)) await rm(zipPath);
    if (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux') await rename(zipTemp, zipPath);
    else throw Error('Unsupported build platform: ' + process.platform);
    await writeFile(path.join(buildDir, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
    await writeFile(path.join(buildDir, 'bundle.json'), JSON.stringify({ packagePath: path.relative(buildDir, packageDir).split(path.sep).join('/') }, null, 2) + '\n');
    return { zipPath, packageDir, files: checked.files.length, bytes: bytes.length, ...info };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await buildLab(options(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
