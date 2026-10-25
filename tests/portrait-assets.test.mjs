import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const source = process.env.JOURNAL_ARTIFACT ? pathToFileURL(join(process.env.JOURNAL_ARTIFACT, 'lib/portrait-assets.mjs')) : new URL('../src/portrait-assets.mjs', import.meta.url);
const { createPortraitAssets, servePortraitAsset, validatePortraitManifest, inspectPortraitWebP, PORTRAIT_LIMITS } = await import(source);
const themes = ['explorer', 'xianxia', 'cyber', 'wuxia', 'fantasy', 'space', 'ocean', 'garden', 'academy', 'steampunk'];
const prefix = '/dsh-achievement-journal/api/assets/portraits/';

// A synthetic RIFF/VP8L header fixture, not an illustration or a decoder test.
function tinyWebP() {
  const data = Buffer.alloc(26);
  data.write('RIFF'); data.writeUInt32LE(18, 4); data.write('WEBP', 8); data.write('VP8L', 12); data.writeUInt32LE(5, 16);
  data[20] = 0x2f; data.writeUInt32LE(3 | (1 << 14), 21); return data;
}
function manifestFor(bytes = tinyWebP()) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { version: 1, themes: Object.fromEntries(themes.map(theme => [theme, {
    file: `${theme}.webp`, url: `${prefix}${theme}.webp?version=${sha256.slice(0, 12)}`,
    columns: 4, rows: 2, aspect: 1, width: 4, height: 2, bytes: bytes.length, sha256,
    characters: Array.from({ length: 8 }, (_, index) => ({ id: `builtin:${theme}:${index + 1}`, name: `测试伙伴${index + 1}`, icon: 'star', column: index % 4, row: Math.floor(index / 4) })),
  }])) };
}
function response() {
  return { status: null, headers: {}, body: undefined, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
}
async function fixture(t, bytes = tinyWebP()) {
  const directory = await mkdtemp(join(tmpdir(), 'portrait-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const assetsDir = join(directory, 'portraits'); await mkdir(assetsDir);
  for (const theme of themes) await writeFile(join(assetsDir, `${theme}.webp`), bytes);
  const manifest = manifestFor(bytes);
  return { directory, assetsDir, manifest, bytes, assets: await createPortraitAssets({ manifest, assetsDir }) };
}

test('initialization validates only manifest metadata and ordinary routes never read missing assets', async () => {
  const manifest = manifestFor();
  const assets = await createPortraitAssets({ manifest, assetsDir: '/does-not-exist/portrait-unit-fixture' });
  for (const entry of Object.values(assets.manifest.themes)) {
    assert.deepEqual(Object.keys(entry).sort(), ['aspect', 'characters', 'columns', 'rows', 'url']);
    assert.equal(entry.file, undefined); assert.equal(entry.sha256, undefined);
  }
  const res = response();
  assert.equal(await assets.serve({ method: 'GET', url: '/state' }, res), false);
  assert.equal(await servePortraitAsset({ method: 'GET', url: '/state' }, response()), false);
  assert.equal(res.status, null);
  assert.equal(await assets.serve({ method: 'POST', url: manifest.themes.xianxia.url }, res), true);
  assert.equal(res.status, 405); assert.equal(res.headers.allow, 'GET, HEAD');
  const missing = response();
  assert.equal(await assets.serve({ method: 'GET', url: manifest.themes.xianxia.url }, missing), true);
  assert.equal(missing.status, 404);
});

test('GET, HEAD, conditional requests and versioned caching serve only the reviewed local WebP bytes', async t => {
  const f = await fixture(t);
  const server = createServer(async (req, res) => { if (!await f.assets.serve(req, res, new URL(req.url, 'http://local'))) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const address = `http://127.0.0.1:${server.address().port}`, url = address + f.manifest.themes.xianxia.url;
  const first = await fetch(url); assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'image/webp'); assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  assert.match(first.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), f.bytes);
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(head.headers.get('content-length'), String(f.bytes.length));
  const cached = await fetch(url, { headers: { 'if-none-match': 'W/' + first.headers.get('etag') } });
  assert.equal(cached.status, 304); assert.equal((await cached.arrayBuffer()).byteLength, 0);
  const unversioned = await fetch(address + prefix + 'xianxia.webp'); assert.equal(unversioned.status, 200); assert.match(unversioned.headers.get('cache-control'), /no-cache/);
  assert.equal((await fetch(address + prefix + 'xianxia.webp?version=stale')).status, 404);
  const verified = await f.assets.verifyAll(); assert.equal(verified.assets.length, 10); assert.equal(verified.totalBytes, 10 * f.bytes.length);
});

test('path traversal, remote URLs and non-whitelisted names never select local files', async t => {
  const f = await fixture(t);
  for (const url of [prefix + '../xianxia.webp', prefix + '%2e%2e/xianxia.webp', prefix + '%252e%252e/xianxia.webp', prefix + 'xianxia%2f.webp', prefix + 'xianxia%5c.webp', prefix + 'unknown.webp', prefix + 'xianxia.png', 'https://example.invalid' + prefix + 'xianxia.webp', prefix + '\\xianxia.webp']) {
    const res = response(); assert.equal(await f.assets.serve({ method: 'GET', url }, res, url), false, url); assert.equal(res.status, null);
  }
  const raw = prefix + '%2e%2e/xianxia.webp';
  assert.equal(await f.assets.serve({ method: 'GET', url: raw }, response(), new URL(raw, 'http://local')), false);
  const res = response(); assert.equal(await f.assets.serve({ method: 'GET', url: prefix + 'xianxia.webp?unexpected=1' }, res), false);
});

test('checksum, size, dimensions and symlink failures produce bounded errors without leaking paths', async t => {
  const f = await fixture(t);
  for (const change of [{ sha256: '0'.repeat(64), url: prefix + 'xianxia.webp?version=' + '0'.repeat(12) }, { width: 8 }, { height: 4 }, { bytes: f.bytes.length + 2 }, { aspect: 0.5 }]) {
    const manifest = structuredClone(f.manifest); Object.assign(manifest.themes.xianxia, change);
    const assets = await createPortraitAssets({ manifest, assetsDir: f.assetsDir }), res = response();
    assert.equal(await assets.serve({ method: 'GET', url: manifest.themes.xianxia.url }, res), true);
    assert.equal(res.status, 503); assert.ok(!String(res.body).includes(f.directory));
  }
  const corrupt = Buffer.from(f.bytes); corrupt.writeUInt32LE(9999, 4);
  await writeFile(join(f.assetsDir, 'xianxia.webp'), corrupt);
  let assets = await createPortraitAssets({ manifest: f.manifest, assetsDir: f.assetsDir }), res = response();
  await assets.serve({ method: 'GET', url: f.manifest.themes.xianxia.url }, res); assert.equal(res.status, 503);
  await rm(join(f.assetsDir, 'xianxia.webp')); await symlink(join(f.assetsDir, 'explorer.webp'), join(f.assetsDir, 'xianxia.webp'));
  assets = await createPortraitAssets({ manifest: f.manifest, assetsDir: f.assetsDir }); res = response();
  await assets.serve({ method: 'GET', url: f.manifest.themes.xianxia.url }, res); assert.equal(res.status, 503);
});

test('manifest whitelist, grid identity and declared byte budgets reject unsafe or incomplete builds', () => {
  const changes = [
    manifest => { delete manifest.themes.xianxia; },
    manifest => { manifest.themes.other = manifest.themes.xianxia; },
    manifest => { manifest.themes.xianxia.file = '../secret.webp'; },
    manifest => { manifest.themes.xianxia.url = 'https://example.invalid/xianxia.webp'; },
    manifest => { manifest.themes.xianxia.url = prefix + 'xianxia.webp/../xianxia.webp'; },
    manifest => { manifest.themes.xianxia.localPath = '/private/secret'; },
    manifest => { manifest.themes.xianxia.columns = 8; },
    manifest => { manifest.themes.xianxia.characters[1].id = manifest.themes.xianxia.characters[0].id; },
    manifest => { manifest.themes.xianxia.characters[1].column = 0; },
    manifest => { manifest.themes.xianxia.bytes = PORTRAIT_LIMITS.assetBytes; },
    manifest => { for (const entry of Object.values(manifest.themes)) entry.bytes = 500000; },
  ];
  for (const change of changes) { const manifest = manifestFor(); change(manifest); assert.throws(() => validatePortraitManifest(manifest)); }
  assert.deepEqual(validatePortraitManifest(manifestFor()).themes.xianxia.characters.map(item => item.column), [0, 1, 2, 3, 0, 1, 2, 3]);
  assert.throws(() => inspectPortraitWebP(Buffer.alloc(PORTRAIT_LIMITS.assetBytes)));
  const truncated = tinyWebP(); truncated.writeUInt32LE(500, 16); assert.throws(() => inspectPortraitWebP(truncated));
});

test('module defaults resolve source and unpacked-lib layouts without depending on process cwd', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'portrait-layout-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const moduleCode = await readFile(source, 'utf8'), collectionCode = await readFile(new URL('./collection.mjs', source), 'utf8');
  for (const layout of ['src', 'lib']) {
    const moduleDir = join(directory, layout), assetsDir = layout === 'src' ? join(directory, 'assets/portraits') : join(moduleDir, 'assets/portraits');
    await mkdir(moduleDir, { recursive: true }); await mkdir(assetsDir, { recursive: true });
    await writeFile(join(moduleDir, 'portrait-assets.mjs'), moduleCode); await writeFile(join(moduleDir, 'collection.mjs'), collectionCode);
    await writeFile(join(moduleDir, 'portrait-manifest.json'), JSON.stringify(manifestFor()));
    for (const theme of themes) await writeFile(join(assetsDir, `${theme}.webp`), tinyWebP());
    const { createPortraitAssets: create } = await import(pathToFileURL(join(moduleDir, 'portrait-assets.mjs')));
    const assets = await create(); assert.equal((await assets.verifyAll()).assets.length, 10);
    const res = response(); await assets.serve({ method: 'HEAD', url: assets.manifest.themes.xianxia.url }, res);
    assert.equal(res.status, 200); assert.equal(res.body, undefined);
  }
});
