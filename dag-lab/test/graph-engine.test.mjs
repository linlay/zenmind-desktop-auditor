import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { template, validateGraph, requireGraph } from '../frontend/core/graph.mjs';
import { Store } from '../backend/store.mjs';
import { Engine } from '../backend/engine.mjs';
async function setup(t, getClient, configured = true) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dag-engine-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new Store(dir).init(), engine = new Engine({ store, getClient, configured }); return { store, engine, dir };
}
test('templates are valid; cycles, duplicates, unknown nodes, incomplete branches and unsafe IDs are rejected', () => {
  for (const kind of ['review', 'data', 'blank']) assert.equal(validateGraph(template(kind)).valid, true);
  const base = template();
  for (const mutate of [g => g.edges.push({ source: 'plan', target: 'extract' }), g => g.edges.push(g.edges[0]), g => g.nodes.push({ ...g.nodes[0] }), g => g.edges.push({ source: 'unknown', target: 'output' }), g => g.nodes[0].id = '__proto__', g => g.edges = [], g => g.nodes[1].config.outputSchema.type = 'string', g => g.nodes[1].config.message = '']) { const graph = structuredClone(base); mutate(graph); assert.equal(validateGraph(graph).valid, false); }
  const draft = template('blank'); draft.edges = []; assert.equal(validateGraph(draft, { draft: true }).valid, true); assert.equal(validateGraph(draft).valid, false);
});
test('a real data DAG joins both upstream objects and persists immutable snapshots across restart', async t => {
  const { store, engine, dir } = await setup(t, () => { throw Error('Must not invoke Agent'); }, false);
  const graph = template('data'); const run = await engine.start(graph); graph.nodes[0].config.value.budget = -1; await engine.completion;
  assert.equal(run.status, 'succeeded'); assert.deepEqual(run.outputs.output, { 'input-a': { project: '新产品发布', budget: 12000 }, 'input-b': { deadline: '两周', format: '方案文档' } });
  const restored = await new Store(dir).init(); assert.equal(restored.value.runs[0].id, run.id); assert.deepEqual(restored.value.runs[0].outputs, run.outputs);
});
test('Agent branches execute serially and merge passes actual outputs to the final Agent', async t => {
  let inFlight = 0, maximum = 0; const calls = [];
  const { engine } = await setup(t, async () => ({ assistant: { execute: async (args, { signal }) => { inFlight++; maximum = Math.max(maximum, inFlight); calls.push(structuredClone(args)); await new Promise(resolve => setTimeout(resolve, 2)); inFlight--; return { chatId: 'actual-chat-' + calls.length, status: 'success', output: { summary: args.message.includes('实施风险') ? '风险结果' : '需求结果', items: ['real-output-' + calls.length] } }; } } }));
  const run = await engine.start(template()); await engine.completion;
  assert.equal(run.status, 'succeeded'); assert.equal(calls.length, 3); assert.equal(maximum, 1);
  assert.deepEqual(calls[2].input.upstream.merge.extract, run.nodes.extract.output); assert.deepEqual(calls[2].input.upstream.merge.risks, run.nodes.risks.output);
  assert.ok(calls.every(args => !('agentKey' in args) && !('skillIds' in args))); assert.equal(run.nodes.plan.chatId, 'actual-chat-3');
});
test('business failure stops the DAG without retrying or manufacturing downstream output', async t => {
  let calls = 0;
  const { engine } = await setup(t, async () => ({ assistant: { execute: async () => { calls++; return { chatId: 'failure-chat', status: 'failure', reason: '无法确定' }; } } }));
  const run = await engine.start(template()); await engine.completion;
  assert.equal(run.status, 'failed'); assert.equal(run.nodes.extract.status, 'failed'); assert.equal(run.nodes.extract.chatId, 'failure-chat'); assert.equal(run.nodes.risks.status, 'skipped'); assert.deepEqual(run.outputs, {}); assert.equal(calls, 1);
});
test('cancel propagates AbortSignal and prevents another active run or late result from continuing', async t => {
  let started; const ready = new Promise(resolve => { started = resolve; }); let aborted = false;
  const { engine } = await setup(t, async () => ({ assistant: { execute: async (args, { signal }) => { started(); return new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true })); } } }));
  const run = await engine.start(template()); await ready;
  await assert.rejects(engine.start(template()), { code: 'run_in_progress' }); await engine.cancel(run.id); await engine.completion;
  assert.equal(aborted, true); assert.equal(run.status, 'cancelled'); assert.equal(run.nodes.extract.status, 'cancelled'); assert.equal(run.nodes.risks.status, 'skipped'); assert.equal(engine.current, null);
});
test('missing SDK rejects Agent workflow before creating a run; invalid receipts fail explicitly', async t => {
  const { engine, store } = await setup(t, async () => {}, false);
  await assert.rejects(engine.start(template()), { code: 'agent_unavailable' }); assert.equal(store.value.runs.length, 0);
  engine.configured = true; engine.getClient = async () => ({ assistant: { execute: async () => ({ status: 'success', output: {} }) } });
  const run = await engine.start(template()); await engine.completion; assert.equal(run.error.code, 'invalid_response');
});
test('startup marks incomplete runs interrupted and does not reissue Agent tasks', async t => {
  const { engine, store, dir } = await setup(t, async () => ({ assistant: { execute: async () => ({ chatId: 'c', status: 'success', output: {} }) } }));
  const run = await engine.start(template('data')); await engine.completion;
  run.status = 'running'; run.nodes.output.status = 'running'; run.nodes.merge.status = 'pending'; await store.save();
  const restored = await new Store(dir).init(); assert.equal(restored.value.runs[0].status, 'interrupted'); assert.equal(restored.value.runs[0].nodes.output.status, 'interrupted'); assert.equal(restored.value.runs[0].nodes.merge.status, 'skipped');
  assert.ok(JSON.parse(await readFile(path.join(dir, 'workspace.json'))).runs[0].finishedAt);
});
test('oversized upstream input fails before SDK submission and injected secrets are scrubbed from persisted errors', async t => {
  let calls = 0;
  const { engine } = await setup(t, async () => ({ assistant: { execute: async () => { calls++; throw Object.assign(Error('token=synthetic-secret'), { code: 'upstream_failure' }); } } }));
  const graph = template(); graph.nodes[0].config.value = { text: 'x'.repeat(250000) };
  const oversized = await engine.start(graph); await engine.completion; assert.equal(oversized.error.code, 'input_too_large'); assert.equal(calls, 0);
  engine.secrets = ['synthetic-secret']; const failed = await engine.start(template()); await engine.completion;
  assert.ok(!JSON.stringify(failed).includes('synthetic-secret')); assert.equal(calls, 1);
});

test('a late successful Agent receipt after cancellation is never committed as output', async t => {
  let release, ready; const started = new Promise(resolve => { ready = resolve; });
  const { engine } = await setup(t, async () => ({ assistant: { execute: async () => { ready(); return new Promise(resolve => { release = resolve; }); } } }));
  const run = await engine.start(template()); await started; await engine.cancel(run.id);
  release({ chatId: 'late-chat', status: 'success', output: { summary: 'late', items: [] } }); await engine.completion;
  assert.equal(run.status, 'cancelled'); assert.equal(run.nodes.extract.output, undefined); assert.equal(run.nodes.plan.status, 'skipped');
});
