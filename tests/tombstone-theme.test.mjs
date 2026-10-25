import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createJournal } from '../src/journal.mjs';
import { CHARACTER_THEME_NAMES, THEME_IDS } from '../src/collection.mjs';
import { createDebugController } from '../src/debug.mjs';

const code = expected => error => error.code === expected;
const definition = (id, rule = { template: 'model_report' }, extra = {}) => ({ id, title: `自定目标 ${id}`, rule, ...extra });
const fact = (id, kind = 'file_read', extra = {}) => ({ id, kind, at: 1000, sessionId: 'fixture-session', turnKey: 'fixture-turn', key: 'opaque-file', ...extra });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-tombstone-')), file = join(directory, 'journal.json'); let calls = 0;
  let journal = await createJournal({ file, now: () => 1000, randomInt: () => { calls++; return 0; } });
  t.after(async () => { await journal.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, file, get j() { return journal; }, calls: () => calls, async reopen() { await journal.close(); journal = await createJournal({ file, now: () => 1000, randomInt: () => { calls++; return 0; } }); } };
}

test('deleting custom earned and unfinished goals preserves points, spending, history and permanent receipts', async t => {
  const f = await fixture(t);
  await f.j.configure({ requestId: 'goals', definitions: [definition('earned'), definition('unfinished', { template: 'count', metric: 'tokens', target: 100 })] }, { source: 'user' });
  await f.j.report({ requestId: 'earned-report', definitionId: 'earned' }, { source: 'user' });
  await f.j.ingest([{ id: 'pending-token', kind: 'tokens', at: 1000, sessionId: 'fixture-session', turnKey: 'fixture-turn' }]);
  await f.j.equip({ id: 'earned', slot: 'badge' }); await f.j.equip({ id: 'earned', slot: 'charm' });
  await f.j.draw({ requestId: 'spent-before-delete' });
  const before = f.j.snapshot(), request = { requestId: 'delete-custom', expectedRevision: before.revision, ids: ['earned', 'unfinished'] };
  const deleted = await f.j.deleteDefinitions(request, { source: 'user' });
  const persisted = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(persisted.schemaVersion, 2);
  assert.equal(persisted.requests[createHash('sha256').update(request.requestId).digest('hex')].method, 'configure');
  assert.ok(Object.values(persisted.requests).every(item => ['configure', 'report', 'draw', 'configureCharacters'].includes(item.method)));
  assert.deepEqual(deleted.awards, before.awards); assert.deepEqual(deleted.timeline, before.timeline); assert.deepEqual(deleted.collection.points, { earned: 1, spent: 1, balance: 0 });
  assert.deepEqual(deleted.collection.draws, before.collection.draws); assert.deepEqual(deleted.collection.owned, before.collection.owned);
  assert.deepEqual(deleted.equipment.badges, []); assert.equal(deleted.equipment.charm, null); assert.deepEqual(deleted.notifications, []);
  assert.ok(deleted.definitions.filter(item => ['earned', 'unfinished'].includes(item.id)).every(item => item.status === 'archived'));
  assert.equal(deleted.definitions.find(item => item.id === 'unfinished').incomplete, true);
  await assert.rejects(f.j.configure({ requestId: 'revive', definitions: [{ id: 'earned', title: '复活旧目标' }] }), code('ARCHIVED'));
  await assert.rejects(f.j.report({ requestId: 'report-deleted', definitionId: 'earned' }), code('ARCHIVED'));
  for (const slot of ['badge', 'charm']) await assert.rejects(f.j.equip({ id: 'earned', slot }), code('ARCHIVED'));
  await f.j.ingest([{ id: 'pending-token', kind: 'tokens', at: 1000, sessionId: 'fixture-session', turnKey: 'fixture-turn', amount: 500 }]);
  assert.equal(f.j.snapshot().awards.length, before.awards.length);
  const revision = f.j.snapshot().revision;
  assert.equal((await f.j.deleteDefinitions(request, { source: 'user' })).revision, revision);
  assert.deepEqual(f.j.snapshot().collection.points, deleted.collection.points);
  await f.reopen(); assert.equal(f.j.snapshot().definitions.find(item => item.id === 'earned').status, 'archived');
  assert.deepEqual(f.j.snapshot().awards, before.awards); assert.equal(f.j.drawReceipt('spent-before-delete').results.length, 10);
});

