import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
const source = process.env.JOURNAL_ARTIFACT ? new URL(`file://${process.env.JOURNAL_ARTIFACT}/lib/index.mjs`) : new URL('../src/index.mjs', import.meta.url);
const { createAchievementJournal } = await import(source);

test('HTTP admission, input limits, preferences, conflict and immutable report provenance', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'achievement-http-')); let handler;
  const ctx = { sessions: {}, logger: { warn() {} }, on: () => () => {},
    webServer: { register(route) { handler = route.handler; return () => {}; } },
    connection: { browserPeer: { id: 'browser' }, admit(req) {
      if (!req.headers['x-fixture-peer']) return { rejection: 401 };
      return { peer: { id: req.headers['x-fixture-peer'] } };
    } },
  };
  const service = await createAchievementJournal(ctx, { statePath: join(dir, 'state.json'), collect: false, registerTools: false });
  const server = createServer((req, res) => { void handler(req, res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await service.dispose(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/dsh-achievement-journal/api`;
  const request = (path, value, extra = {}) => fetch(base + path, { method: value === undefined ? 'GET' : 'POST',
    headers: { 'x-fixture-peer': 'browser', ...(value === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  assert.equal((await fetch(base + '/state')).status, 401);
  assert.equal((await request('/state', undefined, { 'x-fixture-peer': 'model' })).status, 403);
  assert.equal((await request('/preferences', { theme: 'cyber' }, { origin: 'https://other.invalid' })).status, 403);
  assert.equal((await request('/preferences', { theme: 'cyber' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await request('/preferences', { theme: 'cyber' }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await request('/configure', { payload: 'x'.repeat(70000) })).status, 413);
  const initial = await (await request('/state')).json();
  const changed = await (await request('/preferences', { theme: 'cyber', notifications: 'unlocks', reducedMotion: 'reduce' })).json();
  assert.equal(changed.preferences.theme, 'cyber'); assert.equal(changed.preferences.notifications, 'unlocks');
  assert.equal(changed.awards.length, initial.awards.length);
  const stale = await request('/configure', { requestId: 'stale', expectedRevision: initial.revision, definitions: [] });
  assert.equal(stale.status, 409);
  const configured = await request('/configure', { requestId: 'declaration', definitions: [{ title: '纪念一下', rule: { template: 'model_report' } }] });
  assert.equal(configured.status, 200);
  const state = await configured.json(); const def = state.definitions.find(d => d.title === '纪念一下'); assert.ok(def);
  const report = await request('/report', { requestId: 'manual-declaration', definitionId: def.id, note: 'SECRET_BODY_CANARY_DO_NOT_STORE' });
  assert.equal(report.status, 200);
  const reported = await report.json(); assert.equal(reported.awards.find(a => a.definitionId === def.id).source, 'user_record');
  const builtin = reported.definitions.find(d => d.source === 'builtin' && d.rule.template !== 'model_report');
  assert.notEqual((await request('/report', { requestId: 'forge', definitionId: builtin.id })).status, 200);
  const stored = await readFile(join(dir, 'state.json'), 'utf8'); assert.ok(!stored.includes('SECRET_BODY_CANARY'));
  assert.equal((await request('/missing')).status, 404);
});

test('host retains corrupt archives, refuses live writers and recovers only a proven dead lock', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'achievement-recovery-'));
  const ctx = { sessions: {}, logger: { warn() {} }, on: () => () => {} };
  const services = [];
  t.after(async () => { for (const service of services.reverse()) await service.dispose(); await rm(dir, { recursive: true, force: true }); });
  const options = { statePath: join(dir, 'state.json'), collect: false, registerHttp: false, registerTools: false };
  const one = await createAchievementJournal(ctx, options); services.push(one);
  const bytes = await readFile(options.statePath, 'utf8');
  const two = await createAchievementJournal(ctx, options); services.push(two);
  assert.equal(two.snapshot().storage.status, 'unavailable');
  await assert.rejects(two.mutate('preferences', { theme: 'cyber' }), { status: 503 });
  assert.equal(await readFile(options.statePath, 'utf8'), bytes);
  await one.dispose();
  await (await import('node:fs/promises')).writeFile(options.statePath, '{corrupt-data');
  const corrupt = await createAchievementJournal(ctx, options); services.push(corrupt);
  assert.equal(corrupt.snapshot().storage.status, 'unavailable'); assert.equal(await readFile(options.statePath, 'utf8'), '{corrupt-data');
  await assert.rejects(corrupt.mutate('deleteDefinitions', { requestId: 'delete-from-unavailable', ids: ['custom'] }), { status: 503, code: 'JOURNAL_STORAGE' });
  await assert.rejects(corrupt.mutate('rename', { requestId: 'rename-from-unavailable', kind: 'achievement', id: 'first', name: '不可写' }), { status: 503, code: 'JOURNAL_STORAGE' });
  await (await import('node:fs/promises')).writeFile(options.statePath, bytes);
  const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']); assert.equal(exited.status, 0);
  await (await import('node:fs/promises')).writeFile(options.statePath + '.lock', JSON.stringify({ pid: exited.pid, token: 'known-dead-test', at: 0 }));
  const recovered = await createAchievementJournal(ctx, options); services.push(recovered);
  assert.notEqual(recovered.snapshot().storage.status, 'unavailable'); assert.equal(recovered.snapshot().definitions.length, 16);
  const damagedIdentity = join(dir, 'damaged-identity'); await mkdir(damagedIdentity);
  await writeFile(join(damagedIdentity, 'identity-v1'), '');
  await writeFile(join(damagedIdentity, 'state.json'), bytes);
  const bad = await createAchievementJournal(ctx, { ...options, statePath: join(damagedIdentity, 'state.json') }); services.push(bad);
  assert.equal(bad.snapshot().storage.status, 'unavailable'); assert.equal(bad.snapshot().coverage.complete, false);
  assert.equal(await readFile(join(damagedIdentity, 'identity-v1'), 'utf8'), '');
  assert.equal(await readFile(join(damagedIdentity, 'state.json'), 'utf8'), bytes);
});
