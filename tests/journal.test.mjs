import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJournal, JOURNAL_LIMITS } from '../src/journal.mjs';

const digest = value => createHash('sha256').update(String(value)).digest('hex');
const fact = (id, kind, changes = {}) => ({ id, kind, at: 1000, sessionId: 'session-a', turnKey: 'turn-a', ...(kind === 'tokens' ? { amount: 100 } : kind === 'turn_completed' ? {} : { key: `opaque-${id}` }), ...changes });
const card = (snapshot, id) => snapshot.definitions.find(d => d.id === id);
const definition = (id, rule, changes = {}) => ({ id, title: `个人目标 ${id}`, description: '记录一段个人经历', rule, ...changes });
const errorCode = code => error => error.code === code;
const canonicalCopy = items => items.map(({ defaultTitle, customName, ...item }) => item);

async function fixture(t, initialNow = 1000) {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-journal-test-'));
  const file = join(directory, 'journal.json'); let clock = initialNow, current = await createJournal({ file, now: () => clock });
  t.after(async () => { await current.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, file, get j() { return current; }, setNow(value) { clock = value; }, async reopen() { await current.close(); current = await createJournal({ file, now: () => clock }); return current; } };
}

test('a fresh journal has sixteen proposals, stable creation time, and detached snapshots', async t => {
  const f = await fixture(t);
  const first = f.j.snapshot();
  assert.equal(first.definitions.length, 16);
  assert.deepEqual(first.preferences, { theme: 'explorer', portraitStyle: 'flat', notifications: 'all', reducedMotion: 'system', frameStyle: 'standard', frameHeight: 64 });
  assert.equal(first.level.progress, 0);
  first.preferences.theme = 'cyber'; first.definitions.length = 0;
  assert.equal(f.j.snapshot().preferences.theme, 'explorer');
  assert.equal(f.j.snapshot().definitions.length, 16);
  f.setNow(9000); await f.reopen();
  assert.equal(f.j.snapshot().createdAt, 1000);
  assert.equal(f.j.snapshot().revision, 0);
  assert.equal(f.j.catalog().defaultDefinitionCount, 16);
  assert.ok(f.j.catalog().recipes.includes('search_read_change'));
});

test('portrait style persists as appearance without changing earned records, the pool, points or equipment', async t => {
  const f = await fixture(t);
  await f.j.ingest([fact('portrait-owned', 'file_read')]);
  await f.j.draw({ requestId: 'portrait-owned-draw' });
  await f.j.equip({ slot: 'character', id: f.j.snapshot().collection.owned[0].id });
  const before = f.j.snapshot(), catalog = f.j.catalog();
  for (const portraitStyle of ['pixel', 'flat', 'pixel']) {
    const after = await f.j.preferences({ portraitStyle });
    assert.equal(after.preferences.portraitStyle, portraitStyle);
    assert.equal(after.preferences.theme, before.preferences.theme);
    for (const key of ['definitions', 'awards', 'timeline', 'collection', 'equipment', 'totals', 'level']) assert.deepEqual(after[key], before[key], `${key} must not change with portrait style`);
    assert.deepEqual(after.notifications, []); assert.deepEqual(f.j.catalog(), catalog);
  }
  const saved = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(saved.schemaVersion, 2); assert.equal(saved.preferences.portraitStyle, 'pixel');
  await f.reopen(); assert.equal(f.j.snapshot().preferences.portraitStyle, 'pixel');
  const bytes = await readFile(f.file, 'utf8');
  for (const portraitStyle of ['animated', null, 1, {}]) await assert.rejects(f.j.preferences({ portraitStyle }), errorCode('INVALID_INPUT'));
  assert.equal(await readFile(f.file, 'utf8'), bytes);
});

test('an existing schema two archive without portrait style projects flat without an upgrade write', async t => {
  const f = await fixture(t);
  await f.j.ingest([fact('old-style-read', 'file_read')]); await f.j.close();
  const old = JSON.parse(await readFile(f.file, 'utf8')); delete old.preferences.portraitStyle;
  const oldBytes = JSON.stringify(old, null, 2) + '\n'; await writeFile(f.file, oldBytes);
  await f.reopen(); const before = f.j.snapshot();
  assert.equal(before.preferences.portraitStyle, 'flat'); assert.equal(before.revision, old.revision);
  assert.deepEqual(canonicalCopy(before.awards), old.awards); assert.deepEqual(before.collection.points, old.collection.points);
  before.preferences.portraitStyle = 'pixel'; assert.equal(f.j.snapshot().preferences.portraitStyle, 'flat');
  await f.j.ingest([]); f.j.catalog(); await f.reopen();
  assert.equal(await readFile(f.file, 'utf8'), oldBytes);
  await f.j.ingest([fact('old-style-next-read', 'file_read')]);
  assert.equal(Object.hasOwn(JSON.parse(await readFile(f.file, 'utf8')).preferences, 'portraitStyle'), false);
  const revision = f.j.snapshot().revision;
  const saved = await f.j.preferences({ notifications: 'all' });
  assert.equal(saved.revision, revision + 1); assert.equal(saved.preferences.portraitStyle, 'flat');
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).preferences.portraitStyle, 'flat');
  assert.deepEqual(canonicalCopy(saved.awards), old.awards); assert.deepEqual(saved.collection.points, old.collection.points);
});

