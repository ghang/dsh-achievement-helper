import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { mkdir, lstat, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (!['publish', 'view', 'whoami', 'login'].includes(args[0])) throw new Error('Use an explicit supported npm command: publish, view, whoami or login.');
if (!args.length || args.some(arg => /^--(?:registry|userconfig|globalconfig|cache|prefix|scope|otp)(?:=|$)/i.test(arg))) throw new Error('Pass npm arguments without registry/config/cache/auth overrides.');
if (args[0] === 'publish') {
  const allowed = new Set(['--access=public', '--ignore-scripts', '--tag=latest', '--json', '--dry-run']);
  assert.ok(args.slice(1).every(arg => !arg.startsWith('-') || allowed.has(arg)), 'Unsupported or contradictory publish options');
  const tarballs = args.slice(1).filter(arg => !arg.startsWith('-'));
  assert.equal(tarballs.length, 1, 'Publish exactly one frozen local tgz');
  assert.ok(tarballs[0].endsWith('.tgz') && !/^https?:\/\//.test(tarballs[0]), 'Directory and remote publishes are not allowed');
}
const config = join(homedir(), '.config/dsh-plugin-release/npmrc');
const stat = await lstat(config).catch(() => null);
if (!stat?.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('The existing personal npmrc must be an ordinary private file (0600); configure it outside this repository.');
const area = join(root, '.release/npm-public'); await mkdir(area, { recursive: true, mode: 0o700 });
// Resolve local tarballs before changing to an isolated empty working directory.
const command = args.map(arg => arg.endsWith('.tgz') && !/^https?:\/\//.test(arg) ? resolve(arg) : arg);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key) && !['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_AUTH_TOKEN'].includes(key)));
const fixed = ['--registry=https://registry.npmjs.org/', '--userconfig=' + config, '--globalconfig=/dev/null', '--cache=' + join(area, 'cache'), '--update-notifier=false'];
// A cwd below this repository would inherit its project npmrc. Keep npm's
// project discovery outside the source tree as well as isolating user/global config.
const work = await mkdtemp(join(tmpdir(), 'dsh-achievement-helper-npm-'));
try {
if (command[0] === 'publish') {
  const allowedFlags = new Set(['--access=public', '--ignore-scripts', '--tag=latest', '--json', '--dry-run']);
  assert.ok(command.slice(1).every(arg => !arg.startsWith('-') || allowedFlags.has(arg)), 'Unsupported or contradictory publish options');
  const tarballs = command.slice(1).filter(arg => !arg.startsWith('-'));
  assert.equal(tarballs.length, 1, 'Publish exactly one frozen local tgz'); assert.ok(tarballs[0].endsWith('.tgz') && !/^https?:\/\//.test(tarballs[0]), 'Directory and remote publishes are not allowed');
  const report = JSON.parse(await readFile(join(root, '.release/package-report.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(report.name, 'dsh-achievement-helper'); assert.equal(report.name, manifest.name); assert.equal(report.version, manifest.version);
  const git = args => { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0); return result.stdout.trim(); };
  assert.equal(git(['status', '--porcelain']), '', 'Publish a clean frozen checkout'); assert.equal(git(['rev-parse', 'HEAD']), report.sourceCommit);
  for (const file of [tarballs[0], report.archive, report.stableArchive]) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), report.sha256, 'Publish bytes must match the frozen candidate');
  if (!command.includes('--dry-run')) {
    assert.ok(process.stdin.isTTY && process.stdout.isTTY, 'Actual publication requires an interactive terminal for normal authentication');
    const identity = spawnSync('npm', ['whoami', '--json', ...fixed], { cwd: work, env, encoding: 'utf8' });
    assert.equal(identity.status, 0, 'Log in to the personal public npm account before publishing');
    assert.equal(JSON.parse(identity.stdout), 'ghang', 'The public npm publisher must be ghang');
  }
}
const result = spawnSync('npm', [...command, ...fixed], { cwd: work, env, stdio: 'inherit' });
if (result.error) throw new Error('The public npm command could not start.');
process.exitCode = result.status ?? 1;
} finally { await rm(work, { recursive: true, force: true }); }
