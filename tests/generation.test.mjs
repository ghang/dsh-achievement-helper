import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createGenerationController } from '../src/generation.mjs';
import { createJournal } from '../src/journal.mjs';

const digest = value => createHash('sha256').update(String(value)).digest('hex');
const request = (id, extra = {}) => ({ requestId: id, metrics: ['file_read'], theme: 'xianxia', style: 'balanced', ...extra });
const definition = (rule = { template: 'count', metric: 'file_read', target: 3 }, extra = {}) => ({ title: '阅卷有迹', description: '配置后实际阅读三次文件。', icon: 'book', rule, ...extra });
const characterRequest = (requestId, extra = {}) => ({ requestId, kind: 'characters', theme: 'xianxia', ...extra });
const character = (extra = {}) => ({ name: '云归', description: '披月而来的小小旅伴。', theme: 'xianxia', rarity: 'R', icon: 'fox', animation: 'float', ...extra });
const characterOutput = characters => JSON.stringify({ characters: characters ?? [character()] });
const usage = { inputTokens: 10, outputTokens: 15, cacheReadTokens: 20, cacheWriteTokens: 5, totalTokens: 50, reasoningTokens: 4 };
const output = definitions => JSON.stringify({ definitions: definitions ?? [definition()] });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sourceKinds = ['tokens', 'turn_completed', 'file_read', 'file_changed', 'format_read', 'skill_loaded', 'delegate_completed', 'file_presented', 'route_used', 'recall_used'];

async function* chunks(text = output(), options = {}) {
  yield { type: 'text-delta', index: 0, text };
  if (options.usage !== false) yield { type: 'usage', usage: options.usage ?? usage };
  if (options.finish !== false) yield { type: 'finish', reason: options.finish ?? { kind: 'stop' } };
}
async function waitFor(controller, predicate = job => job && job.status !== 'running') {
  for (let i = 0; i < 300; i++) { const { job } = controller.get(); if (predicate(job) && !(await controller.info()).activeJob) return job; await sleep(5); }
  assert.fail('generation did not settle');
}
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-generation-'));
  const journal = await createJournal({ file: join(directory, 'journal.json') });
  const file = join(directory, 'generation-v1.json'), calls = [], prepares = [], receipts = [], applies = [];
  const dataCatalog = { ...journal.catalog(), capabilities: { sources: sourceKinds.map(kind => ({ kind, connected: true })), recipes: ['read_then_change', 'skill_then_change', 'delegate_then_present', 'recall_then_change', 'search_read_change'].map(id => ({ id, available: true })) } };
  const ctx = { sessions: { get: () => undefined }, agentDefaultModel: { currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }) },
    llm: { listProviders: () => [{ id: 'default-provider' }, { id: 'selected-provider' }], async prepareCall(config, signal) {
      prepares.push({ config: structuredClone(config), signal });
      if (overrides.prepare) return overrides.prepare(config, signal);
      return { config, stream(options) { calls.push(options); return overrides.stream ? overrides.stream(options) : chunks(); } };
    } }, ...overrides.ctx };
  const options = { ctx, journal, catalog: (...args) => overrides.catalog ? overrides.catalog(...args, dataCatalog) : dataCatalog, file, hashKey: digest,
    ...(overrides.now ? { now: overrides.now } : {}),
    apply: async (payload, context) => {
      applies.push({ payload, context });
      if (overrides.apply) return overrides.apply(payload, context, journal);
      if (payload.kind === 'characters') { const { kind, ...input } = payload; return journal.configureCharacters(input, context); }
      return journal.configure(payload, context);
    },
    recordUsage: async receipt => { receipts.push(receipt); if (overrides.recordUsage) return overrides.recordUsage(receipt); },
  };
  let controller = await createGenerationController(options);
  t.after(async () => { await controller.dispose(); await journal.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, file, ctx, journal, calls, prepares, receipts, applies, dataCatalog, get c() { return controller; }, async reopen() { await controller.dispose(); controller = await createGenerationController(options); return controller; } };
}

test('one public prepared call uses current selection, bounded isolated input, and atomic creation', async t => {
  const f = await fixture(t);
  const sessionId = 'PRIVATE_SESSION_CANARY', secret = 'PRIVATE_DIRECTION_CANARY';
  const session = { id: sessionId };
  Object.defineProperty(session, 'options', { get() { assert.fail('must not read private agent options'); } });
  f.ctx.sessions.get = id => id === sessionId ? session : undefined;
  f.ctx.sessionProjections = { snapshot(value, keys) { assert.equal(value, session); assert.deepEqual(keys, ['modelSelection']); return { values: { modelSelection: { next: { provider: 'selected-provider', model: 'selected-model', reasoningEffort: 'low' } } } }; } };
  const available = await f.c.info({ sessionId });
  assert.equal(available.available, true); assert.equal(available.routeSource, 'session'); assert.equal(available.maxDefinitions, 6);
  assert.deepEqual(available.styles.map(style => style.id), ['balanced', 'discovery', 'milestone']);
  const first = await f.c.start(request('private-request', { direction: secret, sessionId }));
  assert.equal(first.job.status, 'running');
  const job = await waitFor(f.c);
  assert.equal(job.status, 'succeeded'); assert.equal(job.stage, 'done'); assert.equal(job.createdDefinitionIds.length, 1);
  assert.equal(job.route.provider, 'selected-provider'); assert.equal(job.totalTokens, 50); assert.deepEqual(job.usage, usage);
  assert.equal(f.calls.length, 1); assert.equal(f.prepares[0].config.maxTokens, 4096);
  assert.equal(f.calls[0].purpose, undefined); assert.equal(f.calls[0].sessionId, undefined); assert.deepEqual(f.calls[0].tools, []);
  assert.equal(f.calls[0].messages.length, 1); assert.equal(f.calls[0].messages[0].role, 'user');
  const sent = JSON.parse(f.calls[0].messages[0].content[0].text);
  assert.deepEqual(sent.metrics, ['file_read']); assert.equal(sent.direction, secret);
  assert.equal(JSON.stringify(sent).includes(sessionId), false);
  assert.equal(f.journal.snapshot().definitions.length, 17); assert.equal(f.journal.snapshot().totals.turns, 0);
  assert.equal(f.applies[0].context.source, 'model'); assert.equal(f.receipts.length, 1); assert.equal(f.receipts[0].usageSource, 'auxiliary_generation');
  assert.deepEqual(f.c.accounting(), { knownTokens: 50, unknownCalls: 0, observedCalls: 1 });
  const saved = await readFile(f.file, 'utf8');
  for (const canary of [secret, sessionId, 'private-request', '阅卷有迹', 'Generate 1 to 6']) assert.equal(saved.includes(canary), false);
});