test('an explicitly invalid stored portrait style refuses startup without changing saved bytes', async t => {
  const f = await fixture(t); await f.j.close();
  const good = JSON.parse(await readFile(f.file, 'utf8'));
  for (const portraitStyle of ['animated', null, 1, {}]) {
    const data = structuredClone(good); data.preferences.portraitStyle = portraitStyle;
    const bytes = JSON.stringify(data); await writeFile(f.file, bytes);
    await assert.rejects(createJournal({ file: f.file }), errorCode('CORRUPT_STATE'));
    assert.equal(await readFile(f.file, 'utf8'), bytes);
    assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.lock')));
  }
});

test('concurrent ingests serialize without lost counts, and replay is idempotent across restart', async t => {
  const f = await fixture(t);
  const rows = Array.from({ length: 40 }, (_, i) => fact(`f-${i}`, 'tokens', { amount: 25000, at: 1000 + i }));
  await Promise.all(rows.map(row => f.j.ingest([row])));
  const saved = f.j.snapshot();
  assert.equal(saved.totals.tokens, 1000000);
  assert.equal(saved.storage.usage.facts, 40);
  assert.equal(saved.awards.filter(a => a.definitionId === 'million').length, 1);
  assert.equal(saved.timeline.filter(a => a.definitionId === 'million').length, 1);
  const replay = await f.j.ingest(rows);
  assert.equal(replay.revision, saved.revision);
  assert.deepEqual(replay.notifications, []);
  await f.reopen();
  assert.equal(f.j.snapshot().totals.tokens, 1000000);
  assert.deepEqual((await f.j.ingest(rows)).notifications, []);
});

test('a reused settled identity cannot silently change amount, metric, or scope', async t => {
  const f = await fixture(t), original = fact('stable', 'tokens', { amount: 500 });
  await f.j.ingest([original]); const before = f.j.snapshot();
  await assert.rejects(f.j.ingest([{ ...original, amount: 501 }]), errorCode('FACT_ID_REUSED'));
  await assert.rejects(f.j.ingest([{ ...original, kind: 'turn_completed', amount: undefined }]), errorCode('FACT_ID_REUSED'));
  assert.equal(f.j.snapshot().revision, before.revision);
  assert.equal(f.j.snapshot().totals.tokens, 500);
});

test('unknown token usage stays unknown and can settle once under the same identity', async t => {
  const f = await fixture(t), pending = fact('pending-usage', 'tokens', { amount: undefined });
  const unknown = await f.j.ingest([pending]);
  assert.equal(unknown.totals.tokens, null);
  assert.equal(unknown.totals.knownTokens, 0);
  assert.equal(unknown.level.progress, null);
  assert.equal(card(unknown, 'million').progress, null);
  assert.equal(unknown.coverage.pendingFacts, 1);
  assert.equal(unknown.storage.usage.facts, 0);
  assert.equal((await f.j.ingest([pending])).revision, unknown.revision);
  await f.reopen();
  const resolved = await f.j.ingest([{ ...pending, amount: 1250 }]);
  assert.equal(resolved.totals.tokens, 1250);
  assert.equal(resolved.coverage.pendingFacts, 0);
  assert.equal(resolved.storage.usage.facts, 1);
  assert.equal(card(resolved, 'million').progress, 1250);
  assert.equal((await f.j.ingest([pending])).totals.tokens, 1250);
});

