import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { options, projectRoot } from './build.mjs';

const args = options(process.argv.slice(2));
const desktopRepo = path.resolve(args['desktop-repo']);
const desktopRequire = createRequire(path.join(desktopRepo, 'package.json'));
const env = { ...process.env, BRIDGE_LAB_PROJECT: projectRoot, BRIDGE_LAB_DESKTOP: desktopRepo };
delete env.ELECTRON_RUN_AS_NODE;
// Use the tested Desktop checkout's Electron runtime; no installed Desktop profile is opened.
const child = spawn(desktopRequire('electron'), [path.join(projectRoot, 'test/smoke-electron.cjs')], { env, stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