test('default route availability is metadata only; missing route or source never calls a model', async t => {
  const f = await fixture(t);
  assert.equal((await f.c.info()).routeSource, 'default');
  f.dataCatalog.capabilities.sources.find(source => source.kind === 'file_read').connected = false;
  await assert.rejects(f.c.start(request('unavailable-source')), { code: 'GENERATION_SOURCE_UNAVAILABLE' });
  f.ctx.agentDefaultModel.currentSelection = () => undefined;
  assert.equal((await f.c.info()).available, false);
  await assert.rejects(f.c.start(request('no-route')), { code: 'GENERATION_UNAVAILABLE' });
  assert.equal(f.prepares.length, 0); assert.equal(f.c.get().job, null);
});

test('input whitelist rejects invalid sources, templates, scope and unbounded direction before dispatch', async t => {
  const f = await fixture(t);
  for (const change of [{ metrics: [] }, { metrics: ['recipe'] }, { metrics: ['model_report'] }, { metrics: ['file_read', 'file_read'] }, { direction: 'x'.repeat(241) }, { style: 'unbounded' }, { theme: 'other' }, { archiveIds: ['first'] }, { sessionId: '/private/path' }]) {
    await assert.rejects(f.c.start(request('invalid-request', change)), { code: 'GENERATION_INVALID' });
  }
  assert.equal(f.prepares.length, 0);
});

test('strict JSON, output fields, selected metrics, bounded targets and complete finish are enforced', async t => {
  let current = () => chunks();
  const f = await fixture(t, { stream: () => current() });
  const invalid = [
    () => chunks('```json\n' + output() + '\n```'),
    () => chunks(JSON.stringify({ definitions: [definition()], archiveIds: ['first'] })),
    () => chunks(output([definition(undefined, { id: 'first' })])),
    () => chunks(output([definition(undefined, { scope: 'all' })])),
    () => chunks(output([definition({ template: 'model_report' })])),
    () => chunks(output([definition({ template: 'count', metric: 'tokens', target: 100 })])),
    () => chunks(output([definition({ template: 'count', metric: 'file_read', target: 0 })])),
    () => chunks(output([definition({ template: 'count', metric: 'file_read', target: 10001 })])),
    () => chunks(output([definition({ template: 'recipe', recipe: 'read_then_change', target: 1 })])),
    () => chunks(output([])),
    () => chunks(output(Array.from({ length: 7 }, (_, i) => definition(undefined, { title: `目标 ${i}` })))),
    () => chunks(output(), { finish: false }),
    () => chunks(output(), { finish: { kind: 'max-tokens' } }),
    async function* () { yield { type: 'tool-call-delta', index: 0, id: 'call-id', name: 'edit', argumentsDelta: '{}' }; yield { type: 'finish', reason: { kind: 'stop' } }; },
    async function* () { yield { type: 'block-start', index: 1, blockType: 'tool-call' }; yield* chunks(); },
    async function* () { yield* chunks(); yield { type: 'text-delta', index: 0, text: 'trailing' }; },
  ];
  for (const [index, make] of invalid.entries()) {
    current = make;
    await f.c.start(request(`invalid-output-${index}`));
    const job = await waitFor(f.c);
    assert.equal(job.status, 'failed', `case ${index}`); assert.deepEqual(job.createdDefinitionIds, []);
  }
  assert.equal(f.applies.length, 0); assert.equal(f.journal.snapshot().definitions.length, 16);
});

test('recipes require every underlying selected source and advertised recipe capability', async t => {
  const f = await fixture(t, { stream: () => chunks(output([definition({ template: 'recipe', recipe: 'read_then_change' })])) });
  await f.c.start(request('recipe-good', { metrics: ['file_read', 'file_changed'] }));
  assert.equal((await waitFor(f.c)).status, 'succeeded');
  f.dataCatalog.capabilities.recipes.find(item => item.id === 'read_then_change').available = false;
  await f.c.start(request('recipe-unavailable', { metrics: ['file_read', 'file_changed'] }));
  assert.equal((await waitFor(f.c)).status, 'failed'); assert.equal(f.applies.length, 1);
});

