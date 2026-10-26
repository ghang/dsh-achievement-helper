import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { inspectPortraitWebP } from '../src/portrait-assets.mjs';

const ROOT_FILES = ['.gitignore', 'package.json', 'package-lock.json', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'LICENSE'];
const ROOT_DIRS = ['src', 'tests', 'scripts', 'docs', '.github', 'assets'];
export const README_SCREENSHOT_PATHS = Object.freeze([
  'docs/images/overview.png', 'docs/images/achievements.png',
  'docs/images/characters-flat.png', 'docs/images/characters-pixel.png',
  'docs/images/custom-generation.png', 'docs/images/appearance.png',
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_ANCILLARY_LENGTHS = { sRGB: 1, gAMA: 4, cHRM: 32, pHYs: 9 };
const PNG_CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
const pngFail = rule => { throw new Error('Invalid README screenshot PNG: ' + rule); };

// Binary format and metadata checks do not replace a separate visual privacy review.
export function inspectReadmeScreenshotPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024) pngFail('png-byte-budget');
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) pngFail('png-signature');
  let width, height, rowBytes, offset = 8, ended = false;
  const seen = new Set(), payload = [];
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) pngFail('truncated-png-chunk');
    const size = bytes.readUInt32BE(offset), type = bytes.toString('latin1', offset + 4, offset + 8), start = offset + 8, end = start + size;
    if (end + 4 > bytes.length) pngFail('truncated-png-chunk');
    if (!['IHDR', 'IDAT', 'IEND'].includes(type) && !Object.hasOwn(PNG_ANCILLARY_LENGTHS, type)) pngFail('unreviewed-png-chunk');
    let crc = 0xffffffff;
    for (let index = offset + 4; index < end; index++) crc = PNG_CRC_TABLE[(crc ^ bytes[index]) & 255] ^ crc >>> 8;
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(end)) pngFail('png-chunk-crc');
    if (!seen.size && type !== 'IHDR') pngFail('png-chunk-order');
    if (type === 'IHDR') {
      if (seen.size || size !== 13) pngFail('png-ihdr');
      width = bytes.readUInt32BE(start); height = bytes.readUInt32BE(start + 4);
      if (!width || !height || width > 1600 || height > 1200) pngFail('png-dimensions');
      const depth = bytes[start + 8], color = bytes[start + 9];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[start + 10] || bytes[start + 11] || bytes[start + 12]) pngFail('unsupported-png-encoding');
      rowBytes = Math.ceil(width * ({ 0: 1, 2: 3, 4: 2, 6: 4 }[color]) * depth / 8);
    } else if (type === 'IDAT') payload.push(bytes.subarray(start, end));
    else if (type === 'IEND') {
      if (size || !seen.has('IDAT') || end + 4 !== bytes.length) pngFail('png-iend');
      ended = true;
    } else {
      if (seen.has(type) || seen.has('IDAT') || size !== PNG_ANCILLARY_LENGTHS[type]) pngFail('png-ancillary-layout');
      if (type === 'sRGB' && bytes[start] > 3 || type === 'gAMA' && !bytes.readUInt32BE(start) || type === 'pHYs' && bytes[start + 8] > 1) pngFail('png-ancillary-value');
    }
    seen.add(type); offset = end + 4;
  }
  if (!ended) pngFail('missing-png-iend');
  const compressed = Buffer.concat(payload), expected = (rowBytes + 1) * height;
  let decoded;
  try { decoded = inflateSync(compressed, { info: true, maxOutputLength: expected }); }
  catch { pngFail('png-image-data'); }
  if (decoded.buffer.length !== expected || decoded.engine.bytesWritten !== compressed.length) pngFail('png-image-data');
  for (let row = 0; row < height; row++) if (decoded.buffer[row * (rowBytes + 1)] > 4) pngFail('png-filter');
  return { width, height, bytes: bytes.length };
}

