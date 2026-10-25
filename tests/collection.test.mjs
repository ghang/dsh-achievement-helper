import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createJournal } from '../src/journal.mjs';
import { THEME_IDS, ICON_IDS, ANIMATION_IDS, COLLECTION_LIMITS, validateArt } from '../src/collection.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const pointKinds = ['file_read', 'file_changed', 'skill_loaded', 'file_presented', 'turn_completed'];
const fact = (kind, index = 0) => ({ id: `collection-${kind}-${index}`, kind, at: 1000, sessionId: 'fixture-session', turnKey: 'fixture-turn', ...(kind === 'turn_completed' ? {} : { key: `fixture-${kind}-${index}` }) });
const character = (changes = {}) => ({ name: '小小看卷狐', description: '记录每一次自然探索的原创小伙伴。', theme: 'xianxia', rarity: 'N', icon: 'fox', animation: 'float', ...changes });
const code = value => error => error.code === value;
async function fixture(t, { randomInt = () => 0 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-collection-')), file = join(directory, 'journal.json');
  let now = 1000, current = await createJournal({ file, now: () => now, randomInt });
  t.after(async () => { await current.close(); await rm(directory, { recursive: true, force: true }); });
  return { file, directory, get j() { return current; }, setNow(value) { now = value; }, async reopen() { await current.close(); current = await createJournal({ file, now: () => now, randomInt }); return current; }, async earn(count = 1) { return current.ingest(pointKinds.slice(0, count).map(kind => fact(kind))); } };
}
const png = bytes => {
  const data = Buffer.alloc(bytes, 0); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data); data.writeUInt32BE(13, 8); data.write('IHDR', 12, 'ascii'); data.writeUInt32BE(1, 16); data.writeUInt32BE(1, 20);
  return `data:image/png;base64,${data.toString('base64')}`;
};

test('ten themes ship eighty original characters, every rarity, safe icons and independent achievement copy', async t => {
  const f = await fixture(t), snapshot = f.j.snapshot(), catalog = f.j.catalog();
  assert.deepEqual(catalog.themeIds, THEME_IDS); assert.equal(THEME_IDS.length, 10); assert.equal(snapshot.collection.characters.length, 80);
  for (const theme of THEME_IDS) {
    const pool = snapshot.collection.characters.filter(item => item.theme === theme);
    assert.equal(pool.length, 8); assert.deepEqual([...new Set(pool.map(item => item.rarity))], ['N', 'R', 'SR', 'SSR']);
    assert.ok(pool.every(item => item.source === 'builtin' && ICON_IDS.includes(item.icon) && ANIMATION_IDS.includes(item.animation)));
  }
  for (const theme of THEME_IDS.slice(3)) for (const achievement of snapshot.definitions) {
    assert.ok(achievement.themes[theme].title); assert.notEqual(achievement.themes[theme].title, achievement.themes.explorer.title);
  }
  assert.deepEqual(snapshot.collection.points, { earned: 0, spent: 0, balance: 0 });
  assert.deepEqual(snapshot.collection.owned, []); assert.equal(snapshot.equipment.character, null);
  assert.equal(snapshot.preferences.frameStyle, 'standard'); assert.equal(snapshot.preferences.frameHeight, 64);
  snapshot.collection.characters[0].rarity = 'SSR'; snapshot.collection.points.balance = 100;
  assert.equal(f.j.snapshot().collection.characters[0].rarity, 'N'); assert.equal(f.j.snapshot().collection.points.balance, 0);
});

test('catalog separates base probabilities from the exact guaranteed-pack average', async t => {
  const f = await fixture(t), c = f.j.catalog().collection;
  assert.deepEqual(c.baseRates, { N: 0.6, R: 0.28, SR: 0.1, SSR: 0.02 });
  assert.ok(Math.abs(Object.values(c.actualRates).reduce((a, b) => a + b, 0) - 1) < 1e-14);
  assert.ok(c.actualRates.SR > c.baseRates.SR && c.actualRates.SSR > c.baseRates.SSR);
  assert.equal(c.guarantee.rerollPosition, 10); assert.equal(c.guarantee.rerollRates.SR, 10 / 12); assert.equal(c.guarantee.rerollRates.SSR, 2 / 12);
  assert.equal(c.rates.actualBasis, 'average_per_card_after_ten_pull_guarantee'); assert.equal(c.drawSize, 10); assert.equal(c.drawCost, 1);
});