test('cancellation before prepared dispatch has no stream, application, or expenditure receipt', async t => {
  const entered = deferred(), prepared = deferred(); let dispatches = 0;
  const f = await fixture(t, { prepare: async (config, signal) => { entered.resolve(signal); await prepared.promise; return { config, stream() { dispatches++; return chunks(); } }; } });
  const { job } = await f.c.start(request('cancel-preparation'));
  await entered.promise; assert.equal((await f.c.cancel(job.id)).job.status, 'cancelled');
  prepared.resolve(); const finished = await waitFor(f.c);
  assert.equal(finished.status, 'cancelled'); assert.equal(dispatches, 0); assert.equal(f.applies.length, 0); assert.equal(f.receipts.length, 0);
  assert.deepEqual(f.c.accounting(), { knownTokens: 0, unknownCalls: 0, observedCalls: 0 });
});

test('cancellation retains real usage even when an upstream ignores its abort signal', async t => {
  const entered = deferred(), blocked = deferred();
  const f = await fixture(t, { stream: async function* () { yield { type: 'usage', usage }; entered.resolve(); await blocked.promise; yield* chunks(); } });
  const { job } = await f.c.start(request('cancel-stream'));
  await entered.promise; assert.equal((await f.c.cancel(job.id)).job.totalTokens, 50);
  const finished = await waitFor(f.c);
  assert.equal(finished.status, 'cancelled'); assert.deepEqual(finished.usage, usage); assert.equal(finished.totalTokens, 50);
  assert.equal(f.receipts.length, 1); assert.equal(f.receipts[0].totalTokens, 50); assert.equal(f.applies.length, 0);
  blocked.resolve();
});

test('application phase rejects cancellation rather than promising a rollback', async t => {
  const entered = deferred(), proceed = deferred();
  const f = await fixture(t, { apply: async (payload, context, journal) => { entered.resolve(); await proceed.promise; return journal.configure(payload, context); } });
  const { job } = await f.c.start(request('applying'));
  await entered.promise;
  await assert.rejects(f.c.cancel(job.id), { code: 'GENERATION_APPLYING', status: 409 });
  assert.equal(f.c.get(job.id).job.stage, 'applying');
  proceed.resolve(); assert.equal((await waitFor(f.c)).status, 'succeeded');
});

test('stable request identity prevents repeat charge, rejects changed intent, and survives restart', async t => {
  const gate = deferred(), entered = deferred();
  const f = await fixture(t, { stream: async function* () { entered.resolve(); await gate.promise; yield* chunks(); } });
  const input = request('idempotent');
  const [first, same] = await Promise.all([f.c.start(input), f.c.start(input)]);
  assert.equal(first.job.id, same.job.id); await entered.promise;
  await assert.rejects(f.c.start({ ...input, theme: 'cyber' }), { code: 'GENERATION_REQUEST_ID_REUSED' });
  await assert.rejects(f.c.start(request('other-active')), { code: 'GENERATION_BUSY' });
  gate.resolve(); const completed = await waitFor(f.c);
  assert.equal((await f.c.start(input)).job.status, 'succeeded'); assert.equal(f.calls.length, 1);
  await f.reopen(); assert.equal((await f.c.start(input)).job.id, completed.id); assert.equal(f.calls.length, 1);
});

test('counter changes and local revision races never require another model request', async t => {
  const gate = deferred(), entered = deferred(); let races = 0;
  const f = await fixture(t, { stream: async function* () { entered.resolve(); await gate.promise; yield* chunks(); },
    apply: async (payload, context, journal) => {
      if (races++ === 0) await journal.ingest([{ id: 'local-race', kind: 'tokens', at: Date.now(), sessionId: 'fixture', turnKey: 'fixture-turn', amount: 10 }]);
      return journal.configure(payload, context);
    } });
  await f.c.start(request('counter-concurrency')); await entered.promise;
  await f.journal.ingest([{ id: 'background-tokens', kind: 'tokens', at: Date.now(), sessionId: 'fixture', turnKey: 'fixture-turn', amount: 20 }]);
  gate.resolve(); const job = await waitFor(f.c);
  assert.equal(job.status, 'succeeded'); assert.equal(f.calls.length, 1); assert.equal(f.applies.length, 2); assert.equal(f.journal.snapshot().totals.tokens, 30);
});

test('a concurrent theme or rule configuration rejects application while keeping real usage', async t => {
  const gate = deferred(), entered = deferred();
  const f = await fixture(t, { stream: async function* () { entered.resolve(); await gate.promise; yield* chunks(); } });
  await f.c.start(request('config-concurrency')); await entered.promise;
  await f.journal.preferences({ theme: 'cyber' }); gate.resolve();
  const job = await waitFor(f.c);
  assert.equal(job.status, 'failed'); assert.equal(job.code, 'GENERATION_REVISION_CONFLICT'); assert.equal(job.totalTokens, 50); assert.equal(f.applies.length, 0);
  assert.equal(f.journal.snapshot().preferences.theme, 'cyber'); assert.equal(f.receipts.length, 1);
});

test('failed provider responses preserve usage; absent cache buckets and absent usage remain unknown', async t => {
  let mode = 0;
  const f = await fixture(t, { stream: () => mode === 0 ? chunks(output(), { finish: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'fixture' } } })
    : mode === 1 ? chunks(output(), { usage: { inputTokens: 10, outputTokens: 15 } })
      : mode === 2 ? chunks(output(), { usage: false })
        : chunks(output(), { usage: { inputTokens: 10, outputTokens: 15, cacheReadTokens: 20, cacheWriteTokens: 5, reasoningTokens: 4 } }) });
  await f.c.start(request('failed-usage')); let job = await waitFor(f.c); assert.equal(job.status, 'failed'); assert.equal(job.totalTokens, 50);
  mode = 1; await f.c.start(request('partial-usage')); job = await waitFor(f.c); assert.equal(job.status, 'succeeded'); assert.equal(job.totalTokens, null); assert.deepEqual(job.usage, { inputTokens: 10, outputTokens: 15 });
  mode = 2; await f.c.start(request('unknown-usage')); job = await waitFor(f.c); assert.equal(job.usage, null); assert.equal(job.totalTokens, null);
  mode = 3; await f.c.start(request('derived-usage')); job = await waitFor(f.c); assert.equal(job.totalTokens, 50); assert.equal(job.usage.totalTokens, undefined);
  assert.deepEqual(f.c.accounting(), { knownTokens: 100, unknownCalls: 2, observedCalls: 4 });
});

