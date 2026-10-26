import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectPortraitWebP } from '../src/portrait-assets.mjs';

const ROOT_FILES = ['.gitignore', 'package.json', 'package-lock.json', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'LICENSE'];
const ROOT_DIRS = ['src', 'tests', 'scripts', 'docs', '.github', 'assets'];
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