test('unknown replacement cannot move a fact into a later scope or baseline', async t => {
  const f = await fixture(t), pending = fact('pending-scope', 'tokens', { amount: undefined, workspaceKey: 'workspace-a' });
  await f.j.ingest([pending]);
  await assert.rejects(f.j.ingest([{ ...pending, amount: 40, at: 2000 }]), errorCode('FACT_ID_REUSED'));
  await assert.rejects(f.j.ingest([{ ...pending, amount: 40, workspaceKey: 'workspace-b' }]), errorCode('FACT_ID_REUSED'));
  assert.equal(f.j.snapshot().coverage.pendingFacts, 1);
});

test('usage buckets are retained without counting reasoning twice or filling missing fields', async t => {
  const f = await fixture(t);
  const evidence = { source: 'session/event', eventSeq: 8, usage: { uncachedInputTokens: 10, outputTokens: 15, totalTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 5, reasoningTokens: 10 } };
  const result = await f.j.ingest([fact('buckets', 'tokens', { amount: 50, evidence })]);
  assert.equal(result.totals.tokens, 50);
  assert.deepEqual(result.totals.usage, evidence.usage);
  const partial = await f.j.ingest([fact('partial-buckets', 'tokens', { amount: 100, evidence: { source: 'session/event', usage: { uncachedInputTokens: 20, outputTokens: 30, totalTokens: 100 } } })]);
  assert.equal(partial.totals.tokens, 150);
  assert.equal(partial.totals.usage.cacheReadTokens, null);
  assert.equal(partial.totals.usage.outputTokens, 45);
  await assert.rejects(f.j.ingest([fact('bad-buckets', 'tokens', { amount: 49, evidence })]), errorCode('INVALID_USAGE'));
});

test('custom goals start after configuration, bind trusted workspace, and ignore late old facts', async t => {
  const f = await fixture(t);
  await f.j.ingest([fact('history', 'tokens', { at: 500, amount: 1000, workspaceKey: 'workspace-a' })], { notify: false });
  f.setNow(2000);
  await f.j.configure({ requestId: 'create-workspace-goal', definitions: [definition('fresh-goal', { template: 'count', metric: 'tokens', target: 100 }, { scope: 'current_workspace' })] }, { workspaceKey: 'workspace-a' });
  await f.j.ingest([fact('late-history', 'tokens', { at: 1500, amount: 1000, workspaceKey: 'workspace-a' }), fact('other-workspace', 'tokens', { at: 2100, amount: 1000, workspaceKey: 'workspace-b' })]);
  assert.equal(card(f.j.snapshot(), 'fresh-goal').progress, 0);
  await f.j.ingest([fact('fresh-one', 'tokens', { at: 2100, amount: 40, workspaceKey: 'workspace-a' })]);
  assert.equal(card(f.j.snapshot(), 'fresh-goal').progress, 40);
  const done = await f.j.ingest([fact('fresh-two', 'tokens', { at: 2200, amount: 60, workspaceKey: 'workspace-a' })]);
  assert.equal(card(done, 'fresh-goal').progress, 100);
  assert.ok(card(done, 'fresh-goal').unlockedAt !== undefined);
  await assert.rejects(f.j.configure({ requestId: 'missing-scope', definitions: [definition('unbound', { template: 'count', metric: 'tokens', target: 10 }, { scope: 'current_workspace' })] }), errorCode('WORKSPACE_REQUIRED'));
});

