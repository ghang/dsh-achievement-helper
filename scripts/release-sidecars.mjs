import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const name = 'dsh-achievement-helper';
const reportFile = 'package-report.json';
const requireRule = (condition, file, rule) => { if (!condition) throw new Error(`${file}: ${rule}`); };

export function releaseSidecars(out, report) {
  requireRule(report?.name === name, reportFile, 'package-name-mismatch');
  requireRule(typeof report.version === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(report.version), reportFile, 'invalid-version');
  for (const key of ['sourceCommit', 'sourceTree']) requireRule(typeof report[key] === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(report[key]), reportFile, `invalid-${key}`);
  for (const key of ['sha256', 'sourceSha256']) requireRule(typeof report[key] === 'string' && /^[a-f0-9]{64}$/.test(report[key]), reportFile, `invalid-${key}`);
  requireRule(Number.isSafeInteger(report.bytes) && report.bytes > 0, reportFile, 'invalid-bytes');
  requireRule(Array.isArray(report.files) && report.files.length > 0 && report.files.every(file => typeof file === 'string' && file.length > 0 && !file.startsWith('/') && !file.includes('\\') && !file.split('/').some(part => !part || part === '.' || part === '..')) && new Set(report.files).size === report.files.length, reportFile, 'invalid-files');
  requireRule(report.sourceTests === 'passed' && report.artifactTests === 'passed' && report.published === false, reportFile, 'invalid-frozen-status');
  const filename = `${name}-${report.version}.tgz`, stableFilename = `${name}.tgz`;
  requireRule(report.archive === join(out, filename), reportFile, 'versioned-archive-path-mismatch');
  requireRule(report.stableArchive === join(out, stableFilename), reportFile, 'stable-archive-path-mismatch');
  return {
    checksums: `${report.sha256}  ${filename}\n${report.sha256}  ${stableFilename}\n`,
    plan: { name: report.name, version: report.version, sourceCommit: report.sourceCommit, sourceTree: report.sourceTree,
      sha256: report.sha256, bytes: report.bytes, files: report.files, stableArchive: report.stableArchive, versionedArchive: report.archive,
      gitHub: { repository: 'ghang/dsh-achievement-helper', tag: 'v' + report.version, created: false, published: false },
      npm: { name: report.name, version: report.version, published: false }, market: { entry: 'data/plugins/ghang__dsh-achievement-helper.yml', submitted: false } },
  };
}

async function readChecked(out, file, encoding) {
  try { return await readFile(join(out, file), encoding); }
  catch { throw new Error(`${file}: missing-or-unreadable`); }
}

export async function verifyReleaseSidecars(out, report) {
  const expected = releaseSidecars(out, report);
  requireRule(await readChecked(out, 'SHA256SUMS', 'utf8') === expected.checksums, 'SHA256SUMS', 'frozen-checksums-mismatch');
  let plan;
  try { plan = JSON.parse(await readChecked(out, 'release-plan.json', 'utf8')); }
  catch { throw new Error('release-plan.json: missing-or-invalid'); }
  requireRule(isDeepStrictEqual(plan, expected.plan), 'release-plan.json', 'frozen-plan-mismatch');
}

export async function verifyFrozenCandidate(out, report, expected) {
  releaseSidecars(out, report);
  for (const key of ['name', 'version', 'node', 'sourceCommit', 'sourceTree', 'sourceSha256']) requireRule(report[key] === expected[key], reportFile, `frozen-${key}-mismatch`);
  for (const file of [`${report.name}-${report.version}.tgz`, `${report.name}.tgz`]) {
    const bytes = await readChecked(out, file);
    requireRule(bytes.length === report.bytes, file, 'frozen-bytes-mismatch');
    requireRule(createHash('sha256').update(bytes).digest('hex') === report.sha256, file, 'frozen-sha256-mismatch');
  }
  await verifyReleaseSidecars(out, report);
}

// The report is the success marker. Rename it only after both sidecars exist.
export async function publishReleaseMetadata(out, report, io = { writeFile, rename, rm }) {
  const sidecars = releaseSidecars(out, report);
  for (const [file, content] of [['SHA256SUMS', sidecars.checksums], ['release-plan.json', JSON.stringify(sidecars.plan, null, 2) + '\n'], [reportFile, JSON.stringify(report, null, 2) + '\n']]) {
    const temporary = join(out, `.${file}.${randomUUID()}.tmp`);
    try {
      await io.writeFile(temporary, content, { flag: 'wx' });
      await io.rename(temporary, join(out, file));
    } catch {
      throw new Error(`${file}: atomic-publish-failed`);
    } finally {
      await io.rm(temporary, { force: true }).catch(() => {});
    }
  }
}
