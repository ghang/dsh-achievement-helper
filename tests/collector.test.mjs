import test from 'node:test';
import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { createCollector } from '../src/collector.mjs';

function bus() {
  const listeners = new Map();
  return {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    emit(name, ...args) { for (const fn of [...(listeners.get(name) ?? [])]) fn(...args); },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}
const usage = (input = 10, output = 5) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 10, cacheWriteTokens: 0, totalTokens: input + output + 10, reasoningTokens: 2 });

test('optional providers use the public get seam when scoped property access requires inject', async () => {
  const events = bus(); let forbiddenReads = 0;
  const providers = { tools: {}, subagents: {}, workingDirectory: { get: () => '/private/optional-workspace' } };
  const ctx = new Proxy({ on: events.on, get: name => providers[name] }, {
    get(target, key) { if (Object.hasOwn(providers, key)) { forbiddenReads++; throw new Error('cannot get property without inject'); } return target[key]; },
  });
  const collector = createCollector({ ctx, ingest: async () => {} });
  await collector.start();
  assert.equal(collector.capabilities().sources.find(s => s.kind === 'skill_loaded').connected, true);
  assert.equal(collector.capabilities().sources.find(s => s.kind === 'delegate_completed').connected, true);
  assert.ok(collector.contextFor({ id: 'optional-session', header: {} }).workspaceKey);
  assert.equal(forbiddenReads, 0); await collector.dispose();
});

async function fixture(options = {}) {
  let now = 1_800_000_000_000;
  const ctx = Object.assign(bus(), {
    tools: {}, subagents: {},
    fs: { resolve: async (path, { cwd }) => ({ path: posix.resolve(cwd, path) }), processPath: target => target.path },
    workingDirectory: { get: session => session.effectiveCwd ?? session.header.cwd },
  });
  const agents = new Map();
  ctx.agents = { get: id => agents.get(id), currentInitiator: () => undefined };
  const facts = [];
  const calls = [];
  const collector = createCollector({ ctx, clock: () => now++, ingest: async (batch, metadata) => { calls.push(metadata); facts.push(...batch); }, ...options });
  await collector.start();
  const sequences = new Map();
  function session(id = 'private-session', cwd = '/private/workspace', inheritedEventCount = 0) {
    const value = { id, header: { cwd, isSeeded: inheritedEventCount > 0 }, inheritedEventCount };
    const agent = { id, session: value, ctx: bus() };
    agents.set(id, agent);
    return { session: value, agent };
  }
  function event(owner, type, data, overrides = {}) {
    const s = owner.session ?? owner;
    const seq = sequences.get(s) ?? 0;
    sequences.set(s, seq + 1);
    const value = { type, data, seq, time: now++, ...overrides };
    ctx.emit('session/event', s, value);
    return value;
  }
  function turn(owner, number = 1) { return event(owner, 'turn/start', { turn: number }); }
  function step(owner, number = 1, round = 1, reported = usage(), extra = {}) {
    event(owner, 'step/start', { turn: round, step: number });
    return event(owner, 'assistant/message', { turn: round, step: number, message: { source: { kind: 'model', provider: 'private-provider', model: 'private-model' }, content: [{ type: 'text', text: 'PRIVATE MODEL CONTENT' }] }, stream: [], ...(reported == null ? {} : { usage: reported }), ...extra });
  }
  function closeStep(owner, number = 1, round = 1) { event(owner, 'step/end', { turn: round, step: number }); }
  function end(owner, kind = 'completed', round = 1) { return event(owner, 'turn/end', { turn: round, reason: { kind } }); }
  function tool(owner, name, value, { meta, isError = false, ptc = false, id = `private-call-${now}`, durable = true, canonical = true } = {}) {
    const { agent } = owner;
    const current = collector.diagnostics();
    assert.ok(current.activeTurns > 0);
    const start = event(owner, ptc ? 'tool/ptc-dispatch-start' : 'tool/call', ptc
      ? { subCallId: id, parentCallId: 'private-outer', rootCallId: 'private-outer', name, arguments: {} }
      : { callId: id, name, arguments: '{}' });
    if (canonical) ctx.emit('tools/result', { agent, name, callId: id, rootCallId: ptc ? 'private-outer' : id, ...(ptc ? { parent: {} } : {}), signal: new AbortController().signal }, { isError, ...(isError ? { error: { message: 'PRIVATE FAILURE' } } : { value }), meta, content: [{ type: 'text', text: 'PRIVATE TOOL BODY' }] });
    if (durable) event(owner, ptc ? 'tool/ptc-dispatch' : 'tool/result', ptc
      ? { subCallId: id, parentCallId: 'private-outer', name, arguments: {}, isError, meta, content: [] }
      : { message: { source: { callId: id }, content: [], ...(isError ? { isError: true } : {}) }, ...(isError ? { error: { code: 'ERR' } } : {}), meta });
    return { id, start };
  }
  function delegation(owner, type, info) {
    ctx.emit(`subagent/${type}`, info); // Root receives the real one-argument signature.
    owner.agent.ctx.emit(`subagent/${type}`, info); // Scoped carrier supplies ownership.
  }
  return { ctx, collector, facts, calls, session, event, turn, step, closeStep, end, tool, delegation, flush: () => collector.flush() };
}
const byKind = (f, kind) => f.facts.filter(fact => fact.kind === kind);
const readValue = (path = '/private/workspace/main.ts') => ({ path, offset: 1, lines: [{ number: 1, text: 'PRIVATE SOURCE' }], totalLines: 1 });

