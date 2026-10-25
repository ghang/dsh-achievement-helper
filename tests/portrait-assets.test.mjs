import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { themes, styles, prefix, tinyWebP, manifestFor, writeFixtureAssets } from './portrait-fixtures.mjs';

const source = process.env.JOURNAL_ARTIFACT ? pathToFileURL(join(process.env.JOURNAL_ARTIFACT, 'lib/portrait-assets.mjs')) : new URL('../src/portrait-assets.mjs', import.meta.url);
const { createPortraitAssets, servePortraitAsset, validatePortraitManifest, inspectPortraitWebP, PORTRAIT_LIMITS, PORTRAIT_STYLE_IDS } = await import(source);
const entry = (manifest, style = 'flat', theme = 'xianxia') => manifest.styles[style].themes[theme];
function response() { return { status: null, headers: {}, body: undefined, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } }; }
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'portrait-assets-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const assetsDir = join(directory, 'portraits'); await writeFixtureAssets(assetsDir);
  const manifest = manifestFor(); return { directory, assetsDir, manifest, assets: await createPortraitAssets({ manifest, assetsDir }) };
}
function paddedWebP(length) {
  const bytes = Buffer.alloc(length); tinyWebP().copy(bytes); bytes.writeUInt32LE(length - 8, 4); bytes.write('JUNK', 26); bytes.writeUInt32LE(length - 34, 30); return bytes;
}

test('manifest v2 has exactly two complete styles and browser metadata omits server file facts', async () => {
  const manifest = manifestFor(), assets = await createPortraitAssets({ manifest, assetsDir: '/does-not-exist/portrait-unit-fixture' });
  assert.equal(assets.manifest.version, 2); assert.deepEqual(Object.keys(assets.manifest.styles), styles); assert.deepEqual(PORTRAIT_STYLE_IDS, styles);
  for (const style of styles) {
    assert.equal(assets.manifest.styles[style].label, style === 'flat' ? '清爽扁平' : '微像素');
    assert.equal(Object.keys(assets.manifest.styles[style].themes).length, 10);
    for (const theme of themes) assert.deepEqual(Object.keys(entry(assets.manifest, style, theme)).sort(), ['aspect', 'characters', 'columns', 'rows', 'url']);
  }
  const res = response(); assert.equal(await assets.serve({ method: 'GET', url: '/state' }, res), false);
  assert.equal(await servePortraitAsset({ method: 'GET', url: '/state' }, response()), false); assert.equal(res.status, null);
  assert.equal(await assets.serve({ method: 'POST', url: entry(manifest).url }, res), true); assert.equal(res.status, 405); assert.equal(res.headers.allow, 'GET, HEAD');
  const missing = response(); assert.equal(await assets.serve({ method: 'GET', url: entry(manifest).url }, missing), true); assert.equal(missing.status, 404);
});

test('GET, HEAD and ETag caching keep flat/pixel bytes separate across all twenty local assets', async t => {
  const f = await fixture(t);
  const server = createServer(async (req, res) => { if (!await f.assets.serve(req, res, new URL(req.url, 'http://local'))) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const address = `http://127.0.0.1:${server.address().port}`, url = address + entry(f.manifest).url;
  const flat = await fetch(url); assert.equal(flat.status, 200); assert.equal(flat.headers.get('content-type'), 'image/webp'); assert.equal(flat.headers.get('x-content-type-options'), 'nosniff'); assert.match(flat.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await flat.arrayBuffer()), tinyWebP('flat', 'xianxia'));
  const pixel = await fetch(address + entry(f.manifest, 'pixel').url); assert.equal(pixel.status, 200); assert.notEqual(pixel.headers.get('etag'), flat.headers.get('etag'));
  assert.deepEqual(Buffer.from(await pixel.arrayBuffer()), tinyWebP('pixel', 'xianxia'));
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0); assert.equal(head.headers.get('content-length'), '26');
  const cached = await fetch(url, { headers: { 'if-none-match': 'W/' + flat.headers.get('etag') } }); assert.equal(cached.status, 304); assert.equal((await cached.arrayBuffer()).byteLength, 0);
  const different = await fetch(address + entry(f.manifest, 'pixel').url, { headers: { 'if-none-match': flat.headers.get('etag') } }); assert.equal(different.status, 200); await different.arrayBuffer();
  const unversioned = await fetch(address + prefix + 'flat/xianxia.webp'); assert.equal(unversioned.status, 200); assert.match(unversioned.headers.get('cache-control'), /no-cache/); await unversioned.arrayBuffer();
  assert.equal((await fetch(address + prefix + 'flat/xianxia.webp?version=stale')).status, 404);
  const verified = await f.assets.verifyAll(); assert.equal(verified.assets.length, 20); assert.equal(new Set(verified.assets.map(asset => asset.file)).size, 20); assert.equal(verified.totalBytes, 20 * 26);
  assert.ok(verified.assets.every(asset => asset.file === `${asset.style}/${asset.theme}.webp`));
});

