import z from '@deepseek-ai/schemastery';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { open, mkdir, unlink, lstat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createJournal } from './journal.mjs';
import { createCollector } from './collector.mjs';
import { createGenerationController } from './generation.mjs';
import { THEME_IDS, ICON_IDS, ANIMATION_IDS } from './collection.mjs';
import { createDebugController } from './debug.mjs';
import { servePortraitAsset } from './portrait-assets.mjs';

export const name = 'achievement-journal';
export const inject = ['tools', 'sessions', 'webServer', 'connection', 'llm'];
export const Config = z.object({
  statePath: z.string().default('').description('成就档案文件；留空使用当前 DSH_HOME 下的独立存储。'),
});
const API = '/dsh-achievement-journal/api';
const METRICS = ['tokens', 'turn_completed', 'file_read', 'file_changed', 'format_read', 'skill_loaded',
  'delegate_completed', 'file_presented', 'route_used', 'recall_used', 'recipe', 'model_report'];
const TEMPLATES = ['count', 'distinct', 'first_seen', 'recipe', 'model_report'];
const RECIPES = ['read_then_change', 'skill_then_change', 'delegate_then_present', 'recall_then_change', 'search_read_change'];
const COLLECTION_ERRORS = {
  NOT_ENOUGH_POINTS: '解锁一枚成就获得 1 点，即可进行十连抽取。',
  CHARACTER_NOT_OWNED: '抽中后才能佩戴这位角色。',
  BUILTIN_CHARACTER_IMMUTABLE: '预设角色不能修改，可以新建自己的角色。',
  CHARACTER_POOL_IMMUTABLE: '已获得角色保留主题和稀有度，可以修改名字与外观。',
  INVALID_ART: '请选择 256 KiB 以内的 PNG、JPEG、GIF 或 WebP 图片。',
  RANDOM_UNAVAILABLE: '本次抽取未完成，成就点没有扣除，请重试。',
};
function optionalService(ctx, name) {
  try { const service = ctx.get?.(name); if (service !== undefined) return service; } catch { /* optional provider */ }
  try { return ctx[name]; } catch { return undefined; }
}
const error = (message, status = 400, code = 'JOURNAL_INVALID') => Object.assign(new Error(message), { status, code });
const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
};
async function bodyOf(req, limit = 65536) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw error('需要 application/json。', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw error(`配置超过 ${Math.ceil(limit / 1024)} KiB。`, 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error('无效 JSON。'); }
}
async function identity(file) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const idFile = join(dirname(file), 'identity-v1');
  try {
    const handle = await open(idFile, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(randomBytes(32).toString('hex')); await handle.sync(); } finally { await handle.close(); }
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const handle = await open(idFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== 64) throw error('成就身份文件无效，保留原档案并停止记录。', 503, 'JOURNAL_STORAGE');
    const salt = await handle.readFile('utf8');
    if (!/^[a-f0-9]{64}$/.test(salt)) throw error('成就身份文件损坏。', 503, 'JOURNAL_STORAGE');
    return value => createHmac('sha256', salt).update(String(value)).digest('hex');
  } finally { await handle.close(); }
}

// Recover only a provably dead local writer. A separate exclusive recovery
// guard prevents two booting processes from deleting each other's new lock.
async function recoverDeadWriter(file) {
  const lock = file + '.lock', guard = lock + '.recovery'; let recovery;
  try { recovery = await open(guard, 'wx', 0o600); } catch { return false; }
  let held;
  try {
    held = await open(lock, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await held.stat(); if (!stat.isFile() || stat.size > 1024) return false;
    const raw = await held.readFile('utf8'); const value = JSON.parse(raw);
    if (!Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.token !== 'string') return false;
    try { process.kill(value.pid, 0); return false; } catch (e) { if (e.code !== 'ESRCH') return false; }
    const current = await lstat(lock);
    if (current.dev !== stat.dev || current.ino !== stat.ino) return false;
    await unlink(lock); return true;
  } catch { return false; }
  finally { await held?.close(); await recovery.close(); await unlink(guard).catch(() => {}); }
}
function unavailableJournal() {
  const failure = () => Promise.reject(error('成就档案暂不可用，原数据已保留。', 503, 'JOURNAL_STORAGE'));
  return { snapshot: () => ({ revision: 0, createdAt: null, updatedAt: null,
    preferences: { theme: 'xianxia', portraitStyle: 'flat', notifications: 'all', reducedMotion: 'system', frameStyle: 'standard', frameHeight: 64 }, totals: {},
    level: { number: 1, current: null, next: null, progress: null, incomplete: true },
    definitions: [], awards: [], timeline: [], notifications: [], equipment: { badges: [], charm: null, character: null },
    collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: [], owned: [], draws: [] },
    storage: { status: 'unavailable', message: '档案加载失败，原数据已保留；请停止其它写入进程或修复存储后重新启用。' } }),
    catalog: () => ({ metrics: [], templates: [], available: false }),
    ingest: failure, configure: failure, deleteDefinitions: failure, rename: failure, configureCharacters: failure, draw: failure, drawReceipt: () => null, report: failure, preferences: failure, equip: failure, close: async () => {},
  };
}

const definitionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Existing definition id when editing; omit for a new one.' },
    title: { type: 'string', required: true, description: 'Short themed title, at most 60 characters.' },
    description: { type: 'string', description: 'Plain factual condition, at most 240 characters.' },
    icon: { type: 'string', description: 'A catalog icon key.' },
    category: { type: 'string', description: 'A catalog category.' },
    hidden: { type: 'boolean', description: 'Optional discovery achievement; condition is visible after unlock.' },
    themes: { type: 'object', additionalProperties: false, properties: Object.fromEntries(THEME_IDS.map(theme => [theme, {
      type: 'object', additionalProperties: false, properties: {
        title: { type: 'string', required: true }, description: { type: 'string' },
      },
    }])) },
    scope: { type: 'string', enum: ['all', 'current_workspace'] },
    rule: {
      type: 'object', required: true, additionalProperties: false,
      properties: {
        template: { type: 'string', required: true, enum: TEMPLATES },
        metric: { type: 'string', enum: METRICS, description: 'A supported catalog metric. Do not invent semantic outcomes.' },
        target: { type: 'integer', description: 'Positive bounded target for count/distinct.' },
        recipe: { type: 'string', enum: RECIPES },
      },
    },
  },
};
const characterSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Existing custom character id when changing presentation; omit for a new pool entry.' },
    name: { type: 'string', required: true, description: 'Short character or artifact name matching the chosen theme.' },
    description: { type: 'string', description: 'Short original character description; never include secrets.' },
    theme: { type: 'string', required: true, enum: THEME_IDS },
    rarity: { type: 'string', required: true, enum: ['N', 'R', 'SR', 'SSR'] },
    icon: { type: 'string', required: true, enum: ICON_IDS },
    animation: { type: 'string', required: true, enum: ANIMATION_IDS },
  },
};
const toolOutput = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

