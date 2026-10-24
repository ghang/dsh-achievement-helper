import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm';
import Sessions from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import Agents from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import FsLocal from '@deepseek-ai/dsh-fs-local';
import * as ToolFs from '@deepseek-ai/dsh-tool-fs';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import * as Present from '@deepseek-ai/dsh-tool-present';
import { fakeUpstream } from './fake-upstream.mjs';
const source = process.env.JOURNAL_ARTIFACT ? new URL(`file://${process.env.JOURNAL_ARTIFACT}/lib/index.mjs`) : new URL('../src/index.mjs', import.meta.url);
const { createAchievementJournal } = await import(source);

async function eventually(read) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { const value = read(); if (value) return value; await delay(10); }
  throw new Error('Timed out waiting for observed journal facts');
}

test('native AgentLoop → real tools → journal: model config, file sequence, present, report and usage', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'achievement-integration-'));
  await writeFile(join(dir, 'fixture.ts'), 'export const value = 1;\n');
  const script = [
    { calls: [{ id: 'catalog', name: 'achievement_catalog' }] },
    { calls: [{ id: 'configure', name: 'achievement_configure', input: { requestId: 'integration-config', definitions: [
      { title: '一轮新章', rule: { template: 'count', metric: 'turn_completed', target: 1 } },
      { title: '项目纪念', rule: { template: 'model_report' } },
    ] } }] },
    { calls: [{ id: 'read', name: 'read', input: { file_path: 'fixture.ts' } }] },
    { calls: [{ id: 'edit', name: 'edit', input: { file_path: 'fixture.ts', old_string: 'value = 1', new_string: 'value = 2' } }] },
    { calls: [{ id: 'present', name: 'present', input: { files: [{ path: 'fixture.ts' }] } }] },
    { text: 'Synthetic work finished.' },
  ];
  const upstream = await fakeUpstream(script); const ctx = new Context(); let service;
  t.after(async () => { await service?.dispose(); await ctx.fiber.dispose(); await upstream.close(); await rm(dir, { recursive: true, force: true }); });
  for (const plugin of [Llm, Sessions, Projections]) await ctx.plugin(plugin);
  await ctx.plugin(SystemPrompt, { personaPrefix: 'Synthetic local integration.' });
  for (const plugin of [Tools, Agents]) await ctx.plugin(plugin);
  await ctx.plugin(AgentLoop, { agents: [] });
  for (const plugin of [FsLocal, WorkingDirectory, ToolFs]) await ctx.plugin(plugin);
  await ctx.plugin(Present, { maxFiles: 8 });
  ctx.llm.registerAdapter(['deepseek-official'], new DeepSeekAdapter({
    options: () => resolveAdapterOptions({ baseURL: upstream.url, retryPolicy: { mode: 'normal', maxRetries: 0 } }),
    resolveAuth: async () => ({ headers: { 'x-api-key': 'synthetic-only' } }),
    resolveUserId: () => 'achievement-local-test', resolveAttachments: () => undefined,
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  }));
  service = await createAchievementJournal(ctx, { statePath: join(dir, 'journal/state.json'), registerHttp: false });
  const agent = await ctx.agentLoop.create('synthetic-achievement', { provider: 'deepseek-official', model: 'deepseek-flash' }, { cwd: dir });
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic configure and edit workflow.' }] }));
  await agent.whenIdle();
  await eventually(() => service.snapshot().totals.turns === 1);
  const s = service.snapshot();
  assert.equal(upstream.requests.length, 6);
  assert.match(await readFile(join(dir, 'fixture.ts'), 'utf8'), /value = 2/);
  assert.equal(s.totals.tokens, 6 * 310);
  assert.equal(s.totals.fileReads, 1); assert.equal(s.totals.fileChanges, 1); assert.equal(s.totals.presentations, 1);
  assert.ok(s.awards.some(a => a.rule?.recipe === 'read_then_change'));
  assert.ok(s.awards.some(a => a.title === '一轮新章'));
  const reportDef = s.definitions.find(d => d.title === '项目纪念'); assert.ok(reportDef);
  const reported = await service.mutate('report', { requestId: 'report-1', definitionId: reportDef.id }, { source: 'model', sessionId: 'opaque-test' });
  assert.equal(reported.awards.find(a => a.definitionId === reportDef.id).source, 'model_report');
  assert.ok(service.snapshot().notifications.some(n => n.kind === 'unlock'), 'polling sees committed mutation notifications');
  const schemas = upstream.requests.map(r => JSON.stringify(r.tools));
  assert.ok(schemas.every(s => s === schemas[0]), 'configuring achievements does not re-register or change tool schemas');
  const stored = await readFile(join(dir, 'journal/state.json'), 'utf8');
  assert.ok(!stored.includes(dir)); assert.ok(!stored.includes('Synthetic configure and edit workflow'));
});
