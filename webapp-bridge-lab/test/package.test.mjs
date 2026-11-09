import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { root, bundlePath } from './helpers.mjs';
import { catalog, listMethods, isReservedStub } from '../frontend/catalog.mjs';

test('delivered ZIP has a single canonical root, runtime files, no dependencies or secrets, and the exact SDK hash', async () => {
  const zip = await JSZip.loadAsync(await readFile(path.join(root, 'build/bridge-lab.zip')), { checkCRC32: true });
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  const roots = new Set(names.map(name => name.split('/')[0])); assert.equal(roots.size, 1);
  const id = [...roots][0]; assert.match(id, /^webapp-[a-f0-9]{16}$/);
  const manifest = JSON.parse(await zip.file(id + '/webapp.json').async('string'));
  assert.equal(manifest.id, id); assert.equal(manifest.target, 'any'); assert.equal(manifest.backend.command.type, 'electron-node');
  for (const file of ['frontend/index.html', 'frontend/app.mjs', 'frontend/styles.css', 'frontend/catalog.mjs', 'frontend/workflow.mjs', 'frontend/report.mjs', 'frontend/suite.mjs', 'docs/api-reference.md', 'docs/testing-guide.md', 'docs/integration-guide.md', 'frontend/build-info.json', 'backend/server.mjs', 'backend/websocket.mjs', 'backend/bridge.mjs']) assert.ok(zip.file(id + '/' + file), file);
  for (const file of ['frontend/app.mjs', 'frontend/catalog.mjs', 'frontend/workflow.mjs', 'frontend/suite.mjs', 'frontend/report.mjs', 'backend/server.mjs', 'backend/websocket.mjs']) assert.equal(await zip.file(id + '/' + file).async('string'), await readFile(path.join(root, file), 'utf8'), 'Stale packaged file: ' + file);
  assert.ok(names.every(name => !/(?:^|\/)(?:node_modules|\.git|\.env[^/]*|logs?|test|scripts)(?:\/|$)/.test(name)));
  const sdk = await zip.file(id + '/backend/bridge.mjs').async('nodebuffer');
  const info = JSON.parse(await zip.file(id + '/frontend/build-info.json').async('string'));
  assert.equal(createHash('sha256').update(sdk).digest('hex'), info.sdkSha256);
  assert.deepEqual(info.copilot, manifest.copilot);
  const source = JSON.parse(await readFile(path.join(root, 'webapp.json'), 'utf8'));
  assert.equal(source.copilot, undefined, 'Default package must not depend on a fixture agent or skill.');
});

test('every method exported by the actual build SDK has a test card; reserved probes are real stubs', async () => {
  const sdk = await import(pathToFileURL(path.join(await bundlePath(), 'backend/bridge.mjs')));
  const covered = new Set(catalog.map(item => item.path));
  assert.equal(covered.size, catalog.length);
  assert.deepEqual(listMethods(sdk).filter(method => !covered.has(method)), []);
  for (const definition of catalog.filter(item => item.mode === 'reserved')) assert.equal(isReservedStub(sdk, definition.path), true, definition.path);
  assert.equal(isReservedStub(sdk, 'assistant.execute'), false);
});