test('request idempotency precedes revision checks and conflicts do not poison subsequent requests', async t => {
  const f = await fixture(t);
  const input = { requestId: 'same-request', expectedRevision: 0, definitions: [definition('same-goal', { template: 'count', metric: 'tokens', target: 200 })] };
  const created = await f.j.configure(input);
  assert.equal((await f.j.configure(input)).revision, created.revision);
  await assert.rejects(f.j.configure({ ...input, theme: 'cyber' }), errorCode('REQUEST_ID_REUSED'));
  const results = await Promise.allSettled([
    f.j.configure({ requestId: 'cas-a', expectedRevision: created.revision, definitions: [definition('cas-a', { template: 'first_seen', metric: 'file_read' })] }),
    f.j.configure({ requestId: 'cas-b', expectedRevision: created.revision, definitions: [definition('cas-b', { template: 'first_seen', metric: 'file_read' })] }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  await f.reopen();
  const replay = await f.j.configure(input);
  assert.equal(replay.definitions.filter(d => d.id === 'same-goal').length, 1);
  assert.deepEqual(replay.notifications, []);
});

test('queued configuration snapshots its input before another caller can mutate it', async t => {
  const f = await fixture(t);
  const input = { requestId: 'immutable-input', definitions: [definition('immutable', { template: 'count', metric: 'tokens', target: 100 })] };
  const pending = f.j.configure(input); input.definitions[0].title = 'changed after call'; input.definitions[0].rule.target = 1;
  await pending;
  assert.equal(card(f.j.snapshot(), 'immutable').title, '个人目标 immutable');
  assert.equal(card(f.j.snapshot(), 'immutable').target, 100);
});

test('distinct means distinct opaque keys, while recipes require explicit verified recipe facts', async t => {
  const f = await fixture(t);
  await f.j.ingest([fact('format-a', 'format_read', { key: 'typescript' }), fact('format-b', 'format_read', { key: 'typescript' }), fact('format-c', 'format_read', { key: 'markdown' })]);
  assert.equal(card(f.j.snapshot(), 'formats').progress, 2);
  assert.equal(f.j.snapshot().totals.formats, 2);
  await f.j.ingest([fact('read', 'file_read'), fact('change', 'file_changed')]);
  assert.equal(card(f.j.snapshot(), 'read-then-change').progress, 0);
  const done = await f.j.ingest([fact('proof', 'recipe', { key: 'read_then_change', evidence: { source: 'tools/result', evidenceKeys: ['proof-a', 'proof-b'] } })]);
  assert.ok(card(done, 'read-then-change').unlockedAt !== undefined);
  assert.equal(card(done, 'skill-then-change').progress, 0);
  await assert.rejects(f.j.ingest([fact('invalid-recipe', 'recipe', { key: 'guessed_order' })]), errorCode('INVALID_INPUT'));
});

test('reports cannot grant automatic achievements, and repeated reports keep honest source', async t => {
  const f = await fixture(t);
  await f.j.configure({ requestId: 'model-milestone', definitions: [definition('milestone', { template: 'model_report' })] });
  const result = await f.j.report({ requestId: 'model-finished', definitionId: 'milestone', note: 'This note must never be persisted.' }, { source: 'model', sessionId: 'source-session' });
  assert.equal(result.totals.tokens, 0);
  assert.equal(result.awards.find(a => a.definitionId === 'milestone').source, 'model_report');
  assert.equal(result.awards.find(a => a.definitionId === 'milestone').reportedBy, 'model');
  const twice = await f.j.report({ requestId: 'model-finished-again', definitionId: 'milestone' });
  assert.equal(twice.awards.filter(a => a.definitionId === 'milestone').length, 1);
  assert.deepEqual(twice.notifications, []);
  await assert.rejects(f.j.report({ requestId: 'cheat-real-tokens', definitionId: 'million' }), errorCode('REPORT_NOT_ALLOWED'));
  assert.ok(!(await readFile(f.file, 'utf8')).includes('This note must never be persisted.'));
});

test('user records and scoped model reports cannot be confused with host observations', async t => {
  const f = await fixture(t);
  await f.j.configure({ requestId: 'user-milestone', definitions: [definition('user-milestone', { template: 'model_report' }, { scope: 'current_workspace' })] }, { workspaceKey: 'workspace-a' });
  await assert.rejects(f.j.report({ requestId: 'wrong-owner', definitionId: 'user-milestone' }, { source: 'user', workspaceKey: 'workspace-b' }), errorCode('WORKSPACE_MISMATCH'));
  const result = await f.j.report({ requestId: 'user-confirmed', definitionId: 'user-milestone' }, { source: 'user', workspaceKey: 'workspace-a' });
  assert.equal(result.awards.at(-1).source, 'user_record');
  assert.equal(result.totals.turns, 0);
});

test('earned conditions stay immutable, cosmetic updates preserve the historical award', async t => {
  const f = await fixture(t);
  await f.j.configure({ requestId: 'small-goal', definitions: [definition('small', { template: 'count', metric: 'tokens', target: 50 })] });
  await f.j.ingest([fact('earn-small', 'tokens')]);
  const original = f.j.snapshot().awards.find(a => a.definitionId === 'small');
  await assert.rejects(f.j.configure({ requestId: 'move-goalposts', definitions: [definition('small', { template: 'count', metric: 'tokens', target: 200 })] }), errorCode('AWARDED_RULE_IMMUTABLE'));
  await f.j.configure({ requestId: 'cosmetic-edit', definitions: [{ id: 'small', title: '现在的名字', description: '现在的说明' }] });
  assert.equal(card(f.j.snapshot(), 'small').title, '现在的名字');
  assert.deepEqual(f.j.snapshot().awards.find(a => a.definitionId === 'small'), original);
  await f.reopen();
  assert.deepEqual(f.j.snapshot().awards.find(a => a.definitionId === 'small'), original);
});

test('editing an unfinished threshold preserves its baseline and never replays historical usage', async t => {
  const f = await fixture(t);
  await f.j.ingest([fact('prior', 'tokens', { amount: 900 })]);
  f.setNow(2000);
  await f.j.configure({ requestId: 'new-baseline', definitions: [definition('threshold', { template: 'count', metric: 'tokens', target: 1000 })] });
  await f.j.ingest([fact('newly-earned', 'tokens', { at: 2001, amount: 30 })]);
  await f.j.configure({ requestId: 'lower-threshold', definitions: [{ id: 'threshold', rule: { template: 'count', metric: 'tokens', target: 20 } }] });
  assert.equal(card(f.j.snapshot(), 'threshold').knownProgress, 30);
  assert.equal(card(f.j.snapshot(), 'threshold').baselineAt, 2000);
  assert.equal(f.j.snapshot().awards.find(a => a.definitionId === 'threshold').rule.target, 20);
  await assert.rejects(f.j.configure({ requestId: 'new-metric', definitions: [{ id: 'first-change', rule: { template: 'first_seen', metric: 'file_read' } }] }), errorCode('NEW_DEFINITION_REQUIRED'));
});

test('themes change presentation without re-granting, resetting conditions, or losing equipment', async t => {
  const f = await fixture(t);
  const themes = { explorer: { title: '自己的印记' }, xianxia: { title: '自成一卷', description: '此次历练已经入卷' }, cyber: { title: '私人协议' } };
  await f.j.configure({ requestId: 'themed', definitions: [definition('themed', { template: 'model_report' }, { themes })] });
  await f.j.report({ requestId: 'themed-report', definitionId: 'themed' });
  await f.j.equip({ id: 'themed', slot: 'badge' }); await f.j.equip({ id: 'star', slot: 'charm' });
  const before = f.j.snapshot();
  for (const theme of ['xianxia', 'cyber', 'explorer']) {
    const result = await f.j.preferences({ theme });
    assert.deepEqual(canonicalCopy(result.awards), canonicalCopy(before.awards));
    assert.deepEqual(result.equipment, before.equipment);
    assert.deepEqual(canonicalCopy(result.definitions), canonicalCopy(before.definitions));
    assert.equal(result.awards.find(item => item.definitionId === 'themed').defaultTitle, themes[theme].title);
    assert.deepEqual(result.notifications, []);
  }
  await f.reopen();
  assert.equal(card(f.j.snapshot(), 'themed').themes.xianxia.title, '自成一卷');
  assert.deepEqual(f.j.snapshot().equipment, { badges: ['themed'], charm: 'star', character: null });
});

test('archiving freezes a custom goal and preserves history while taking its badge off', async t => {
  const f = await fixture(t);
  await f.j.configure({ requestId: 'archive-cases', definitions: [definition('unfinished', { template: 'count', metric: 'tokens', target: 1000 }), definition('earned', { template: 'count', metric: 'tokens', target: 50 })] });
  await f.j.ingest([fact('archive-progress', 'tokens')]); await f.j.equip({ id: 'earned', slot: 'badge' });
  await f.j.configure({ requestId: 'archive-both', archiveIds: ['unfinished', 'earned'] });
  await f.j.ingest([fact('after-archive', 'tokens', { amount: 2000 })]);
  assert.equal(card(f.j.snapshot(), 'unfinished').progress, 100);
  assert.equal(card(f.j.snapshot(), 'unfinished').status, 'archived');
  assert.equal(f.j.snapshot().awards.filter(a => a.definitionId === 'earned').length, 1);
  assert.deepEqual(f.j.snapshot().equipment.badges, []);
});

test('archiving incomplete progress does not later pretend the unknown interval was zero', async t => {
  const f = await fixture(t);
  await f.j.configure({ requestId: 'unknown-archive', definitions: [definition('unknown-archive', { template: 'count', metric: 'tokens', target: 500 })] });
  const pending = fact('unknown-before-archive', 'tokens', { amount: undefined });
  await f.j.ingest([pending]);
  await f.j.configure({ requestId: 'freeze-unknown', archiveIds: ['unknown-archive'] });
  await f.j.ingest([{ ...pending, amount: 300 }]);
  assert.equal(card(f.j.snapshot(), 'unknown-archive').progress, null);
  assert.equal(card(f.j.snapshot(), 'unknown-archive').knownProgress, 0);
  await f.reopen(); assert.equal(card(f.j.snapshot(), 'unknown-archive').progress, null);
});

test('an archived unfinished goal cannot be edited into a new award', async t => {
  const f = await fixture(t);
  await f.j.configure({ requestId: 'archived-edit-setup', definitions: [definition('frozen-goal', { template: 'count', metric: 'tokens', target: 1000 })] });
  await f.j.ingest([fact('before-freeze', 'tokens', { amount: 10 }), fact('existing-collection', 'file_read')]);
  await f.j.equip({ id: 'first-read', slot: 'badge' });
  await f.j.configure({ requestId: 'freeze-goal', archiveIds: ['frozen-goal'] });
  const before = f.j.snapshot();
  await assert.rejects(f.j.configure({ requestId: 'lower-frozen-target', definitions: [{ id: 'frozen-goal', rule: { template: 'count', metric: 'tokens', target: 1 } }] }), errorCode('ARCHIVED'));
  await assert.rejects(f.j.configure({ requestId: 'rename-frozen-goal', definitions: [{ id: 'frozen-goal', title: 'A changed archived goal' }] }), errorCode('ARCHIVED'));
  const after = f.j.snapshot();
  assert.equal(after.revision, before.revision);
  assert.equal(card(after, 'frozen-goal').status, 'archived');
  assert.equal(card(after, 'frozen-goal').target, 1000);
  assert.equal(card(after, 'frozen-goal').knownProgress, 10);
  assert.equal(card(after, 'frozen-goal').unlockedAt, undefined);
  assert.deepEqual(after.awards, before.awards);
  assert.deepEqual(after.timeline, before.timeline);
  assert.deepEqual(after.equipment, before.equipment);
  assert.deepEqual(after.notifications, []);
  await f.reopen();
  assert.deepEqual(f.j.snapshot().awards, before.awards);
  assert.equal(card(f.j.snapshot(), 'frozen-goal').unlockedAt, undefined);
});

test('notifications are deltas; preferences and silent imports never suppress permanent awards', async t => {
  const f = await fixture(t);
  const silent = await f.j.ingest([fact('silent-turn', 'turn_completed')], { notify: false });
  assert.ok(silent.awards.some(a => a.definitionId === 'first'));
  assert.deepEqual(silent.notifications, []);
  await f.j.preferences({ notifications: 'unlocks', reducedMotion: 'reduce' });
  const unlocked = await f.j.ingest([fact('million-quiet-progress', 'tokens', { amount: 1000000 })]);
  assert.ok(unlocked.notifications.some(n => n.kind === 'unlock'));
  assert.ok(unlocked.notifications.some(n => n.kind === 'level'));
  assert.ok(!unlocked.notifications.some(n => n.kind === 'progress'));
  assert.deepEqual(f.j.snapshot().notifications, []);
  await f.j.preferences({ notifications: 'off' });
  const off = await f.j.ingest([fact('first-present', 'file_presented')]);
  assert.ok(off.awards.some(a => a.definitionId === 'present'));
  assert.deepEqual(off.notifications, []);
  await f.reopen(); assert.deepEqual(f.j.snapshot().notifications, []);
});

test('badge ownership and slots are enforced, and removal never deletes an award', async t => {
  const f = await fixture(t);
  await assert.rejects(f.j.equip({ id: 'million', slot: 'badge' }), errorCode('NOT_OWNED'));
  await f.j.ingest([fact('own-read', 'file_read'), fact('own-change', 'file_changed'), fact('own-skill', 'skill_loaded'), fact('own-present', 'file_presented')]);
  for (const id of ['first-read', 'first-change', 'first-skill']) await f.j.equip({ id, slot: 'badge' });
  await assert.rejects(f.j.equip({ id: 'present', slot: 'badge' }), errorCode('EQUIPMENT_FULL'));
  await f.j.equip({ id: 'first-read', slot: 'badge', equipped: false }); await f.j.equip({ id: 'present', slot: 'badge' });
  assert.ok(f.j.snapshot().awards.some(a => a.definitionId === 'first-read'));
  assert.equal(f.j.snapshot().equipment.badges.length, 3);
});

test('facts never persist source bodies, raw paths, or opaque caller keys', async t => {
  const f = await fixture(t);
  const privateKey = 'private-opaque-identity';
  await f.j.ingest([fact('privacy', 'file_read', { key: privateKey, evidence: { source: 'tools/result', callKey: 'opaque-call-id', evidenceKeys: ['opaque-proof-id'] } })]);
  const saved = await readFile(f.file, 'utf8');
  assert.ok(!saved.includes(privateKey)); assert.ok(!saved.includes('opaque-call-id'));
  await assert.rejects(f.j.ingest([fact('path-leak', 'file_read', { key: '/' + 'Users/example/private.txt' })]), errorCode('INVALID_INPUT'));
  await assert.rejects(f.j.ingest([fact('body-leak', 'file_read', { evidence: { source: 'tools/result', content: 'source body' } })]), errorCode('INVALID_INPUT'));
  await assert.rejects(f.j.configure({ requestId: 'bad-title', definitions: [definition('path-title', { template: 'model_report' }, { title: '/' + 'Users/example/private.txt' })] }), errorCode('PRIVATE_PATH'));
});

test('write failure retains the previous memory and disk state and the queue remains usable', async t => {
  const f = await fixture(t), old = await readFile(f.file, 'utf8'), backup = f.file + '.saved';
  await rename(f.file, backup); await mkdir(f.file);
  await assert.rejects(f.j.ingest([fact('failed-commit', 'tokens')]), errorCode('PERSISTENCE_FAILED'));
  assert.equal(f.j.snapshot().revision, 0); assert.equal(f.j.snapshot().totals.tokens, 0);
  assert.equal(await readFile(backup, 'utf8'), old);
  assert.ok(!(await readdir(f.directory)).some(name => name.includes('.tmp-')));
  await rm(f.file, { recursive: true }); await rename(backup, f.file);
  assert.equal((await f.j.ingest([fact('failed-commit', 'tokens')])).totals.tokens, 100);
});

test('corrupt or future-schema state refuses startup without overwriting saved bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-corrupt-')), file = join(directory, 'state.json');
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [data, code] of [['{"broken":', 'CORRUPT_STATE'], ['{"schemaVersion":99}', 'SCHEMA_UNSUPPORTED']]) {
    await writeFile(file, data);
    await assert.rejects(createJournal({ file }), errorCode(code));
    assert.equal(await readFile(file, 'utf8'), data);
    assert.ok(!(await readdir(directory)).some(name => name.endsWith('.lock')));
  }
});