test('points come from unique permanent awards and never from repeated facts, theme or cosmetic edits', async t => {
  const f = await fixture(t); await f.earn();
  assert.deepEqual(f.j.snapshot().collection.points, { earned: 1, spent: 0, balance: 1 });
  await f.j.ingest([fact('file_read'), fact('file_read', 2)]);
  await f.j.preferences({ theme: 'wuxia', frameHeight: 88 });
  await f.j.configure({ requestId: 'rename-old-award', definitions: [{ id: 'first-read', title: '一本新名字' }] });
  assert.equal(f.j.snapshot().collection.points.earned, 1);
  await f.j.configure({ requestId: 'point-goal', definitions: [{ id: 'point-goal', title: '一段声明', rule: { template: 'model_report' } }] });
  await f.j.report({ requestId: 'point-report', definitionId: 'point-goal' });
  await f.j.report({ requestId: 'point-report', definitionId: 'point-goal' });
  assert.equal(f.j.snapshot().collection.points.earned, 2);
  await f.reopen(); assert.equal(f.j.snapshot().collection.points.earned, 2);
});

test('zero points, unexpected write fields and invalid themes cannot create a charge or a receipt', async t => {
  const f = await fixture(t);
  await assert.rejects(f.j.draw({ requestId: 'later-valid', theme: 'xianxia' }), code('NOT_ENOUGH_POINTS'));
  assert.equal(f.j.drawReceipt('later-valid'), null); assert.equal(f.j.snapshot().revision, 0);
  await assert.rejects(f.j.draw({ requestId: 'spoof-points', theme: 'xianxia', balance: 100 }), code('INVALID_INPUT'));
  await assert.rejects(f.j.preferences({ points: { balance: 100 } }), code('INVALID_INPUT'));
  await f.earn(); const before = f.j.snapshot();
  await assert.rejects(f.j.draw({ requestId: 'bad-theme', theme: 'unknown' }), code('INVALID_INPUT'));
  assert.deepEqual(f.j.snapshot(), before);
  await f.j.draw({ requestId: 'later-valid', theme: 'xianxia' });
  assert.equal(f.j.snapshot().collection.points.balance, 0);
});

test('one point draws ten, duplicates accumulate, and the tenth base-low roll gets its SR guarantee', async t => {
  const rolls = []; const f = await fixture(t, { randomInt: maximum => { rolls.push(maximum); return 0; } });
  await f.earn(2);
  const result = await f.j.draw({ requestId: 'ten-one', theme: 'xianxia' }), receipt = f.j.drawReceipt('ten-one');
  assert.deepEqual(result.collection.points, { earned: 2, spent: 1, balance: 1 });
  assert.equal(receipt.results.length, 10); assert.equal(receipt.results[9].rarity, 'SR'); assert.equal(receipt.results.slice(0, 9).every(item => item.rarity === 'N'), true);
  assert.deepEqual(receipt.results.map(item => item.isNew), [true, false, false, false, false, false, false, false, false, true]);
  assert.equal(result.collection.owned.find(item => item.id === receipt.results[0].id).count, 9);
  assert.equal(rolls.filter(maximum => maximum === 12).length, 1);
  const rollCount = rolls.length;
  await f.j.draw({ requestId: 'ten-one', theme: 'xianxia' });
  assert.equal(rolls.length, rollCount); assert.equal(f.j.snapshot().collection.points.spent, 1);
  await assert.rejects(f.j.draw({ requestId: 'ten-one', theme: 'cyber' }), code('REQUEST_ID_REUSED'));
  await f.j.draw({ requestId: 'ten-two', theme: 'cyber' });
  assert.equal(f.j.drawReceipt('ten-one').theme, 'xianxia'); assert.equal(f.j.drawReceipt('ten-two').theme, 'cyber');
  receipt.results.length = 0; assert.equal(f.j.drawReceipt('ten-one').results.length, 10);
  await f.reopen(); assert.equal(f.j.drawReceipt('ten-one').results.length, 10); assert.equal(f.j.snapshot().collection.points.spent, 2);
  assert.equal((await readFile(f.file, 'utf8')).includes('ten-one'), false);
});