test('old unstyled routes, unknown styles, traversal, remote URLs and malformed queries select no local file', async t => {
  const f = await fixture(t);
  for (const suffix of ['xianxia.webp', 'other/xianxia.webp', 'Flat/xianxia.webp', 'flat/unknown.webp', 'flat/xianxia.png', 'flat/../pixel/xianxia.webp', 'flat/%2e%2e/pixel/xianxia.webp', 'flat/%252e%252e/pixel/xianxia.webp', 'flat/xianxia%2f.webp', 'flat/xianxia%5c.webp', 'flat/\\xianxia.webp', 'flat/xianxia.webp?unexpected=1', 'flat/xianxia.webp?version=one&version=two', 'flat/xianxia.webp#fragment']) {
    const url = prefix + suffix, res = response(); assert.equal(await f.assets.serve({ method: 'GET', url }, res), false, url); assert.equal(res.status, null);
  }
  for (const url of ['https://example.invalid' + prefix + 'flat/xianxia.webp', '//example.invalid' + prefix + 'flat/xianxia.webp']) assert.equal(await f.assets.serve({ method: 'GET', url }, response()), false);
  const raw = prefix + 'flat/%2e%2e/pixel/xianxia.webp'; assert.equal(await f.assets.serve({ method: 'GET', url: raw }, response(), new URL(raw, 'http://local')), false);
  assert.equal(await f.assets.serve({ method: 'GET', url: entry(f.manifest).url }, response(), new URL('https://example.invalid' + entry(f.manifest).url)), false);
});

test('checksum, size and dimensions are mandatory and verified before any asset bytes are returned', async t => {
  const f = await fixture(t);
  for (const change of [{ sha256: '0'.repeat(64), url: prefix + 'flat/xianxia.webp?version=' + '0'.repeat(12) }, { width: 8, height: 4 }, { bytes: 28 }]) {
    const manifest = structuredClone(f.manifest); Object.assign(entry(manifest), change);
    const assets = await createPortraitAssets({ manifest, assetsDir: f.assetsDir }), res = response();
    assert.equal(await assets.serve({ method: 'GET', url: entry(manifest).url }, res), true); assert.equal(res.status, 503); assert.ok(!String(res.body).includes(f.directory));
  }
  const corrupt = tinyWebP('flat', 'xianxia'); corrupt.writeUInt32LE(9999, 4); await writeFile(join(f.assetsDir, 'flat/xianxia.webp'), corrupt);
  const assets = await createPortraitAssets({ manifest: f.manifest, assetsDir: f.assetsDir }), res = response();
  await assets.serve({ method: 'HEAD', url: entry(f.manifest).url }, res); assert.equal(res.status, 503); assert.equal(res.body, undefined);
});

test('symlinked files, style directories and manifests fail closed without exposing paths', async t => {
  const f = await fixture(t), flatFile = join(f.assetsDir, 'flat/xianxia.webp');
  await rm(flatFile); await symlink(join(f.assetsDir, 'flat/explorer.webp'), flatFile);
  let assets = await createPortraitAssets({ manifest: f.manifest, assetsDir: f.assetsDir }), res = response();
  await assets.serve({ method: 'GET', url: entry(f.manifest).url }, res); assert.equal(res.status, 503); assert.ok(!String(res.body).includes(f.directory));
  await rm(join(f.assetsDir, 'pixel'), { recursive: true }); await symlink(join(f.assetsDir, 'flat'), join(f.assetsDir, 'pixel'));
  assets = await createPortraitAssets({ manifest: f.manifest, assetsDir: f.assetsDir }); res = response();
  await assets.serve({ method: 'GET', url: entry(f.manifest, 'pixel').url }, res); assert.equal(res.status, 503);
  const path = join(f.directory, 'manifest.json'); await writeFile(path, JSON.stringify(f.manifest)); await symlink(path, path + '.link');
  await assert.rejects(createPortraitAssets({ manifestFile: path + '.link', assetsDir: f.assetsDir }));
});

