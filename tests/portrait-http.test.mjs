import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, copyFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { themes, styles, prefix, tinyWebP, manifestFor, writeFixtureAssets } from './portrait-fixtures.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'portrait-auth-http-')), lib = join(directory, 'lib');
  let service, server, handler; let providerCalls = 0;
  t.after(async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await service?.dispose(); await rm(directory, { recursive: true, force: true }); });
  await mkdir(lib);
  const codeDir = process.env.JOURNAL_ARTIFACT ? join(process.env.JOURNAL_ARTIFACT, 'lib') : fileURLToPath(new URL('../src/', import.meta.url));
  for (const name of await readdir(codeDir)) if (name.endsWith('.mjs')) await copyFile(join(codeDir, name), join(lib, name));
  await symlink(fileURLToPath(new URL('../node_modules/', import.meta.url)), join(directory, 'node_modules'));
  const manifest = manifestFor(), assetsDir = join(lib, 'assets/portraits');
  await writeFile(join(lib, 'portrait-manifest.json'), JSON.stringify(manifest)); await writeFixtureAssets(assetsDir);
  const { createAchievementJournal } = await import(pathToFileURL(join(lib, 'index.mjs')));
  const ctx = { sessions: { get() {} }, on: () => () => {}, logger: { warn() {} },
    llm: { listProviders: () => [], prepareCall() { providerCalls++; assert.fail('Serving an image must not call a model'); } },
    webServer: { register(route) { handler = route.handler; return () => {}; } },
    connection: { browserPeer: { id: 'browser' }, admit(req) { const id = req.headers['x-fixture-peer']; return id ? { peer: { id } } : { rejection: 401 }; } },
  };
  const statePath = join(directory, 'journal.json');
  service = await createAchievementJournal(ctx, { statePath, collect: false, registerTools: false });
  server = createServer((req, res) => { void handler(req, res); }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = `http://127.0.0.1:${server.address().port}`;
  return { directory, assetsDir, manifest, statePath, address, service, providerCalls: () => providerCalls,
    async get(style, theme, options = {}) { return fetch(address + manifest.styles[style].themes[theme].url, { ...options, headers: { 'x-fixture-peer': 'browser', ...options.headers } }); },
    raw(path, headers = {}) { return new Promise((resolve, reject) => { const req = httpRequest(address, { path, headers: { 'x-fixture-peer': 'browser', ...headers } }, res => { const chunks = []; res.on('data', value => chunks.push(value)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); }); req.on('error', reject); req.end(); }); },
  };
}

test('real index admits browser ownership before GET, HEAD or conditional image handling', async t => {
  const f = await fixture(t), before = await readFile(f.statePath, 'utf8');
  const url = f.address + f.manifest.styles.flat.themes.xianxia.url;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { 'x-fixture-peer': 'model' } })).status, 403);
  assert.equal((await fetch(url, { method: 'HEAD', headers: { 'x-fixture-peer': 'api-operator' } })).status, 403);
  const image = await f.get('flat', 'xianxia'); assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), tinyWebP('flat', 'xianxia'));
  assert.equal(image.headers.get('content-type'), 'image/webp'); assert.match(image.headers.get('cache-control'), /^private,.*immutable/); assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  const deniedCache = await fetch(url, { headers: { 'if-none-match': image.headers.get('etag') } }); assert.equal(deniedCache.status, 401);
  const head = await f.get('flat', 'xianxia', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0); assert.equal(head.headers.get('content-length'), '26');
  const cached = await f.get('flat', 'xianxia', { headers: { 'if-none-match': image.headers.get('etag') } }); assert.equal(cached.status, 304); assert.equal((await cached.arrayBuffer()).byteLength, 0);
  const debuglessAsset = await f.get('pixel', 'xianxia', { headers: { 'x-daj-debug': 'expired-scope-does-not-authorize-images' } }); assert.equal(debuglessAsset.status, 200); assert.deepEqual(Buffer.from(await debuglessAsset.arrayBuffer()), tinyWebP('pixel', 'xianxia'));
  assert.equal((await f.get('flat', 'xianxia', { method: 'POST' })).status, 405);
  assert.equal(await readFile(f.statePath, 'utf8'), before); assert.equal(f.providerCalls(), 0);
});

test('real index serves twenty reviewed style routes and rejects retired/traversal/query aliases', async t => {
  const f = await fixture(t);
  for (const style of styles) for (const theme of themes) {
    const res = await f.get(style, theme); assert.equal(res.status, 200); assert.deepEqual(Buffer.from(await res.arrayBuffer()), tinyWebP(style, theme));
  }
  for (const suffix of ['xianxia.webp', 'unknown/xianxia.webp', 'flat/no-theme.webp', 'flat/../pixel/xianxia.webp', 'flat/%2e%2e/pixel/xianxia.webp', 'flat/xianxia.webp?version=stale', 'flat/xianxia.webp?version=a&version=b', 'flat/xianxia.webp?unexpected=1']) {
    const response = await f.raw(prefix + suffix); assert.equal(response.status, 404, suffix); assert.ok(!response.body.toString().includes(f.directory));
  }
  assert.equal(f.providerCalls(), 0);
});

test('real index does not leak or rewrite local state when a whitelisted atlas is corrupt or missing', async t => {
  const f = await fixture(t), before = await readFile(f.statePath, 'utf8');
  await writeFile(join(f.assetsDir, 'pixel/ocean.webp'), 'not a webp');
  const corrupt = await f.get('pixel', 'ocean'); assert.equal(corrupt.status, 503); assert.equal(corrupt.headers.get('cache-control'), 'no-store'); assert.ok(!(await corrupt.text()).includes(f.directory));
  await rm(join(f.assetsDir, 'flat/ocean.webp'));
  const missing = await f.get('flat', 'ocean', { method: 'HEAD' }); assert.equal(missing.status, 404); assert.equal((await missing.arrayBuffer()).byteLength, 0);
  assert.equal(await readFile(f.statePath, 'utf8'), before); assert.equal(f.providerCalls(), 0);
});