test('rarity boundaries and the guarantee 10:2 reroll use server randomness', async t => {
  const f = await fixture(t, { randomInt: maximum => maximum === 100 ? 99 : 0 });
  await f.earn(); await f.j.draw({ requestId: 'all-ssr', theme: 'space' });
  assert.ok(f.j.drawReceipt('all-ssr').results.every(item => item.rarity === 'SSR'));
  const g = await fixture(t, { randomInt: maximum => maximum === 12 ? 10 : 0 });
  await g.earn(); await g.j.draw({ requestId: 'guaranteed-ssr', theme: 'space' });
  assert.equal(g.j.drawReceipt('guaranteed-ssr').results[9].rarity, 'SSR');
  let rarityRolls = 0, rerolls = 0;
  const h = await fixture(t, { randomInt: maximum => { if (maximum === 12) rerolls++; return maximum === 100 && rarityRolls++ === 0 ? 88 : 0; } });
  await h.earn(); await h.j.draw({ requestId: 'earlier-sr', theme: 'ocean' });
  assert.equal(h.j.drawReceipt('earlier-sr').results[0].rarity, 'SR'); assert.equal(h.j.drawReceipt('earlier-sr').results[9].rarity, 'N'); assert.equal(rerolls, 0);
});

test('concurrent distinct draws cannot overdraw, and a concurrent repeated request cannot charge twice', async t => {
  const f = await fixture(t); await f.earn();
  const results = await Promise.allSettled([f.j.draw({ requestId: 'race-a', theme: 'garden' }), f.j.draw({ requestId: 'race-b', theme: 'garden' })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'NOT_ENOUGH_POINTS');
  assert.equal(f.j.snapshot().collection.draws.length, 1); assert.equal(f.j.snapshot().collection.points.balance, 0);
  const g = await fixture(t); await g.earn();
  await Promise.all([g.j.draw({ requestId: 'same', theme: 'garden' }), g.j.draw({ requestId: 'same', theme: 'garden' })]);
  assert.equal(g.j.snapshot().collection.draws.length, 1); assert.equal(g.j.snapshot().collection.owned.reduce((n, item) => n + item.count, 0), 10);
});

test('only owned characters equip and old or unrelated removals cannot erase the current character', async t => {
  const f = await fixture(t);
  await assert.rejects(f.j.equip({ id: 'builtin:xianxia:1', slot: 'character' }), code('NOT_OWNED'));
  await f.earn(); await f.j.draw({ requestId: 'equip-pool', theme: 'xianxia' });
  await f.j.equip({ id: 'builtin:xianxia:1', slot: 'character' }); assert.equal(f.j.snapshot().equipment.character, 'builtin:xianxia:1');
  await f.j.equip({ id: 'builtin:xianxia:7', slot: 'character', equipped: false }); assert.equal(f.j.snapshot().equipment.character, 'builtin:xianxia:1');
  await f.reopen(); assert.equal(f.j.snapshot().equipment.character, 'builtin:xianxia:1');
  await f.j.equip({ id: 'builtin:xianxia:1', slot: 'character', equipped: false }); assert.equal(f.j.snapshot().equipment.character, null);
});

test('frame presets and custom height are bounded preferences independent of collection progress', async t => {
  const f = await fixture(t); await f.earn(); const collection = f.j.snapshot().collection;
  for (const [frameStyle, height] of [['compact', 32], ['standard', 64], ['showcase', 104]]) {
    await f.j.preferences({ frameStyle }); assert.equal(f.j.snapshot().preferences.frameHeight, height);
  }
  await f.j.preferences({ frameStyle: 'standard', frameHeight: 93 }); assert.equal(f.j.snapshot().preferences.frameHeight, 93);
  for (const frameHeight of [31, 161, 64.5, '64', null]) await assert.rejects(f.j.preferences({ frameHeight }), code('INVALID_INPUT'));
  await assert.rejects(f.j.preferences({ frameStyle: 'giant' }), code('INVALID_INPUT'));
  assert.deepEqual(f.j.snapshot().collection, collection); await f.reopen(); assert.equal(f.j.snapshot().preferences.frameHeight, 93);
});

test('custom configuration is idempotent and adds a pool definition without granting ownership or points', async t => {
  const f = await fixture(t), input = { requestId: 'custom-config', expectedRevision: 0, characters: [character()] };
  const configured = await f.j.configureCharacters(input, { source: 'model' });
  const custom = configured.collection.characters.find(item => item.source === 'model');
  assert.equal(custom.id, `character-${digest('custom-config').slice(0, 16)}-1`); assert.equal(custom.revision, 1);
  assert.deepEqual(configured.collection.owned, []); assert.deepEqual(configured.collection.points, { earned: 0, spent: 0, balance: 0 });
  assert.equal((await f.j.configureCharacters(input, { source: 'model' })).revision, configured.revision);
  await assert.rejects(f.j.configureCharacters({ ...input, characters: [character({ rarity: 'SSR' })] }, { source: 'model' }), code('REQUEST_ID_REUSED'));
  await assert.rejects(f.j.configureCharacters({ requestId: 'stale-character', expectedRevision: 0, characters: [character()] }), code('REVISION_CONFLICT'));
  for (const bad of [{ source: 'builtin' }, { count: 99 }, { owned: true }, { theme: 'bad' }, { rarity: 'UR' }, { animation: 'script' }, { icon: 'remote-url' }]) {
    await assert.rejects(f.j.configureCharacters({ requestId: `bad-${Object.keys(bad)[0]}`, characters: [character(bad)] }), code('INVALID_INPUT'));
  }
  await assert.rejects(f.j.configureCharacters({ requestId: 'builtin-edit', characters: [character({ id: 'builtin:xianxia:1' })] }), code('BUILTIN_CHARACTER_IMMUTABLE'));
  await f.reopen(); assert.equal(f.j.snapshot().collection.characters.find(item => item.id === custom.id).name, custom.name);
});

test('an unowned custom pool may move, but collected theme and rarity freeze while appearance remains editable', async t => {
  const f = await fixture(t, { randomInt: maximum => maximum === 100 ? 0 : maximum - 1 });
  await f.j.configureCharacters({ requestId: 'make-custom', characters: [character({ id: 'custom-fox', theme: 'cyber', rarity: 'R' })] }, { source: 'model' });
  await f.j.configureCharacters({ requestId: 'move-unowned', characters: [character({ id: 'custom-fox' })] });
  await f.earn(); await f.j.draw({ requestId: 'collect-custom', theme: 'xianxia' });
  assert.equal(f.j.snapshot().collection.owned.find(item => item.id === 'custom-fox').count, 9);
  const before = f.j.snapshot();
  for (const change of [{ theme: 'space' }, { rarity: 'SSR' }]) await assert.rejects(f.j.configureCharacters({ requestId: `immutable-${Object.keys(change)[0]}`, characters: [{ id: 'custom-fox', ...change }] }), code('CHARACTER_POOL_IMMUTABLE'));
  await f.j.configureCharacters({ requestId: 'cosmetic-fox', characters: [{ id: 'custom-fox', name: '月光看卷狐', icon: 'moon', animation: 'orbit', art: png(24) }] }, { source: 'user' });
  const after = f.j.snapshot(), custom = after.collection.characters.find(item => item.id === 'custom-fox');
  assert.equal(custom.name, '月光看卷狐'); assert.equal(custom.source, 'model'); assert.equal(custom.theme, 'xianxia'); assert.equal(custom.rarity, 'N');
  assert.deepEqual(after.collection.owned, before.collection.owned); assert.deepEqual(after.collection.points, before.collection.points); assert.deepEqual(after.collection.draws, before.collection.draws);
  await f.j.configureCharacters({ requestId: 'clear-custom-art', characters: [{ id: 'custom-fox', art: null }] });
  assert.equal(f.j.snapshot().collection.characters.find(item => item.id === 'custom-fox').art, undefined);
  await f.reopen(); assert.equal(f.j.snapshot().collection.owned.find(item => item.id === 'custom-fox').count, 9);
});

test('raster art checks declared magic and budgets, rejecting URLs, SVG, scripts and forged base64', async t => {
  const gif = Buffer.alloc(13); gif.write('GIF89a'); gif.writeUInt16LE(1, 6); gif.writeUInt16LE(1, 8);
  const webp = Buffer.alloc(20); webp.write('RIFF'); webp.writeUInt32LE(12, 4); webp.write('WEBP', 8); webp.write('VP8L', 12);
  const jpeg = Buffer.from([255, 216, 255, 224, 255, 217]);
  for (const [mime, bytes] of [['gif', gif], ['webp', webp], ['jpeg', jpeg]]) assert.equal(validateArt(`data:image/${mime};base64,${bytes.toString('base64')}`).bytes, bytes.length);
  assert.equal(validateArt(png(24)).bytes, 24); assert.equal(validateArt(png(COLLECTION_LIMITS.artBytes)).bytes, COLLECTION_LIMITS.artBytes);
  for (const art of ['https://example.invalid/a.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,PHN2Zz48L3N2Zz4=', 'data:image/gif;base64,' + jpeg.toString('base64'), png(24) + '=', png(COLLECTION_LIMITS.artBytes + 1)]) assert.throws(() => validateArt(art), code('INVALID_ART'));
  const f = await fixture(t);
  await assert.rejects(f.j.configureCharacters({ requestId: 'forged-art', characters: [character({ art: 'https://example.invalid/pet.png' })] }), code('INVALID_ART'));
  assert.equal(f.j.snapshot().collection.characters.length, 80);
});

test('the aggregate image budget rejects a batch without partially adding its earlier cards', async t => {
  const f = await fixture(t), art = png(COLLECTION_LIMITS.artBytes);
  await assert.rejects(f.j.configureCharacters({ requestId: 'too-many-images', characters: Array.from({ length: 17 }, (_, index) => character({ name: `批量伙伴${index}`, art })) }), code('BUDGET_EXCEEDED'));
  assert.equal(f.j.snapshot().collection.characters.length, 80); assert.equal(f.j.snapshot().revision, 0);
  await f.j.configureCharacters({ requestId: 'one-safe-image', characters: [character({ art })] });
  await f.reopen(); assert.equal(f.j.snapshot().collection.characters.at(-1).art, art);
});

test('RNG failure and disk replacement failure roll back charge, ownership and request id together', async t => {
  let broken = true, rolls = 0;
  const f = await fixture(t, { randomInt: maximum => { if (broken && ++rolls === 4) throw new Error('fixture random unavailable'); return 0; } });
  await f.earn(); const before = f.j.snapshot();
  await assert.rejects(f.j.draw({ requestId: 'random-retry', theme: 'academy' }), code('RANDOM_UNAVAILABLE'));
  assert.deepEqual(f.j.snapshot(), before); assert.equal(f.j.drawReceipt('random-retry'), null);
  broken = false; await f.j.draw({ requestId: 'random-retry', theme: 'academy' }); assert.equal(f.j.snapshot().collection.points.spent, 1);
  const g = await fixture(t); await g.earn(); const old = await readFile(g.file, 'utf8'), state = g.j.snapshot(), backup = g.file + '.saved';
  await rename(g.file, backup); await mkdir(g.file);
  await assert.rejects(g.j.draw({ requestId: 'disk-retry', theme: 'garden' }), code('PERSISTENCE_FAILED'));
  assert.deepEqual(g.j.snapshot(), state); assert.equal(await readFile(backup, 'utf8'), old); assert.equal(g.j.drawReceipt('disk-retry'), null);
  assert.ok(!(await readdir(g.directory)).some(name => name.includes('.tmp-')));
  await rm(g.file, { recursive: true }); await rename(backup, g.file);
  await g.j.draw({ requestId: 'disk-retry', theme: 'garden' }); assert.equal(g.j.snapshot().collection.points.spent, 1);
});

test('corrupt version two collection accounting, ownership or draw evidence preserves original bytes', async t => {
  const f = await fixture(t); await f.earn(); await f.j.draw({ requestId: 'corruption-baseline', theme: 'xianxia' }); await f.j.close();
  const good = JSON.parse(await readFile(f.file, 'utf8'));
  for (const corrupt of [data => { data.collection.points.balance++; }, data => { data.collection.owned[0].count++; }, data => { data.collection.draws[0].results[0].isNew = false; }, data => { data.collection.characters[0].name = 'forged builtin'; }, data => { data.collection.characters.pop(); }, data => { data.equipment.character = 'unowned'; }]) {
    const data = structuredClone(good); corrupt(data); const bytes = JSON.stringify(data); await writeFile(f.file, bytes);
    await assert.rejects(createJournal({ file: f.file }), code('CORRUPT_STATE')); assert.equal(await readFile(f.file, 'utf8'), bytes);
  }
});

// Generated by the frozen rc.3 v1 createJournal using only synthetic facts,
// one declared milestone, unknown usage and equipment. Gzip keeps the complete
// real producer output (17 definitions), rather than hand-writing a v1 lookalike.
// Uncompressed SHA-256: e0f1f4f9601307dd6a12d229d22ac4cc0983c36e8a42ca2b8801e8245fba77a6
const LEGACY_V1_GZIP = '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';
const legacyBytes = () => gunzipSync(Buffer.from(LEGACY_V1_GZIP, 'base64'));

test('real rc.3 v1 migration retains awards, requests, unknown progress and equipment without replaying unlocks', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-real-v1-')), file = join(directory, 'state.json'); let journal;
  t.after(async () => { await journal?.close(); await rm(directory, { recursive: true, force: true }); });
  const bytes = legacyBytes(), before = JSON.parse(bytes); assert.equal(digest(bytes), 'e0f1f4f9601307dd6a12d229d22ac4cc0983c36e8a42ca2b8801e8245fba77a6');
  await writeFile(file, bytes); journal = await createJournal({ file, now: () => 5000, randomInt: () => 0 });
  const migrated = journal.snapshot();
  assert.equal(migrated.storage.schemaVersion, 2); assert.equal(migrated.revision, before.revision); assert.equal(migrated.createdAt, before.createdAt); assert.equal(migrated.updatedAt, before.updatedAt);
  assert.deepEqual(migrated.awards, before.awards); assert.deepEqual(migrated.timeline, [...before.timeline].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))); assert.deepEqual(migrated.notifications, []);
  assert.deepEqual(migrated.equipment, { ...before.equipment, character: null }); assert.equal(migrated.preferences.frameHeight, 64); assert.equal(migrated.preferences.frameStyle, 'standard');
  assert.deepEqual(migrated.collection.points, { earned: 2, spent: 0, balance: 2 }); assert.equal(migrated.totals.tokens, null); assert.equal(migrated.totals.knownTokens, 100); assert.equal(migrated.coverage.pendingFacts, 1);
  assert.equal(migrated.definitions.find(item => item.id === 'legacy-kept').themes.xianxia.title, '旧卷留痕');
  assert.equal(Object.keys(migrated.definitions[0].themes).length, 10); assert.equal(Object.keys(migrated.awards[0].themes).length, 3);
  const replay = await journal.report({ requestId: 'legacy-report', definitionId: 'legacy-kept' }, { source: 'user' });
  assert.equal(replay.revision, before.revision); assert.deepEqual(replay.notifications, []); assert.equal(replay.collection.points.earned, 2);
  const saved = JSON.parse(await readFile(file, 'utf8')); assert.deepEqual(saved.facts, before.facts); assert.deepEqual(saved.requests, before.requests);
  await journal.draw({ requestId: 'after-migration', theme: 'wuxia' }); await journal.close();
  journal = await createJournal({ file, now: () => 6000 }); assert.deepEqual(journal.snapshot().awards, before.awards); assert.deepEqual(journal.snapshot().collection.points, { earned: 2, spent: 1, balance: 1 }); assert.deepEqual(journal.snapshot().notifications, []);
});