test('Windows drive and UNC paths retain read/change and search/read/change identities', async () => {
  for (const cwd of ['C:\\work space\\工程', '\\\\server\\share\\工程']) {
    const f = await fixture({ languageForPath: () => undefined });
    f.ctx.fs = { resolve: async (path, { cwd }) => ({ path: win32.resolve(cwd, path) }), processPath: target => target.path };
    const owner = f.session('windows-session', cwd), path = win32.join(cwd, 'main.ts');
    try {
      assert.ok(f.collector.contextFor(owner.agent).workspaceKey);
      f.turn(owner); f.step(owner, 1); f.tool(owner, 'grep', { matches: [{ path: 'main.ts' }] }); f.closeStep(owner, 1);
      f.step(owner, 2); f.tool(owner, 'read', readValue(path)); f.closeStep(owner, 2);
      f.step(owner, 3); f.tool(owner, 'edit', { path, before: 'before', after: 'after' }); f.closeStep(owner, 3); f.end(owner);
      await f.flush();
      assert.equal(byKind(f, 'file_read').length, 1); assert.equal(byKind(f, 'file_changed').length, 1);
      assert.equal(byKind(f, 'format_read')[0].key, 'typescript');
      assert.deepEqual(byKind(f, 'recipe').map(item => item.key).sort(), ['read_then_change', 'search_read_change']);
      assert.equal(JSON.stringify(f.facts).includes(cwd), false);
    } finally { await f.collector.dispose(); }
  }
});

test('uses the official exact-turn helper, counts cached input once and keeps the schema opaque', async () => {
  const f = await fixture();
  assert.equal(f.collector.capabilities().sources.find(item => item.kind === 'tokens').connected, true);
  const owner = f.session();
  f.turn(owner); f.step(owner); f.closeStep(owner); f.end(owner);
  await f.flush();
  assert.equal(byKind(f, 'tokens')[0].amount, 25);
  assert.deepEqual(byKind(f, 'tokens')[0].evidence.usage, { uncachedInputTokens: 10, outputTokens: 5, totalTokens: 25, cacheReadTokens: 10, cacheWriteTokens: 0, reasoningTokens: 2 });
  assert.equal(byKind(f, 'turn_completed').length, 1);
  assert.equal(byKind(f, 'route_used').length, 1);
  const stored = JSON.stringify(f.facts);
  for (const secret of ['PRIVATE', '/private/', 'private-session', 'private-provider', 'private-model']) assert.equal(stored.includes(secret), false);
  assert.equal(f.calls.every(item => item.source === 'runtime_observed'), true);
  await f.collector.dispose();
});