test('exclusive writer ownership and close protect against a second journal instance', async t => {
  const f = await fixture(t);
  await assert.rejects(createJournal({ file: f.file }), errorCode('LOCK_HELD'));
  await f.j.close();
  await assert.rejects(f.j.preferences({ theme: 'cyber' }), errorCode('CLOSED'));
  await f.reopen(); assert.equal(f.j.snapshot().storage.status, 'ready');
});

test('the finite identity budget fails explicitly and retains existing deduplication', async t => {
  const f = await fixture(t);
  const existing = fact('already-recorded', 'turn_completed'); await f.j.ingest([existing]); await f.j.close();
  const stored = JSON.parse(await readFile(f.file, 'utf8'));
  for (let i = Object.keys(stored.facts).length; i < JOURNAL_LIMITS.facts; i++) stored.facts[digest(`budget-${i}`)] = digest(`fingerprint-${i}`);
  await writeFile(f.file, JSON.stringify(stored)); await f.reopen();
  const before = f.j.snapshot();
  await assert.rejects(f.j.ingest([fact('one-too-many', 'turn_completed')]), errorCode('BUDGET_EXCEEDED'));
  assert.equal(f.j.snapshot().revision, before.revision);
  assert.equal(f.j.snapshot().storage.usage.facts, JOURNAL_LIMITS.facts);
  assert.equal((await f.j.ingest([existing])).revision, before.revision);
});
