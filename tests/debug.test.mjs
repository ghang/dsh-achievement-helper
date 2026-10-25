import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJournal } from '../src/journal.mjs';
import { createDebugController, DEBUG_LIMITS } from '../src/debug.mjs';

const code = expected => error => error.code === expected;
const fact = (id = 'real-read') => ({ id, kind: 'file_read', at: 1000, sessionId: 'real-session', turnKey: 'real-turn', key: 'opaque-real-file' });
const character = { name: '调试小狐', description: '只存在于调试副本中的原创伙伴。', theme: 'xianxia', rarity: 'N', icon: 'fox', animation: 'float' };

async function fixture(t, { clockHook } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-debug-test-')), statePath = join(directory, 'real.json'), copies = join(directory, 'copies');
  await mkdir(copies); let at = 1000; const now = () => { clockHook?.(); return at; };
  const journal = await createJournal({ file: statePath, now }), direct = new Set();
  const controller = createDebugController({ journal, statePath, now, tmpRoot: copies });
  t.after(async () => { await controller.dispose(); for (const copy of direct) await copy.close(); await journal.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, statePath, copies, journal, c: controller, setNow(value) { at = value; },
    async openCopy({ debug = true, randomInt = () => 0 } = {}) {
      const file = join(directory, `direct-${direct.size}.json`), data = JSON.parse(await readFile(statePath, 'utf8'));
      if (debug) data.debug = true; await writeFile(file, JSON.stringify(data));
      const copy = await createJournal({ file, now, allowDebug: true, randomInt }); direct.add(copy); return { copy, file };
    },
    async copyFiles() { return Promise.all((await readdir(copies)).map(async name => ({ directory: join(copies, name), file: join(copies, name, 'journal-debug.json') }))); },
  };
}

test('real instances reject debugAction before input validation, including allowDebug without a file marker', async t => {
  const f = await fixture(t), before = await readFile(f.statePath, 'utf8');
  for (const input of [undefined, {}, { requestId: 'forbidden', action: 'complete_all' }]) await assert.rejects(f.journal.debugAction(input), code('DEBUG_ONLY'));
  const ordinary = await f.openCopy({ debug: false });
  await assert.rejects(ordinary.copy.debugAction({}), code('DEBUG_ONLY'));
  assert.equal(f.journal.snapshot().debug, undefined); assert.equal(ordinary.copy.snapshot().debug, undefined);
  assert.equal(await readFile(f.statePath, 'utf8'), before);
});

test('marked debug archives survive debug reopen but default real readers refuse them without overwriting bytes', async t => {
  const f = await fixture(t), { copy, file } = await f.openCopy();
  await copy.debugAction({ requestId: 'direct-complete', action: 'complete' }); await copy.close();
  const before = await readFile(file, 'utf8'); assert.equal(JSON.parse(before).debug, true);
  await assert.rejects(createJournal({ file }), code('DEBUG_ARCHIVE_FORBIDDEN')); assert.equal(await readFile(file, 'utf8'), before);
  assert.equal((await readdir(f.directory)).some(name => name === 'direct-0.json.lock'), false);
  const reopened = await createJournal({ file, allowDebug: true });
  assert.equal(reopened.snapshot().debug, true); assert.equal(reopened.snapshot().awards.length, 1); await reopened.close();
  const bad = JSON.parse(before); bad.debug = false; await writeFile(file, JSON.stringify(bad));
  await assert.rejects(createJournal({ file, allowDebug: true }), code('CORRUPT_STATE'));
});

test('start copies only the current atomic archive into its own private marked directory', async t => {
  const f = await fixture(t); await f.journal.ingest([fact()]); await f.journal.preferences({ theme: 'xianxia' });
  const real = await readFile(f.statePath, 'utf8'), started = await f.c.start(), files = await f.copyFiles();
  assert.match(started.token, /^[a-f0-9]{64}$/); assert.equal(started.snapshot.debug, true); assert.equal(started.snapshot.preferences.theme, 'xianxia');
  assert.deepEqual(started.snapshot.awards, f.journal.snapshot().awards); assert.equal(files.length, 1);
  const data = JSON.parse(await readFile(files[0].file, 'utf8')); assert.equal(data.debug, true);
  delete data.debug; assert.deepEqual(data, JSON.parse(real));
  assert.equal((await stat(files[0].directory)).mode & 0o777, 0o700); assert.equal((await stat(files[0].file)).mode & 0o777, 0o600);
  const face = f.c.get(started.token); assert.equal(face.debugAction, undefined); assert.equal(face.ingest, undefined); assert.equal(Object.isFrozen(face), true);
  assert.equal(await readFile(f.statePath, 'utf8'), real);
});

test('quick completions, charms and draws never change real bytes or pass notifications to the real journal', async t => {
  const f = await fixture(t), before = await readFile(f.statePath, 'utf8'), { token } = await f.c.start();
  const completed = await f.c.action(token, { requestId: 'quick-one', action: 'complete', definitionId: 'first-read' });
  assert.equal(completed.debug, true); assert.equal(completed.awards.length, 1); assert.ok(completed.notifications.some(item => item.kind === 'unlock'));
  await f.c.action(token, { requestId: 'quick-charm', action: 'charm', charm: 'leaf' });
  await f.c.mutate(token, 'preferences', { theme: 'ocean' });
  const drawn = await f.c.action(token, { requestId: 'quick-ten', action: 'draw', theme: 'ocean' });
  assert.equal(drawn.equipment.charm, 'leaf'); assert.equal(drawn.collection.draws.length, 1); assert.equal(drawn.collection.points.balance, 0);
  const receipt = f.c.get(token).drawReceipt('quick-ten'); assert.equal(receipt.theme, 'ocean'); assert.equal(receipt.results.length, 10);
  const ranks = ['N', 'R', 'SR', 'SSR'], equipped = drawn.collection.characters.find(item => item.id === drawn.equipment.character);
  assert.equal(ranks.indexOf(equipped.rarity), Math.max(...receipt.results.map(item => ranks.indexOf(item.rarity))));
  assert.equal(await readFile(f.statePath, 'utf8'), before); assert.equal(f.journal.snapshot().awards.length, 0); assert.deepEqual(f.journal.snapshot().notifications, []);
});

test('real collection continues during debug and reset takes a fresh copy without merging fake results', async t => {
  const f = await fixture(t), { token } = await f.c.start(); await f.c.action(token, { requestId: 'fake-all', action: 'complete_all' });
  await f.journal.ingest([fact()]); await f.journal.preferences({ theme: 'space', frameHeight: 93 });
  const realBytes = await readFile(f.statePath, 'utf8'), old = f.c.get(token);
  assert.equal(old.snapshot().awards.length, 16); assert.equal(f.journal.snapshot().awards.length, 1);
  const reset = await f.c.reset(token);
  assert.notEqual(reset.token, token); assert.equal(reset.snapshot.awards.length, 1); assert.equal(reset.snapshot.collection.points.earned, 1); assert.equal(reset.snapshot.collection.draws.length, 0);
  assert.equal(reset.snapshot.preferences.theme, 'space'); assert.equal(reset.snapshot.preferences.frameHeight, 93);
  assert.throws(() => f.c.get(token), code('DEBUG_SCOPE_EXPIRED')); assert.throws(() => old.snapshot(), code('DEBUG_SCOPE_EXPIRED'));
  await assert.rejects(f.c.action(token, { requestId: 'stale', action: 'complete_all' }), code('DEBUG_SCOPE_EXPIRED'));
  assert.deepEqual(await f.c.exit(token), { exited: true }); assert.equal(f.c.get(reset.token).snapshot().awards.length, 1);
  assert.equal((await f.copyFiles()).length, 1); assert.equal(await readFile(f.statePath, 'utf8'), realBytes);
});

test('debug completion clears the selected incomplete condition without converting unknown real usage to zero', async t => {
  const f = await fixture(t);
  await f.journal.ingest([{ id: 'unknown-call', kind: 'tokens', at: 1000, sessionId: 'real-session', turnKey: 'real-turn' }]);
  await f.journal.configure({ requestId: 'archived-one', definitions: [{ id: 'archived-custom', title: '自定义旧目标', rule: { template: 'first_seen', metric: 'file_changed' } }], archiveIds: ['archived-custom'] });
  const before = await readFile(f.statePath, 'utf8'), { token } = await f.c.start();
  const completed = await f.c.action(token, { requestId: 'unknown-complete', action: 'complete', definitionId: 'million' });
  const definition = completed.definitions.find(item => item.id === 'million');
  assert.equal(definition.progress, 1000000); assert.equal(definition.incomplete, false); assert.equal(completed.totals.tokens, null);
  const all = await f.c.action(token, { requestId: 'complete-active', action: 'complete_all' });
  assert.ok(all.definitions.filter(item => item.status === 'active').every(item => item.unlockedAt !== undefined && !item.incomplete));
  assert.equal(all.definitions.find(item => item.id === 'archived-custom').unlockedAt, undefined);
  await assert.rejects(f.c.action(token, { requestId: 'cannot-complete-archive', action: 'complete', definitionId: 'archived-custom' }), code('ARCHIVED'));
  assert.equal(await readFile(f.statePath, 'utf8'), before); assert.equal(f.journal.snapshot().definitions.find(item => item.id === 'million').progress, null);
});

test('debug draw atomically earns a point if needed, charges once and equips the highest drawn rarity', async t => {
  const f = await fixture(t), { copy } = await f.openCopy();
  await copy.preferences({ theme: 'xianxia' });
  const input = { requestId: 'atomic-debug-draw', action: 'draw', theme: 'xianxia' };
  const [first, repeat] = await Promise.all([copy.debugAction(input), copy.debugAction(input)]);
  assert.equal(first.revision, repeat.revision); assert.equal(first.awards.length, 1); assert.equal(first.collection.draws.length, 1);
  assert.deepEqual(first.collection.points, { earned: 1, spent: 1, balance: 0 });
  const receipt = copy.drawReceipt(input.requestId); assert.equal(receipt.results[9].rarity, 'SR'); assert.equal(first.equipment.character, receipt.results[9].id);
  await assert.rejects(copy.debugAction({ ...input, theme: 'cyber' }), code('REQUEST_ID_REUSED'));
  await copy.preferences({ theme: 'cyber' });
  const retried = await copy.debugAction(input); assert.equal(retried.collection.draws.length, 1);
  const next = await copy.debugAction({ requestId: 'atomic-debug-draw-two', action: 'draw', theme: 'cyber' }); assert.equal(next.awards.length, 2); assert.equal(next.collection.points.spent, 2);
  assert.equal(copy.drawReceipt(input.requestId).theme, 'xianxia');
});

test('invalid quick draw or RNG failure rolls back its synthetic completion, award and point charge', async t => {
  const f = await fixture(t), { copy } = await f.openCopy(), before = copy.snapshot();
  await assert.rejects(copy.debugAction({ requestId: 'bad-theme', action: 'draw', theme: 'not-a-theme' }), code('INVALID_INPUT'));
  assert.deepEqual(copy.snapshot(), before); assert.equal(copy.drawReceipt('bad-theme'), null);
  const broken = await f.openCopy({ randomInt: () => { throw new Error('fixture crypto failure'); } }); const untouched = broken.copy.snapshot();
  await assert.rejects(broken.copy.debugAction({ requestId: 'broken-rng', action: 'draw' }), code('RANDOM_UNAVAILABLE'));
  assert.deepEqual(broken.copy.snapshot(), untouched);
});

test('complete_all awards each active goal once and charms accept only their supported presets', async t => {
  const f = await fixture(t); await f.journal.ingest([fact()]); const { token } = await f.c.start();
  const first = await f.c.action(token, { requestId: 'all', action: 'complete_all' }); assert.equal(first.awards.length, 16); assert.equal(first.collection.points.earned, 16);
  const replay = await f.c.action(token, { requestId: 'all', action: 'complete_all' }); assert.equal(replay.revision, first.revision);
  const other = await f.c.action(token, { requestId: 'all-again', action: 'complete_all' }); assert.equal(other.awards.length, 16); assert.equal(other.collection.points.earned, 16);
  for (const charm of ['compass', 'star', 'leaf']) assert.equal((await f.c.action(token, { requestId: `charm-${charm}`, action: 'charm', charm })).equipment.charm, charm);
  await assert.rejects(f.c.action(token, { requestId: 'bad-charm', action: 'charm', charm: 'none' }), code('INVALID_INPUT'));
  await assert.rejects(f.c.action(token, { requestId: 'unrelated', action: 'charm', theme: 'xianxia' }), code('INVALID_INPUT'));
});

test('ordinary domain mutations stay in the debug scope while generation and ingestion are unavailable', async t => {
  const f = await fixture(t), before = await readFile(f.statePath, 'utf8'), { token } = await f.c.start();
  await f.c.mutate(token, 'preferences', { theme: 'xianxia', frameStyle: 'showcase' });
  await f.c.mutate(token, 'configure', { requestId: 'debug-goal', definitions: [{ id: 'debug-report', title: '调试声明', rule: { template: 'model_report' } }] });
  await f.c.mutate(token, 'report', { requestId: 'debug-report-once', definitionId: 'debug-report' });
  await f.c.mutate(token, 'characters', { requestId: 'debug-character', characters: [character] });
  const drawn = await f.c.mutate(token, 'draw', { requestId: 'ordinary-debug-draw', theme: 'xianxia' });
  const id = drawn.collection.owned[0].id; await f.c.mutate(token, 'equip', { id, slot: 'character' });
  assert.equal(f.c.get(token).snapshot().equipment.character, id); assert.equal(f.c.get(token).snapshot().preferences.frameHeight, 104);
  for (const method of ['generation', 'ingest', 'debugAction', 'close', '__proto__']) await assert.rejects(f.c.mutate(token, method, {}), code('DEBUG_METHOD_REJECTED'));
  assert.equal(await readFile(f.statePath, 'utf8'), before);
});

test('four-scope capacity is bounded and unknown exit cannot touch another session or directory', async t => {
  const f = await fixture(t), scopes = await Promise.all(Array.from({ length: 4 }, () => f.c.start()));
  assert.equal(new Set(scopes.map(scope => scope.token)).size, 4); assert.equal((await f.copyFiles()).length, 4);
  await assert.rejects(f.c.start(), code('DEBUG_SESSION_LIMIT'));
  await f.c.exit('../../real.json'); assert.equal(f.c.get(scopes[0].token).snapshot().debug, true);
  await f.c.exit(scopes[0].token); assert.throws(() => f.c.get(scopes[0].token), code('DEBUG_SCOPE_EXPIRED'));
  const replacement = await f.c.start(); assert.notEqual(replacement.token, scopes[0].token); assert.equal((await f.copyFiles()).length, 4);
  const reset = await f.c.reset(scopes[1].token); assert.notEqual(reset.token, scopes[1].token); assert.equal((await f.copyFiles()).length, 4);
  await f.c.dispose(); assert.deepEqual(await readdir(f.copies), []); assert.deepEqual(f.c.diagnostics(), { activeSessions: 0, ownedDirectories: 0, closed: true });
});

test('TTL expiry invalidates old tokens with a 409 error and exit remains idempotent', async t => {
  const f = await fixture(t), { token } = await f.c.start(), face = f.c.get(token);
  f.setNow(1000 + DEBUG_LIMITS.ttlMs);
  assert.throws(() => f.c.get(token), error => error.code === 'DEBUG_SCOPE_EXPIRED' && error.status === 409);
  assert.throws(() => face.catalog(), code('DEBUG_SCOPE_EXPIRED'));
  await assert.rejects(f.c.reset(token), code('DEBUG_SCOPE_EXPIRED'));
  assert.deepEqual(await f.c.exit(token), { exited: true });
  const next = await f.c.start(); assert.notEqual(next.token, token); assert.equal(next.snapshot.debug, true);
  await f.c.dispose(); assert.deepEqual(await readdir(f.copies), []);
});

test('reset serializes with admitted writes and every later old-token write fails without real fallback', async t => {
  const f = await fixture(t), before = await readFile(f.statePath, 'utf8'), { token } = await f.c.start();
  const action = f.c.action(token, { requestId: 'before-reset', action: 'complete_all' });
  const reset = f.c.reset(token), stale = f.c.action(token, { requestId: 'after-reset', action: 'charm' });
  const result = await Promise.allSettled([action, reset, stale]);
  assert.equal(result[0].status, 'fulfilled'); assert.equal(result[1].status, 'fulfilled'); assert.equal(result[2].status, 'rejected'); assert.equal(result[2].reason.code, 'DEBUG_SCOPE_EXPIRED');
  const fresh = result[1].value; assert.equal(fresh.snapshot.awards.length, 0); assert.equal(f.c.get(fresh.token).snapshot().equipment.charm, null);
  assert.equal((await f.copyFiles()).length, 1); assert.equal(await readFile(f.statePath, 'utf8'), before);
});

test('exit waits for prior admitted writes, removes locks and directories, and leaves real ingestion alive', async t => {
  const f = await fixture(t), { token } = await f.c.start();
  const result = await Promise.allSettled([f.c.action(token, { requestId: 'last-debug-write', action: 'draw' }), f.c.exit(token), f.c.action(token, { requestId: 'too-late', action: 'complete' })]);
  assert.equal(result[0].status, 'fulfilled'); assert.equal(result[1].status, 'fulfilled'); assert.equal(result[2].reason.code, 'DEBUG_SCOPE_EXPIRED');
  assert.deepEqual(await readdir(f.copies), []); await f.journal.ingest([fact()]); assert.equal(f.journal.snapshot().awards.length, 1);
  assert.deepEqual(await f.c.exit(token), { exited: true });
});

test('closing during a pending start cleans every late copy and never publishes a usable token', async t => {
  let controller, scheduled = false, closing;
  const f = await fixture(t, { clockHook: () => { if (controller && !scheduled) { scheduled = true; queueMicrotask(() => { closing = controller.dispose(); }); } } });
  controller = f.c;
  await assert.rejects(f.c.start(), code('DEBUG_CLOSED')); await closing;
  assert.deepEqual(await readdir(f.copies), []); assert.equal(f.c.diagnostics().ownedDirectories, 0);
  await assert.rejects(f.c.start(), code('DEBUG_CLOSED'));
});

test('unavailable, mismatched, symbolic or already-debug sources cannot become a debug session', async t => {
  const f = await fixture(t), path = join(f.directory, 'source-link.json'); await symlink(f.statePath, path);
  const linked = createDebugController({ journal: f.journal, statePath: path, tmpRoot: f.copies });
  await assert.rejects(linked.start(), code('DEBUG_SOURCE_UNAVAILABLE')); await linked.dispose();
  const unavailable = createDebugController({ journal: { snapshot: () => ({ storage: { status: 'unavailable' } }) }, statePath: f.statePath, tmpRoot: f.copies });
  await assert.rejects(unavailable.start(), code('DEBUG_SOURCE_UNAVAILABLE')); await unavailable.dispose();
  const { copy, file } = await f.openCopy(); const nested = createDebugController({ journal: copy, statePath: file, tmpRoot: f.copies });
  await assert.rejects(nested.start(), code('DEBUG_SOURCE_UNAVAILABLE')); await nested.dispose();
  assert.deepEqual(await readdir(f.copies), []); assert.equal(f.journal.snapshot().debug, undefined);
});