/** Creates the host bridge. Optional switches are for isolated integration tests only. */
export async function createAchievementJournal(ctx, config = {}) {
  const statePath = config.statePath || join(resolveDshHome(), 'storages', 'achievement-journal', 'journal-v1.json');
  let hashKey = config.hashKey;
  let journal = config.journal; let storageUnavailable = false;
  if (!hashKey) {
    try { hashKey = await identity(statePath); } catch { storageUnavailable = true; }
  }
  if (!journal && !storageUnavailable) {
    try { journal = await createJournal({ file: statePath }); }
    catch (e) {
      if (e.code === 'LOCK_HELD' && await recoverDeadWriter(statePath)) {
        try { journal = await createJournal({ file: statePath }); } catch { /* remain unavailable */ }
      }
      if (!journal) storageUnavailable = true;
    }
  }
  if (!journal || storageUnavailable) {
    storageUnavailable = true; journal = unavailableJournal();
    ctx.logger?.warn?.('achievement-journal: storage unavailable; existing archive retained');
  }
  // The fallback is ephemeral and never records facts; a damaged salt is not
  // reset and cannot silently re-key a previously earned collection.
  hashKey ??= value => createHmac('sha256', 'unavailable-ephemeral').update(String(value)).digest('hex');
  const disposers = []; let disposed = false; let closing = false; let ingestFailures = 0; let generation;
  let notifications = [];
  const now = config.now ?? Date.now;
  const debug = createDebugController({ journal, statePath, now });
  function remember(snapshot) {
    const ids = new Set(notifications.map(item => item.id));
    for (const entry of snapshot.notifications ?? []) if (!ids.has(entry.id)) {
      notifications.push({ ...entry, seenAt: now() }); ids.add(entry.id);
    }
    notifications = notifications.filter(item => now() - item.seenAt < 300000).slice(-64);
    return state();
  }
  const collector = createCollector({ ctx, hashKey, ingest: async (facts, options) => {
    if (disposed) return;
    try { return remember(await journal.ingest(facts, options)); }
    catch (e) { ingestFailures++; throw e; }
  } });
  function capabilities(agent) {
    const data = collector.capabilities();
    const tool = name => { try { return Boolean(ctx.tools?.get?.(name, agent)); } catch { return false; } };
    const service = name => Boolean(optionalService(ctx, name));
    const enabled = { file_read: tool('read'), format_read: tool('read'), file_changed: tool('edit') || tool('write'),
      skill_loaded: tool('skill'), file_presented: tool('present'), recall_used: service('sessionReferenceResolver') };
    const recipes = { read_then_change: enabled.file_read && enabled.file_changed, skill_then_change: enabled.skill_loaded && enabled.file_changed,
      delegate_then_present: service('subagents') && enabled.file_presented, recall_then_change: enabled.recall_used && enabled.file_changed,
      search_read_change: tool('grep') && enabled.file_read && enabled.file_changed };
    return { ...data, sources: data.sources.map(item => Object.hasOwn(enabled, item.kind)
      ? { ...item, connected: item.connected && enabled[item.kind], missing: enabled[item.kind] ? item.missing : 'required_tool_or_provider_unavailable' } : item),
      recipes: Object.entries(recipes).map(([id, available]) => ({ id, available: available && !storageUnavailable })) };
  }
  function catalog(agent) {
    return { ...journal.catalog(), capabilities: capabilities(agent),
      coverage: { mode: 'live_since_installation', since: journal.snapshot().createdAt, historyImport: false },
      instructions: '先查询此目录再配置。只使用可用指标；条件从配置后新增记录开始。自动事实由宿主判定；业务验收使用 model_report 并明确来源。主题仅改变表现。' };
  }
  function state() {
    const snapshot = journal.snapshot();
    const definitionsById = new Map(snapshot.definitions.map(item => [item.id, item]));
    const diagnostics = collector.diagnostics();
    const auxiliary = generation?.accounting?.() ?? { knownTokens: 0, unknownCalls: 0, observedCalls: 0 };
    const degraded = ingestFailures > 0 || diagnostics.ingestErrors > 0 || diagnostics.boundedDrops > 0 || diagnostics.droppedQueue > 0;
    return { ...snapshot, debug: { active: false }, notifications: notifications.filter(item => now() - item.seenAt < 300000).map(item => {
      const definition = definitionsById.get(item.definitionId);
      if (!definition) return item;
      // Notices live longer than a rename. Resolve display overrides from the
      // current definition instead of keeping the name from the earned event.
      const { customName, defaultTitle, ...notice } = item;
      return { ...notice, defaultTitle: definition.defaultTitle, ...(definition.customName === undefined ? {} : { customName: definition.customName }) };
    }),
      generation: { ...(generation?.get?.() ?? { job: null }), accounting: auxiliary },
      coverage: { ...(snapshot.coverage ?? {}), mode: 'live_since_installation', since: snapshot.createdAt,
        historyImport: false, capabilities: capabilities(), diagnostics, ingestFailures, degraded,
        complete: !storageUnavailable && snapshot.coverage?.complete !== false && !degraded && auxiliary.unknownCalls === 0,
        notes: ['只记录接入后完整观测到的新回合；没有自动导入历史。',
          ...(degraded ? ['部分事件未能入账或达到记录上限；当前数字为已记录下界，请检查存储状态。'] : []),
          ...(auxiliary.unknownCalls > 0 ? ['部分成就生成调用缺少完整用量回执，累计只包含已记录用量。'] : []),
          ...(storageUnavailable ? ['档案暂不可用，原始数据已保留；恢复存储后重新启用。'] : [])] } };
  }
  function debugState(token, snapshot = debug.get(token).snapshot()) {
    return { ...snapshot, debug: { active: true, sessionId: token, label: '调试模式' },
      generation: { job: null, accounting: { knownTokens: 0, unknownCalls: 0, observedCalls: 0 } },
      coverage: { ...(snapshot.coverage ?? {}), mode: 'debug_sandbox', historyImport: false,
        notes: ['调试操作只影响独立临时档案；真实工作记录继续单独累积。'] } };
  }
  function context(exec) {
    if (!exec.agent) throw error('需要来自当前工作会话的调用。');
    return { ...collector.contextFor(exec.agent), source: 'model' };
  }
  async function mutate(method, input, access = { source: 'user' }) {
    if (disposed || closing) throw error('成就手记正在关闭。', 503);
    return remember(await journal[method](input, access));
  }
  if (config.collect !== false && !storageUnavailable) await collector.start();
  const recordGenerationUsage = async receipt => {
    // A generation is an auxiliary call, never a synthetic work turn. Its
    // proven usage can contribute once; absent disclosure stays in the
    // generation receipt as unknown, without fabricating zero tokens.
    if (disposed) throw error('辅助用量仍在等待恢复入账。', 503, 'JOURNAL_CLOSED');
    if (!receipt.usage || !Number.isSafeInteger(receipt.totalTokens) || receipt.totalTokens < 0) return;
    const usage = { totalTokens: receipt.totalTokens };
    const fields = { inputTokens: 'uncachedInputTokens', outputTokens: 'outputTokens', cacheReadTokens: 'cacheReadTokens', cacheWriteTokens: 'cacheWriteTokens', reasoningTokens: 'reasoningTokens' };
    for (const [key, target] of Object.entries(fields)) if (Number.isSafeInteger(receipt.usage[key]) && receipt.usage[key] >= 0) usage[target] = receipt.usage[key];
    const id = hashKey(`generation:${receipt.id}`);
    try {
      remember(await journal.ingest([{ id: `generation:${id}`, kind: 'tokens', at: receipt.at,
        sessionId: `aux:${id}`, turnKey: `aux:${id}`, amount: receipt.totalTokens,
        evidence: { source: 'auxiliary_generation', usage, callKey: `aux:${id}` } }]));
    } catch (e) { ingestFailures++; throw e; }
  };
  try {
    generation = await createGenerationController({ ctx, journal, collector, catalog, apply: async (input, access) => {
      if (disposed || closing) throw error('成就手记正在关闭。', 503);
      let applied;
      if (input.kind === 'characters') {
        const { kind, ...charactersInput } = input;
        applied = await journal.configureCharacters(charactersInput, access);
      } else applied = await journal.configure(input, access);
      remember(applied); return applied;
    },
      recordUsage: recordGenerationUsage, file: statePath + '.generation-v1.json', hashKey, now });
  } catch {
    generation = { info: async () => ({ available: false, reason: '生成回执暂不可用，原文件已保留。' }),
      get: () => ({ job: null }), accounting: () => ({ knownTokens: 0, unknownCalls: 0, observedCalls: 0 }),
      start: async () => { throw error('生成回执暂不可用。', 503); }, cancel: async () => { throw error('生成回执暂不可用。', 503); }, dispose: async () => {} };
  }
  if (config.registerTools !== false) {
    const register = definition => {
      const dispose = ctx.tools.register(defineTool({ ...definition, output: toolOutput }));
      if (typeof dispose === 'function') disposers.push(dispose);
    };
    register({ name: 'achievement_catalog', description: 'Query supported achievement rules, themes, collection characters, rarity probabilities and animation presets before configuring. This does not trigger model calls or spend points.',
      parameters: {}, execute: async (_args, exec) => ({ ...catalog(exec.agent), generation: await generation.info({ sessionId: exec.agent?.session.id }) }) });
    register({ name: 'achievement_query', description: 'Read personal achievement progress and earned records. Token totals are observed use, not business quality or acceptance.',
      parameters: { id: { type: 'string', description: 'Optional definition id.' }, history: { type: 'boolean', description: 'Include the most recent 20 records.' }, collection: { type: 'boolean', description: 'Include point balance, owned character counts and character metadata; images are omitted.' } },
      execute: args => { const s = state(); return { revision: s.revision, preferences: s.preferences, totals: s.totals, level: s.level,
        definitions: s.definitions.filter(d => args.id ? d.id === args.id : d.status !== 'archived').slice(0, 64), coverage: s.coverage,
        ...(args.history ? { timeline: (s.timeline ?? []).slice(0, 20), awards: (s.awards ?? []).slice(-20) } : {}),
        ...(args.collection ? { collection: { points: s.collection.points, owned: s.collection.owned, drawInfo: s.collection.drawInfo,
          characters: s.collection.characters.slice(0, 128).map(({ art, ...metadata }) => metadata) } } : {}) }; } });
    register({ name: 'achievement_configure', description: 'Configure bounded achievement rules OR themed character pool entries, one kind per write. Query catalog first. Characters are definitions only: this never grants cards, draws, or changes points. New achievement rules count future observed activity. Never fabricate token use or user acceptance.',
      parameters: {
        requestId: { type: 'string', required: true, description: 'Unique stable id for this write; reuse unchanged on retry.' },
        expectedRevision: { type: 'integer', description: 'Revision from achievement_query for conflict protection.' },
        definitions: { type: 'array', items: definitionSchema, description: 'At most 20 new/updated definitions per write.' },
        characters: { type: 'array', items: characterSchema, description: 'Alternatively configure up to 8 themed character pool entries. No image URLs, scripts or raw SVG; use icon and animation catalog keys.' },
        archiveIds: { type: 'array', items: { type: 'string' }, description: 'Archive unfinished goals; preserve earned history.' },
        theme: { type: 'string', enum: THEME_IDS },
      }, execute: async (args, exec) => {
        if (args.characters !== undefined) {
          if (args.definitions !== undefined || args.archiveIds !== undefined || args.theme !== undefined) throw error('角色与成就请分两次配置。');
          if (!Array.isArray(args.characters) || args.characters.length > 8) throw error('每次最多配置 8 个角色。');
          if (args.characters.some(c => c && Object.hasOwn(c, 'art'))) throw error('模型角色请使用目录中的图标和动画预设。');
          const prefix = createHash('sha256').update(args.requestId).digest('hex').slice(0, 16);
          const requested = new Set(args.characters.map((c, i) => c.id || `character-${prefix}-${i + 1}`));
          const s = await mutate('configureCharacters', args, context(exec));
          return { revision: s.revision, collection: { points: s.collection.points,
            characters: s.collection.characters.filter(c => requested.has(c.id)).map(({ art, ...metadata }) => metadata) } };
        }
        const before = new Map(journal.snapshot().definitions.map(d => [d.id, d.revision]));
        const s = await mutate('configure', args, context(exec));
        const requested = new Set([...(args.definitions ?? []).map(d => d.id), ...(args.archiveIds ?? [])]);
        const changed = s.definitions.filter(d => !before.has(d.id) || requested.has(d.id) || before.get(d.id) !== d.revision);
        return { revision: s.revision, definitions: changed.slice(0, 20).map(({ id, title, description, source, rule, progress, target, status }) => ({ id, title, description, source, rule, progress, target, status })), theme: s.preferences.theme };
      } });
    register({ name: 'achievement_report', description: 'Record a model-declared personal milestone ONLY for a model_report rule. This is a model statement, not runtime verification or human acceptance. Cannot write tokens or grant automatically measured achievements.',
      parameters: { requestId: { type: 'string', required: true }, definitionId: { type: 'string', required: true }, note: { type: 'string', description: 'Optional short declaration; never include secrets or source text.' } },
      execute: async (args, exec) => { const s = await mutate('report', args, context(exec)); return { revision: s.revision, award: s.awards.find(a => a.definitionId === args.definitionId) }; } });
  }
  if (config.registerHttp !== false) {
    disposers.push(ctx.webServer.register({ kind: 'prefix', path: API, handler: async (req, res) => {
      try {
        const admission = ctx.connection.admit(req);
        if ('rejection' in admission) return json(res, admission.rejection, { error: '需要 DSH 浏览器登录。' });
        if (admission.peer.id !== ctx.connection.browserPeer.id) return json(res, 403, { error: '仅当前浏览器用户可访问。' });
        const url = new URL(req.url, 'http://local'); const path = url.pathname;
        if (await servePortraitAsset(req, res, url)) return;
        const scope = req.headers['x-daj-debug'];
        if (scope !== undefined && (typeof scope !== 'string' || !scope.trim())) throw error('调试会话无效，请退出后重新进入。', 409, 'DEBUG_SCOPE_EXPIRED');
        if (req.method === 'GET' && path === API + '/state') return json(res, 200, scope ? debugState(scope) : state());
        if (req.method === 'GET' && path === API + '/catalog') {
          if (scope) return json(res, 200, { ...debug.get(scope).catalog(), debug: { active: true }, capabilities: capabilities(),
            generation: { available: false, reason: '调试模式不调用模型。请退出调试后生成。', activeJob: null } });
          const sessionId = url.searchParams.get('sessionId') || undefined;
          let agent; try { agent = sessionId ? optionalService(ctx, 'agents')?.get?.(sessionId) : undefined; } catch { /* use the default/global view */ }
          return json(res, 200, { ...catalog(agent), generation: await generation.info({ sessionId }) });
        }
        if (req.method === 'GET' && path === API + '/generation') {
          if (scope) { debug.get(scope); return json(res, 200, { job: null }); }
          return json(res, 200, generation.get(url.searchParams.get('id') || undefined));
        }
        if (req.method === 'POST') {
          if (req.headers['sec-fetch-site'] === 'cross-site') throw error('拒绝跨站写入。', 403);
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw error('来源不匹配。', 403);
          if ([API + '/debug/start', API + '/debug/reset', API + '/debug/exit'].includes(path)) {
            const body = await bodyOf(req);
            if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw error('调试管理操作不接受附加数据。');
            if (path.endsWith('/start')) { const started = await debug.start(); return json(res, 200, { token: started.token, snapshot: debugState(started.token, started.snapshot) }); }
            if (path.endsWith('/reset')) { const reset = await debug.reset(scope); return json(res, 200, { token: reset.token, snapshot: debugState(reset.token, reset.snapshot) }); }
            await debug.exit(scope); return json(res, 200, { debug: null });
          }
          if (path === API + '/debug/action') {
            const body = await bodyOf(req); const snapshot = debugState(scope, await debug.action(scope, body));
            return json(res, 200, body.action === 'draw' ? { ...snapshot, draw: debug.get(scope).drawReceipt(body.requestId) } : snapshot);
          }
          if (scope && [API + '/generation', API + '/generation/cancel'].includes(path)) {
            debug.get(scope); throw error('调试模式不调用模型。请退出调试后生成。', 409, 'DEBUG_GENERATION_DISABLED');
          }
          if (path === API + '/generation') return json(res, 200, await generation.start(await bodyOf(req)));
          if (path === API + '/generation/cancel') { const body = await bodyOf(req); return json(res, 200, await generation.cancel(body.id)); }
          if (path === API + '/draw') {
            const body = await bodyOf(req); const snapshot = scope ? debugState(scope, await debug.mutate(scope, 'draw', body)) : await mutate('draw', body);
            return json(res, 200, { ...snapshot, draw: scope ? debug.get(scope).drawReceipt(body.requestId) : journal.drawReceipt(body.requestId) });
          }
          if (path === API + '/characters') {
            const body = await bodyOf(req, 3 * 1024 * 1024);
            return json(res, 200, scope ? debugState(scope, await debug.mutate(scope, 'configureCharacters', body)) : await mutate('configureCharacters', body));
          }
          if (path === API + '/delete') {
            const body = await bodyOf(req);
            return json(res, 200, scope ? debugState(scope, await debug.mutate(scope, 'deleteDefinitions', body)) : await mutate('deleteDefinitions', body));
          }
          if (path === API + '/rename') {
            const body = await bodyOf(req);
            return json(res, 200, scope ? debugState(scope, await debug.mutate(scope, 'rename', body)) : await mutate('rename', body));
          }
          const method = ({ preferences: 'preferences', equip: 'equip', configure: 'configure', report: 'report' })[path.slice(API.length + 1)];
          if (method) { const body = await bodyOf(req); return json(res, 200, scope ? debugState(scope, await debug.mutate(scope, method, body)) : await mutate(method, body)); }
        }
        return json(res, 404, { error: '接口不存在。' });
      } catch (e) {
        const code = String(e.code);
        const storageError = ['PERSISTENCE_FAILED', 'DURABILITY_UNCERTAIN', 'CORRUPT_STATE', 'SCHEMA_UNSUPPORTED', 'LOCK_HELD', 'CLOSED', 'BUDGET_EXCEEDED', 'COUNTER_OVERFLOW'].includes(code);
        const status = e.status ?? (storageError ? 503 : /CONFLICT|ARCHIVED|IMMUTABLE|REQUEST_ID_REUSED|INSUFFICIENT_POINTS|NOT_OWNED/.test(code) ? 409 : e.name === 'JournalError' || code.includes('INVALID') ? 400 : 500);
        json(res, status, { error: COLLECTION_ERRORS[code] || (code.startsWith('GENERATION_') || code.startsWith('DEBUG_') || status < 500 ? e.message : '成就存储暂不可用，已保留原档案，请查看宿主日志。'), code: e.code ?? 'JOURNAL_UNAVAILABLE' });
      }
    } }));
  }
  return { journal, collector, generation, debug, snapshot: state, catalog, mutate,
    async dispose() {
      if (disposed || closing) return; closing = true;
      for (const dispose of disposers.reverse()) await dispose?.();
      await debug.dispose();
      await generation.dispose();
      await collector.dispose(); disposed = true; await journal.close(); notifications = [];
    },
  };
}
export async function apply(ctx, config) {
  const service = await createAchievementJournal(ctx, config);
  ctx.effect(() => () => service.dispose(), 'achievement-journal: stop observers and close journal');
}