test('corrupt or future-version generation receipts disable generation without resetting saved bytes', async t => {
  const f = await fixture(t);
  for (const data of ['{broken', JSON.stringify({ schemaVersion: 99, jobs: [] })]) {
    await f.c.dispose(); await writeFile(f.file, data); await f.reopen();
    assert.equal((await f.c.info()).available, false);
    await assert.rejects(f.c.start(request('corrupt')), { code: 'GENERATION_STORAGE' });
    assert.equal(await readFile(f.file, 'utf8'), data);
  }
  assert.equal(f.prepares.length, 0);
});

test('an interrupted receipt is finalized on restart with no model or configuration replay', async t => {
  const entered = deferred(), blocked = deferred();
  const f = await fixture(t, { stream: async function* () { entered.resolve(); await blocked.promise; yield* chunks(); } });
  const input = request('interrupted'); await f.c.start(input); await entered.promise;
  const interrupted = await readFile(f.file, 'utf8');
  await f.c.dispose(); blocked.resolve(); await writeFile(f.file, interrupted); await f.reopen();
  const job = f.c.get().job;
  assert.equal(job.status, 'failed'); assert.equal(job.code, 'GENERATION_INTERRUPTED');
  assert.equal((await f.c.start(input)).job.id, job.id); assert.equal(f.calls.length, 1); assert.equal(f.applies.length, 0);
  assert.equal(f.c.accounting().unknownCalls, 1);
});

test('pending usage delivery is retried by stable receipt identity without model replay', async t => {
  let unavailable = true;
  const f = await fixture(t, { recordUsage: () => { if (unavailable) throw new Error('fixture persistence'); } });
  await f.c.start(request('usage-outbox')); const job = await waitFor(f.c);
  assert.equal(job.status, 'succeeded'); assert.equal(f.receipts.length, 1);
  unavailable = false; await f.reopen();
  assert.equal(f.receipts.length, 2); assert.equal(f.receipts[0].id, f.receipts[1].id); assert.equal(f.calls.length, 1);
});

test('a full finite receipt budget refuses new charges and retains old idempotency records', async t => {
  const f = await fixture(t); await f.c.start(request('budget-original')); await waitFor(f.c); await f.c.dispose();
  const data = JSON.parse(await readFile(f.file, 'utf8')), original = data.jobs[0];
  data.jobs = Array.from({ length: 1000 }, (_, i) => ({ ...structuredClone(original), id: `generation-${digest(`job-${i}`)}`, requestHash: digest(`request-${i}`), fingerprint: digest(`fingerprint-${i}`) }));
  await writeFile(f.file, JSON.stringify(data)); await f.reopen();
  assert.equal((await f.c.info()).available, false);
  await assert.rejects(f.c.start(request('budget-new')), { code: 'GENERATION_BUDGET' });
  assert.equal(f.calls.length, 1); assert.equal(JSON.parse(await readFile(f.file, 'utf8')).jobs.length, 1000);
});

test('dispose aborts a non-cooperating preparation and does not leave dispatch behind', async t => {
  const entered = deferred();
  const f = await fixture(t, { prepare: () => { entered.resolve(); return new Promise(() => {}); } });
  await f.c.start(request('dispose-prepare')); await entered.promise;
  const start = Date.now(); await f.c.dispose();
  assert.ok(Date.now() - start < 1000); assert.equal(f.calls.length, 0); assert.equal(f.c.get().job.status, 'cancelled');
  assert.equal((await f.c.info()).available, false);
});

test('deadline and output size are bounded without applying a truncated configuration', async t => {
  const realTimer = globalThis.setTimeout;
  globalThis.setTimeout = (callback, ms, ...args) => realTimer(callback, ms === 60000 ? 30 : ms, ...args);
  t.after(() => { globalThis.setTimeout = realTimer; });
  let mode = 'timeout';
  const f = await fixture(t, { stream: () => mode === 'timeout' ? { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: async () => ({ done: true }) }; } }
    : chunks('x'.repeat(65537)) });
  await f.c.start(request('deadline')); let job = await waitFor(f.c);
  assert.equal(job.status, 'failed'); assert.equal(job.code, 'GENERATION_TIMEOUT'); assert.equal(job.totalTokens, null);
  mode = 'oversize'; await f.c.start(request('oversize')); job = await waitFor(f.c);
  assert.equal(job.status, 'failed'); assert.equal(job.code, 'GENERATION_OUTPUT_LIMIT'); assert.equal(f.applies.length, 0);
});

test('an unavailable domain writer never reads, rewrites or recovers another host generation receipt', async t => {
  const f = await fixture(t); await f.c.start(request('live-owner')); await waitFor(f.c); await f.c.dispose();
  const data = JSON.parse(await readFile(f.file, 'utf8'));
  Object.assign(data.jobs[0], { status: 'running', stage: 'generating' });
  const bytes = JSON.stringify(data); await writeFile(f.file, bytes);
  const other = await createGenerationController({ ctx: f.ctx, file: f.file, hashKey: digest,
    journal: { snapshot: () => ({ storage: { status: 'unavailable' } }) }, catalog: () => f.dataCatalog,
    apply: () => assert.fail('unavailable writer must not apply'), recordUsage: () => assert.fail('unavailable writer must not settle another owner') });
  try { assert.equal((await other.info()).available, false); assert.equal(other.get().job, null); assert.equal(await readFile(f.file, 'utf8'), bytes); }
  finally { await other.dispose(); }
});

