import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { forbiddenPath, textIssues, auditFiles, README_SCREENSHOT_PATHS, inspectReadmeScreenshotPng } from '../scripts/release-audit.mjs';

test('release content checks reject private paths, credentials, emails and authenticated URLs without returning the match', () => {
  const cases = [
    '/' + 'Users/private-person/code/', ['person', 'company.invalid-host.com'].join('@'),
    'npm_' + 'a'.repeat(30), 'ghp_' + 'b'.repeat(30),
    'http://127.0.0.1:3499/?' + 'token=' + 'synthetic-value',
    'http://[::1]/#' + 'access_token=' + 'synthetic-value',
  ];
  for (const value of cases) { const issues = textIssues(value); assert.ok(issues.length > 0); assert.ok(!JSON.stringify(issues).includes('synthetic-value')); }
});
test('the release allowlist accepts approved identity and SSH repository links while rejecting private files', () => {
  assert.deepEqual(textIssues('12455956+ghang@users.noreply.github.com'), []);
  assert.deepEqual(textIssues(['git', 'github.com:ghang/dsh-achievement-helper.git'].join('@')), []);
  for (const file of ['docs/.npmrc', 'src/.env.local', 'tests/session.jsonl.gz', 'assets/private.key', 'vendor/code.mjs', 'profiles/web/config.yml']) assert.equal(forbiddenPath(file), true, file);
  assert.equal(forbiddenPath('docs/RELEASING.md'), false);
});
test('source and package gates reject escaping or missing Markdown links and private dependency registries', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'helper-release-audit-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'README.md'), '[bad](../private.md)');
  await assert.rejects(auditFiles(dir, ['README.md']), /missing-or-external-relative-link/);
  await writeFile(join(dir, 'README.md'), '[bad](missing.md)');
  await assert.rejects(auditFiles(dir, ['README.md']), /missing-or-external-relative-link/);
  await writeFile(join(dir, 'README.md'), '# Public source\n');
  await writeFile(join(dir, 'package-lock.json'), JSON.stringify({ packages: { dependency: { resolved: 'https://packages.invalid/dependency.tgz' } } }));
  await assert.rejects(auditFiles(dir, ['README.md', 'package-lock.json']), /non-public-dependency/);
});

function pngChunk(type, data = Buffer.alloc(0)) {
  const chunk = Buffer.alloc(data.length + 12); chunk.writeUInt32BE(data.length); chunk.write(type, 4, 'ascii'); data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4); return chunk;
}
function screenshotPng({ width = 64, height = 1, chunks = [], pixels = Buffer.alloc(0), idat } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height); pixels.copy(rows, 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), ...chunks,
    pngChunk('IDAT', idat ?? deflateSync(rows, { level: 0 })), pngChunk('IEND')]);
}

test('README screenshots use exactly six approved paths and are audited as binary assets', async t => {
  assert.deepEqual(README_SCREENSHOT_PATHS, [
    'docs/images/overview.png', 'docs/images/achievements.png', 'docs/images/characters-flat.png',
    'docs/images/characters-pixel.png', 'docs/images/custom-generation.png', 'docs/images/appearance.png',
  ]);
  const dir = await mkdtemp(join(tmpdir(), 'helper-screenshots-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'docs/images'), { recursive: true });
  const binaryText = '/' + 'Users/synthetic-person/code/';
  const png = screenshotPng({ pixels: Buffer.from(binaryText), chunks: [pngChunk('sRGB', Buffer.from([0])), pngChunk('gAMA', Buffer.from([0, 0, 177, 143])), pngChunk('cHRM', Buffer.alloc(32)), pngChunk('pHYs', Buffer.alloc(9))] });
  assert.ok(png.includes(Buffer.from(binaryText)), 'The fixture must contain text that the prose gate would reject');
  for (const file of README_SCREENSHOT_PATHS) await writeFile(join(dir, file), png);
  await writeFile(join(dir, 'docs/images/README.md'), README_SCREENSHOT_PATHS.map(file => `[Screenshot](${file.split('/').at(-1)})`).join('\n'));
  const result = await auditFiles(dir, [...README_SCREENSHOT_PATHS, 'docs/images/README.md']);
  assert.equal(result.rasterCount, 6); assert.equal(result.files, 7);
  for (const file of ['docs/images/unreviewed.png', 'docs/images/Overview.png', 'docs/overview.png']) {
    await writeFile(join(dir, file), png);
    await assert.rejects(auditFiles(dir, [file]), /unreviewed-raster-path/);
  }
});

test('README PNG inspection rejects text, EXIF, XMP, animation and unknown chunks', () => {
  for (const type of ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'acTL', 'fcTL', 'fdAT', 'vpAg']) {
    assert.throws(() => inspectReadmeScreenshotPng(screenshotPng({ chunks: [pngChunk(type, Buffer.from('synthetic metadata'))] })), /unreviewed-png-chunk/, type);
  }
});

test('README PNG inspection rejects oversized, truncated and corrupt images', () => {
  const valid = screenshotPng(), invalidSignature = Buffer.from(valid), invalidCrc = Buffer.from(valid), overflow = Buffer.from(valid);
  invalidSignature[0] = 0; invalidCrc[29] ^= 1; overflow.writeUInt32BE(0xffffffff, 33);
  for (const [bytes, rule] of [
    [invalidSignature, /png-signature/], [screenshotPng({ width: 0 }), /png-dimensions/],
    [screenshotPng({ width: 1601 }), /png-dimensions/], [screenshotPng({ height: 1201 }), /png-dimensions/],
    [Buffer.concat([valid, Buffer.alloc(1024 * 1024)]), /png-byte-budget/],
    [valid.subarray(0, -1), /truncated-png-chunk/], [overflow, /truncated-png-chunk/], [invalidCrc, /png-chunk-crc/],
    [Buffer.concat([valid, Buffer.from([0])]), /png-iend/], [valid.subarray(0, -12), /missing-png-iend/],
    [screenshotPng({ idat: Buffer.from('invalid zlib data') }), /png-image-data/],
    [screenshotPng({ idat: Buffer.concat([deflateSync(Buffer.alloc(257)), Buffer.from('trailing data')]) }), /png-image-data/],
    [screenshotPng({ chunks: [pngChunk('gAMA', Buffer.alloc(3))] }), /png-ancillary-layout/],
  ]) assert.throws(() => inspectReadmeScreenshotPng(bytes), rule);
});
