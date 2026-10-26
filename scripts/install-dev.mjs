import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const projectConfig = await lstat(join(root, '.npmrc')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
if (projectConfig) throw new Error('A project npmrc would override isolated settings; use a clean checkout without it.');
const dependency = await lstat(join(root, 'node_modules')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
if (dependency?.isSymbolicLink()) throw new Error('Refusing to install into a runtime/profile dependency link.');
const cache = join(root, '.release/dev-cache'); await mkdir(cache, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key) && !['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_AUTH_TOKEN'].includes(key)));
// npm on Linux rejects loading one file as both user and global configuration.
// Use two distinct empty files, without inheriting either personal configuration.
const configDir = await mkdtemp(join(tmpdir(), 'dsh-achievement-helper-dev-'));
try {
  const userConfig = join(configDir, 'user.npmrc'), globalConfig = join(configDir, 'global.npmrc');
  await writeFile(userConfig, '', { flag: 'wx', mode: 0o600 });
  await writeFile(globalConfig, '', { flag: 'wx', mode: 0o600 });
  const result = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', '--userconfig=' + userConfig, '--globalconfig=' + globalConfig, '--cache=' + cache], { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw new Error('The isolated development install could not start.');
  process.exitCode = result.status ?? 1;
} finally { await rm(configDir, { recursive: true, force: true }); }