test('unknown usage stays unknown; empty completed, failed and interrupted turns are not natural completion', async () => {
  const f = await fixture();
  const missing = f.session('missing');
  f.turn(missing); f.step(missing, 1, 1, null); f.closeStep(missing); f.end(missing);
  const empty = f.session('empty'); f.turn(empty); f.end(empty);
  const cancelled = f.session('cancelled');
  f.turn(cancelled); f.step(cancelled, 1, 1, usage(), { interrupted: true }); f.closeStep(cancelled); f.end(cancelled, 'aborted');
  const failed = f.session('failed');
  f.turn(failed); f.step(failed); f.closeStep(failed); f.end(failed, 'error');
  await f.flush();
  assert.equal(byKind(f, 'turn_completed').length, 1); // Missing billing disclosure does not erase a real normal turn.
  const totals = byKind(f, 'tokens');
  assert.equal(totals.length, 4);
  assert.equal(totals.filter(item => !Object.hasOwn(item, 'amount')).length, 2);
  assert.equal(totals.filter(item => item.amount === 25).length, 2); // Actual cancelled/error consumption remains recorded.
  await f.collector.dispose();
});

test('retry accounting includes a failed attempt and the final attempt, without replaying stream chunks', async () => {
  const f = await fixture(); const owner = f.session();
  f.turn(owner); f.event(owner, 'step/start', { turn: 1, step: 1 });
  f.event(owner, 'assistant/attempt', { turn: 1, step: 1, stream: [
    { type: 'text-chunks', texts: ['PRIVATE STREAM'], dt: [0], time0: 1, index: 0 },
    { type: 'chunk', time: 1, chunk: { type: 'usage', usage: usage(4, 2) } },
    { type: 'chunk', time: 2, chunk: { type: 'usage', usage: usage(6, 3) } },
  ] });
  f.event(owner, 'llm/retry', { turn: 1, step: 1, retryId: 'r', retry: 1 });
  f.event(owner, 'llm/retry-started', { turn: 1, step: 1, retryId: 'r', retry: 1 });
  f.event(owner, 'assistant/message', { turn: 1, step: 1, message: { source: { provider: 'p', model: 'm' }, content: [] }, stream: [], usage: usage() });
  f.closeStep(owner); f.end(owner); await f.flush();
  assert.equal(byKind(f, 'tokens')[0].amount, 19 + 25);
  assert.equal(byKind(f, 'turn_completed').length, 1);
  await f.collector.dispose();
});

test('only newly observed own turn boundaries are eligible; no seed or in-flight catchup', async () => {
  const f = await fixture(); const partial = f.session('partial');
  f.event(partial, 'step/start', { turn: 9, step: 1 }); f.end(partial, 'completed', 9);
  const fork = f.session('fork', '/private/workspace', 10);
  f.event(fork, 'turn/start', { turn: 1 }, { seq: 1 }); f.event(fork, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, { seq: 2 });
  f.event(fork, 'turn/start', { turn: 2 }, { seq: 11 });
  f.event(fork, 'step/start', { turn: 2, step: 1 }, { seq: 12 });
  const message = f.event(fork, 'assistant/message', { turn: 2, step: 1, message: { source: { provider: 'p', model: 'm' } }, usage: usage(), stream: [] }, { seq: 13 });
  f.ctx.emit('session/event', fork.session, message);
  f.event(fork, 'step/end', { turn: 2, step: 1 }, { seq: 14 });
  f.event(fork, 'turn/end', { turn: 2, reason: { kind: 'completed' } }, { seq: 15 });
  await f.flush();
  assert.equal(byKind(f, 'turn_completed').length, 1);
  assert.equal(byKind(f, 'tokens').length, 1);
  assert.equal(f.collector.diagnostics().ignoredInherited, 2);
  assert.ok(f.collector.diagnostics().duplicates >= 1);
  assert.equal(f.collector.capabilities().coverage.history, false);
  await f.collector.dispose();
});