test('incomplete v1/style/theme metadata, aliases and duplicate grid identities cannot build', () => {
  const changes = [
    manifest => { manifest.version = 1; }, manifest => { delete manifest.styles.pixel; }, manifest => { manifest.styles.other = manifest.styles.flat; },
    manifest => { manifest.styles.flat.label = 'unreviewed'; }, manifest => { delete manifest.styles.pixel.themes.ocean; }, manifest => { manifest.styles.flat.themes.other = entry(manifest); },
    manifest => { entry(manifest).file = '../secret.webp'; }, manifest => { entry(manifest).url = 'https://example.invalid/xianxia.webp'; },
    manifest => { entry(manifest).url = entry(manifest, 'pixel').url; }, manifest => { entry(manifest).url = prefix + 'flat/xianxia.webp'; },
    manifest => { entry(manifest).url += '&version=duplicate'; }, manifest => { entry(manifest).url = prefix + 'flat/xianxia.webp?version=' + entry(manifest).sha256; },
    manifest => { entry(manifest).localPath = '/private/secret'; }, manifest => { entry(manifest).columns = 8; }, manifest => { entry(manifest).aspect = 0.5; },
    manifest => { delete entry(manifest).sha256; }, manifest => { delete entry(manifest).bytes; }, manifest => { entry(manifest).width = 5; },
    manifest => { entry(manifest).characters[1].id = entry(manifest).characters[0].id; }, manifest => { entry(manifest).characters[1].column = 0; },
    manifest => { entry(manifest).bytes = PORTRAIT_LIMITS.assetBytes + 1; },
    manifest => { for (const style of styles) for (const theme of themes) entry(manifest, style, theme).bytes = 700000; },
  ];
  for (const change of changes) { const manifest = manifestFor(); change(manifest); assert.throws(() => validatePortraitManifest(manifest)); }
  assert.equal(validatePortraitManifest(manifestFor()).styles.pixel.themes.xianxia.characters.length, 8);
  assert.equal(inspectPortraitWebP(paddedWebP(PORTRAIT_LIMITS.assetBytes)).bytes, PORTRAIT_LIMITS.assetBytes);
  assert.throws(() => inspectPortraitWebP(paddedWebP(PORTRAIT_LIMITS.assetBytes + 2)));
  const truncated = tinyWebP(); truncated.writeUInt32LE(500, 16); assert.throws(() => inspectPortraitWebP(truncated));
});

test('module defaults resolve source and unpacked-lib style folders without using process cwd', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'portrait-layout-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const moduleCode = await readFile(source, 'utf8'), collectionCode = await readFile(new URL('./collection.mjs', source), 'utf8');
  for (const layout of ['src', 'lib']) {
    const moduleDir = join(directory, layout), assetsDir = layout === 'src' ? join(directory, 'assets/portraits') : join(moduleDir, 'assets/portraits');
    await mkdir(moduleDir, { recursive: true }); await writeFixtureAssets(assetsDir);
    await writeFile(join(moduleDir, 'portrait-assets.mjs'), moduleCode); await writeFile(join(moduleDir, 'collection.mjs'), collectionCode);
    await writeFile(join(moduleDir, 'portrait-manifest.json'), JSON.stringify(manifestFor()));
    const { createPortraitAssets: create } = await import(pathToFileURL(join(moduleDir, 'portrait-assets.mjs')));
    const assets = await create(); assert.equal((await assets.verifyAll()).assets.length, 20);
    const res = response(); await assets.serve({ method: 'HEAD', url: entry(assets.manifest, 'pixel').url }, res); assert.equal(res.status, 200); assert.equal(res.body, undefined);
  }
});

test('clean build inlines browser manifest v2 and copies precisely twenty verified nested atlases', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'portrait-build-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'src'), { recursive: true }); await mkdir(join(directory, 'scripts')); await mkdir(join(directory, 'lib'));
  await writeFile(join(directory, 'lib/stale.webp'), 'stale');
  await writeFile(join(directory, 'src/portrait-assets.mjs'), await readFile(source)); await writeFile(join(directory, 'src/collection.mjs'), await readFile(new URL('./collection.mjs', source)));
  await writeFile(join(directory, 'scripts/build.mjs'), await readFile(new URL('../scripts/build.mjs', import.meta.url)));
  await writeFile(join(directory, 'src/portrait-manifest.json'), JSON.stringify(manifestFor()));
  await writeFile(join(directory, 'src/client.js'), "globalThis.fixture = { css: '__ACHIEVEMENT_CSS__', portraits: '__ACHIEVEMENT_PORTRAITS__' };\n");
  await writeFile(join(directory, 'src/client.css'), '.fixture { color: teal; }'); await writeFixtureAssets(join(directory, 'assets/portraits'));
  // Source leftovers are never copied, including the retired unstyled layout.
  await writeFile(join(directory, 'assets/portraits/explorer.webp'), tinyWebP());
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: directory, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(join(directory, 'lib/assets/portraits'))).sort(), styles);
  for (const style of styles) assert.deepEqual((await readdir(join(directory, 'lib/assets/portraits', style))).sort(), themes.map(theme => theme + '.webp').sort());
  assert.ok(!(await readdir(join(directory, 'lib'))).includes('stale.webp'));
  const runtime = {}; runInNewContext(await readFile(join(directory, 'lib/client.js'), 'utf8'), runtime);
  assert.equal(runtime.fixture.portraits.version, 2); assert.deepEqual(Object.keys(runtime.fixture.portraits.styles), styles); assert.match(runtime.fixture.css, /color: teal/);
  assert.equal(runtime.fixture.portraits.styles.flat.themes.explorer.file, undefined);
  const { createPortraitAssets: create } = await import(pathToFileURL(join(directory, 'lib/portrait-assets.mjs')));
  assert.equal((await (await create()).verifyAll()).assets.length, 20);
});