test('a committed domain write with uncertain durability records committed goals and never retries generation', async t => {
  const f = await fixture(t, { apply: async (payload, context, journal) => {
    await journal.configure(payload, context);
    await journal.configure({ requestId: 'other-actor', definitions: [definition({ template: 'count', metric: 'file_read', target: 20 }, { title: '其它操作者的新目标' })] }, { source: 'user' });
    throw Object.assign(new Error('fixture directory fsync failed after rename'), { code: 'DURABILITY_UNCERTAIN', committed: true });
  } });
  const input = request('committed-uncertain'); await f.c.start(input);
  const job = await waitFor(f.c);
  assert.equal(job.status, 'succeeded'); assert.equal(job.code, 'DURABILITY_UNCERTAIN');
  assert.match(job.message, /已提交/); assert.match(job.message, /持久性尚未确认/); assert.match(job.message, /不要重复生成/); assert.doesNotMatch(job.message, /未应用/);
  assert.equal(job.createdDefinitionIds.length, 1);
  assert.equal(f.journal.snapshot().definitions.find(item => item.id === job.createdDefinitionIds[0]).title, '阅卷有迹');
  assert.equal(f.journal.snapshot().definitions.filter(item => item.source === 'model').length, 2);
  assert.equal(job.totalTokens, 50); assert.equal(f.receipts.length, 1);
  assert.equal((await f.c.start(input)).job.code, 'DURABILITY_UNCERTAIN');
  await f.reopen(); assert.equal((await f.c.start(input)).job.code, 'DURABILITY_UNCERTAIN');
  assert.equal(f.calls.length, 1); assert.equal(f.applies.length, 1);
});

test('committed uncertainty does not invent definition ids absent from the public snapshot', async t => {
  let hideCreated = false;
  const f = await fixture(t, { apply: async (payload, context, journal) => {
    await journal.configure(payload, context); hideCreated = true;
    throw Object.assign(new Error('committed fixture'), { code: 'DURABILITY_UNCERTAIN', committed: true });
  } });
  const snapshot = f.journal.snapshot;
  f.journal.snapshot = () => { const result = snapshot(); if (hideCreated) result.definitions = result.definitions.filter(item => item.source === 'builtin'); return result; };
  await f.c.start(request('unconfirmed-ids')); const job = await waitFor(f.c);
  assert.equal(job.status, 'succeeded'); assert.equal(job.code, 'DURABILITY_UNCERTAIN'); assert.deepEqual(job.createdDefinitionIds, []);
  assert.equal(snapshot().definitions.length, 17);
});

test('dispose during an enqueued catalog lookup prevents every later preparation and dispatch', async t => {
  const entered = deferred(), catalogGate = deferred(); let catalogCalls = 0;
  const f = await fixture(t, { catalog: async (...args) => { if (++catalogCalls === 1) { entered.resolve(); await catalogGate.promise; } return args.at(-1); } });
  const starting = f.c.start(request('close-before-owner'));
  const rejected = assert.rejects(starting, { code: 'GENERATION_CLOSED' });
  await entered.promise;
  await f.c.dispose(); catalogGate.resolve(); await rejected; await sleep(20);
  assert.equal(f.prepares.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.applies.length, 0); assert.equal(f.c.get().job, null);
  assert.equal(f.journal.snapshot().definitions.length, 16);
});

test('dispose while the first receipt write is pending cannot activate a late owner', async t => {
  let controller, scheduled = false; const closing = deferred();
  const f = await fixture(t, { now: () => {
    if (controller && !scheduled) { scheduled = true; queueMicrotask(() => { closing.resolve(controller.dispose()); }); }
    return Date.now();
  } });
  controller = f.c;
  await assert.rejects(f.c.start(request('close-during-intent-write')), { code: 'GENERATION_CLOSED' });
  await closing.promise; await sleep(20);
  assert.equal(f.prepares.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.applies.length, 0);
  assert.equal(f.c.get().job.status, 'cancelled'); assert.equal(f.c.get().job.attempted, false);
  const saved = JSON.parse(await readFile(f.file, 'utf8')); assert.equal(saved.jobs[0].status, 'cancelled');
});

test('optional Cordis services use get before protected getters for default and current model routes', async t => {
  const f = await fixture(t);
  const sessionId = 'strict-cordis-session', session = { id: sessionId }, agent = { session };
  const services = new Map([
    ['llm', f.ctx.llm], ['agentDefaultModel', f.ctx.agentDefaultModel],
    ['sessions', { get: id => id === sessionId ? session : undefined }],
    ['sessionProjections', { snapshot: value => { assert.equal(value, session); return { values: { modelSelection: { next: { provider: 'selected-provider', model: 'selected-model' } } } }; } }],
    ['agents', { get: id => id === sessionId ? agent : undefined }],
  ]);
  const lookedUp = []; let forbiddenReads = 0;
  f.ctx.get = name => { lookedUp.push(name); return services.get(name); };
  for (const name of services.keys()) Object.defineProperty(f.ctx, name, { configurable: true, get() { forbiddenReads++; throw new Error(`cannot get property "${name}" without inject`); } });
  const defaultRoute = await f.c.info();
  assert.equal(defaultRoute.available, true); assert.equal(defaultRoute.routeSource, 'default'); assert.equal(defaultRoute.route.model, 'default-model');
  await f.c.start(request('strict-default')); assert.equal((await waitFor(f.c)).status, 'succeeded');
  const currentRoute = await f.c.info({ sessionId });
  assert.equal(currentRoute.available, true); assert.equal(currentRoute.routeSource, 'session'); assert.equal(currentRoute.route.model, 'selected-model');
  await f.c.start(request('strict-current', { sessionId })); assert.equal((await waitFor(f.c)).status, 'succeeded');
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].model, 'default-model'); assert.equal(f.calls[1].model, 'selected-model');
  assert.equal(forbiddenReads, 0);
  for (const name of services.keys()) assert.ok(lookedUp.includes(name), `${name} must be resolved through public get`);
});

