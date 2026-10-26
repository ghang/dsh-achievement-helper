import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2); assert.equal(args[0], '--channel'); assert.ok(['npm', 'github'].includes(args[1]) && args.length === 2);
const report = JSON.parse(await readFile(new URL('../.release/package-report.json', import.meta.url), 'utf8'));
assert.equal(report.name, 'dsh-achievement-helper');
const local = await readFile(report.archive); assert.equal(createHash('sha256').update(local).digest('hex'), report.sha256);
let url;
if (args[1] === 'npm') {
  const metadata = await fetch(`https://registry.npmjs.org/${report.name}/${report.version}`, { signal: AbortSignal.timeout(20000) });
  assert.equal(metadata.status, 200, 'The exact npm version is not publicly available yet');
  const item = await metadata.json(); assert.equal(item.name, report.name); assert.equal(item.version, report.version);
  assert.equal(createHash('sha1').update(local).digest('hex'), item.dist.shasum);
  const tokens = item.dist.integrity.split(/\s+/); assert.ok(tokens.includes('sha512-' + createHash('sha512').update(local).digest('base64')));
  url = item.dist.tarball; const parsed = new URL(url); assert.equal(parsed.protocol, 'https:'); assert.equal(parsed.hostname, 'registry.npmjs.org');
} else url = `https://github.com/ghang/dsh-achievement-helper/releases/download/v${report.version}/dsh-achievement-helper.tgz`;
const response = await fetch(url, { signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200);
const remote = Buffer.from(await response.arrayBuffer()); assert.deepEqual(remote, local); assert.equal(createHash('sha256').update(remote).digest('hex'), report.sha256);
console.log(JSON.stringify({ status: 'passed', channel: args[1], name: report.name, version: report.version, sha256: report.sha256, bytes: remote.length }));