test('ordinary archive uses deletion semantics and built-in deletion is an atomic rejection', async t => {
  const f = await fixture(t);
  await f.j.configure({ requestId: 'custom', definitions: [definition('by-user'), definition('by-model')] }, { source: 'user' });
  await f.j.report({ requestId: 'report-user', definitionId: 'by-user' });
  await f.j.equip({ id: 'by-user', slot: 'badge' }); await f.j.equip({ id: 'by-user', slot: 'charm' });
  const archived = await f.j.configure({ requestId: 'archive-user', archiveIds: ['by-user'] });
  assert.equal(archived.definitions.find(item => item.id === 'by-user').configuredBy, 'user');
  assert.equal(archived.definitions.find(item => item.id === 'by-user').status, 'archived'); assert.deepEqual(archived.equipment.badges, []); assert.equal(archived.equipment.charm, null);
  const before = f.j.snapshot();
  await assert.rejects(f.j.deleteDefinitions({ requestId: 'mixed-delete', ids: ['by-model', 'first'] }), code('BUILTIN_DEFINITION_IMMUTABLE'));
  await assert.rejects(f.j.configure({ requestId: 'builtin-archive', archiveIds: ['first-read'] }), code('BUILTIN_DEFINITION_IMMUTABLE'));
  assert.deepEqual(f.j.snapshot(), before);
  for (const ids of [[], ['by-model', 'by-model'], ['missing']]) await assert.rejects(f.j.deleteDefinitions({ requestId: `invalid-${ids.length}-${ids[0] ?? 'empty'}`, ids }));
  assert.deepEqual(f.j.snapshot(), before);
});

test('deletion respects trusted model workspace and revision conflicts without discarding deduplication', async t => {
  const f = await fixture(t);
  await f.j.configure({ requestId: 'scoped', definitions: [definition('scoped', undefined, { scope: 'current_workspace' })] }, { source: 'user', workspaceKey: 'workspace-a' });
  const before = f.j.snapshot();
  await assert.rejects(f.j.deleteDefinitions({ requestId: 'wrong-workspace', ids: ['scoped'] }, { source: 'model', workspaceKey: 'workspace-b' }), code('WORKSPACE_MISMATCH'));
  await assert.rejects(f.j.deleteDefinitions({ requestId: 'stale-revision', expectedRevision: 0, ids: ['scoped'] }, { source: 'model', workspaceKey: 'workspace-a' }), code('REVISION_CONFLICT'));
  assert.deepEqual(f.j.snapshot(), before);
  const request = { requestId: 'valid-delete', expectedRevision: before.revision, ids: ['scoped'] };
  const deleted = await f.j.deleteDefinitions(request, { source: 'model', workspaceKey: 'workspace-a' });
  assert.equal((await f.j.deleteDefinitions(request, { source: 'model', workspaceKey: 'workspace-a' })).revision, deleted.revision);
  await assert.rejects(f.j.deleteDefinitions({ ...request, ids: ['first'] }, { source: 'model', workspaceKey: 'workspace-a' }), code('REQUEST_ID_REUSED'));
  await assert.rejects(f.j.configure({ requestId: request.requestId, definitions: [] }, { source: 'model', workspaceKey: 'workspace-a' }), code('REQUEST_ID_REUSED'));
});

test('new draws enforce global theme while exact old payload retries precede that check', async t => {
  const f = await fixture(t); await f.j.ingest([fact('read'), fact('change', 'file_changed')]);
  const before = f.j.snapshot();
  await assert.rejects(f.j.draw({ requestId: 'switch-retry', theme: 'xianxia' }), error => error.code === 'THEME_MISMATCH' && error.status === 409);
  assert.deepEqual(f.j.snapshot(), before); assert.equal(f.calls(), 0);
  await f.j.preferences({ theme: 'xianxia' }); const original = { requestId: 'switch-retry', theme: 'xianxia' }; await f.j.draw(original);
  const calls = f.calls(); await f.j.preferences({ theme: 'cyber' });
  const revision = f.j.snapshot().revision; await f.j.draw(original);
  assert.equal(f.j.snapshot().revision, revision); assert.equal(f.calls(), calls); assert.equal(f.j.drawReceipt(original.requestId).theme, 'xianxia');
  await assert.rejects(f.j.draw({ ...original, theme: 'cyber' }), code('REQUEST_ID_REUSED'));
  await f.j.draw({ requestId: 'default-theme' }); assert.equal(f.j.drawReceipt('default-theme').theme, 'cyber');
  await f.j.preferences({ theme: 'garden' }); await f.j.draw({ requestId: 'default-theme' }); assert.equal(f.j.drawReceipt('default-theme').theme, 'cyber');
  assert.deepEqual(f.j.snapshot().collection.points, { earned: 2, spent: 2, balance: 0 });
  await f.reopen(); await f.j.draw(original); assert.equal(f.j.snapshot().collection.draws.length, 2);
});