test('character generation uses catalog presets and name summaries without reading art or granting ownership', async t => {
  const f = await fixture(t, { stream: () => chunks(characterOutput()) });
  await f.journal.configureCharacters({ requestId: 'existing-character', characters: [character({ name: '旧友' })] }, { source: 'user' });
  const originalSnapshot = f.journal.snapshot;
  let forbiddenArtReads = 0;
  f.journal.snapshot = () => {
    const result = originalSnapshot();
    for (const item of result.collection.characters) Object.defineProperty(item, 'art', { enumerable: true, get() { forbiddenArtReads++; assert.fail('generator must not read or serialize character art'); } });
    return result;
  };
  const before = originalSnapshot();
  const input = characterRequest('characters-once', { direction: '清淡的山间旅伴' });
  const started = await f.c.start(input);
  assert.equal(started.job.kind, 'characters');
  const job = await waitFor(f.c);
  assert.equal(job.status, 'succeeded', JSON.stringify(job));
  assert.deepEqual(job.createdDefinitionIds, []); assert.equal(job.createdCharacterIds.length, 1);
  const after = originalSnapshot();
  assert.equal(after.collection.characters.length, before.collection.characters.length + 1);
  assert.equal(after.collection.characters.find(item => item.id === job.createdCharacterIds[0]).source, 'model');
  assert.equal(after.collection.characters.find(item => item.id === job.createdCharacterIds[0]).name, '云归');
  assert.deepEqual(after.definitions, before.definitions);
  assert.equal(after.totals.tokens, before.totals.tokens); assert.equal(after.totals.turns, 0);
  for (const key of ['owned', 'ownedCharacters', 'wallet', 'points', 'balance', 'draws', 'drawHistory']) assert.deepEqual(after.collection[key], before.collection[key], `${key} must not be granted or spent by generation`);
  assert.equal(forbiddenArtReads, 0);
  const sent = JSON.parse(f.calls[0].messages[0].content[0].text);
  assert.equal(sent.theme, 'xianxia'); assert.equal(sent.direction, input.direction);
  assert.ok(sent.existingNames.names.includes('旧友'));
  assert.deepEqual(sent.allowed.iconIds, f.dataCatalog.collection.iconIds);
  assert.deepEqual(sent.allowed.animationIds, f.dataCatalog.collection.animationIds);
  assert.deepEqual(sent.allowed.rarities, ['N', 'R', 'SR', 'SSR']);
  for (const key of ['metrics', 'recordedCounts', 'art', 'owned', 'wallet', 'history']) assert.equal(sent[key], undefined);
  assert.deepEqual(f.calls[0].tools, []); assert.equal(f.calls[0].messages.length, 1);
  assert.deepEqual(Object.keys(f.applies[0].payload).sort(), ['characters', 'expectedRevision', 'kind', 'requestId']);
  assert.equal(f.applies[0].context.source, 'model');
  assert.equal(f.receipts[0].usageSource, 'auxiliary_generation'); assert.equal(job.totalTokens, 50);
  const stored = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(stored.jobs[0].summary.kind, 'characters');
  assert.ok(!JSON.stringify(stored).includes(input.direction));
  assert.equal((await f.c.start({ ...input, metrics: [], style: 'balanced' })).job.id, job.id);
  await f.reopen(); assert.equal((await f.c.start(input)).job.id, job.id);
  await assert.rejects(f.c.start({ ...input, kind: 'achievements', metrics: ['tokens'], style: 'balanced' }), { code: 'GENERATION_REQUEST_ID_REUSED' });
  assert.equal(f.calls.length, 1);
});

test('character output rejects assets, grants, off-catalog choices, wrong themes and duplicate names', async t => {
  let raw = characterOutput();
  const f = await fixture(t, { stream: () => chunks(raw) });
  const before = f.journal.snapshot();
  const invalid = [
    { definitions: [definition()] },
    { characters: [character()], balance: 100 },
    { characters: [] },
    { characters: Array.from({ length: 9 }, (_, i) => character({ name: `角色 ${i}` })) },
    { characters: [character(), character()] },
    ...[
      { id: 'builtin:replace' }, { art: 'data:image/png;base64,iVBORw0KGgo=' },
      { svg: '<svg></svg>' }, { url: 'https://example.invalid/image.png' },
      { owned: true }, { points: 100 }, { theme: 'cyber' }, { rarity: 'UR' },
      { icon: 'outside-catalog' }, { animation: 'execute' },
      { description: 'https://example.invalid/image.png' },
      { description: '<svg onload="alert(1)"></svg>' },
      { description: 'data:image/gif;base64,R0lGODlh' },
      { description: 'UklGRiIAAABXRUJQVlA4' },
      { description: '<script>alert(1)</script>' }, { name: '' },
    ].map(change => ({ characters: [character(change)] })),
  ];
  for (const [index, value] of invalid.entries()) {
    raw = JSON.stringify(value);
    await f.c.start(characterRequest(`invalid-character-${index}`));
    const job = await waitFor(f.c);
    assert.equal(job.status, 'failed', `character case ${index}`);
    assert.deepEqual(job.createdCharacterIds, []); assert.deepEqual(job.createdDefinitionIds, []);
  }
  assert.equal(f.applies.length, 0);
  assert.deepEqual(f.journal.snapshot().collection, before.collection);
});

