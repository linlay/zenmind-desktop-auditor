import { readFile, writeFile, mkdir, cp, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildLab(desktopRepo) {
  const contract = path.join(desktopRepo, 'contracts/webapp');
  const { webappManifestSchema } = await import(pathToFileURL(path.join(contract, 'webapp-manifest-validator.mjs')));
  const require = createRequire(import.meta.url);
  const { validateWebappPackageDirectory, validateWebappArchiveLayout } = require(path.join(desktopRepo, 'src/main/modules/webs/webapps/package-validation.js'));
  const manifest = webappManifestSchema.parse(JSON.parse(await readFile(path.join(root, 'webapp.json'), 'utf8')));
  // Pin the official auth-only SDK with the app: a running older publisher may serve an older gateway SDK.
  await build({ stdin: { contents: 'export { auth } from ' + JSON.stringify(path.join(contract, 'bridge.mjs')), resolveDir: root },
    outfile: path.join(root, 'frontend/auth-sdk.mjs'), bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    minify: true, treeShaking: true, pure: ['Object.freeze'], external: ['node:*'], legalComments: 'none', banner: { js: '// Generated from the official Desktop WebApp contract; do not edit.' } });
  const buildDir = path.join(root, 'build'); await mkdir(buildDir, { recursive: true });
  const temporary = await mkdtemp(path.join(buildDir, 'bundle-')), packageDir = path.join(temporary, manifest.id);
  try {
    await mkdir(path.join(packageDir, 'backend'), { recursive: true });
    await cp(path.join(root, 'frontend'), path.join(packageDir, 'frontend'), { recursive: true });
    await cp(path.join(root, 'assets'), path.join(packageDir, 'assets'), { recursive: true });
    await cp(path.join(root, 'docs'), path.join(packageDir, 'docs'), { recursive: true });
    await build({ absWorkingDir: root, entryPoints: ['backend/server.mjs'], outfile: path.join(packageDir, 'backend/server.mjs'),
      bundle: true, platform: 'node', format: 'esm', target: 'node22', legalComments: 'eof', sourcemap: false });
    await writeFile(path.join(packageDir, 'webapp.json'), JSON.stringify(manifest, null, 2) + '\n');
    const licenses = ['jose'];
    for (const name of licenses) {
      const text = await readFile(path.join(root, 'node_modules', name, 'LICENSE.md'), 'utf8');
      await writeFile(path.join(packageDir, 'docs', name + '-LICENSE.md'), text);
    }
    const sdk = await readFile(path.join(contract, 'bridge.mjs'));
    let revision = null;
    try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: desktopRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* The contract fingerprint works for exported checkouts. */ }
    const info = { version: manifest.version, desktopRevision: revision, sdkSha256: createHash('sha256').update(sdk).digest('hex'), builtAt: new Date().toISOString() };
    const checked = validateWebappPackageDirectory(packageDir, manifest), zip = new JSZip();
    for (const file of checked.files) zip.file(manifest.id + '/' + file.relativePath, await readFile(file.absolutePath));
    validateWebappArchiveLayout(Object.keys(zip.files), /^webapp-[a-f0-9]{16}$/u);
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'DOS' });
    const reopened = await JSZip.loadAsync(bytes, { checkCRC32: true });
    validateWebappArchiveLayout(Object.keys(reopened.files), /^webapp-[a-f0-9]{16}$/u);
    const output = path.join(buildDir, 'auth-lab.zip'), tempZip = path.join(temporary, 'auth-lab.zip');
    await writeFile(tempZip, bytes);
    // Windows rename cannot replace an existing ZIP; remove only this generated output.
    if (process.platform === 'win32') await rm(output, { force: true });
    else if (!['darwin', 'linux'].includes(process.platform)) throw Error('Unsupported build platform');
    await rename(tempZip, output);
    await writeFile(path.join(buildDir, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
    return { zipPath: output, bytes: bytes.length, files: checked.files.length, ...info };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--desktop-repo') throw Error('Usage: npm run build -- --desktop-repo <checkout>');
  console.log(JSON.stringify(await buildLab(path.resolve(args[1])), null, 2));
}
