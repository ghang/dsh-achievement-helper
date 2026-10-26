import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forbiddenPath, textIssues, auditFiles } from '../scripts/release-audit.mjs';

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