test('character presets and all ten themes come from the current catalog before a model call', async t => {
  const f = await fixture(t, { stream: () => chunks(characterOutput([character({ theme: 'space', name: '星湾旅伴', icon: 'ship', animation: 'orbit' })])) });
  assert.equal(f.dataCatalog.themeIds.length, 10);
  await f.c.start(characterRequest('space-character', { theme: 'space' }));
  assert.equal((await waitFor(f.c)).status, 'succeeded');
  f.dataCatalog.themeIds = f.dataCatalog.themeIds.filter(theme => theme !== 'space');
  await assert.rejects(f.c.start(characterRequest('removed-theme', { theme: 'space' })), { code: 'GENERATION_SOURCE_UNAVAILABLE' });
  const icons = f.dataCatalog.collection.iconIds; f.dataCatalog.collection.iconIds = [];
  await assert.rejects(f.c.start(characterRequest('missing-role-presets')), { code: 'GENERATION_SOURCE_UNAVAILABLE' });
  f.dataCatalog.collection.iconIds = icons;
  await assert.rejects(f.c.start(characterRequest('role-image-direction', { direction: '参考 https://example.invalid/role.png' })), { code: 'GENERATION_OUTPUT' });
  assert.equal(f.calls.length, 1);
});

test('character generation tolerates counter, equipment and collection progress while applying at the latest revision', async t => {
  const entered = deferred(), proceed = deferred(); let raced = false;
  const f = await fixture(t, {
    stream: async function* () { entered.resolve(); await proceed.promise; yield* chunks(characterOutput()); },
    apply: async (payload, context, journal) => {
      if (!raced) { raced = true; await journal.ingest([{ id: 'character-apply-race', kind: 'tokens', at: Date.now(), sessionId: 'fixture', turnKey: 'fixture', amount: 20 }]); }
      const { kind, ...input } = payload; return journal.configureCharacters(input, context);
    },
  });
  await f.c.start(characterRequest('character-progress'));
  await entered.promise;
  await f.journal.ingest([
    { id: 'character-background', kind: 'tokens', at: Date.now(), sessionId: 'fixture', turnKey: 'fixture', amount: 10 },
    { id: 'character-background-read', kind: 'file_read', at: Date.now(), sessionId: 'fixture', turnKey: 'fixture', key: 'opaque-file' },
  ]);
  await f.journal.draw({ requestId: 'draw-during-character-generation', theme: 'xianxia' });
  await f.journal.equip({ slot: 'charm', id: 'star' });
  await f.journal.preferences({ notifications: 'off' });
  proceed.resolve();
  const job = await waitFor(f.c);
  assert.equal(job.status, 'succeeded'); assert.equal(job.createdCharacterIds.length, 1);
  assert.equal(f.calls.length, 1); assert.equal(f.applies.length, 2);
  assert.equal(f.journal.snapshot().totals.tokens, 30);
  assert.equal(f.journal.snapshot().equipment.charm, 'star');
  assert.equal(f.journal.snapshot().collection.draws.length, 1);
  assert.ok(f.journal.snapshot().collection.owned.length > 0);
});

test('a concurrent character definition change rejects stale generated definitions and preserves usage', async t => {
  const entered = deferred(), proceed = deferred();
  const f = await fixture(t, { stream: async function* () { entered.resolve(); await proceed.promise; yield* chunks(characterOutput()); } });
  await f.c.start(characterRequest('stale-characters'));
  await entered.promise;
  await f.journal.configureCharacters({ requestId: 'other-character-author', characters: [character({ name: '另一位旅伴' })] }, { source: 'user' });
  proceed.resolve();
  const job = await waitFor(f.c);
  assert.equal(job.status, 'failed'); assert.equal(job.code, 'GENERATION_REVISION_CONFLICT');
  assert.deepEqual(job.createdCharacterIds, []); assert.equal(f.applies.length, 0);
  assert.ok(f.journal.snapshot().collection.characters.some(item => item.name === '另一位旅伴'));
  assert.ok(!f.journal.snapshot().collection.characters.some(item => item.name === '云归'));
  assert.equal(job.totalTokens, 50); assert.equal(f.receipts.length, 1);
});

test('character cancellation and pending usage replay never apply or resend a paid request', async t => {
  const entered = deferred(), proceed = deferred(); let unavailable = true;
  const f = await fixture(t, {
    stream: async function* () { yield { type: 'usage', usage }; entered.resolve(); await proceed.promise; yield* chunks(characterOutput()); },
    recordUsage: () => { if (unavailable) throw new Error('fixture outbox unavailable'); },
  });
  const input = characterRequest('cancelled-character-call');
  const started = await f.c.start(input); await entered.promise;
  await f.c.cancel(started.job.id);
  const job = await waitFor(f.c); proceed.resolve();
  assert.equal(job.kind, 'characters'); assert.equal(job.status, 'cancelled');
  assert.equal(job.totalTokens, 50); assert.equal(f.applies.length, 0);
  unavailable = false; await f.reopen();
  assert.equal((await f.c.start(input)).job.status, 'cancelled');
  assert.equal(f.receipts.length, 2); assert.equal(f.receipts[0].id, f.receipts[1].id);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.c.get().job.createdCharacterIds, []);
});

