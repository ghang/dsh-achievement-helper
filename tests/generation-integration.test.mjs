import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm';
import Sessions from '@deepseek-ai/dsh-session';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools, { defineTool } from '@deepseek-ai/dsh-tools';
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import { fakeUpstream } from './fake-upstream.mjs';

const source = process.env.JOURNAL_ARTIFACT
  ? pathToFileURL(join(process.env.JOURNAL_ARTIFACT, 'lib/index.mjs'))
  : new URL('../src/index.mjs', import.meta.url);
const { createAchievementJournal } = await import(source);

const mainPrompt = 'SYNTHETIC_MAIN_SESSION_PROMPT_MUST_STAY_LOCAL';
const mainTool = 'synthetic_main_session_tool';
const generated = {
  title: '积少成章', description: '在配置之后，记录下一段自然积累。', icon: 'book',
  rule: { template: 'count', metric: 'tokens', target: 12345 },
  themes: {
    explorer: { title: '积少成章', description: '记录自然使用中的下一段积累。' },
    xianxia: { title: '灵光成卷', description: '下一段修行，从此刻开始留痕。' },
    cyber: { title: '微光存档', description: '把后续真实经历写入个人档案。' },
  },
};
const input = { requestId: 'generation-integration', metrics: ['tokens'], theme: 'xianxia', style: 'balanced', sessionId: 'synthetic-main-session' };

async function eventually(read, message = 'generation did not settle') {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await delay(10);
  }
  throw new Error(message);
}