export function forbiddenPath(file) {
  return /(^|\/)(?:node_modules|vendor|\.git|\.dsh|\.ssh|\.aws|out|\.release|profiles|sessions|storages)(\/|$)|(^|\/)(?:\.(?:env|npmrc|yarnrc|netrc)|credentials)(?:[.\/-]|$)|\.(?:pem|key|p12|pfx|jsonl)(?:\.(?:gz|zst|zstd))?$/i.test(file);
}
export function textIssues(text) {
  const issues = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(line)) issues.push({ line: index + 1, rule: 'private-path' });
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|npm_)[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{24,}/.test(line)) issues.push({ line: index + 1, rule: 'credential' });
    const emails = [...line.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)];
    if (emails.some(match => !(match[0].replace(/^[`'"]+/, '') === ['git', 'github.com'].join('@') && line[match.index + match[0].length] === ':') && !/^(?:users\.noreply\.github\.com|(?:.*\.)?example\.(?:com|org|net)|.*\.invalid)$/i.test(match[1]))) issues.push({ line: index + 1, rule: 'private-email' });
    for (const match of line.matchAll(/https?:\/\/[^\s<>"'`\\)]+/gi)) {
      let url; try { url = new URL(match[0]); } catch { continue; }
      if (url.username || url.password) issues.push({ line: index + 1, rule: 'url-credentials' });
      if (/^(?:localhost\.?|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(url.hostname)) {
        for (const params of [url.searchParams, new URLSearchParams(url.hash.slice(1))]) if ([...params].some(([key, value]) => value && /^(?:token|access[_-]?token|auth(?:[_-]?token)?|api[_-]?key)$/i.test(key))) issues.push({ line: index + 1, rule: 'authenticated-loopback-url' });
      }
    }
  }
  return issues;
}
export async function sourceFiles(root) {
  const files = [];
  async function visit(file) {
    const stat = await lstat(join(root, file));
    if (forbiddenPath(file) || stat.isSymbolicLink()) throw new Error('Rejected public source path: ' + file);
    if (stat.isDirectory()) for (const name of (await readdir(join(root, file))).sort()) await visit(posix.join(file, name));
    else if (stat.isFile()) files.push(file);
    else throw new Error('Unsupported public entry: ' + file);
  }
  for (const file of [...ROOT_FILES, ...ROOT_DIRS]) await visit(file);
  return files.sort();
}
export async function auditFiles(root, files, { links = true } = {}) {
  const issues = [], digest = createHash('sha256'); let rasterCount = 0;
  for (const file of files) {
    if (forbiddenPath(file)) { issues.push({ file, rule: 'private-pathname' }); continue; }
    const bytes = await readFile(join(root, file)); digest.update(file + '\0').update(bytes).update('\0');
    if (bytes.length > 1024 * 1024) issues.push({ file, rule: 'large-file' });
    if (file.endsWith('.webp')) {
      if (!/^(?:assets|lib\/assets)\/portraits\/(?:flat|pixel)\/[a-z]+\.webp$/.test(file)) issues.push({ file, rule: 'unreviewed-raster-path' });
      inspectPortraitWebP(bytes); rasterCount++; continue;
    }
    if (file.endsWith('.png')) {
      if (!README_SCREENSHOT_PATHS.includes(file)) issues.push({ file, rule: 'unreviewed-raster-path' });
      else { inspectReadmeScreenshotPng(bytes); rasterCount++; }
      continue; // Screenshot bytes are never decoded as UTF-8 prose.
    }
    if (!/\.(?:mjs|js|json|ya?ml|md|css)$/.test(file) && !['.gitignore', 'LICENSE'].includes(file)) { issues.push({ file, rule: 'unsupported-file' }); continue; }
    const text = bytes.toString('utf8'); issues.push(...textIssues(text).map(issue => ({ file, ...issue })));
    if (links && file.endsWith('.md')) for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      const link = target.replace(/^<|>$/g, '').split('#')[0];
      if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(file), link));
      if (resolved.startsWith('../') || resolved.startsWith('/') || !files.includes(resolved)) issues.push({ file, rule: 'missing-or-external-relative-link' });
    }
    if (file === 'package-lock.json') {
      const lock = JSON.parse(text);
      if (Object.values(lock.packages ?? {}).some(entry => entry.link || entry.resolved && !entry.resolved.startsWith('https://registry.npmjs.org/'))) issues.push({ file, rule: 'non-public-dependency' });
    }
  }
  if (issues.length) throw new Error('Public content gate failed: ' + JSON.stringify(issues));
  return { files: files.length, rasterCount, sourceSha256: digest.digest('hex') };
}