test('legacy achievement receipts without kind retain identity and never trigger another paid call', async t => {
  const f = await fixture(t);
  const input = request('legacy-no-kind'); await f.c.start(input); const original = await waitFor(f.c);
  await f.c.dispose();
  const data = JSON.parse(await readFile(f.file, 'utf8'));
  delete data.jobs[0].summary.kind; delete data.jobs[0].createdCharacterIds;
  await writeFile(f.file, JSON.stringify(data)); await f.reopen();
  const replay = await f.c.start({ ...input, kind: 'achievements' });
  assert.equal(replay.job.id, original.id); assert.equal(replay.job.kind, 'achievements');
  assert.deepEqual(replay.job.createdCharacterIds, []); assert.equal(f.calls.length, 1);
});

test('committed character uncertainty confirms only this request identities without including concurrent authors', async t => {
  const f = await fixture(t, {
    stream: () => chunks(characterOutput()),
    apply: async (payload, context, journal) => {
      const { kind, ...input } = payload; await journal.configureCharacters(input, context);
      await journal.configureCharacters({ requestId: 'another-character-writer', characters: [character({ name: '旁观旅伴' })] }, { source: 'user' });
      throw Object.assign(new Error('fixture committed character'), { code: 'DURABILITY_UNCERTAIN', committed: true });
    },
  });
  const input = characterRequest('uncertain-characters'); await f.c.start(input);
  const job = await waitFor(f.c);
  assert.equal(job.status, 'succeeded'); assert.equal(job.code, 'DURABILITY_UNCERTAIN');
  assert.match(job.message, /角色配置已提交/); assert.doesNotMatch(job.message, /未应用/);
  assert.deepEqual(job.createdDefinitionIds, []); assert.equal(job.createdCharacterIds.length, 1);
  assert.equal(f.journal.snapshot().collection.characters.find(item => item.id === job.createdCharacterIds[0]).name, '云归');
  await f.reopen(); assert.equal((await f.c.start(input)).job.id, job.id); assert.equal(f.calls.length, 1);
});

async function fillCharacterSlots(f, count, prefix) {
  const batchSize = f.dataCatalog.collection.limits.characterBatch;
  for (let offset = 0; offset < count; offset += batchSize) {
    const characters = Array.from({ length: Math.min(batchSize, count - offset) }, (_, index) => character({ name: `${prefix}伙伴${offset + index}` }));
    await f.journal.configureCharacters({ requestId: `${prefix}-${offset}`, characters }, { source: 'user' });
  }
}

test('a full custom or total character pool refuses generation before preparing or charging a model', async t => {
  const f = await fixture(t);
  await fillCharacterSlots(f, f.dataCatalog.collection.limits.customCharacters, 'full-pool');
  const full = f.journal.snapshot();
  await assert.rejects(f.c.start(characterRequest('full-pool-generation')), { code: 'GENERATION_CHARACTER_CAPACITY' });
  assert.equal(f.prepares.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.receipts.length, 0);
  assert.equal(f.c.get().job, null); assert.deepEqual(f.journal.snapshot(), full);
  await f.c.start(request('achievements-still-available'));
  assert.equal((await waitFor(f.c)).status, 'succeeded', 'character capacity must not disable achievement generation');

  const g = await fixture(t);
  g.dataCatalog.collection.limits.characters = g.journal.snapshot().collection.characters.length;
  await assert.rejects(g.c.start(characterRequest('total-pool-full')), { code: 'GENERATION_CHARACTER_CAPACITY' });
  assert.equal(g.prepares.length, 0); assert.equal(g.calls.length, 0); assert.equal(g.c.get().job, null);
});

test('one remaining character slot bounds the prompt and rejects two outputs, then rechecks capacity before dispatch', async t => {
  const f = await fixture(t, { stream: () => chunks(characterOutput([character(), character({ name: '月返' })])) });
  await fillCharacterSlots(f, f.dataCatalog.collection.limits.customCharacters - 1, 'nearly-full');
  const before = f.journal.snapshot();
  await f.c.start(characterRequest('one-slot-two-output'));
  const job = await waitFor(f.c);
  assert.equal(job.status, 'failed'); assert.equal(job.code, 'GENERATION_OUTPUT');
  assert.equal(f.applies.length, 0); assert.deepEqual(f.journal.snapshot(), before);
  const supplied = JSON.parse(f.calls[0].messages[0].content[0].text);
  assert.equal(supplied.allowed.maxCharacters, 1); assert.match(f.calls[0].system, /Design 1 to 1/);
  assert.equal(f.receipts.length, 1);

  const prepare = f.ctx.llm.prepareCall;
  f.ctx.llm.prepareCall = async (...args) => {
    const prepared = await prepare(...args);
    await f.journal.configureCharacters({ requestId: 'last-slot-during-prepare', characters: [character({ name: '最后空位' })] }, { source: 'user' });
    return prepared;
  };
  await f.c.start(characterRequest('filled-while-preparing'));
  const blocked = await waitFor(f.c);
  assert.equal(blocked.status, 'failed'); assert.equal(blocked.code, 'GENERATION_CHARACTER_CAPACITY');
  assert.equal(blocked.attempted, false);
  assert.equal(f.prepares.length, 2); assert.equal(f.calls.length, 1, 'a pool filled during preparation must not dispatch another model request');
  assert.equal(f.applies.length, 0); assert.equal(f.receipts.length, 1);
});