function latch() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Gate an actual HTTP request before the synthetic SSE response. This lets a
// journal write race with model generation without replacing the real adapter.
async function gateResponse(upstream) {
  const arrived = latch(), released = latch();
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      arrived.resolve();
      await released.promise;
      const reply = await fetch(`${upstream.url}${request.url}`, {
        method: request.method, headers: { 'content-type': 'application/json' },
        body: Buffer.concat(chunks),
      });
      response.writeHead(reply.status, { 'content-type': reply.headers.get('content-type') ?? 'text/event-stream' });
      response.end(Buffer.from(await reply.arrayBuffer()));
    } catch {
      if (!response.destroyed) { response.writeHead(502); response.end('Synthetic gate failed'); }
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`, arrived: arrived.promise,
    release: () => released.resolve(),
    async close() {
      released.resolve(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function fixture(t, { gated = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-generation-integration-'));
  const statePath = join(directory, 'journal/state.json');
  const upstream = await fakeUpstream([{ text: JSON.stringify({ definitions: [generated] }) }]);
  const gate = gated ? await gateResponse(upstream) : null;
  const realCtx = new Context();
  let service;
  t.after(async () => {
    gate?.release();
    await service?.dispose();
    await realCtx.fiber.dispose();
    await gate?.close();
    await upstream.close();
    await rm(directory, { recursive: true, force: true });
  });
  for (const plugin of [Llm, Sessions]) await realCtx.plugin(plugin);
  await realCtx.plugin(SystemPrompt, { personaPrefix: 'Synthetic main-session fixture.' });
  await realCtx.plugin(Tools);
  realCtx.llm.registerAdapter(['deepseek-official'], new DeepSeekAdapter({
    options: () => resolveAdapterOptions({ baseURL: gate?.url ?? upstream.url, retryPolicy: { mode: 'normal', maxRetries: 0 } }),
    resolveAuth: async () => ({ headers: { 'x-api-key': 'synthetic-only' } }),
    resolveUserId: () => 'achievement-local-generation-test', resolveAttachments: () => undefined,
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  }));
  realCtx.tools.register(defineTool({
    name: mainTool, description: 'Synthetic main-session tool; never available to auxiliary generation.',
    parameters: {}, output: { schema: { type: 'json' }, render: () => [] },
    execute: async () => { throw new Error('Auxiliary generation must never call main-session tools'); },
  }));
  const session = realCtx.sessions.create(input.sessionId);
  session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: mainPrompt }],
  }), { surfaceOp: 'append' });
  const sessionSequence = session.seq;
  const ctx = {
    llm: realCtx.llm, sessions: realCtx.sessions, tools: realCtx.tools,
    on: realCtx.on.bind(realCtx),
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) },
  };
  const create = async () => {
    service = await createAchievementJournal(ctx, { statePath, registerHttp: false, registerTools: false, collect: true });
    return service;
  };
  await create();
  assert.equal(service.catalog().capabilities.sources.find(item => item.kind === 'tokens')?.connected, true);
  assert.equal((await service.generation.info()).available, true);
  return { directory, statePath, upstream, gate, session, sessionSequence,
    get service() { return service; },
    async restart() { await service.dispose(); return create(); },
  };
}

async function settled(service, id) {
  const job = await eventually(() => {
    const value = service.generation.get(id).job;
    return value?.status !== 'running' && value;
  });
  await eventually(() => {
    const snapshot = service.snapshot();
    return snapshot.generation?.accounting?.observedCalls === 1 && snapshot.totals.tokens === 310;
  },
    'completed generation usage was not accounted');
  return job;
}

function assertAuxiliaryUsage(f, job, expectedFileReads = 0) {
  const snapshot = f.service.snapshot();
  assert.equal(job.usageSource, 'auxiliary_generation');
  assert.equal(job.totalTokens, 310);
  assert.equal(job.usage.inputTokens, 100);
  assert.equal(job.usage.cacheReadTokens, 200);
  assert.equal(job.usage.outputTokens, 10);
  assert.equal(snapshot.totals.tokens, 310);
  assert.equal(snapshot.totals.turns, 0, 'auxiliary usage must not invent a completed conversational turn');
  assert.equal(snapshot.totals.fileReads, expectedFileReads);
  assert.deepEqual(snapshot.generation.accounting, { knownTokens: 310, unknownCalls: 0, observedCalls: 1 });
  assert.equal(snapshot.generation.job.id, job.id);
  assert.equal(f.session.seq, f.sessionSequence, 'generation must not append to the main conversation');
}

test('one-click generation uses the real host LLM, commits model definitions and deduplicates across restart', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const initial = f.service.snapshot();
  const started = await f.service.generation.start(input);
  assert.equal(started.job.status, 'running');
  const retryWhileRunning = await f.service.generation.start(input);
  assert.equal(retryWhileRunning.job.id, started.job.id);
  const job = await settled(f.service, started.job.id);
  assert.equal(job.status, 'succeeded', JSON.stringify(job));
  assert.equal(f.upstream.requests.length, 1);
  assert.equal(job.routeSource, 'default');
  assert.deepEqual(job.route, { provider: 'deepseek-official', model: 'deepseek-flash' });

  const request = f.upstream.requests[0];
  assert.equal(request.model, 'deepseek-flash');
  assert.deepEqual(request.tools ?? [], []);
  assert.equal(request.messages.length, 1);
  assert.equal(request.messages[0].role, 'user');
  const supplied = JSON.parse(request.messages[0].content[0].text);
  assert.deepEqual(supplied.metrics, ['tokens']);
  assert.equal(supplied.theme, 'xianxia');
  assert.equal(supplied.style, 'balanced');
  assert.equal(supplied.recordedCounts.tokens, 0);
  const sent = JSON.stringify(request);
  for (const excluded of [mainPrompt, mainTool, input.sessionId, f.directory]) assert.ok(!sent.includes(excluded));

  const snapshot = f.service.snapshot();
  const added = snapshot.definitions.filter(item => !initial.definitions.some(previous => previous.id === item.id));
  assert.equal(added.length, 1);
  assert.deepEqual(job.createdDefinitionIds, [added[0].id]);
  assert.equal(added[0].source, 'model');
  assert.equal(added[0].configuredBy, 'model');
  assert.deepEqual(added[0].rule, generated.rule);
  assert.equal(added[0].themes.xianxia.title, generated.themes.xianxia.title);
  assert.equal(snapshot.preferences.theme, 'xianxia');
  assertAuxiliaryUsage(f, job);
  const stored = await readFile(f.statePath, 'utf8');
  for (const excluded of [mainPrompt, input.sessionId, f.directory]) assert.ok(!stored.includes(excluded));

  const revision = snapshot.revision;
  assert.equal((await f.service.generation.start(input)).job.id, job.id);
  assert.equal(f.service.snapshot().revision, revision);
  await f.restart();
  assert.equal(f.service.generation.get(job.id).job.status, 'succeeded');
  assert.equal((await f.service.generation.start(input)).job.id, job.id);
  assert.equal(f.upstream.requests.length, 1, 'requestId replay must never resend the model request');
  assert.equal(f.service.snapshot().revision, revision);
  assertAuxiliaryUsage(f, f.service.generation.get(job.id).job);
});

test('ordinary observed progress during generation applies against the latest journal revision without another LLM call', { timeout: 15000 }, async t => {
  const f = await fixture(t, { gated: true });
  const started = await f.service.generation.start(input);
  await f.gate.arrived;
  const oldRevision = f.service.snapshot().revision;
  await f.service.journal.ingest([{ id: 'synthetic-background-read', kind: 'file_read', at: Date.now(),
    sessionId: 'opaque-session', turnKey: 'opaque-turn', key: 'opaque-file' }]);
  assert.ok(f.service.snapshot().revision > oldRevision);
  f.gate.release();
  const job = await settled(f.service, started.job.id);
  assert.equal(job.status, 'succeeded', JSON.stringify(job));
  assert.equal(f.upstream.requests.length, 1);
  assert.equal(f.service.snapshot().definitions.filter(item => item.source === 'model').length, 1);
  assertAuxiliaryUsage(f, job, 1);
});

test('a concurrent theme change preserves the newer configuration and records auxiliary usage without applying stale definitions', { timeout: 15000 }, async t => {
  const f = await fixture(t, { gated: true });
  const initial = f.service.snapshot();
  const started = await f.service.generation.start(input);
  await f.gate.arrived;
  await f.service.mutate('preferences', { theme: 'cyber' });
  f.gate.release();
  const job = await settled(f.service, started.job.id);
  assert.equal(job.status, 'failed', JSON.stringify(job));
  assert.equal(job.code, 'GENERATION_REVISION_CONFLICT');
  assert.deepEqual(job.createdDefinitionIds, []);
  assert.equal(f.upstream.requests.length, 1);
  const snapshot = f.service.snapshot();
  assert.equal(snapshot.preferences.theme, 'cyber');
  assert.deepEqual(snapshot.definitions.map(item => item.id), initial.definitions.map(item => item.id));
  assertAuxiliaryUsage(f, job);
  assert.equal((await f.service.generation.start(input)).job.id, job.id);
  assert.equal(f.upstream.requests.length, 1, 'failed request receipts must also prevent a second charged call');
});

test('journals in the same directory isolate generation receipts and request identity across restart', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-generation-neighbors-'));
  const aPath = join(directory, 'a.json'), bPath = join(directory, 'b.json');
  const aDefinition = { ...generated, title: '甲册积累' }, bDefinition = { ...generated, title: '乙册探索' };
  const upstream = await fakeUpstream([
    { text: JSON.stringify({ definitions: [aDefinition] }) },
    { text: JSON.stringify({ definitions: [bDefinition] }) },
  ]);
  const realCtx = new Context();
  let a, b;
  t.after(async () => {
    await a?.dispose(); await b?.dispose();
    await realCtx.fiber.dispose(); await upstream.close();
    await rm(directory, { recursive: true, force: true });
  });
  for (const plugin of [Llm, Sessions]) await realCtx.plugin(plugin);
  realCtx.llm.registerAdapter(['deepseek-official'], new DeepSeekAdapter({
    options: () => resolveAdapterOptions({ baseURL: upstream.url, retryPolicy: { mode: 'normal', maxRetries: 0 } }),
    resolveAuth: async () => ({ headers: { 'x-api-key': 'synthetic-only' } }),
    resolveUserId: () => 'achievement-neighbor-test', resolveAttachments: () => undefined,
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  }));
  const ctx = { llm: realCtx.llm, sessions: realCtx.sessions, on: realCtx.on.bind(realCtx),
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) } };
  const create = statePath => createAchievementJournal(ctx, { statePath, registerHttp: false, registerTools: false, collect: true });
  const idle = async service => {
    for (let i = 0; i < 500; i++) {
      if (!(await service.generation.info()).activeJob) return;
      await delay(10);
    }
    assert.fail('generation receipt did not finish its durable usage acknowledgement');
  };
  a = await create(aPath); b = await create(bPath);
  assert.equal(a.snapshot().storage.status, 'ready');
  assert.equal(b.snapshot().storage.status, 'ready');
  const aInput = { requestId: 'same-click', metrics: ['tokens'], theme: 'xianxia', style: 'balanced', direction: '甲册自然积累' };
  const bInput = { ...aInput, direction: '乙册探索发现' };
  const aJob = await settled(a, (await a.generation.start(aInput)).job.id);
  const bJob = await settled(b, (await b.generation.start(bInput)).job.id);
  assert.equal(aJob.status, 'succeeded'); assert.equal(bJob.status, 'succeeded');
  await idle(a); await idle(b);
  assert.equal(upstream.requests.length, 2, 'each independent journal may generate once for its own requestId');
  assert.equal(a.snapshot().definitions.find(item => item.source === 'model')?.title, aDefinition.title);
  assert.equal(b.snapshot().definitions.find(item => item.source === 'model')?.title, bDefinition.title);
  const aRevision = a.snapshot().revision;
  const aBytes = await readFile(aPath, 'utf8');
  const aReceipt = await readFile(aPath + '.generation-v1.json', 'utf8');
  const bReceipt = await readFile(bPath + '.generation-v1.json', 'utf8');
  assert.notEqual(aReceipt, bReceipt, 'different generation intent must have separate durable receipts');

  await b.dispose(); b = await create(bPath);
  assert.equal((await b.generation.start(bInput)).job.status, 'succeeded');
  assert.equal(a.snapshot().revision, aRevision);
  assert.equal(await readFile(aPath, 'utf8'), aBytes);
  assert.equal(await readFile(aPath + '.generation-v1.json', 'utf8'), aReceipt, 'restarting B cannot rewrite A receipts');
  await a.dispose(); a = await create(aPath);
  assert.equal((await a.generation.start(aInput)).job.status, 'succeeded');
  assert.equal(a.snapshot().definitions.find(item => item.source === 'model')?.title, aDefinition.title);
  assert.equal(await readFile(bPath + '.generation-v1.json', 'utf8'), bReceipt);
  assert.equal(upstream.requests.length, 2, 'both restarted archives retain their own deduplication receipts');
  assert.equal(a.snapshot().totals.tokens, 310); assert.equal(b.snapshot().totals.tokens, 310);
  assert.equal(a.snapshot().totals.turns, 0); assert.equal(b.snapshot().totals.turns, 0);
});