test('queued theme changes reject a stale new draw without consuming randomness or points', async t => {
  const f = await fixture(t); await f.j.ingest([fact('read')]);
  const results = await Promise.allSettled([f.j.preferences({ theme: 'ocean' }), f.j.draw({ requestId: 'stale-window', theme: 'explorer' })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.code, 'THEME_MISMATCH'); assert.equal(f.calls(), 0);
  assert.equal(f.j.drawReceipt('stale-window'), null); assert.equal(f.j.snapshot().collection.points.balance, 1);
});

test('debug deletion remains isolated and debug quick draws follow their own global theme', async t => {
  const f = await fixture(t), copies = join(f.directory, 'copies'); await mkdir(copies);
  const debug = createDebugController({ journal: f.j, statePath: f.file, tmpRoot: copies, now: () => 1000 }); t.after(() => debug.dispose());
  const before = await readFile(f.file, 'utf8'), { token } = await debug.start();
  await debug.mutate(token, 'configure', { requestId: 'debug-custom', definitions: [definition('debug-custom')] });
  await debug.mutate(token, 'report', { requestId: 'debug-report', definitionId: 'debug-custom' });
  await debug.mutate(token, 'equip', { id: 'debug-custom', slot: 'badge' });
  await debug.mutate(token, 'deleteDefinitions', { requestId: 'debug-delete', ids: ['debug-custom'] });
  assert.equal(debug.get(token).snapshot().definitions.find(item => item.id === 'debug-custom').status, 'archived'); assert.deepEqual(debug.get(token).snapshot().equipment.badges, []);
  await debug.mutate(token, 'preferences', { theme: 'ocean' });
  await assert.rejects(debug.action(token, { requestId: 'bad-debug-theme', action: 'draw', theme: 'xianxia' }), code('THEME_MISMATCH'));
  const payload = { requestId: 'debug-global', action: 'draw' }; await debug.action(token, payload);
  await debug.mutate(token, 'preferences', { theme: 'garden' }); await debug.action(token, payload);
  assert.equal(debug.get(token).drawReceipt('debug-global').theme, 'ocean'); assert.equal(debug.get(token).snapshot().collection.draws.length, 1);
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('role presentation maps all builtin slots while custom names and stored canonical bytes remain intact', async t => {
  const f = await fixture(t);
  assert.deepEqual(CHARACTER_THEME_NAMES.xianxia, ['练气小修', '练气修士', '练气剑修', '筑基修士', '筑基剑修', '筑基丹师', '结丹真人', '元婴大能']);
  assert.equal(CHARACTER_THEME_NAMES.wuxia[1], '江湖新人'); assert.equal(CHARACTER_THEME_NAMES.steampunk[7], '发明大师');
  for (const theme of THEME_IDS) {
    const cards = f.j.snapshot().collection.characters.filter(item => item.theme === theme);
    assert.deepEqual(cards.map(item => item.name), CHARACTER_THEME_NAMES[theme]); assert.equal(new Set(cards.map(item => item.name)).size, 8);
  }
  const naming = f.j.catalog().collection.themeNaming; assert.equal(naming.style, 'profession_or_rank'); assert.deepEqual(naming.byTheme, CHARACTER_THEME_NAMES);
  naming.byTheme.xianxia[0] = 'caller edit'; assert.equal(f.j.catalog().collection.themeNaming.byTheme.xianxia[0], '练气小修');
  await f.j.preferences({ theme: 'academy' });
  await f.j.configureCharacters({ requestId: 'default-current-theme', characters: [{ id: 'my-custom', name: '自定的猫猫名字', rarity: 'N', icon: 'cat', animation: 'none' }] }, { source: 'user' });
  assert.equal(f.j.snapshot().collection.characters.find(item => item.id === 'my-custom').theme, 'academy');
  await f.j.preferences({ theme: 'cyber' }); await f.j.configureCharacters({ requestId: 'cosmetic-custom', characters: [{ id: 'my-custom', description: '保留其原题材' }] });
  const custom = f.j.snapshot().collection.characters.find(item => item.id === 'my-custom'); assert.equal(custom.theme, 'academy'); assert.equal(custom.name, '自定的猫猫名字');
  const bytes = await readFile(f.file, 'utf8'), raw = JSON.parse(bytes);
  assert.equal(raw.collection.characters.find(item => item.id === 'builtin:xianxia:1').name, '青苔童子');
  assert.equal(f.j.snapshot().collection.characters.find(item => item.id === 'builtin:xianxia:1').name, '练气小修');
  await f.reopen(); assert.equal(await readFile(f.file, 'utf8'), bytes);
});

// Complete synthetic schema-2 producer output from frozen source 7ea896f,
// including an owned/equipped legacy card, receipts, a custom name, and an old
// archived builtin. It must remain readable without a migration write.
const LEGACY_V2_GZIP = 'H4sIAAAAAAAAE+1dW1PbypZ+n19B+ZlTI8myJfM2M1VTcx7OedipmpdTu3bJUgtcMTbHNjsnk0oVkADmanMLBkyAcN0k2JAEbDA2P+a4dXmavzDTEsYtq218kWBXZe+nHWCtJX3d/a3Va61uvfHExSEwLPw3iMVD0YhngOn3xMCvIfMfXL9HjAEhAaR/S3gGaIqi+j2jI5L1ByMxIIMYiIgg7hl440kMgWHgGfD8IyRE/hESPP2eSDQRkkOikAhFI3HPgEcIhz3IijQqAukv0YRhyhN/HU+AYU+/R44Jw+BF4nUYaYknhIgkxKTaz/8LhAaHEp4BP/u23yNGRyMJw6gcCoNfYkCQPAN0v/kvcUiIDAL0g7f9njiw/d0bDxdggBygZF7wsqwk+1kKCDTgvV6ZY4MBhpc5Ach0UGB4n8SIjOhlWMALkl8EgJMDlM8zkIiNgreN9t54KIH3+QUfywkBvw8Egn7aF/AyIsv7/QGKlRkAvCwf8DGAob2UGGB8FDJA0UCmRFGWmHvFSLMgmg/u8/IMYAVK4kRG4GSRDQIfzYmiLEpskBNZr4zexe/lApKXlRka0P5gkAMUxzCsXw5SngGP18dLXkYKcrTIM0zQyweEAMOLHGA5nvN5RZniZNbLB/1eKcgCGkiiwAQoVpK5oBDw+WVPv4dneIoRWToY9AHKK1JeVqB5OsD7WUaSOYpn/QzF+AM+AHhAy7wAfMDPBihepAQ/4wWCZ8DDMJKXAzRNU3KAp4DI8jzNUIDx+QWGE3gg0JRPZlhOkkW/yLAcLwVAQJYZNBxc0BvwvO33jICIFIoMegbevEXz6O+jIG6iRPM8HxQ5DgiBoI8PSjQf8IIA5+f4IMN7AzInMV7J66P9LANoTuZ5v5/yikGKC8qyKEpBpGMYJIaikmfAI8WEV2jahSKDIDYSC0USngEPT0k+P+2j0UjRvFdkeVqk/azfJwV5Tg74aG+AkWmOEb0i7QMsx9Csl2YpigtKPCv5BPT4VFDyByk+EAxK6De8n6EEhpZZmWHpQIBiAetjeDkQ8PuoAO8LcBInAI4J+OggzTIS5bU8pRiNyKHB0Rj4jyEhJogJEIvbHlrkeYZj/XyA8vECxUuMIItoknOsDHxBlhVlv+hjZUoOUAxDsz4pQAe8lEyznCxzQb/XeGhOBrLPx7OyLPhkEKQEKhigRQlQvMCxos/rD7BBHgjA52fogJ/jfALgKUnmgE8Q6ECQ/NC2Rw16A36JEjmOF8WgzEpBlgWSIPlEL+0FQVEMslRACgpAEgTGR/m9PEdzPprhGZahvIwXeNCqkYAcioTu6eZvbzwhZFMOxeIJT78nEUoYzAKT28qXPZjOqydzHiQTF2OhkXsygrl5JZlWv3ypFse0ck7JzsDcR31jUjnZgx/nlLND/fRA3XwPC4fVchZufYTppKffExINYTksDHr6PaKQAIPR2Ov/n0rV200tvw0Xp0xb8ehoTETPEBwNhROhCPrjGiLSv7+2/CI2ip72jScBhkfCQgLU3uSXOADo98MgEQuJngFPYjQW+UWMDo+EQQIgvkwIsUGQuOc/MToCHqg3KMRBOBRBP4gBMRqTgPTLUCieQA9b/y1ieKrfMxSSJBDxDMhCOA5w50C34xziCSExapC+mAj9isb7VyE8CgzNL8HruLmGRyMvI9FXEfMfciz6PyDy50jtXR5MG57FWOfgHyPhaAzEDGDcGs+3/Q8+zGoGTh5WSxv62KpTZsTXQeu76EcflC97yuIhnDx0ysirUeKbKBc7yvUHp4zIQiQhxF/bzajHGfjpnVNm4iOCCOyAwekbpZh3ykhUBELEPsOUmS+wOOWUkUEhZqyuuhVl+axanIPJbW227JQVQRQkMPyagNjkoZavODYsCSAMj4xGXtoNqRPX6vhnZwy9fdt/z+lDoxEpZpLdvTV1o6KVczA9r+3N26yp3/Nabs+02UdTVB/6UyKFi0NCwk0KNyLX9tibon4M/u5t5MhkrW5U1IlbfT2nj690pdPGzOpGBXFAak+ZsXuZdjTaaBg949opmlglOz+2o5HAueZTwqllfeO3rnTaCBaNTvJUy53D8lpXGm1sip6xnFO3itXb711ptFMnUrl+qI2taflSVyoJPIlePF/pYVoSSdEcoOrtLpw96UJrnQGHQ+EwkrIwYLU4rV0WtORpM9WFr+ZI9tF/6UtEXxqBZI35osMjQjzeQH7lO3X1RD3Oq9/zbpAfeoS4lfTQfz8M8XUxYE2jU/X0UB2/VLI3HekiER16qvczcOprR5rscebCO3hxgYKnq5mONBGITcnsqOOf0VtONyVLoi4boSmZHXieQZqO7RFjK002IlMuJ5XrCqzk4GRn70eI/TZO9OxXFPuNb3akikBc8NOJOnHdxQuSo7iVLLxY6lhbnagSIGLnKrjwDk2y5Kl2d/24VspGVvGEEPtdMNUPQlVdjleT4Gz8UrksIF5IpjtTZiMr87n0lYpWaGN2Uq3YCumZRs6+WtntTBUpDjvO6CtXyGuvLHSmzL7DXblSvn7rBnobYWl3WcXwNh2rIoRc1+MwdaUk09qCfXfXUheBshD2e5fV6yN1vWmQ2QQuEmdpy0XloqyVTzp8zzppySE58dpOW9WbVXPGwWQJ3hw9qttnZ67fRZjl+6HIq/tRI/MXYsKLPVhehpOPxyK+lvylFC7gxYR291FZtOf7Wqqy89fNqnL9QV3bgOnHKcf3GH9VDpTMjr5yBpNNN1RkZfZ4q3Ch/nbTDfT2gKtwoa1sI1UL552psvMX3NqCZ/vw+rtWznWmixRynR0plwWEfacPRuQv5byoZG47hwznr1g88Sej3oltEO9K8HasWhzT9y5tau/TgkYSTsuXYOpDtThWLZWVD9PV0lWdv4LR6EsreSmLn9Tvn2BqSV08d6vGUS/f/t7LG7Tju8QeRq3JXvF2DC4UlOwMyT0+rtFGYuafaZcFdaIbffZ9o/F8Wn6KFNQ9ro9UikgdwAUUccJ0NxptnKYlC+rpunY8oVzak4GP67MTWzmnXKS1fEnJfulCHyE6MyaNNnuhnV90oZBEcbVJA/ftFNcGhMRkmPmUK9twy16KeEynsbzCUfFlfVk20J/ZmIEToFFuUL7saemy+sVexTNNascTML8Dk+dwcUdd3THtwalJmLtWN9+r2R2Y+6isXsNUBo/qJGBlRW1vHs6eqDen8O7SVVastZ+4T4xMZ8QYE4dCvxoP5ho1Oj2eZL40tRvlKrs77saGfRs7tYFKpetrzRm5Mwukmq+WX9NX57TZZUcskIJGYzj08RX1y5HyYdoRM6SCb7V4Wr3LablPjlggVXvVUgZlKJqyUmcWCPRsIrXyVflwDrM7jlghcfZ93fpa+WYvNnQ1Gs3qvB839ZUpfdmeBu3cSktej8aGhUQcTyQebKrHC/r2J3hG6spAzkPPIP/R5+1TL0rV4gKq6OTPtJMxJfnBfBBl9xbeprDk4ogQczXGlULxRCgiWvbo5qs1xrje32WM63x60blRbBLyLmxqx0ktX4QLhd4N2Pn7YFPZTSq3n5VisXf1pEoxzF1px+P6un033rF6Unx8OwF3duBWRZ+xl2Q7NmDjbHiwqZ1fKDOflVSqd/V2wj7YRGlNh+AhVpdRJO2QfhJPo+m/5JQBIkmjISh/d8ZEY5oh/jJkUJM1rFdm5uCUvXJ+3+GWTMPZHTi7q5XLyBOunyizY9q78nPnGYxX+SUcFaQfsZOyl4FrWpbW8mvV0oaSbbbxbqXRni892YPb6+rEdfXGnrV7XJ+NWZW5rJYvqccZ9cKeNH1cH6lQ/W0NThbVu1LzdE0rjXbuzN9qydOux8ReA0qeKpeFrvWREqln2sxN1wpJdDi2o2cmu9ZITqlmb+D8bpc664Rn8AMefyofrpVva8rqlbaegrkrm2pcaZ+3T18/Mam1ke7CQJCfOuRsQnY/SMzZ48g1SRXkiwYBHJLizMc12vnO+JW+NUUqlT+uz8Z3Wr6ozdyg59ua7UIfge/MNzZh7EIjIbV6oZXL6s6hlrf3Wj+uj9Ckg/bxXT+fne/MF9Ymvmpz610oJPCdli+qx0uo+n1mTzi0ASEx3tuqqDfFLl+7zncSCINBxCDYjjt1VC2OwdS8mr19dLt/lu4TBkEk0adNn6rvr8zWRrPlG6bWlZmM2d7Ycu8NF1LVclYtpeDilFtxX+09f+hzNG4MbLOwcEq7+axkZ5qHhV2ZsvFntbSvpqdgeVnPPJ5l68CQPb+ankeJz60inLU3XvdgiLRZT89Xb78r24fVuz0nTdlDz4WUljxFTUxNSz5dGbJv4I0ma2X7kHS+pgdDxGC1WjxzfphIUWx6Xj1dd94Ume4NjtTLd6Ruhq6N1f3ASAzEQQQ/RflQFCFFOg0WzfRB9eagWsrA2ZNqOfu/t/PV4kK1tK/tnairJ0qyoJ/OK6st+wxM+SeoqN2/7I/oA1wa1Ufqao4bsydok1dwZRyej2v7k86asqcUjPeBS8nq9aPVws5MkXyBcdIHlpeVvX1njRH75rcqprizpkg5CgTh5CHpUGdPpgjh/OyF+uUGDVrTxECXtoiRfkX/lHFluJpsAuBCwfkhq/uFBw7BHEMhr65emNkLbcy+2sxks9nx2sf0oWKusfnoG4lFfw1JIPavw1EJhPtMPc9clYtFRxPgl9G4xRcwP4gvcHYgmyZMtEIepiaUCXuA3rkFUmVOK+TRgfrZLQf029geZQm/V5Ri0dyc9qqf1FWxNq+vn8B8ScvdOWCBWJwrn8DCHukUWuf6SWSu3tyZ08gB/UQGh5X3LYuvnRggt/eqx0vODQGxFy63p97coWFwwEadoFE/wZ8SQyBi74aDk0nUVze1QDqKKkbDYSAmorE+1GmcH1cyi/d/n/rwz7FxmF40+zXQZrQ41tgkbG+HM9M3sPybtuXAKfoYEEMjwELUtZ88BOz9tZ+ZIPyCQLhvlvM4Q+DorqbfMX87P75NjnPtHKJmx3SyWhxzzA6xyXhqQ18/UxftMWG3Vuz58fM5mNuE6UUnMSNmzUuom/ZDWflmP/DUrR17yG50XMD0YvUuBw/sBc5uDdk5/nhCKeeadGF2a4WUep+CqSs4tVC9yykftx2zRIzUS+jPya1zXQ8QkfizcyhOn1rQ9if1SacGqaFk2cQFoIL/QgEufCPdcQDT8+a1A2ahwCwOoKVhXtRiGDXNmTsFLf++WiqYf6YsziupvVblzWd1CGbl84fzCG4PN9k/KNk8TC82IQdnrDapm2rpMszaU9fO2LSXAM6OqqVDbfq7umqnDGdskjJAZ0ewsgxzH7WCvd/EGasEv4LaKFDSYObYvalkLxNUUFpIWZzXkm69KqFiUDlFvYu7ZfXYzs3OGCUdiL7eRWumcOkevOSMUeUUjeztGCwQ7p9zwK69tGy6JnuBwbCz1SQ7THCK5o4IK27crRpPu4jyQ7We84dcWNMbG5/VLz2UoQ3XVMPkh/BNbg53kyK0uxbtPuliWrkcb5KN7d2evWu8clCt7KK3dOX9SL7oPKVndtTSijsWCb1C53pmB+E6a2er3u0RUlnXemYHlpdJqbLe7RGcz+QFajSavXAHUFKq6zyllt5Xbw5cGsImvZnu2Xz79ud+j/BKiEnYlcDGvwcsh+TrVwf/2XaAvv67n3D6FB5ossbCGHHW/IYwmogOC4mQ+OQH8f84Vv7HsfI/jpV3cazc0VspHuJdnHMeEjFE1iH81iHeeb7z738c5P7jIPcfB7l/tIPcTt9kgWK5RGj4fvNbi+ZqPxkghHUvQxH0J+aJcg/Onc4EY63CRuNx/twk3iQSNR7a1S/QJL3eg49o4wWdZ/3Wbov83g+/bvXmhh9Bowz+PhoaGUbZj4E3nqAgDSLn8Tcc35/70WXtsWHPQGQ0HDb/YXwGpZ6TGbj3AQO0QdbmTsJ46TeekWjo/hNCQIhF0Od7GERShkUaJVHCQgQ9JZqCYv0LKw+Trmai5s4GaPTBI8H4ApKyn4OV99W7vWrZXstXtg+16VMzVlfWJ/WxVXXzPS5hJM8Wq+Vd1JJ7WTDPcJgDYCan/jk2UfOo1hasmBALJZDz/aut8iJEQsPC/RPI4ahxyT0ht9VReuhhhtqwYOpYqLsT8Otv6moJFpPtYYFLOIvF/ZYJxyISjQBXofDWoajeLGnnBe3dPJyfhASnR0SjQchZQOqXUT7t/GDroMB8ScnsmHseuGRPjBFBaRByAJSfbHcL44hEY8GQu4j4MPb4OA4nZ/RPU6gNtl1EGoScReQ+S44jMjIajru7cPwYIuvHqPX4LqftHcJ5++28ZESsQs4iQmCSWn+qe4hw2Kq5uEAXTpYyKP/QLrE2CDmAyAsMkmEgCeEnXzd8HRO9tKhkFrW7rLY3T+pXJWLSIOQEJjgoZIJ1barU4506KtvL2tyq+vkQnhFOEBuQVO9y6IaGB0gwiQ7xqH/68blDkRoSeCQyfql8m9Gnp7WFfPXG/pUEIhgNQs7iEUW1tSfi1RogWDyibFfUdzvqF9RA0B4auISjUDxhZFYDAo9B0l/0rRM4s1S9s5+eIwKBS/QOBB58vIoa3zx90kWCBR/qRlmtlKvF6+ZepXGFYBKOQhGNBZ/KndSAwGIOfSytZJPq+KU61y5vYhKOAiFH//HULIGFGtriV5g6h5U9fX+x+a6lAYsGod7hwJ0qiTddnxpYoFG93taz79F5uLT9TAkRDlzCASxwMKSYMGh8o+BJAgwj4Y2HF7BQUMfzsGAcXmi6WdEut+DCppKdg5NzdQ61inaIi5l6b7atNaoRT7JiTESwMAOerWuzE8ZB8/GO4MDkHMSCEHS5PDuwCMO8O6BlIoyMBSbn5LwwP+74JL7VxAILMvTsirZxreWX1N3x5s6VCEeDaK+I/NRypbjGpCYiWKyhr1ypd7cwl4QH2eYBORkRq6iDiMSiwWjjJHGZPPx4JJpE5cn5z9XKkbLYzNmS14xV1MlJ8tSrBos+9OkUPEubmb7mm3ryHLGK9grIi+cJTU1EbGkOdDdLLlct2i/zbIWIVbRnRF48sm5cczRGVRwPQ9TP12r+QlvIq5/tnYD3iZ+zo2plt75twSQ6BMKsyT9/jsNEAQs9lOIeTO1r+e/V66PmhNoARIOQg1g84abehMJrTXvtfdbXPrQotFhxwCUcBOEpc+cmCo2JjVM4s9Q2CrhEryg8V1rDhAGvqFyO69mPavp7i1R5w6LAJByE4UkzfiYMeHBRXta3xpVikfSFQ/JswCQchEEGQmIIPFmRzQQCT2kUU0o2CZNj+maz3E4DELhEr0BYiiZR297dZRh4vKy2i76Em1tvf1lgEj3D8OIRfnAterjveMPjB21uFS7uVCsp+L5ZKhweTsPrUn1GYBIdQlHruCM7jEFgKz+75TVrQOBFkndbcHLGPFTYHhC4hKNAhIVIAsQal4drdFkDAw8iVt7p13fKh0M4ttEeGLiEs2A8YVxZQ4K1bNXRyftKQf86Xr0lXB1MBsMi1DseP7XEwzXirOGBRxTG58j10yW4b//6LREMXMJRJJ6FOvHmjGwSVUjPVmH+trkjaUTDKuQoIPbNueucgcUW6nEGfnqnVzbQxzOaJiwaOdQq1DscL1r3qri+VPAoY+NE2TqCuaR2uqJX2uTRBiEHAHm+monR+W4JNsxjPsbnW1s0eGV20Knqh3jDKtQhImb3/bNv000osHBD3zhRd77p09PKbqFtKBqEHITCTh2uOVkTCizY0Mon+vhK9S6HLqwmnL4nzwqrkINQEMJQ12jUxILFw/EFdHzL+PQJzLW7QqxCvWLxaBeXayRqwoFHG8YntKt3ezDVqtvPCkeDkJNw2MtoLk8NvyXygucZ5XIO9TG2yxgNQg5iQWgWdpkysFhDmc3AyRmt8E67G2/R8diAhVWoVywsu/ih0MjTLhIszjA/WQ9v17TkadtgNAj1DMYjaLgWYxhn3yxHUIyjv8pcRfu+3aIUcFlQvtfrQw1CHaJhnr8je5P4EAg3Nge7tk5MMPCkRmpWXdpsfR7HigQu4SAMT8mcJgpYgKEejMPyhVJ+pD+6AQirkJNYEJ2qW5GniQZr3bZeVx49ZdGwQKxCvaLRmixcXh9402dqQU3twlxSyW61PzOsQg5i8YQbeBMKPLy4LOhbFeWs/RWCSzg6IeyM6ZozNWHAKyQr20pxFp2VOM60iDitSDQI9QrGsx0uMdHAGz6L00o5h7pZvxbbnhcNQj2j8XwJDPPYuyW62DjRs1+VgwVtbr1F1+fsBdw6w3M6uFCHgNyfvX/+7Pg9Goyl1wCmrvSJHCw0Oz7QAAUu4SQOhPjCLYd6DwPe7HmegpX3WmZJS003P6XXgESDkJNgyOHoK1uR2TVPco+HNcKAZ/va+Tv9aKNFw2fDIrEK9YzHT4/g4fYywaIMbe0EhZKzB8rH9RbtnlY8GoScxINAGm7PDizQ0LITKNk/e9H2UsElnMSh5jeexLfeA4EnMS7HtfSBPrarbOTbXyZWoZ7hsBwvIdad3UYECzfg1hY821f2c+q4/UYSMotiEr1j8eIx0nAt0ri/+sZywOTTiVopK7PvYXlNXbXfsHNfPjo70jewk85WoQ4hqV3A08StEJuXXOPRGiR4vLG8oxzewrFbZf2wbUgahByF5AlbVmpwWLo0rvS9S3TW//qoeTDaCIdVyFE4CAU11xxLDQ/W2puQW1d3V9XfrtrGo0Godzye6UKNGh54duPdFkyda5XftNwN8UPfJDwahBzF44kbm2qQ+PFcOboJCi4vo7at5j0bDZBYhRyF5JlIlbPs8dG1GIU9PTPZom/DCkmDUO+QWA6ZvHqyjEcND7yc8tu1vnelfT9oGwxcwgEkHmlhca9do3Y1nuV8yeSBOp7Xzt9p+RYtG9pyUbkoNxy6aRDttMT0cFHf76JJsg4OHo+sZOH+N62wpE3eKdmmGzsSOA2iDoNDOpPkXnX2ARpLbIIuU0Rfn92qNA/VmkBjEXUYmqds+nkABm8oLaGx1/c/ajPT+lrTw8FEYKyiTgDzTIWYOjL4qVjjI9768k6LxAARFkzOYUwI8b17df0HTPBkifHC5qa3RY6ABEuDqMPIPG2OsY4NfkJ2bErfX1SyN8qn8w6xaRB1ApsXzz5t8NbT86KSuYWzJ3B2C9696wSaBlFHoGl9gtjxgAZ9SkZ8/SdxNJ6IDmNrafoU5jbR7XjpBXi2bgPl4T1het5sN62nVRZ3YHJLO17WZr72Vsm0Uepo3Dxb3NGb/tzvib4y7m5tvJUVvwhNjI6iS10D/ebtsU2nEH73zb0M3Sjzcz+qvb0y74GNgb+PgnjCuOmW5nk+KHIcEAJBHx+UaD7gBQHOz/FBhvcGZE5ivJLXR/tZBtCczPN+P+UVgxQXlGVRlILEG1/wi97jo+EE4fpZ/EWtfj7+V/DK/OpPy2viSELGB3v+kPrdSXF2psVGGV2IHI2jKfP2Z/RRprgwCO6/z4T+9y+heDwUGbz/SBOa1f8piIn64goL1p+8/Zf/A+qU60ojwgAA';
const LEGACY_V2_SHA = '75f36d8ff452ee094628d9b67d1fd015702c3f18279b652936dccb22e5654351';
test('the real prior rc.2 schema-2 shape loads byte-for-byte while builtin presentation changes only in memory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'achievement-old-v2-')), file = join(directory, 'journal.json'); let journal;
  t.after(async () => { await journal?.close(); await rm(directory, { recursive: true, force: true }); });
  const bytes = gunzipSync(Buffer.from(LEGACY_V2_GZIP, 'base64')), raw = JSON.parse(bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), LEGACY_V2_SHA); await writeFile(file, bytes);
  journal = await createJournal({ file, randomInt: () => assert.fail('reopening/replaying cannot roll again') });
  const snapshot = journal.snapshot(); assert.equal(snapshot.storage.schemaVersion, 2);
  assert.deepEqual(snapshot.collection.owned, raw.collection.owned); assert.deepEqual(snapshot.collection.draws, raw.collection.draws); assert.deepEqual(snapshot.collection.points, raw.collection.points); assert.deepEqual(snapshot.awards, raw.awards); assert.deepEqual(snapshot.equipment, raw.equipment);
  assert.equal(snapshot.collection.characters.find(item => item.id === 'builtin:xianxia:1').name, '练气小修');
  assert.equal(raw.collection.characters.find(item => item.id === 'builtin:xianxia:1').name, '青苔童子');
  assert.equal(snapshot.collection.characters.find(item => item.id === 'legacy-custom').name, '自定旧名字');
  assert.equal(snapshot.definitions.find(item => item.id === 'first-change').status, 'archived');
  await journal.draw({ requestId: 'legacy-v2-draw', theme: 'xianxia' });
  await journal.configure({ requestId: 'legacy-builtin-archive', archiveIds: ['first-change'] });
  assert.equal(await readFile(file, 'utf8'), bytes.toString()); await journal.close(); assert.equal(await readFile(file, 'utf8'), bytes.toString());
});
