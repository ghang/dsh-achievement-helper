import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const script = new URL('../scripts/public-npm.mjs', import.meta.url);
test('publication aliases and configuration overrides are rejected before npm/authentication', () => {
  for (const args of [['pub'], ['pu'], ['whoami', '--registry=https://registry.invalid/'], ['publish', 'candidate.tgz', '--userconfig=/dev/null']]) {
    const result = spawnSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /explicit supported npm command|without registry\/config\/cache\/auth overrides/);
  }
});
test('publication rejects directory, remote, multiple or contradictory dry-run inputs before inspecting account configuration', () => {
  for (const args of [['publish', '.'], ['publish', 'https://packages.invalid/candidate.tgz'], ['publish', 'first.tgz', 'second.tgz'], ['publish', 'candidate.tgz', '--dry-run', '--dry-run=false']]) {
    const result = spawnSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /Directory and remote publishes|exactly one frozen|contradictory publish/);
  }
});
