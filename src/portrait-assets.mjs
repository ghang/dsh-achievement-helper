import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { THEME_IDS, ICON_IDS } from './collection.mjs';

export const PORTRAIT_LIMITS = Object.freeze({ assetBytes: 1024 * 1024, totalBytes: 12 * 1024 * 1024, manifestBytes: 128 * 1024 });
export const PORTRAIT_STYLE_IDS = Object.freeze(['flat', 'pixel']);
export const PORTRAIT_STYLE_LABELS = Object.freeze({ flat: '清爽扁平', pixel: '微像素' });
const PREFIX = '/dsh-achievement-journal/api/assets/portraits/';
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultManifest = join(moduleDirectory, 'portrait-manifest.json');
const defaultAssets = basename(moduleDirectory) === 'src' ? join(moduleDirectory, '../assets/portraits') : join(moduleDirectory, 'assets/portraits');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw Object.assign(new Error(message), { code: 'PORTRAIT_ASSET_INVALID' }); };
const integer = value => Number.isSafeInteger(value) && value > 0;
const fields = (value, allowed) => { if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Portrait metadata has unsupported fields.'); };
const copy = value => structuredClone(value);

export function validatePortraitManifest(input) {
  fields(input, ['version', 'styles']);
  if (input.version !== 2) fail('Unsupported portrait manifest version.');
  fields(input.styles, PORTRAIT_STYLE_IDS);
  if (Object.keys(input.styles).length !== PORTRAIT_STYLE_IDS.length) fail('Portrait manifest must contain exactly flat and pixel styles.');
  const result = { version: 2, styles: {} };
  let declaredBytes = 0;
  for (const style of PORTRAIT_STYLE_IDS) {
    const source = input.styles[style]; fields(source, ['label', 'themes']);
    if (source.label !== PORTRAIT_STYLE_LABELS[style]) fail('Invalid portrait style label.');
    fields(source.themes, THEME_IDS);
    if (Object.keys(source.themes).length !== THEME_IDS.length) fail('Each style must contain all ten themes.');
    const themes = {};
  for (const theme of THEME_IDS) {
    const entry = source.themes[theme];
    fields(entry, ['file', 'url', 'columns', 'rows', 'aspect', 'characters', 'sha256', 'width', 'height', 'bytes']);
    const file = `${theme}.webp`;
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('A complete portrait checksum is required.');
    if (entry.file !== file || entry.url !== `${PREFIX}${style}/${file}?version=${entry.sha256.slice(0, 12)}`) fail('Portrait files and versioned URLs must use the local style/theme whitelist.');
    if (entry.columns !== 4 || entry.rows !== 2 || entry.aspect !== 1) fail('Portrait grid must have four columns and two rows of square cells.');
    for (const key of ['width', 'height', 'bytes']) if (!integer(entry[key])) fail('Portrait dimensions and size must be positive integers.');
    if (entry.width % 4 || entry.height % 2 || entry.width !== 2 * entry.height || entry.width > 16384 || entry.height > 16384 || entry.width * entry.height > 64 * 1024 * 1024) fail('Portrait dimensions disagree with its square-cell grid.');
    if (entry.bytes > PORTRAIT_LIMITS.assetBytes) fail('Portrait exceeds the per-file budget.');
    declaredBytes += entry.bytes;
    if (!Array.isArray(entry.characters) || entry.characters.length !== 8) fail('Each portrait sheet must have eight character cells.');
    const ids = new Set(), cells = new Set();
    const characters = entry.characters.map(character => {
      fields(character, ['id', 'name', 'icon', 'column', 'row']);
      if (!Array.from({ length: 8 }, (_, index) => `builtin:${theme}:${index + 1}`).includes(character.id) || ids.has(character.id)) fail('Portrait cells must refer to the eight canonical theme characters.');
      if (typeof character.name !== 'string' || !character.name.trim() || character.name.length > 60 || /[\u0000-\u001f\u007f]/u.test(character.name) || !ICON_IDS.includes(character.icon)) fail('Invalid portrait display metadata.');
      if (!Number.isInteger(character.column) || character.column < 0 || character.column >= 4 || !Number.isInteger(character.row) || character.row < 0 || character.row >= 2) fail('Portrait cell is outside its grid.');
      const cell = `${character.column}:${character.row}`;
      if (cells.has(cell)) fail('Two portrait characters share one grid cell.');
      ids.add(character.id); cells.add(cell);
      return { id: character.id, name: character.name, icon: character.icon, column: character.column, row: character.row };
    });
    themes[theme] = { file, url: entry.url, columns: 4, rows: 2, aspect: 1, characters, sha256: entry.sha256, width: entry.width, height: entry.height, bytes: entry.bytes };
  }
    result.styles[style] = { label: source.label, themes };
  }
  if (declaredBytes > PORTRAIT_LIMITS.totalBytes) fail('Portrait sheets exceed the total asset budget.');
  return result;
}

export function inspectPortraitWebP(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20 || bytes.length > PORTRAIT_LIMITS.assetBytes || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.toString('ascii', 8, 12) !== 'WEBP') fail('Invalid or oversized WebP container.');
  let width, height, image = false, offset = 12;
  for (; offset < bytes.length;) {
    if (offset + 8 > bytes.length) fail('Truncated WebP chunk header.');
    const kind = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + size;
    if (end + (size % 2) > bytes.length) fail('Truncated WebP chunk.');
    let nextWidth, nextHeight;
    if (kind === 'VP8X') {
      if (size !== 10 || bytes[start] & 2) fail('Portrait sheets must be static WebP images.');
      nextWidth = bytes.readUIntLE(start + 4, 3) + 1; nextHeight = bytes.readUIntLE(start + 7, 3) + 1;
    } else if (kind === 'VP8L') {
      if (size < 5 || bytes[start] !== 0x2f) fail('Invalid lossless WebP header.');
      const bits = bytes.readUInt32LE(start + 1);
      if (bits >>> 29) fail('Unsupported lossless WebP version.');
      nextWidth = (bits & 0x3fff) + 1; nextHeight = ((bits >>> 14) & 0x3fff) + 1; image = true;
    } else if (kind === 'VP8 ') {
      if (size < 10 || !bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) fail('Invalid lossy WebP header.');
      nextWidth = bytes.readUInt16LE(start + 6) & 0x3fff; nextHeight = bytes.readUInt16LE(start + 8) & 0x3fff; image = true;
    } else if (['ANIM', 'ANMF'].includes(kind)) fail('Portrait sheets cannot contain animation frames.');
    if (nextWidth !== undefined) {
      if (!integer(nextWidth) || !integer(nextHeight) || nextWidth > 16384 || nextHeight > 16384 || nextWidth * nextHeight > 64 * 1024 * 1024 || width !== undefined && (width !== nextWidth || height !== nextHeight)) fail('Invalid or conflicting WebP dimensions.');
      width = nextWidth; height = nextHeight;
    }
    offset = end + (size % 2);
  }
  if (!image || width === undefined) fail('WebP image payload is missing.');
  return { width, height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function routeOf(req, value) {
  const raw = typeof value === 'string' ? value : req.url ?? value?.href ?? '';
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null;
  const rawPath = raw.split(/[?#]/, 1)[0];
  if (/[\\\u0000-\u001f\u007f]/u.test(raw) || /%2e|%2f|%5c|%00/i.test(rawPath) || /(?:^|\/)\.\.?($|\/)/.test(rawPath)) return null;
  let url; try { url = new URL(raw, 'http://portrait.local'); } catch { return null; }
  if (url.hash) return null;
  if (value instanceof URL) {
    const host = req.headers?.host;
    const origins = ['http://portrait.local', 'http://local', ...typeof host === 'string' ? [`http://${host}`, `https://${host}`] : []];
    if (!origins.includes(value.origin) || value.pathname !== url.pathname || value.search !== url.search || value.hash) return null;
  }
  for (const style of PORTRAIT_STYLE_IDS) for (const theme of THEME_IDS) if (url.pathname === `${PREFIX}${style}/${theme}.webp`) return { style, theme, url };
  return null;
}
function reject(res, status, code, head = false) {
  const body = JSON.stringify({ error: code });
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
  res.end(head ? undefined : body); return true;
}

/** Lazy local assets only; callers must perform their browser admission first. */
export async function createPortraitAssets({ manifest, manifestFile = defaultManifest, assetsDir = defaultAssets } = {}) {
  if (manifest === undefined) {
    const handle = await open(manifestFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > PORTRAIT_LIMITS.manifestBytes) fail('Portrait manifest exceeds its budget.'); manifest = JSON.parse(await handle.readFile('utf8')); }
    finally { await handle.close(); }
  }
  const metadata = validatePortraitManifest(manifest), cache = new Map();
  const browserManifest = { version: metadata.version, styles: Object.fromEntries(PORTRAIT_STYLE_IDS.map(style => [style, { label: metadata.styles[style].label, themes: Object.fromEntries(THEME_IDS.map(theme => {
    const { url, columns, rows, aspect, characters } = metadata.styles[style].themes[theme];
    return [theme, { url, columns, rows, aspect, characters }];
  })) }])) };
  async function load(style, theme) {
    const key = `${style}/${theme}`;
    if (!cache.has(key)) {
      const promise = (async () => {
        const expected = metadata.styles[style].themes[theme], styleDir = join(assetsDir, style);
        const directory = await lstat(styleDir);
        if (!directory.isDirectory() || directory.isSymbolicLink()) fail('Portrait style folder must be an ordinary directory.');
        const file = await open(join(styleDir, expected.file), constants.O_RDONLY | constants.O_NOFOLLOW);
        let data;
        try { const stat = await file.stat(); if (!stat.isFile() || stat.size > PORTRAIT_LIMITS.assetBytes) fail('Portrait file is invalid or oversized.'); data = await file.readFile(); } finally { await file.close(); }
        const actual = inspectPortraitWebP(data);
        for (const field of ['width', 'height', 'bytes', 'sha256']) if (expected[field] !== actual[field]) fail(`Portrait ${field} differs from its manifest.`);
        if (actual.width < expected.columns || actual.height < expected.rows || Math.abs(actual.width / expected.columns / (actual.height / expected.rows) - expected.aspect) > 0.005) fail('Portrait dimensions disagree with its grid aspect.');
        return { data, ...actual };
      })();
      cache.set(key, promise);
      promise.catch(() => { if (cache.get(key) === promise) cache.delete(key); });
    }
    return cache.get(key);
  }
  return {
    manifest: copy(browserManifest), metadata: copy(metadata),
    async verifyAll() {
      const assets = [];
      for (const style of PORTRAIT_STYLE_IDS) for (const theme of THEME_IDS) { const { data, ...info } = await load(style, theme); assets.push({ style, theme, file: `${style}/${metadata.styles[style].themes[theme].file}`, ...info }); }
      const totalBytes = assets.reduce((sum, item) => sum + item.bytes, 0);
      if (totalBytes > PORTRAIT_LIMITS.totalBytes) fail('Portrait sheets exceed the total asset budget.');
      return { assets, totalBytes };
    },
    async serve(req, res, value = req.url) {
      const route = routeOf(req, value);
      if (!route) return false;
      const head = req.method === 'HEAD';
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(); return true; }
      const expected = metadata.styles[route.style].themes[route.theme], version = route.url.searchParams.get('version');
      const expectedVersion = new URL(expected.url, 'http://portrait.local').searchParams.get('version');
      if ([...route.url.searchParams.keys()].some(key => key !== 'version') || route.url.searchParams.getAll('version').length > 1 || version !== null && version !== expectedVersion) return false;
      let asset; try { asset = await load(route.style, route.theme); } catch (error) { return reject(res, error.code === 'ENOENT' ? 404 : 503, 'PORTRAIT_ASSET_UNAVAILABLE', head); }
      const etag = `"sha256-${asset.sha256}"`, headers = { 'content-type': 'image/webp', 'x-content-type-options': 'nosniff', etag,
        'cache-control': version !== null ? 'private, max-age=31536000, immutable' : 'private, no-cache', 'content-length': String(asset.bytes) };
      const match = String(req.headers?.['if-none-match'] ?? '').split(',').map(item => item.trim().replace(/^W\//, '')).some(item => item === '*' || item === etag);
      res.writeHead(match ? 304 : 200, headers); res.end(head || match ? undefined : asset.data); return true;
    },
  };
}

let defaultAssetsPromise;
export async function servePortraitAsset(req, res, url = req.url) {
  if (!routeOf(req, url)) return false;
  try {
    defaultAssetsPromise ??= createPortraitAssets().catch(error => { defaultAssetsPromise = undefined; throw error; });
    return await (await defaultAssetsPromise).serve(req, res, url);
  } catch { return reject(res, 503, 'PORTRAIT_MANIFEST_UNAVAILABLE', req.method === 'HEAD'); }
}