test('canonical file outcomes: nonempty read, known changes, unknown update baseline and formal meta', async () => {
  const f = await fixture(); const owner = f.session();
  f.turn(owner); f.step(owner);
  f.tool(owner, 'read', readValue());
  f.tool(owner, 'read', { ...readValue(), lines: [] });
  f.tool(owner, 'read', readValue(), { isError: true });
  f.tool(owner, 'write', { path: '/private/workspace/unknown.ts', operation: 'update', before: null, after: 'NEW' }, { meta: { path: '/private/workspace/unknown.ts', diffs: [{ path: '/private/workspace/unknown.ts', oldText: 'x', newText: 'y' }] } });
  f.tool(owner, 'edit', { path: '/private/workspace/same.ts', before: 'same', after: 'same' });
  f.tool(owner, 'write', { path: '/private/workspace/empty.ts', operation: 'create', before: null, after: '' });
  f.tool(owner, 'write', { path: '/private/workspace/new.ts', operation: 'create', before: null, after: 'real' });
  f.tool(owner, 'edit', undefined, { canonical: false, meta: { path: '/private/workspace/meta.ts', diffs: [{ path: '/private/workspace/meta.ts', oldText: 'old', newText: 'new' }] } });
  f.closeStep(owner); f.end(owner); await f.flush();
  assert.equal(byKind(f, 'file_read').length, 1);
  assert.equal(byKind(f, 'format_read')[0].key, 'typescript');
  assert.equal(byKind(f, 'file_changed').length, 2);
  assert.equal(byKind(f, 'recipe').length, 0); // Same-step result order is not dependency proof.
  assert.equal(JSON.stringify(f.facts).includes('SOURCE'), false);
  await f.collector.dispose();
});

test('normal/PTC final results deduplicate against durable fallback and wrapper calls', async () => {
  const f = await fixture(); const owner = f.session();
  f.turn(owner); f.step(owner);
  f.tool(owner, 'read', readValue(), { ptc: true, id: 'outer:ptc:1', meta: readValue() });
  f.tool(owner, 'run_code', { path: '/private/workspace/main.ts', lines: readValue().lines });
  f.closeStep(owner); f.end(owner); await f.flush();
  assert.equal(byKind(f, 'file_read').length, 1);
  assert.equal(byKind(f, 'format_read').length, 1);
  assert.ok(f.collector.diagnostics().duplicates >= 1);
  await f.collector.dispose();
});

test('fixed recipes require the same fresh turn, same path where applicable, and later steps', async () => {
  const f = await fixture(); const owner = f.session();
  f.turn(owner); f.step(owner, 1);
  f.tool(owner, 'grep', { matches: [{ path: 'main.ts', lineNumber: 1, line: 'PRIVATE SEARCH' }] });
  f.tool(owner, 'skill', { name: 'private-skill', provider: 'private-skill-provider', content: 'PRIVATE SKILL BODY' });
  f.event(owner, 'user/message', { source: { kind: 'session-reference', form: 'recall', version: 1, references: [{ sessionId: 'old-private-session', capturedThroughSeq: 123, retainedMessages: 2 }] }, content: [{ type: 'text', text: 'PRIVATE RECALL' }] });
  f.closeStep(owner, 1); f.step(owner, 2); f.tool(owner, 'read', readValue()); f.closeStep(owner, 2);
  f.step(owner, 3); f.tool(owner, 'edit', { path: '/private/workspace/main.ts', before: 'PRIVATE BEFORE', after: 'PRIVATE AFTER' }); f.closeStep(owner, 3); f.end(owner);
  await f.flush();
  assert.deepEqual(byKind(f, 'recipe').map(item => item.key).sort(), ['read_then_change', 'recall_then_change', 'search_read_change', 'skill_then_change']);
  assert.equal(byKind(f, 'skill_loaded').length, 1);
  assert.equal(byKind(f, 'recall_used').length, 1);
  assert.equal(JSON.stringify(f.facts).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(f.facts).includes('private-'), false);
  await f.collector.dispose();
});

