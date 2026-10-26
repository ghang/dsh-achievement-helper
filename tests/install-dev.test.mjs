import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'helper-install-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await copyFile(new URL('../scripts/install-dev.mjs', import.meta.url), join(root, 'scripts/install-dev.mjs'));
  const manifest = { name: 'helper-install-fixture', version: '1.0.0', scripts: { preinstall: 'node -e "require(\'fs\').writeFileSync(\'lifecycle-ran\', \'unexpected\')"' } };
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages: { '': { name: manifest.name, version: manifest.version, hasInstallScript: true } } }));
  return root;
}
function install(root) {
  return spawnSync(process.execPath, ['scripts/install-dev.mjs'], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, npm_config_registry: 'https://packages.invalid/', NPM_CONFIG_USERCONFIG: join(root, 'missing.npmrc'), NODE_AUTH_TOKEN: 'fixture' },
  });
}
test('the isolated installer works with real npm and never runs dependency lifecycle scripts', async t => {
  const root = await fixture(t), result = install(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await lstat(join(root, 'lifecycle-ran')).catch(error => error.code), 'ENOENT');
  assert.ok((await lstat(join(root, '.release/dev-cache'))).isDirectory());
});
test('the installer refuses project npm configuration and runtime dependency links', async t => {
  const root = await fixture(t);
  await writeFile(join(root, '.npmrc'), 'registry=https://packages.invalid/\n');
  let result = install(root);
  assert.equal(result.status, 1); assert.match(result.stderr, /project npmrc/);
  await rm(join(root, '.npmrc'));
  const target = join(root, 'runtime-dependencies'); await mkdir(target);
  await symlink(target, join(root, 'node_modules'), 'dir');
  result = install(root);
  assert.equal(result.status, 1); assert.match(result.stderr, /runtime\/profile dependency link/);
});
