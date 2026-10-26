import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { publishReleaseMetadata, releaseSidecars, verifyFrozenCandidate } from '../scripts/release-sidecars.mjs';

async function fixture(t, publish = true) {
  const out = await mkdtemp(join(tmpdir(), 'helper-release-sidecars-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const bytes = Buffer.from('synthetic frozen archive');
  const report = { name: 'dsh-achievement-helper', version: '0.2.0', node: process.version,
    archive: join(out, 'dsh-achievement-helper-0.2.0.tgz'), stableArchive: join(out, 'dsh-achievement-helper.tgz'),
    sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), sourceSha256: 'c'.repeat(64),
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), files: ['LICENSE', 'lib/index.mjs', 'package.json'],
    sourceTests: 'passed', artifactTests: 'passed', published: false };
  const expected = Object.fromEntries(['name', 'version', 'node', 'sourceCommit', 'sourceTree', 'sourceSha256'].map(key => [key, report[key]]));
  for (const file of [report.archive, report.stableArchive]) await writeFile(file, bytes);
  if (publish) await publishReleaseMetadata(out, report);
  return { out, report, expected, bytes };
}

test('a complete frozen candidate reuses both archives and sidecars without rewriting bytes', async t => {
  const { out, report, expected } = await fixture(t);
  const files = await readdir(out), before = await Promise.all(files.map(file => readFile(join(out, file))));
  await verifyFrozenCandidate(out, report, expected);
  assert.deepEqual(await Promise.all(files.map(file => readFile(join(out, file)))), before);
});

test('missing and stale checksum sidecars cannot turn a frozen report into success', async t => {
  const variants = {
    missing: null,
    'stale digest': text => text.replace(reportHash(text), '0'.repeat(64)),
    'missing alias': text => text.split('\n').slice(0, 1).join('\n') + '\n',
    'wrong alias': text => text.replace('dsh-achievement-helper.tgz', 'other.tgz'),
    'extra entry': text => text + '0'.repeat(64) + '  other.tgz\n',
  };
  for (const [label, mutate] of Object.entries(variants)) await t.test(label, async t => {
    const { out, report, expected } = await fixture(t), file = join(out, 'SHA256SUMS');
    if (mutate) await writeFile(file, mutate(await readFile(file, 'utf8'))); else await rm(file);
    await assert.rejects(verifyFrozenCandidate(out, report, expected), error => {
      assert.match(error.message, /^SHA256SUMS: /);
      assert.ok(!error.message.includes(out));
      return true;
    });
  });
});
const reportHash = text => text.slice(0, 64);

test('release plans must match the full frozen identity and default channel states', async t => {
  const changes = [
    ['name', 'other'], ['version', '0.2.1'], ['sourceCommit', 'd'.repeat(40)], ['sourceTree', 'e'.repeat(40)],
    ['sha256', 'f'.repeat(64)], ['bytes', 1], ['files', ['package.json']], ['stableArchive', 'other.tgz'], ['versionedArchive', 'other-0.2.0.tgz'],
    ['gitHub.repository', 'other/repo'], ['gitHub.tag', 'v0.2.1'], ['gitHub.created', true], ['gitHub.published', true],
    ['npm.name', 'other'], ['npm.version', '0.2.1'], ['npm.published', true], ['market.entry', 'other.yml'], ['market.submitted', true], ['unreviewed', true],
  ];
  for (const [key, value] of changes) await t.test(key, async t => {
    const { out, report, expected } = await fixture(t), file = join(out, 'release-plan.json');
    const plan = JSON.parse(await readFile(file, 'utf8')), parts = key.split('.');
    if (parts.length === 2) plan[parts[0]][parts[1]] = value; else plan[key] = value;
    await writeFile(file, JSON.stringify(plan));
    await assert.rejects(verifyFrozenCandidate(out, report, expected), /^Error: release-plan\.json: frozen-plan-mismatch$/);
  });
  for (const content of [null, '{']) await t.test(content === null ? 'missing' : 'invalid JSON', async t => {
    const { out, report, expected } = await fixture(t), file = join(out, 'release-plan.json');
    if (content === null) await rm(file); else await writeFile(file, content);
    await assert.rejects(verifyFrozenCandidate(out, report, expected), /^Error: release-plan\.json: missing-or-invalid$/);
  });
});