test('invalid legacy bytes fail validation before any migration or reset', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-invalid-v1-')), file = join(directory, 'state.json'); t.after(() => rm(directory, { recursive: true, force: true }));
  for (const corrupt of [data => { data.preferences.frameHeight = 500; }, data => { data.awards[0].definitionId = 'missing'; }, data => { data.awards[1].id = data.awards[0].id; }, data => { data.schemaVersion = 999; }]) {
    const data = JSON.parse(legacyBytes()); corrupt(data); const bytes = JSON.stringify(data); await writeFile(file, bytes);
    await assert.rejects(createJournal({ file }), code(data.schemaVersion === 999 ? 'SCHEMA_UNSUPPORTED' : 'CORRUPT_STATE')); assert.equal(await readFile(file, 'utf8'), bytes);
  }
});

test('custom character capacity is explicit, atomic and still permits edits at the limit', async t => {
  const f = await fixture(t);
  for (let start = 0; start < COLLECTION_LIMITS.customCharacters; start += 20) {
    await f.j.configureCharacters({ requestId: `capacity-${start}`, characters: Array.from({ length: Math.min(20, COLLECTION_LIMITS.customCharacters - start) }, (_, offset) => character({ id: `capacity-card-${start + offset}`, name: `小伙伴${start + offset}` })) });
  }
  const before = f.j.snapshot();
  await assert.rejects(f.j.configureCharacters({ requestId: 'over-character-capacity', characters: [character()] }), code('BUDGET_EXCEEDED'));
  assert.deepEqual(f.j.snapshot(), before);
  await f.j.configureCharacters({ requestId: 'edit-at-capacity', characters: [{ id: 'capacity-card-0', name: '更新名字' }] });
  assert.equal(f.j.snapshot().collection.characters.length, 80 + COLLECTION_LIMITS.customCharacters);
  await f.reopen(); assert.equal(f.j.snapshot().collection.characters.find(item => item.id === 'capacity-card-0').name, '更新名字');
});