test('same-step ordering, different paths and failed turns do not award recipes', async () => {
  const f = await fixture(); const owner = f.session();
  f.turn(owner); f.step(owner);
  f.tool(owner, 'read', readValue());
  f.tool(owner, 'edit', { path: readValue().path, before: 'a', after: 'b' });
  f.closeStep(owner); f.step(owner, 2);
  f.tool(owner, 'edit', { path: '/private/workspace/other.ts', before: 'a', after: 'b' });
  f.closeStep(owner, 2); f.end(owner); await f.flush();
  assert.equal(byKind(f, 'recipe').length, 0);
  const failed = f.session('later-failed'); f.turn(failed); f.step(failed); f.tool(failed, 'read', readValue());
  f.closeStep(failed); f.step(failed, 2); f.tool(failed, 'edit', { path: readValue().path, before: 'a', after: 'b' }); f.closeStep(failed, 2); f.end(failed, 'error');
  await f.flush(); assert.equal(byKind(f, 'recipe').length, 0);
  await f.collector.dispose();
});

test('explicit skill injection counts as loading, catalogs do not, and no text guessing occurs', async () => {
  const f = await fixture(); const owner = f.session(); f.turn(owner); f.step(owner);
  f.event(owner, 'user/message', { source: { kind: 'skill-catalog', entries: [{ name: 'x' }] }, content: [] });
  f.event(owner, 'user/message', { source: { kind: 'skill-invocation', form: 'instructions', name: 'private-skill' }, content: [] });
  f.tool(owner, 'skill', { name: 'private-skill', provider: 'p', content: 'loaded' });
  f.tool(owner, 'bash', { kind: 'foreground', exitCode: 0, stdout: 'cat SKILL.md succeeded' });
  f.closeStep(owner); f.end(owner); await f.flush();
  assert.equal(byKind(f, 'skill_loaded').length, 1);
  await f.collector.dispose();
});

test('delegate attribution uses the parent scoped carrier and distinct child identities before durable presentation', async () => {
  const f = await fixture(); const parent = f.session('private-parent'); const other = f.session('unrelated-parent');
  f.turn(parent); f.step(parent); f.turn(other); f.step(other);
  const first = { runId: 'run-1', id: 'child-1', local: true, provider: 'local' };
  const second = { runId: 'run-2', id: 'child-2', local: true, provider: 'local' };
  f.delegation(parent, 'start', first); f.delegation(parent, 'start', second);
  f.delegation(parent, 'end', { ...first, stopReason: { kind: 'completed' }, lastAssistantMessage: [{ type: 'text', text: 'PRIVATE CHILD OUTPUT' }] });
  f.delegation(parent, 'end', { ...second, stopReason: { kind: 'completed' } });
  f.closeStep(parent); f.step(parent, 2);
  f.tool(parent, 'present', { turn: 1, files: [{ path: '/private/workspace/result.md' }] });
  assert.equal(byKind(f, 'file_presented').length, 0);
  f.event(parent, 'deliverables/presented', { turn: 1, callId: 'present-1', files: [{ path: '/private/workspace/result.md' }] });
  f.closeStep(parent, 2); f.end(parent); f.closeStep(other); f.end(other);
  await f.flush();
  assert.equal(byKind(f, 'delegate_completed').length, 2);
  assert.equal(new Set(byKind(f, 'delegate_completed').map(item => item.sessionId)).size, 1);
  assert.equal(byKind(f, 'delegate_completed')[0].sessionId, f.collector.contextFor(parent.agent).sessionId);
  assert.equal(byKind(f, 'file_presented').length, 1);
  assert.deepEqual(byKind(f, 'recipe').map(item => item.key), ['delegate_then_present']);
  assert.equal(f.collector.diagnostics().activeRuns, 0);
  assert.equal(parent.agent.ctx.listenerCount(), 0);
  await f.collector.dispose();
});

