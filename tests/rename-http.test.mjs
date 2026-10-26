import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';

const target = process.env.JOURNAL_ARTIFACT ? new URL(`file://${process.env.JOURNAL_ARTIFACT}/lib/index.mjs`) : new URL('../src/index.mjs', import.meta.url);
const { createAchievementJournal } = await import(target);

test('display renaming requires the owner browser, retains real progress and remains isolated in debug copies', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'achievement-rename-http-')), file = join(dir, 'journal.json'); let handler;
  const ctx = { sessions: {}, logger: { warn() {} }, on: () => () => {},
    webServer: { register(route) { handler = route.handler; return () => {}; } },
    connection: { browserPeer: { id: 'browser' }, admit(req) { return req.headers['x-fixture-peer'] ? { peer: { id: req.headers['x-fixture-peer'] } } : { rejection: 401 }; } },
  };
  const service = await createAchievementJournal(ctx, { statePath: file, collect: false, registerTools: false });
  const server = createServer((req, res) => void handler(req, res)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await service.dispose(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/dsh-achievement-helper/api`;
  const request = (path, body, scope, headers = {}) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-fixture-peer': 'browser', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(scope ? { 'x-daj-debug': scope } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  await service.journal.ingest([{ id: 'rename-real-turn', kind: 'turn_completed', at: Date.now(), sessionId: 'rename-session', turnKey: 'turn-1' }]);
  await service.mutate('configure', { requestId: 'rename-notice-definition', definitions: [{ title: '队列中的纪念', rule: { template: 'model_report' } }] });
  const noticeDefinition = service.snapshot().definitions.find(d => d.title === '队列中的纪念');
  await service.mutate('report', { requestId: 'rename-notice-award', definitionId: noticeDefinition.id });
  const before = service.snapshot(), achievement = before.definitions.find(d => d.id === noticeDefinition.id), character = before.collection.characters.find(c => c.theme === before.preferences.theme);
  assert.ok(achievement);
  const input = { requestId: 'rename-owned-achievement', expectedRevision: before.revision, kind: 'achievement', id: achievement.id, name: '我的第一步' };
  const originalBytes = await readFile(file);
  assert.equal((await fetch(base + '/rename', { method: 'POST' })).status, 401);
  assert.equal((await request('/rename', input, undefined, { 'x-fixture-peer': 'model' })).status, 403);
  assert.equal((await request('/rename', input, undefined, { origin: 'https://other.invalid' })).status, 403);
  assert.equal((await request('/rename', input, undefined, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.deepEqual(await readFile(file), originalBytes);
  const response = await request('/rename', input); assert.equal(response.status, 200); const renamed = await response.json();
  assert.equal(renamed.definitions.find(d => d.id === achievement.id).customName, input.name);
  assert.equal(renamed.awards.find(a => a.definitionId === achievement.id).customName, input.name);
  assert.equal(renamed.notifications.find(n => n.definitionId === achievement.id).customName, input.name, 'Queued notices resolve the current display name');
  assert.deepEqual(renamed.collection.points, before.collection.points);
  assert.deepEqual(renamed.collection.owned, before.collection.owned);
  assert.equal(renamed.definitions.find(d => d.id === achievement.id).progress, achievement.progress);
  const raw = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(raw.definitions.find(d => d.id === achievement.id).title, achievement.title);
  assert.deepEqual(raw.awards, JSON.parse(originalBytes).awards, 'Renaming cannot rewrite original earned snapshots');
  const retry = await request('/rename', input); assert.equal(retry.status, 200); assert.equal((await retry.json()).revision, renamed.revision);
  assert.equal((await request('/rename', { ...input, name: '同一请求的新名字' })).status, 409);
  const start = await (await request('/debug/start', {})).json(), realBytes = await readFile(file);
  const debugInput = { requestId: 'rename-only-debug-character', expectedRevision: start.snapshot.revision, kind: 'character', id: character.id, name: '调试专属角色' };
  const debugResponse = await request('/rename', debugInput, start.token); assert.equal(debugResponse.status, 200);
  const debugState = await debugResponse.json();
  assert.equal(debugState.collection.characters.find(c => c.id === character.id).name, debugInput.name);
  assert.deepEqual(await readFile(file), realBytes);
  const reset = await (await request('/debug/reset', {}, start.token)).json();
  assert.equal(reset.snapshot.collection.characters.find(c => c.id === character.id).name, character.name);
  const expired = await request('/rename', { ...debugInput, requestId: 'expired-debug-rename' }, start.token);
  assert.equal(expired.status, 409); assert.equal((await expired.json()).code, 'DEBUG_SCOPE_EXPIRED');
  assert.deepEqual(await readFile(file), realBytes);
  assert.equal((await request('/debug/exit', {}, reset.token)).status, 200);
  const restored = await request('/rename', { requestId: 'restore-real-achievement-name', expectedRevision: renamed.revision, kind: 'achievement', id: achievement.id, name: null });
  assert.equal(restored.status, 200); const restoredState = await restored.json();
  assert.equal(restoredState.definitions.find(d => d.id === achievement.id).customName, undefined);
  assert.equal(restoredState.notifications.find(n => n.definitionId === achievement.id).customName, undefined, 'Reset removes a stale override from queued notices');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).awards, raw.awards);
});
