import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = name => process.env.JOURNAL_ARTIFACT ? pathToFileURL(join(process.env.JOURNAL_ARTIFACT, 'lib', name)) : new URL('../src/' + name, import.meta.url);
const { createJournal } = await import(moduleUrl('journal.mjs'));
const { createDebugController } = await import(moduleUrl('debug.mjs'));
const { createGenerationController } = await import(moduleUrl('generation.mjs'));

// Each test file runs in its own Node process. Restore both the platform
// descriptor and named builtin bindings before cleanup or the next test.
async function fault(root, { stage, code = 'EPERM', platform = 'win32' }, operation) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const open = fs.open, rename = fs.rename, failures = [];
  const matches = path => resolve(String(path)).startsWith(resolve(root) + sep);
  const fail = phase => { const error = Object.assign(new Error('Synthetic storage fault'), { code, syscall: phase }); failures.push(error); throw error; };
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
  fs.open = async (file, flags, ...rest) => {
    const selected = matches(file), directory = selected && flags === 'r';
    if (directory && stage === 'directory-open') fail('open');
    const handle = await open(file, flags, ...rest);
    if (!selected) return handle;
    const temporary = String(file).includes('.tmp-') || String(file).endsWith('archive.tmp');
    if (temporary && stage === 'file-write') handle.writeFile = async () => fail('write');
    if (directory && stage === 'directory-sync' || temporary && stage === 'file-sync') handle.sync = async () => fail('fsync');
    if (directory && stage === 'directory-close') {
      const close = handle.close.bind(handle); handle.close = async () => { await close(); fail('close'); };
    }
    return handle;
  };
  fs.rename = async (from, to) => { if (matches(to) && stage === 'rename') fail('rename'); return rename(from, to); };
  syncBuiltinESMExports();
  try { return await operation(failures); }
  finally { fs.open = open; fs.rename = rename; Object.defineProperty(process, 'platform', descriptor); syncBuiltinESMExports(); }
}
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'achievement-windows-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  // Non-ASCII and spaces also exercise real local path handling.
  const directory = join(root, '档案 with spaces'); await fs.mkdir(directory);
  return { root, directory, file: join(directory, 'journal.json') };
}
for (const stage of ['directory-open', 'directory-sync']) {
  test(`Windows ${stage} EPERM permits initial creation, archive writes and idempotent draws`, async t => {
    const f = await fixture(t);
    await fault(f.root, { stage }, async failures => {
      const journal = await createJournal({ file: f.file, randomInt: () => 0 });
      try {
        await journal.preferences({ theme: 'xianxia' });
        await journal.ingest([{ id: 'read', kind: 'file_read', at: 1000, sessionId: 'session', turnKey: 'turn', key: 'opaque' }]);
        await journal.draw({ requestId: 'windows-draw', theme: 'xianxia' });
        const saved = await fs.readFile(f.file, 'utf8'), disk = JSON.parse(saved);
        assert.equal(disk.preferences.theme, 'xianxia'); assert.equal(disk.collection.draws.length, 1);
        assert.equal(disk.collection.points.spent, 1); assert.equal(journal.snapshot().storage.status, 'ready');
        await journal.draw({ requestId: 'windows-draw', theme: 'xianxia' });
        assert.equal(await fs.readFile(f.file, 'utf8'), saved); assert.ok(failures.length >= 4);
      } finally { await journal.close(); }
      const reopened = await createJournal({ file: f.file });
      assert.equal(reopened.snapshot().collection.points.spent, 1); await reopened.close();
    });
  });
  test(`Windows ${stage} EPERM permits debug copy, mutations, reset and disposal without real-data changes`, async t => {
    const f = await fixture(t), journal = await createJournal({ file: f.file });
    const copies = join(f.directory, 'copies'); await fs.mkdir(copies);
    const controller = createDebugController({ journal, statePath: f.file, tmpRoot: copies });
    const before = await fs.readFile(f.file, 'utf8');
    try {
      await fault(f.root, { stage }, async failures => {
        const first = await controller.start();
        await controller.mutate(first.token, 'preferences', { theme: 'xianxia' });
        assert.equal(controller.get(first.token).snapshot().preferences.theme, 'xianxia');
        const next = await controller.reset(first.token); assert.notEqual(next.token, first.token);
        assert.throws(() => controller.get(first.token), { code: 'DEBUG_SCOPE_EXPIRED' });
        await controller.exit(next.token); assert.deepEqual(await fs.readdir(copies), []);
        assert.ok(failures.length >= 3); assert.equal(await fs.readFile(f.file, 'utf8'), before);
      });
    } finally { await controller.dispose(); await journal.close(); }
  });
  test(`Windows ${stage} EPERM permits one complete generation and receipt replay`, async t => {
    const f = await fixture(t), journal = await createJournal({ file: f.file }); await journal.preferences({ theme: 'xianxia' });
    const file = join(f.directory, 'generation.json'); let calls = 0, controller;
    const ctx = { agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'fixture' }) }, llm: {
      listProviders: () => [{ id: 'fixture' }], async prepareCall(config) { return { config, async *stream() {
        calls++;
        yield { type: 'text-delta', index: 0, text: JSON.stringify({ definitions: [{ title: '新页有迹', description: '实际阅读三份文件。', icon: 'book', rule: { template: 'count', metric: 'file_read', target: 3 } }] }) };
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 15, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 25 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } }; },
    } };
    const catalog = () => ({ ...journal.catalog(), capabilities: { sources: [{ kind: 'file_read', connected: true }], recipes: [] } });
    const input = { requestId: 'windows-generation', metrics: ['file_read'], theme: 'xianxia', style: 'balanced', count: 1 };
    try {
      await fault(f.root, { stage }, async failures => {
        controller = await createGenerationController({ ctx, journal, file, catalog, apply: input => journal.configure(input, { source: 'user' }) });
        const first = await controller.start(input);
        for (let i = 0; i < 300 && ((await controller.info()).activeJob || controller.get().job.status === 'running'); i++) await new Promise(done => setTimeout(done, 5));
        const final = controller.get().job; assert.equal(final.status, 'succeeded'); assert.equal(final.createdDefinitionIds.length, 1);
        assert.equal((await controller.info()).available, true); assert.equal(calls, 1); assert.ok(failures.length >= 4);
        const saved = await fs.readFile(file, 'utf8'); assert.equal(JSON.parse(saved).jobs[0].status, 'succeeded');
        assert.equal((await controller.start(input)).job.id, first.job.id); assert.equal(calls, 1); assert.equal(await fs.readFile(file, 'utf8'), saved);
      });
    } finally { await controller?.dispose(); await journal.close(); }
  });
}
for (const stage of ['file-write', 'file-sync', 'rename']) {
  test(`Windows ${stage} EPERM remains a real failure and retains the original archive and cause`, async t => {
    const f = await fixture(t), journal = await createJournal({ file: f.file });
    try {
      const before = await fs.readFile(f.file, 'utf8');
      await fault(f.root, { stage }, failures => assert.rejects(journal.preferences({ theme: 'xianxia' }), error => {
        assert.equal(error.code, 'PERSISTENCE_FAILED'); assert.equal(error.committed, false); assert.equal(error.cause, failures[0]); return true;
      }));
      assert.equal(await fs.readFile(f.file, 'utf8'), before); assert.equal(journal.snapshot().preferences.theme, 'explorer');
    } finally { await journal.close(); }
  });
}
for (const options of [
  { stage: 'directory-sync', code: 'EIO', platform: 'win32' },
  { stage: 'directory-close', code: 'EPERM', platform: 'win32' },
  { stage: 'directory-open', code: 'EPERM', platform: 'darwin' },
  { stage: 'directory-sync', code: 'EPERM', platform: 'linux' },
]) {
  test(`${options.platform} ${options.stage} ${options.code} still reports committed uncertainty and its cause`, async t => {
    const f = await fixture(t), journal = await createJournal({ file: f.file });
    try {
      await fault(f.root, options, failures => assert.rejects(journal.preferences({ theme: 'xianxia' }), error => {
        assert.equal(error.code, 'DURABILITY_UNCERTAIN'); assert.equal(error.committed, true); assert.equal(error.cause, failures[0]); return true;
      }));
      assert.equal(JSON.parse(await fs.readFile(f.file, 'utf8')).preferences.theme, 'xianxia');
      assert.equal(journal.snapshot().storage.status, 'durability_uncertain');
    } finally { await journal.close(); }
  });
}
