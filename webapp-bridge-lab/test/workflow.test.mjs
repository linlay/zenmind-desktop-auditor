import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflow, artifactKey, BACKEND_METHODS, validateResult } from '../frontend/workflow.mjs';
const metadata = (chatId, runId = 'published-run', artifactId = 'file') => ({ chatId, runId, artifactId, name: 'verification.md', mimeType: 'text/markdown', sizeBytes: 128 });
function chat(flow, id, kind = 'chat', channel = 'page') { return flow.remember({ chatId: id, runId: 'run-' + id, ...(kind === 'background' ? { accepted: true } : {}) }, { channel, kind }); }

test('Chat identities must come from returned SDK results and ordinary chats may have no published artifacts', () => {
  const f = new Workflow();
  assert.throws(() => f.chat('sample-chat'), { code: 'prerequisite_required' });
  assert.throws(() => f.remember({ output: { chatId: 'invented' } }, {}), { code: 'invalid_response' });
  chat(f, 'real');
  f.acceptList(f.beginList({ chatId: 'real' }), { items: [] });
  assert.equal(f.chat().loaded, true); assert.equal(f.chat().items.length, 0);
  assert.throws(() => f.artifactArgs(), { code: 'prerequisite_required' });
});

test('execute never silently replaces the Chat selected for artifact tests, and channel changes keep app-owned provenance', () => {
  const f = new Workflow(); chat(f, 'published');
  f.acceptList(f.beginList({ chatId: 'published' }), { items: [metadata('published')] });
  const expected = f.artifactArgs();
  chat(f, 'execute-chat', 'execute', 'backend');
  assert.deepEqual(f.artifactArgs(), expected);
  f.selectChat('execute-chat'); assert.throws(() => f.artifactArgs(), { code: 'prerequisite_required' });
  f.selectChat('published'); assert.deepEqual(f.artifactArgs(), expected);
});

test('same artifactId in different runs remains distinguishable, pagination uses opaque returned cursor', () => {
  const f = new Workflow(); chat(f, 'chat');
  f.acceptList(f.beginList({ chatId: 'chat' }), { items: [metadata('chat', 'first')], nextCursor: '1' });
  const next = f.chat().nextCursor;
  f.acceptList(f.beginList({ chatId: 'chat', cursor: next }), { items: [metadata('chat', 'second')] });
  assert.equal(f.chat().items.length, 2); assert.equal(f.chat().nextCursor, undefined);
  assert.throws(() => f.checkArtifactArgs({ chatId: 'chat', artifactId: 'file' }), { code: 'prerequisite_required' });
  f.selectArtifact(artifactKey(metadata('chat', 'second')));
  assert.deepEqual(f.artifactArgs(), { chatId: 'chat', runId: 'second', artifactId: 'file' });
});

test('refresh and Chat switches cannot reuse stale artifact IDs or install late lists into a newer generation', () => {
  const f = new Workflow(); chat(f, 'one'); chat(f, 'two');
  const old = f.beginList({ chatId: 'one' }), fresh = f.beginList({ chatId: 'one' });
  assert.throws(() => f.acceptList(old, { items: [metadata('one')] }), { code: 'stale_result' });
  f.acceptList(fresh, { items: [metadata('one')] });
  f.selectChat('two');
  assert.throws(() => f.checkArtifactArgs({ chatId: 'two', runId: 'published-run', artifactId: 'file' }), { code: 'prerequisite_required' });
  assert.throws(() => f.acceptList(f.beginList({ chatId: 'two' }), { items: [metadata('one')] }), { code: 'invalid_response' });
  f.selectChat('one'); f.beginList({ chatId: 'one' });
  assert.throws(() => f.artifactArgs(), { code: 'prerequisite_required' });
});

test('background completion, interruption, failure and expiration are tracked for the exact run', () => {
  const f = new Workflow(); chat(f, 'one', 'background'); chat(f, 'two', 'background');
  f.event('run-one', { type: 'run.failed' }); f.event('run-one', { type: 'run.finished' });
  assert.equal(f.chat('one').status, 'failed'); assert.equal(f.chat('two').status, 'running');
  f.event('run-two', { type: 'run.finished', reason: 'interrupted' }); assert.equal(f.chat('two').status, 'interrupted');
  f.expire('one'); assert.throws(() => f.chat('one'), { code: 'prerequisite_required' });
  assert.equal(f.report().find(chat => chat.chatId === 'one').status, 'expired');
});

test('empty objects and mismatched results are never reported as successful interface evidence', () => {
  for (const path of ['assistant.chat', 'assistant.execute', 'artifact.list', 'artifact.get', 'artifact.read', 'connector.list', 'connector.describe', 'connector.invoke', 'skill.list', 'skill.describe', 'kanban.issues.get', 'desktop.capabilities.list']) {
    assert.throws(() => validateResult(path, {}, { chatId: 'c', artifactId: 'a', connectorId: 'connector', skillId: 'skill', issueId: 'issue' }), { code: 'invalid_response' }, path);
  }
  assert.throws(() => validateResult('artifact.get', metadata('other'), { chatId: 'expected', artifactId: 'file' }), { code: 'invalid_response' });
  assert.deepEqual(validateResult('artifact.list', { items: [] }, {}), { items: [] });
  assert.equal(validateResult('auth.isAvailable', false, {}), false);
  assert.equal(validateResult('assistant.execute', { chatId: 'c', status: 'success', output: {} }, {}).status, 'success');
});

test('backend workbench never exposes page-only or unimplemented entry points', () => {
  for (const path of ['artifact.open', 'artifact.saveAs', 'assistant.image', 'desktop.authenticateConnector', 'desktop.dialog.selectFiles', 'auth.createSession', 'automation.list']) assert.equal(BACKEND_METHODS.has(path), false, path);
  for (const path of ['assistant.chat', 'assistant.execute', 'artifact.list', 'artifact.get', 'artifact.read', 'connector.invoke']) assert.equal(BACKEND_METHODS.has(path), true, path);
});


test('uploaded Chat is real provenance without manufacturing a Run or published artifacts', () => {
  const flow = new Workflow();
  flow.remember({chatId:'uploaded-chat',upload:{id:'u',name:'test.txt'}},{channel:'page',kind:'upload'});
  assert.equal(flow.chat().runId,'');assert.equal(flow.chat().kind,'upload');
  assert.throws(()=>flow.artifact());
  validateResult('assistant.upload',{chatId:'uploaded-chat',upload:{id:'u',name:'test.txt'}},{});
  assert.throws(()=>validateResult('assistant.upload',{chatId:'uploaded-chat'},{}));
});
