import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
const base = process.env.JOURNAL_ARTIFACT ? new URL(`file://${process.env.JOURNAL_ARTIFACT}/`) : new URL('../', import.meta.url);
const { createAchievementJournal, name } = await import(new URL(process.env.JOURNAL_ARTIFACT ? 'lib/index.mjs' : 'src/index.mjs', base));
const current = '/dsh-achievement-helper/api', legacy = '/dsh-achievement-journal/api';

test('the renamed package retains the Cordis identity and declares an installable bundle', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', base), 'utf8'));
  assert.equal(manifest.name, 'dsh-achievement-helper');
  assert.equal(manifest.repository.url, 'git+https://github.com/ghang/dsh-achievement-helper.git');
  assert.equal(name, 'achievement-journal');
  const patch = await readFile(new URL(manifest.dsh.bundle.patch, base), 'utf8');
  assert.match(patch, /id: achievement-journal\s+name: dsh-achievement-helper/);
});

test('old API requests and new routes share authentication, receipts, data and image bytes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'helper-rename-')), file = join(dir, 'journal.json'), routes = [];
  const ctx = { sessions: {}, logger: { warn() {} }, on: () => () => {},
    webServer: { register(route) { routes.push(route); return () => {}; } },
    connection: { browserPeer: { id: 'browser' }, admit(req) { return req.headers['x-fixture-peer'] ? { peer: { id: req.headers['x-fixture-peer'] } } : { rejection: 401 }; } },
  };
  const service = await createAchievementJournal(ctx, { statePath: file, collect: false, registerTools: false });
  assert.deepEqual(routes.map(r => r.path), [current, legacy]);
  const server = createServer((req, res) => { const route = routes.find(r => req.url === r.path || req.url.startsWith(r.path + '/') || req.url.startsWith(r.path + '?')); if (route) void route.handler(req, res); else { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await service.dispose(); await rm(dir, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (prefix, path, body, headers = {}) => fetch(origin + prefix + path, { headers: { 'x-fixture-peer': 'browser', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const before = service.snapshot(), bytes = await readFile(file);
  assert.equal((await fetch(origin + legacy + '/state')).status, 401);
  assert.equal((await call(legacy, '/state', undefined, { 'x-fixture-peer': 'model' })).status, 403);
  assert.deepEqual(await (await call(legacy, '/state')).json(), await (await call(current, '/state')).json());
  assert.deepEqual(await readFile(file), bytes);
  const input = { requestId: 'rename-through-old-route', expectedRevision: before.revision, kind: 'achievement', id: before.definitions[0].id, name: '兼容后的成就' };
  assert.equal((await call(legacy, '/rename', input, { origin: 'https://other.invalid' })).status, 403);
  const first = await call(legacy, '/rename', input); assert.equal(first.status, 200); const changed = await first.json();
  const retry = await call(current, '/rename', input); assert.equal(retry.status, 200); assert.equal((await retry.json()).revision, changed.revision);
  assert.deepEqual(service.snapshot().collection.points, before.collection.points);
  const manifest = JSON.parse(await readFile(new URL(process.env.JOURNAL_ARTIFACT ? 'lib/portrait-manifest.json' : 'src/portrait-manifest.json', base), 'utf8'));
  const path = manifest.styles.flat.themes.xianxia.url.slice(current.length);
  const oldImage = await call(legacy, path), newImage = await call(current, path);
  assert.equal(oldImage.status, 200); assert.equal(newImage.status, 200);
  assert.deepEqual(Buffer.from(await oldImage.arrayBuffer()), Buffer.from(await newImage.arrayBuffer()));
  assert.equal(oldImage.headers.get('etag'), newImage.headers.get('etag'));
  assert.equal((await fetch(origin + legacy + path)).status, 401);
  const stableBytes = await readFile(file);
  const debug = await (await call(legacy, '/debug/start', {})).json();
  assert.equal((await call(current, '/rename', { ...input, requestId: 'debug-name', expectedRevision: debug.snapshot.revision, name: '仅调试' }, { 'x-daj-debug': debug.token })).status, 200);
  assert.deepEqual(await readFile(file), stableBytes);
  await call(legacy, '/debug/exit', {}, { 'x-daj-debug': debug.token });
  assert.equal((await call(current, '/rename', { ...input, requestId: 'expired-name' }, { 'x-daj-debug': debug.token })).status, 409);
  assert.deepEqual(await readFile(file), stableBytes);
});