test('two activations of one child, unmatched end, fork metadata and late end are not two-child collaboration', async () => {
  const f = await fixture(); const parent = f.session();
  parent.session.header.parentSession = 'a-fork-parent';
  f.turn(parent); f.step(parent);
  for (const runId of ['r1', 'r2']) {
    const info = { runId, id: 'same-child', local: true, provider: 'local' };
    f.delegation(parent, 'start', info); f.delegation(parent, 'end', { ...info, stopReason: { kind: 'completed' } });
  }
  f.ctx.emit('subagent/end', { runId: 'unobserved', id: 'other', stopReason: { kind: 'completed' } });
  f.delegation(parent, 'start', { runId: 'late', id: 'late-child' });
  f.closeStep(parent); f.step(parent, 2); f.event(parent, 'deliverables/presented', { turn: 1, callId: 'p', files: [{ path: '/private/workspace/output.md' }] }); f.closeStep(parent, 2); f.end(parent);
  f.ctx.emit('subagent/end', { runId: 'late', id: 'late-child', stopReason: { kind: 'completed' } });
  await f.flush();
  assert.equal(byKind(f, 'delegate_completed').length, 2);
  assert.equal(byKind(f, 'recipe').length, 0);
  assert.equal(f.collector.diagnostics().activeRuns, 0);
  await f.collector.dispose();
});

test('contextFor shares the collector hash protocol and project identity survives cd', async () => {
  const f = await fixture(); const owner = f.session();
  const before = f.collector.contextFor(owner.agent);
  owner.session.effectiveCwd = '/private/other-directory';
  assert.deepEqual(f.collector.contextFor(owner.agent), before);
  assert.equal(Object.values(before).every(value => /^[a-z]+:[a-f0-9]{64}$/.test(value)), true);
  assert.deepEqual(f.collector.contextFor(undefined), {});
  await f.collector.dispose();
});

test('observer/ingest failures are contained and dispose waits for queued delivery', async () => {
  let resolveFirst;
  const gate = new Promise(resolve => { resolveFirst = resolve; });
  let entered = false, writes = 0;
  const f = await fixture({ ingest: async () => { writes++; if (writes === 1) { entered = true; await gate; throw new Error('PRIVATE DISK PATH'); } } });
  const owner = f.session(); f.turn(owner); f.step(owner); f.closeStep(owner); f.end(owner);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(entered, true);
  let complete = false;
  const disposed = f.collector.dispose().then(() => { complete = true; });
  await Promise.resolve(); assert.equal(complete, false);
  resolveFirst(); await disposed;
  assert.ok(writes >= 2);
  assert.equal(f.collector.diagnostics().ingestErrors, 1);
  assert.equal(f.collector.diagnostics().activeTurns, 0);
  assert.equal(f.ctx.listenerCount(), 0);
  assert.equal(JSON.stringify(f.collector.diagnostics()).includes('PRIVATE'), false);
  assert.doesNotThrow(() => f.ctx.emit('session/event', owner.session, { seq: 99, type: 'turn/start', data: { turn: 2 } }));
});

test('limits bound active turns and token buffers, and missing capabilities are explicit', async () => {
  const f = await fixture({ limits: { turns: 1, events: 2 }, deriveTurnUsage: null });
  const first = f.session('first'); const second = f.session('second');
  f.turn(first); f.step(first); f.turn(second); f.closeStep(first); f.end(first); await f.flush();
  assert.equal(byKind(f, 'tokens').length, 1);
  assert.equal(Object.hasOwn(byKind(f, 'tokens')[0], 'amount'), false);
  assert.ok(f.collector.diagnostics().boundedDrops > 0);
  assert.equal(f.collector.capabilities().sources.find(item => item.kind === 'tokens').missing, 'token_meter_helper_unavailable');
  assert.equal(f.collector.capabilities().coverage.sequenceOrdering, 'cross_step_only');
  await f.collector.dispose();
  assert.equal(f.collector.diagnostics().bufferedTokenEvents, 0);
});