test('source identity, runtime, archive paths and both archive bytes are independently checked', async t => {
  for (const key of ['sourceCommit', 'sourceTree', 'sourceSha256', 'node']) await t.test(key, async t => {
    const { out, report, expected } = await fixture(t);
    const changed = { ...report, [key]: key === 'node' ? 'v22.19.0-fixture' : 'd'.repeat(report[key].length) };
    await publishReleaseMetadata(out, changed);
    await assert.rejects(verifyFrozenCandidate(out, changed, expected), new RegExp(`package-report\\.json: frozen-${key}-mismatch`));
  });
  for (const key of ['archive', 'stableArchive']) await t.test(key + ' identity', async t => {
    const { out, report, expected, bytes } = await fixture(t), other = join(out, 'other.tgz');
    await writeFile(other, bytes);
    await assert.rejects(verifyFrozenCandidate(out, { ...report, [key]: other }, expected), /package-report\.json: (?:versioned|stable)-archive-path-mismatch/);
  });
  for (const key of ['archive', 'stableArchive']) for (const alterLength of [false, true]) await t.test(key + (alterLength ? ' length' : ' hash'), async t => {
    const { out, report, expected, bytes } = await fixture(t), changed = Buffer.from(bytes);
    changed[0] ^= 1;
    await writeFile(report[key], alterLength ? Buffer.concat([changed, Buffer.from('!')]) : changed);
    await assert.rejects(verifyFrozenCandidate(out, report, expected), alterLength ? /frozen-bytes-mismatch/ : /frozen-sha256-mismatch/);
  });
  for (const key of ['sourceTests', 'artifactTests', 'published']) await t.test(key + ' status', async t => {
    const { out, report, expected } = await fixture(t);
    await assert.rejects(verifyFrozenCandidate(out, { ...report, [key]: key === 'published' ? true : 'failed' }, expected), /invalid-frozen-status/);
  });
});

test('the atomic success report becomes visible only after complete sidecars', async t => {
  const { out, report, expected } = await fixture(t, false), publications = [];
  await publishReleaseMetadata(out, report, { writeFile, rm, async rename(from, to) {
    const file = basename(to); publications.push(file);
    await assert.rejects(readFile(join(out, 'package-report.json')), { code: 'ENOENT' });
    if (file === 'package-report.json') {
      const sidecars = releaseSidecars(out, report);
      assert.equal(await readFile(join(out, 'SHA256SUMS'), 'utf8'), sidecars.checksums);
      assert.deepEqual(JSON.parse(await readFile(join(out, 'release-plan.json'), 'utf8')), sidecars.plan);
      assert.deepEqual(JSON.parse(await readFile(from, 'utf8')), report);
    }
    await rename(from, to);
  } });
  assert.deepEqual(publications, ['SHA256SUMS', 'release-plan.json', 'package-report.json']);
  await verifyFrozenCandidate(out, report, expected);
});

test('interrupted metadata writes leave no success report and recover without changing archives', async t => {
  for (const phase of ['write', 'rename']) for (const target of ['SHA256SUMS', 'release-plan.json', 'package-report.json']) await t.test(phase + ' ' + target, async t => {
    const { out, report, expected, bytes } = await fixture(t, false);
    const io = { rm, async writeFile(file, content, options) {
      if (phase === 'write' && basename(file).startsWith(`.${target}.`)) {
        await writeFile(file, content.slice(0, 5), options);
        throw new Error('synthetic interruption');
      }
      await writeFile(file, content, options);
    }, async rename(from, to) {
      if (phase === 'rename' && basename(to) === target) throw new Error('synthetic interruption');
      await rename(from, to);
    } };
    await assert.rejects(publishReleaseMetadata(out, report, io), error => error.message === `${target}: atomic-publish-failed`);
    await assert.rejects(readFile(join(out, 'package-report.json')), { code: 'ENOENT' });
    assert.ok((await readdir(out)).every(file => !file.endsWith('.tmp')));
    await publishReleaseMetadata(out, report);
    await verifyFrozenCandidate(out, report, expected);
    for (const file of [report.archive, report.stableArchive]) assert.deepEqual(await readFile(file), bytes);
  });
});
