import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile, readdir, mkdtemp } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { THEME_IDS } from '../src/collection.mjs';
import { PORTRAIT_LIMITS, PORTRAIT_STYLE_IDS, inspectPortraitWebP } from '../src/portrait-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, '.release'); await mkdir(out, { recursive: true });
assert.equal((await lstat(join(root, 'node_modules'))).isSymbolicLink(), false, 'Use independent locked dev dependencies');
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key) && !['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_AUTH_TOKEN'].includes(key)));
const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, { cwd: root, env: { ...baseEnv, ...env }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) { process.stderr.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? ''); throw new Error(`${command} failed (${result.status})`); }
  return result.stdout;
};
const testFiles = (await readdir(join(root, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => 'tests/' + name);
const tests = run(process.execPath, ['--test', '--test-reporter=tap', ...testFiles]);
await writeFile(join(out, 'source-tests.tap'), tests);
assert.match(tests, /# fail 0/); assert.match(tests, /# skipped 0/);
run(process.execPath, ['scripts/build.mjs']);
const emptyUser = join(out, 'empty-user.npmrc'), emptyGlobal = join(out, 'empty-global.npmrc');
await writeFile(emptyUser, ''); await writeFile(emptyGlobal, '');
const pack = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out,
  '--cache', join(out, 'npm-cache'), '--userconfig', emptyUser, '--globalconfig', emptyGlobal, '--registry=https://registry.npmjs.org/']))[0];
const archive = join(out, pack.filename);
const portraitFiles = PORTRAIT_STYLE_IDS.flatMap(style => THEME_IDS.map(theme => `lib/assets/portraits/${style}/${theme}.webp`));
const extraFiles = new Set([...portraitFiles, 'lib/portrait-manifest.json', 'lib/client.css']);
assert.ok(pack.files.every(file => extraFiles.has(file.path) || /^(package.json|README.md|LICENSE|CHANGELOG.md|cordis.patch.yml|lib\/[^/]+\.(?:mjs|js))$/.test(file.path)), 'Unexpected packaged files');
assert.deepEqual(pack.files.filter(file => file.path.endsWith('.webp')).map(file => file.path).sort(), [...portraitFiles].sort(), 'The tgz must contain exactly the twenty reviewed flat/pixel portrait sheets');
let totalPortraitBytes = 0;
for (const entry of pack.files) {
  if (portraitFiles.includes(entry.path)) {
    const info = inspectPortraitWebP(await readFile(join(root, entry.path)));
    totalPortraitBytes += info.bytes;
    continue; // Raster bytes are validated as bytes, never decoded as UTF-8 prose.
  }
  const text = await readFile(join(root, entry.path), 'utf8');
  assert.ok(!/\/Users\/[A-Za-z0-9_.-]+\/|[?&]token=[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/.test(text), `Private material in ${entry.path}`);
}
assert.ok(totalPortraitBytes <= PORTRAIT_LIMITS.totalBytes, 'Packaged portrait sheets exceed the total asset budget');
const extracted = await mkdtemp(join(out, 'artifact-'));
run('/usr/bin/tar', ['-xzf', archive, '-C', extracted]);
const artifact = join(extracted, 'package');
assert.deepEqual((await readdir(join(artifact, 'lib/assets/portraits'))).sort(), [...PORTRAIT_STYLE_IDS].sort());
for (const style of PORTRAIT_STYLE_IDS) assert.deepEqual((await readdir(join(artifact, 'lib/assets/portraits', style))).sort(), THEME_IDS.map(theme => `${theme}.webp`).sort());
const { createPortraitAssets } = await import(pathToFileURL(join(artifact, 'lib/portrait-assets.mjs')));
const packagedPortraits = await createPortraitAssets();
const portraitReport = await packagedPortraits.verifyAll();
assert.equal(portraitReport.assets.length, 20); assert.equal(portraitReport.totalBytes, totalPortraitBytes);
for (const asset of portraitReport.assets) {
  const url = packagedPortraits.manifest.styles[asset.style].themes[asset.theme].url;
  let status, headers, body;
  const served = await packagedPortraits.serve({ method: 'GET', url, headers: {} }, { writeHead(value, fields) { status = value; headers = fields; }, end(value) { body = value; } }, url);
  assert.equal(served, true); assert.equal(status, 200); assert.equal(headers['content-type'], 'image/webp');
  assert.equal(body.length, asset.bytes); assert.equal(createHash('sha256').update(body).digest('hex'), asset.sha256);
  assert.equal(createHash('sha256').update(await readFile(join(root, 'lib/assets/portraits', asset.file))).digest('hex'), asset.sha256, 'Unpacked assets must match the built candidate');
}
// Tests use only the unpacked code; the same locked dev runtime supplies peers.
run('/bin/ln', ['-s', join(root, 'node_modules'), join(artifact, 'node_modules')]);
const artifactTests = run(process.execPath, ['--test', '--test-reporter=tap', 'tests/integration.test.mjs', 'tests/http.test.mjs', 'tests/collection-http.test.mjs', 'tests/debug-http.test.mjs', 'tests/rename-http.test.mjs', 'tests/generation-integration.test.mjs', 'tests/portrait-assets.test.mjs', 'tests/portrait-http.test.mjs'], { JOURNAL_ARTIFACT: artifact });
await writeFile(join(out, 'artifact-tests.tap'), artifactTests);
assert.match(artifactTests, /# fail 0/); assert.match(artifactTests, /# skipped 0/);
const bytes = await readFile(archive); const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const digest = createHash('sha256').update(bytes).digest('hex');
const report = { version: manifest.version, node: process.version, archive, bytes: bytes.length, sha256: digest,
  files: pack.files.map(f => f.path), sourceTests: 'passed', artifactTests: 'passed', portraitAssets: { status: 'passed', styles: PORTRAIT_STYLE_IDS, files: portraitReport.assets.length, bytes: portraitReport.totalBytes }, published: false };
await writeFile(join(out, 'package-report.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(join(out, 'SHA256SUMS'), `${digest}  ${pack.filename}\n`);
console.log(JSON.stringify(report, null, 2));
