import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJournal } from '../src/journal.mjs';
import { collectionCatalog, collectionDrawInfo, drawCollection, freshCollection, THEME_IDS, validateCollection } from '../src/collection.mjs';
import { createDebugController } from '../src/debug.mjs';

const code = expected => error => error.code === expected;
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should equal ${expected}`);
const fact = (id = 'read', kind = 'file_read') => ({ id, kind, at: 1000, sessionId: 'synthetic-session', turnKey: 'synthetic-turn', key: 'opaque-file' });
const user = { source: 'user' };
async function fixture(t, { randomInt = () => 0 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-names-pity-')), file = join(directory, 'state.json');
  let journal = await createJournal({ file, now: () => 1000, randomInt });
  t.after(async () => { await journal.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, file, get j() { return journal; }, raw: async () => JSON.parse(await readFile(file, 'utf8')),
    async reopen() { await journal.close(); journal = await createJournal({ file, now: () => 1000, randomInt }); },
    async earn() { await journal.configure({ requestId: 'points', definitions: Array.from({ length: 10 }, (_, index) => ({ id: `point-${index}`, title: `合成目标 ${index}`, rule: { template: 'first_seen', metric: 'file_read' } })) }, user); await journal.ingest([fact()]); },
  };
}
function poolFixture() {
  const collection = freshCollection(1000), requests = {}, awards = Array.from({ length: 100 }, (_, index) => ({ id: `award-${index}` }));
  collection.points = { earned: 100, spent: 0, balance: 100 };
  return { collection, requests, awards,
    draw(theme = 'explorer', randomInt = () => 0) {
      const requestHash = hash(`draw-${collection.draws.length}`); requests[requestHash] = { method: 'draw' };
      drawCollection(collection, { requestHash, theme, at: 1000 + collection.draws.length, randomInt });
      validateCollection(collection, { awards, requests, character: null });
      return collection.draws.at(-1);
    },
  };
}

test('the fiftieth individual card is SSR and takes precedence over the tenth-slot SR fallback', () => {
  const f = poolFixture();
  for (let index = 0; index < 4; index++) assert.equal(f.draw().results.at(-1).rarity, 'SR');
  assert.deepEqual(collectionDrawInfo(f.collection, 'explorer').pity, { limit: 50, sinceSSR: 40, remaining: 10 });
  let rerolls = 0;
  const fifth = f.draw('explorer', maximum => { if (maximum === 12) rerolls++; return 0; });
  assert.equal(fifth.results.slice(0, 9).every(item => item.rarity === 'N'), true);
  assert.equal(fifth.results[9].rarity, 'SSR'); assert.equal(rerolls, 0);
  assert.deepEqual(collectionDrawInfo(f.collection, 'explorer').pity, { limit: 50, sinceSSR: 0, remaining: 50 });
  for (let index = 0; index < 5; index++) f.draw();
  assert.equal(f.collection.draws[9].results[9].rarity, 'SSR');
});

test('an early SSR resets its theme streak and a guarantee can land at the first slot of the next pack', () => {
  const f = poolFixture(); let baseRolls = 0;
  f.draw('xianxia', maximum => maximum === 100 && baseRolls++ === 0 ? 98 : 0);
  assert.equal(collectionDrawInfo(f.collection, 'xianxia').pity.sinceSSR, 9);
  for (let index = 0; index < 4; index++) f.draw('xianxia');
  assert.equal(collectionDrawInfo(f.collection, 'xianxia').pity.sinceSSR, 49);
  const info = collectionDrawInfo(f.collection, 'xianxia');
  close(info.tenPullRates.N, 0.54); close(info.tenPullRates.R, 0.252); close(info.tenPullRates.SR, 0.09); close(info.tenPullRates.SSR, 0.118);
  const guaranteed = f.draw('xianxia'); assert.equal(guaranteed.results[0].rarity, 'SSR'); assert.equal(guaranteed.results.at(-1).rarity, 'N');
  assert.equal(collectionDrawInfo(f.collection, 'xianxia').pity.sinceSSR, 9);
  let slot = 0;
  const early = f.draw('xianxia', maximum => maximum === 100 && slot++ === 4 ? 99 : 0);
  assert.equal(early.results[4].rarity, 'SSR'); assert.equal(collectionDrawInfo(f.collection, 'xianxia').pity.sinceSSR, 5);
});

test('SSR pity is per theme and uses receipt chronology without modifying the stored order', () => {
  const f = poolFixture();
  for (let index = 0; index < 4; index++) f.draw('explorer');
  f.draw('xianxia', maximum => maximum === 100 ? 99 : 0);
  assert.equal(collectionDrawInfo(f.collection, 'explorer').pity.sinceSSR, 40);
  assert.equal(collectionDrawInfo(f.collection, 'xianxia').pity.sinceSSR, 0);
  assert.equal(f.draw('explorer').results.at(-1).rarity, 'SSR');
  const last = f.collection.draws.at(-1), earlier = f.collection.draws[0];
  f.collection.draws[0] = last; f.collection.draws[f.collection.draws.length - 1] = earlier;
  const bytes = JSON.stringify(f.collection);
  assert.equal(collectionDrawInfo(f.collection, 'explorer').pity.sinceSSR, 0);
  assert.equal(JSON.stringify(f.collection), bytes);
});

test('next-ten probabilities match the legacy guarantee away from pity and divide uniformly over dynamic pools', () => {
  const f = poolFixture(), catalog = collectionCatalog();
  assert.equal(catalog.hardPity.limit, 50); assert.equal(catalog.rates.actualExcludesHardPity, true);
  for (const theme of THEME_IDS) {
    const info = collectionDrawInfo(f.collection, theme);
    for (const rarity of ['N', 'R', 'SR', 'SSR']) close(info.tenPullRates[rarity], catalog.actualRates[rarity]);
    close(Object.values(info.tenPullRates).reduce((sum, rate) => sum + rate, 0), 1);
    close(info.characterRates.reduce((sum, card) => sum + card.baseRate, 0), 1);
    close(info.characterRates.reduce((sum, card) => sum + card.tenPullRate, 0), 1);
  }
  f.collection.characters.push({ ...f.collection.characters.find(item => item.rarity === 'SSR'), id: 'synthetic-ssr', source: 'user' });
  const info = collectionDrawInfo(f.collection, 'explorer'), cards = info.characterRates.filter(item => [f.collection.characters.find(item => item.rarity === 'SSR').id, 'synthetic-ssr'].includes(item.id));
  assert.equal(cards.length, 2); close(cards[0].baseRate, 0.01); close(cards[0].tenPullRate, info.tenPullRates.SSR / 2); close(cards[0].tenPullRate, cards[1].tenPullRate);
  close(info.characterRates.reduce((sum, card) => sum + card.tenPullRate, 0), 1);
});

test('journal pity survives restart and exact draw retries cannot roll or charge again', async t => {
  let rolls = 0; const f = await fixture(t, { randomInt: () => { rolls++; return 0; } }); await f.earn();
  for (let index = 0; index < 4; index++) await f.j.draw({ requestId: `real-draw-${index}` });
  const bytes = await readFile(f.file, 'utf8'), beforeRolls = rolls;
  await f.reopen(); assert.equal(await readFile(f.file, 'utf8'), bytes);
  assert.equal(f.j.snapshot().collection.drawInfo.pity.sinceSSR, 40);
  await f.j.draw({ requestId: 'real-draw-3' }); assert.equal(rolls, beforeRolls); assert.equal(await readFile(f.file, 'utf8'), bytes);
  const input = { requestId: 'real-fiftieth' }; const drawn = await f.j.draw(input), receipt = f.j.drawReceipt(input.requestId);
  assert.equal(receipt.results.at(-1).rarity, 'SSR'); assert.equal(drawn.collection.drawInfo.pity.sinceSSR, 0);
  const committed = await readFile(f.file, 'utf8'), committedRolls = rolls; await f.reopen(); await f.j.draw(input);
  assert.equal(rolls, committedRolls); assert.equal(await readFile(f.file, 'utf8'), committed);
  assert.equal(Object.hasOwn((await f.raw()).collection, 'drawInfo'), false);
});

test('a pre-pity schema-two streak over fifty reads unchanged and guarantees the next card', async t => {
  const f = await fixture(t); await f.earn();
  for (let index = 0; index < 6; index++) await f.j.draw({ requestId: `old-${index}` });
  await f.j.close(); const raw = await f.raw(), counts = new Map();
  // Reconstruct a valid historical producer that only guaranteed SR per ten.
  for (const draw of raw.collection.draws) for (const item of draw.results) {
    if (item.rarity === 'SSR') { item.id = 'builtin:explorer:7'; item.rarity = 'SR'; }
    const prior = counts.get(item.id); item.isNew = !prior;
    if (prior) prior.count++; else counts.set(item.id, { id: item.id, count: 1, firstAt: draw.at });
  }
  raw.collection.owned = [...counts.values()];
  const oldBytes = JSON.stringify(raw, null, 2) + '\n'; await writeFile(f.file, oldBytes); await f.reopen();
  const info = f.j.snapshot().collection.drawInfo; assert.deepEqual(info.pity, { limit: 50, sinceSSR: 60, remaining: 1 });
  await f.j.ingest([]); f.j.catalog(); await f.reopen(); assert.equal(await readFile(f.file, 'utf8'), oldBytes);
  assert.equal(Object.hasOwn(await f.raw(), 'displayNames'), false);
  await f.j.draw({ requestId: 'first-upgraded-draw' }); assert.equal(f.j.drawReceipt('first-upgraded-draw').results[0].rarity, 'SSR');
  assert.deepEqual((await f.raw()).collection.draws.slice(0, 6), raw.collection.draws);
});

test('renaming every builtin identity changes only display metadata and reset restores the theme defaults', async t => {
  const f = await fixture(t); await f.j.ingest([fact()]); await f.j.draw({ requestId: 'owned-before-name' });
  const original = await f.raw(), initial = f.j.snapshot();
  for (const kind of ['achievement', 'character']) for (const record of kind === 'achievement' ? initial.definitions : initial.collection.characters) {
    const input = { requestId: `name-${kind}-${record.id}`, expectedRevision: f.j.snapshot().revision, kind, id: record.id, name: `我的${record.id}` };
    const renamed = await f.j.rename(input, user), item = (kind === 'achievement' ? renamed.definitions : renamed.collection.characters).find(item => item.id === record.id);
    assert.equal(item.customName, input.name); assert.equal(item.revision, record.revision);
    assert.equal(kind === 'achievement' ? item.title : item.defaultName, kind === 'achievement' ? record.title : record.defaultName);
  }
  const raw = await f.raw();
  for (const key of ['definitions', 'awards', 'timeline', 'equipment', 'collection', 'counts', 'sets', 'facts', 'pending', 'usage', 'usageMissing', 'preferences']) assert.deepEqual(raw[key], original[key], key);
  assert.equal(raw.schemaVersion, 2); assert.equal(Object.keys(raw.displayNames.achievements).length, 16); assert.equal(Object.keys(raw.displayNames.characters).length, 80);
  await f.j.preferences({ theme: 'xianxia' }); const switched = f.j.snapshot();
  assert.equal(switched.definitions.find(item => item.id === 'first').customName, '我的first');
  assert.equal(switched.definitions.find(item => item.id === 'first').defaultTitle, '初入仙途');
  assert.equal(switched.collection.characters.find(item => item.id === 'builtin:xianxia:8').defaultName, '大乘飞升');
  for (const kind of ['achievement', 'character']) for (const record of kind === 'achievement' ? initial.definitions : initial.collection.characters) await f.j.rename({ requestId: `reset-${kind}-${record.id}`, kind, id: record.id, name: null }, user);
  const reset = f.j.snapshot(); assert.equal(reset.definitions.every(item => !Object.hasOwn(item, 'customName')), true); assert.equal(reset.collection.characters.every(item => item.name === item.defaultName && !Object.hasOwn(item, 'customName')), true);
  assert.equal(Object.hasOwn(await f.raw(), 'displayNames'), false); assert.deepEqual((await f.raw()).definitions, original.definitions);
});

test('achievement overrides project onto new notifications and historical awards without altering snapshots', async t => {
  const f = await fixture(t);
  await f.j.rename({ requestId: 'rename-before-award', kind: 'achievement', id: 'first-read', name: '我的开卷' }, user);
  const unlocked = await f.j.ingest([fact()]);
  for (const item of [unlocked.definitions.find(item => item.id === 'first-read'), unlocked.awards[0], unlocked.timeline[0], unlocked.notifications.find(item => item.kind === 'unlock')]) { assert.equal(item.customName, '我的开卷'); assert.equal(item.defaultTitle, '翻开一页'); assert.equal(item.title, '翻开一页'); }
  const raw = await f.raw(); assert.equal(raw.awards[0].title, '翻开一页'); assert.equal(Object.hasOwn(raw.awards[0], 'customName'), false);
  await f.j.preferences({ theme: 'xianxia' }); await f.j.rename({ requestId: 'rename-history', kind: 'achievement', id: 'first-read', name: '一生的开卷' }, user);
  const named = f.j.snapshot(); for (const item of [named.awards[0], named.timeline[0]]) { assert.equal(item.customName, '一生的开卷'); assert.equal(item.defaultTitle, '开卷有迹'); }
  assert.deepEqual((await f.raw()).awards, raw.awards); assert.deepEqual((await f.raw()).timeline, raw.timeline);
  await f.j.rename({ requestId: 'history-reset', kind: 'achievement', id: 'first-read', name: null }, user);
  assert.equal(f.j.snapshot().awards[0].customName, undefined); assert.equal(f.j.snapshot().awards[0].defaultTitle, '开卷有迹');
});

test('source edits preserve user overrides and resets use the latest raw custom name', async t => {
  const f = await fixture(t);
  await f.j.configure({ requestId: 'custom-goal', definitions: [{ id: 'custom-goal', title: '原始目标', rule: { template: 'model_report' } }] }, user);
  await f.j.configureCharacters({ requestId: 'custom-card', characters: [{ id: 'custom-card', name: '原始伙伴', theme: 'xianxia', rarity: 'N' }] }, user);
  for (const kind of ['achievement', 'character']) await f.j.rename({ requestId: `custom-name-${kind}`, kind, id: kind === 'achievement' ? 'custom-goal' : 'custom-card', name: '我起的名字' }, user);
  await f.j.configure({ requestId: 'custom-goal-edit', definitions: [{ id: 'custom-goal', title: '最新目标' }] }, user);
  await f.j.configureCharacters({ requestId: 'custom-card-edit', characters: [{ id: 'custom-card', name: '最新伙伴' }] }, user);
  const snapshot = f.j.snapshot(), goal = snapshot.definitions.find(item => item.id === 'custom-goal'), card = snapshot.collection.characters.find(item => item.id === 'custom-card');
  assert.equal(goal.customName, '我起的名字'); assert.equal(goal.defaultTitle, '最新目标'); assert.equal(card.name, '我起的名字'); assert.equal(card.defaultName, '最新伙伴');
  await f.j.rename({ requestId: 'custom-card-reset', kind: 'character', id: 'custom-card', name: null }, user);
  assert.equal(f.j.snapshot().collection.characters.find(item => item.id === 'custom-card').name, '最新伙伴');
  const bytes = await readFile(f.file, 'utf8'); await f.reopen(); assert.equal(await readFile(f.file, 'utf8'), bytes); assert.equal(f.j.snapshot().definitions.find(item => item.id === 'custom-goal').customName, '我起的名字');
});

test('invalid names, identities, scopes and stale revisions are atomic while exact rename retries survive restart', async t => {
  const f = await fixture(t);
  await f.j.configure({ requestId: 'scoped-goal', definitions: [{ id: 'scoped-goal', title: '工作区目标', scope: 'current_workspace', rule: { template: 'model_report' } }] }, { source: 'user', workspaceKey: 'workspace-a' });
  const bytes = await readFile(f.file, 'utf8'), input = { requestId: 'rename-input', expectedRevision: f.j.snapshot().revision, kind: 'achievement', id: 'first', name: '新名字' };
  for (const name of ['', ' ', '长'.repeat(61), '\n标题', '标题\u0085', '/' + 'Users/synthetic/private', '路径(' + '/' + 'home/example/a)', 'file:///private/a', 'C:\\private\\a', '~/' + 'secret', 1, {}, undefined]) await assert.rejects(f.j.rename({ ...input, name }, user));
  for (const changes of [{ kind: 'other' }, { id: 'missing' }, { id: '/' + 'Users/synthetic' }, { award: true }, { expectedRevision: 0 }]) await assert.rejects(f.j.rename({ ...input, ...changes }, user));
  await assert.rejects(f.j.rename({ ...input, id: 'scoped-goal' }, { source: 'model', workspaceKey: 'workspace-b' }), code('WORKSPACE_MISMATCH'));
  assert.equal(await readFile(f.file, 'utf8'), bytes);
  const result = await f.j.rename(input, user); await f.j.preferences({ theme: 'garden' }); const committed = await readFile(f.file, 'utf8');
  const replayed = await f.j.rename(input, user); assert.equal(replayed.revision, result.revision + 1); assert.equal(await readFile(f.file, 'utf8'), committed);
  await f.reopen(); await f.j.rename(input, user); assert.equal(await readFile(f.file, 'utf8'), committed);
  await assert.rejects(f.j.rename({ ...input, name: '另一个名字' }, user), code('REQUEST_ID_REUSED'));
  await assert.rejects(f.j.rename({ ...input, requestId: 'new-stale' }, user), code('REVISION_CONFLICT'));
  assert.equal(await readFile(f.file, 'utf8'), committed);
});

test('failed persistence leaves rename metadata and durable request identity unmodified', async t => {
  const f = await fixture(t), backup = f.file + '.held', bytes = await readFile(f.file, 'utf8'), input = { requestId: 'disk-failure-name', kind: 'character', id: 'builtin:explorer:1', name: '可重试的名字' };
  await rename(f.file, backup); await mkdir(f.file);
  await assert.rejects(f.j.rename(input, user), code('PERSISTENCE_FAILED'));
  assert.equal(f.j.snapshot().collection.characters[0].customName, undefined);
  await rm(f.file, { recursive: true }); await rename(backup, f.file); assert.equal(await readFile(f.file, 'utf8'), bytes);
  await f.j.rename(input, user); assert.equal(f.j.snapshot().collection.characters[0].customName, input.name);
});

test('debug rename stays isolated, reset clears its overrides, and expired tokens cannot fall back to real writes', async t => {
  const f = await fixture(t), controller = createDebugController({ journal: f.j, statePath: f.file, now: () => 1000, tmpRoot: f.directory }); t.after(() => controller.dispose());
  const bytes = await readFile(f.file, 'utf8'), { token } = await controller.start();
  await controller.mutate(token, 'rename', { requestId: 'debug-name', kind: 'achievement', id: 'first', name: '调试名' });
  await controller.mutate(token, 'rename', { requestId: 'debug-card-name', kind: 'character', id: 'builtin:xianxia:8', name: '调试伙伴' });
  assert.equal(controller.get(token).snapshot().definitions[0].customName, '调试名'); assert.equal(await readFile(f.file, 'utf8'), bytes);
  const next = await controller.reset(token); assert.equal(next.snapshot.definitions[0].customName, undefined);
  await assert.rejects(controller.mutate(token, 'rename', { requestId: 'stale-debug', kind: 'achievement', id: 'first', name: '不该生效' }), code('DEBUG_SCOPE_EXPIRED'));
  await controller.exit(next.token); assert.equal(await readFile(f.file, 'utf8'), bytes);
});

test('strict stored display-name maps reject corrupt data without changing bytes', async t => {
  const f = await fixture(t); await f.j.close(); const original = await f.raw();
  for (const displayNames of [{ achievements: { missing: '名字' }, characters: {} }, { achievements: {}, characters: { 'builtin:xianxia:1': '长'.repeat(61) } }, { achievements: {}, characters: {}, extra: {} }, { achievements: {} }]) {
    const bytes = JSON.stringify({ ...original, displayNames }); await writeFile(f.file, bytes);
    await assert.rejects(createJournal({ file: f.file }), code('CORRUPT_STATE')); assert.equal(await readFile(f.file, 'utf8'), bytes);
  }
  await writeFile(f.file, JSON.stringify(original)); await f.reopen();
});
