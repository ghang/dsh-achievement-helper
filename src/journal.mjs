import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { syncParentDirectory } from './storage.mjs';
import { THEME_IDS as THEMES, ICON_IDS as ICONS, RARITIES, FRAME_STYLES, COLLECTION_LIMITS, ACHIEVEMENT_THEME_TITLES,
  collectionCatalog, freshCollection, presentCollection, syncCollectionPoints, validateCollection, configureCollectionCharacters, drawCollection } from './collection.mjs';

const VERSION = 2;
export const JOURNAL_LIMITS = Object.freeze({ facts: 100000, requests: 10000, definitions: 256, awards: 1024, timeline: 4096, bytes: 16 * 1024 * 1024, batch: 4096 });
const KINDS = ['tokens', 'turn_completed', 'file_read', 'file_changed', 'format_read', 'skill_loaded', 'delegate_completed', 'file_presented', 'route_used', 'recall_used', 'recipe'];
const TEMPLATES = ['count', 'distinct', 'first_seen', 'recipe', 'model_report'];
const RECIPES = ['read_then_change', 'skill_then_change', 'delegate_then_present', 'recall_then_change', 'search_read_change'];
const LEGACY_THEMES = ['explorer', 'xianxia', 'cyber'];
const LEGACY_ICONS = ['compass', 'star', 'book', 'flag', 'chat', 'spark', 'leaf', 'code', 'medal'];
const PORTRAIT_STYLES = ['flat', 'pixel'];
const KEYED = new Set(KINDS.filter(kind => !['tokens', 'turn_completed'].includes(kind)));
const HASH = /^[a-f0-9]{64}$/;
const has = (object, key) => Object.hasOwn(object, key);
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const same = (a, b) => stable(a) === stable(b);
const sum = (a, b) => { const result = a + b; if (!Number.isSafeInteger(result)) fail('COUNTER_OVERFLOW', 'A counter exceeded the safe integer range.'); return result; };

export class JournalError extends Error {
  constructor(code, message, options = {}) { super(message); this.name = 'JournalError'; this.code = code; Object.assign(this, options); }
}
function fail(code, message) { throw new JournalError(code, message); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function object(value, name) { if (!plain(value)) fail('INVALID_INPUT', `${name} must be a plain object.`); return value; }
function fields(value, allowed, name) { object(value, name); for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('INVALID_INPUT', `${name} contains an unsupported field.`); }
function integer(value, name, minimum = 0) { if (!Number.isSafeInteger(value) || value < minimum) fail('INVALID_INPUT', `${name} must be a safe integer at least ${minimum}.`); return value; }
function text(value, name, maximum, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) fail('INVALID_INPUT', `${name} must be nonempty text of at most ${maximum} characters.`);
  // These fields are short display copy, never filesystem references or source bodies.
  if (/(?:^|\s)(?:\/(?:Users|home|private|tmp|var|etc|Volumes|opt)\/|file:\/\/|[A-Za-z]:\\|~\/)/u.test(value)) fail('PRIVATE_PATH', `${name} cannot contain an absolute filesystem path.`);
  return value.trim();
}
function displayName(value) {
  const result = text(value, 'display name', 60);
  if (/\p{Cc}/u.test(value)) fail('INVALID_INPUT', 'A display name cannot contain control characters.');
  if (/(?:\/(?:Users|home|private|tmp|var|etc|Volumes|opt)\/|file:\/\/|[A-Za-z]:\\|~\/)/u.test(value)) fail('PRIVATE_PATH', 'A display name cannot contain a private filesystem path.');
  return result;
}
function opaque(value, name) { if (typeof value !== 'string' || value.length < 1 || value.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9_.:@+\-]*$/u.test(value)) fail('INVALID_INPUT', `${name} must be an opaque identifier, not a path or body.`); return value; }
function option(value, allowed, name) { if (!allowed.includes(value)) fail('INVALID_INPUT', `${name} is unsupported.`); return value; }
function bool(value, name) { if (typeof value !== 'boolean') fail('INVALID_INPUT', `${name} must be a boolean.`); return value; }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function safeContext(context) {
  object(context, 'context');
  const result = { source: option(context.source ?? 'model', ['model', 'user'], 'context.source') };
  for (const key of ['workspaceKey', 'sessionId', 'turnKey']) if (context[key] !== undefined) result[key] = opaque(context[key], `context.${key}`);
  return result;
}
function archiveDefinitions(state, ids, context, at) {
  const touched = new Set();
  for (const id of ids) {
    opaque(id, 'delete id'); if (touched.has(id)) fail('INVALID_INPUT', 'A deletion batch cannot repeat an identity.'); touched.add(id);
    const d = state.definitions.find(item => item.id === id);
    if (!d) fail('NOT_FOUND', 'The custom achievement does not exist.');
    if (d.source !== 'model') fail('BUILTIN_DEFINITION_IMMUTABLE', 'Built-in achievements cannot be deleted.');
    if (d.scope === 'current_workspace' && context.source === 'model' && context.workspaceKey !== d.workspaceKey) fail('WORKSPACE_MISMATCH', 'This model deletion does not belong to the bound workspace.');
    if (d.status !== 'archived') { d.frozenIncomplete ||= Object.keys(d.unknown).length > 0; d.unknown = {}; d.status = 'archived'; d.updatedAt = at; d.revision++; }
    state.equipment.badges = state.equipment.badges.filter(value => value !== id);
    if (state.equipment.charm === id) state.equipment.charm = null;
  }
}
function drawTheme(state, proposed) {
  const theme = option(proposed ?? state.preferences.theme, THEMES, 'draw theme');
  if (theme !== state.preferences.theme) throw new JournalError('THEME_MISMATCH', '抽卡主题已变化，请使用当前全局主题重新发起抽卡。', { status: 409 });
  return theme;
}
function themeCopy(title, description, supplied, themeIds = THEMES) {
  if (supplied !== undefined) fields(supplied, themeIds, 'themes');
  return Object.fromEntries(themeIds.map(theme => {
    const entry = supplied?.[theme];
    if (entry !== undefined) fields(entry, ['title', 'description'], `themes.${theme}`);
    return [theme, { title: text(entry?.title ?? title, 'theme title', 60), description: entry?.description === undefined ? description : text(entry.description, 'theme description', 240) }];
  }));
}
function builtinThemeCopy(id, title, description, supplied) {
  return themeCopy(title, description, { ...Object.fromEntries(Object.entries(ACHIEVEMENT_THEME_TITLES).map(([theme, titles]) => [theme, { title: titles[id] ?? title }])), ...supplied });
}
function normalizeRule(input) {
  fields(input, ['template', 'metric', 'target', 'recipe'], 'rule');
  const template = option(input.template, TEMPLATES, 'rule.template');
  if (template === 'model_report') {
    if (input.metric !== undefined && input.metric !== 'model_report') fail('INVALID_RULE', 'Model reports use the model_report metric.');
    if (input.recipe !== undefined || input.target !== undefined && input.target !== 1) fail('INVALID_RULE', 'Model reports have no automatic threshold or recipe.');
    return { template, metric: 'model_report', target: 1 };
  }
  if (template === 'recipe') return { template, metric: option(input.metric ?? 'recipe', ['recipe'], 'rule.metric'), target: integer(input.target ?? 1, 'rule.target', 1), recipe: option(input.recipe, RECIPES, 'rule.recipe') };
  const metric = option(input.metric, KINDS.filter(kind => kind !== 'recipe'), 'rule.metric');
  if (input.recipe !== undefined) fail('INVALID_RULE', 'Recipe keys require the recipe template.');
  if (template === 'distinct' && !KEYED.has(metric)) fail('INVALID_RULE', 'This metric has no stable distinct key.');
  if (template === 'first_seen' && input.target !== undefined && input.target !== 1) fail('INVALID_RULE', 'First-seen rules always have target 1.');
  return { template, metric, target: template === 'first_seen' ? 1 : integer(input.target, 'rule.target', 1) };
}
function defaultDefinitions(at) {
  const rows = [
    ['first', '初次启程', '完成第一轮有实际模型步骤的工作回合', 'flag', '会话历程', { template: 'first_seen', metric: 'turn_completed' }, '初入仙途', '首次接入'],
    ['hundred', '百轮同行', '累计完成 100 轮工作回合', 'chat', '会话历程', { template: 'count', metric: 'turn_completed', target: 100 }, '百炼问道', '百次握手'],
    ['million', '百万起航', '累计已记录 1M token', 'compass', '使用积累', { template: 'count', metric: 'tokens', target: 1000000 }, '初窥灵机', '百万脉冲'],
    ['tenmillion', '千万航迹', '累计已记录 10M token', 'star', '使用积累', { template: 'count', metric: 'tokens', target: 10000000 }, '灵海初成', '千万链路'],
    ['fiftymillion', '五千万刻度', '累计已记录 50M token', 'compass', '使用积累', { template: 'count', metric: 'tokens', target: 50000000 }, '万象归元', '深层连接'],
    ['first-read', '翻开一页', '首次实际读取一份文件', 'book', '探索发现', { template: 'first_seen', metric: 'file_read' }, '开卷有迹', '读取起点'],
    ['first-change', '第一次落笔', '首次观察到原生文件内容的真实改变', 'code', '行动纪念', { template: 'first_seen', metric: 'file_changed' }, '落笔成符', '写入痕迹'],
    ['formats', '多种面孔', '实际阅读 3 类不同语言或文件格式', 'spark', '探索发现', { template: 'distinct', metric: 'format_read', target: 3 }, '博览诸卷', '多栈漫游'],
    ['first-skill', '翻开手册', '首次成功加载一门技能', 'book', '探索发现', { template: 'first_seen', metric: 'skill_loaded' }, '初试仙术', '模块点亮'],
    ['skills', '方法收藏家', '成功加载 3 门不同技能', 'leaf', '探索发现', { template: 'distinct', metric: 'skill_loaded', target: 3 }, '诸法入卷', '技能集成'],
    ['delegate', '另一双眼', '首次观察到子 agent 自然完成一轮受托工作', 'spark', '协作经历', { template: 'first_seen', metric: 'delegate_completed' }, '分身有术', '代理归队'],
    ['present', '落笔成卷', '首次观察到文件交付动作，不代表用户验收', 'book', '交付纪念', { template: 'first_seen', metric: 'file_presented' }, '落笔成卷', '制品封装'],
    ['explorer', '路由探索者', '实际使用 2 个不同 provider/model 路由', 'spark', '探索发现', { template: 'distinct', metric: 'route_used', target: 2 }, '诸路参悟', '多路接力'],
    ['read-then-change', '先读再动', 'collector 已证明先读取、后改变同一文件', 'code', '经历彩蛋', { template: 'recipe', recipe: 'read_then_change' }, '知行合一', '读写闭环'],
    ['skill-then-change', '翻卷即行', '同回合加载技能后实际改变文件，不评价技能掌握', 'leaf', '经历彩蛋', { template: 'recipe', recipe: 'skill_then_change' }, '术后落笔', '技能落地'],
    ['delegate-then-present', '合力成卷', 'collector 已证明不同子 agent 返回后发生文件交付', 'flag', '经历彩蛋', { template: 'recipe', recipe: 'delegate_then_present' }, '合力成卷', '汇流交付'],
  ];
  return rows.map(([id, title, description, icon, category, rule, xianxia, cyber]) => ({
    id, title, description, icon, category, source: 'builtin', configuredBy: 'builtin', rule: normalizeRule(rule), scope: 'all', baseline: 'recorded_history', baselineAt: 0,
    hidden: category === '经历彩蛋', revision: 1, createdAt: at, updatedAt: at, status: 'active', value: 0, keys: {}, unknown: {}, frozenIncomplete: false,
    themes: builtinThemeCopy(id, title, description, { xianxia: { title: xianxia }, cyber: { title: cyber } }),
  }));
}
function fresh(at) {
  return { schemaVersion: VERSION, revision: 0, createdAt: at, updatedAt: at, preferences: { theme: 'explorer', portraitStyle: 'flat', notifications: 'all', reducedMotion: 'system', frameStyle: 'standard', frameHeight: 64 }, counts: {}, sets: {}, facts: {}, pending: {}, requests: {}, definitions: defaultDefinitions(at), awards: [], timeline: [], equipment: { badges: [], charm: null, character: null }, collection: freshCollection(at), usage: {}, usageMissing: {}, firstFactAt: null, lastFactAt: null };
}
function migrateLegacy(state) {
  const next = clone(state); next.schemaVersion = VERSION;
  Object.assign(next.preferences, { frameStyle: 'standard', frameHeight: 64 }); next.equipment.character = null;
  next.collection = freshCollection(next.createdAt, next.awards);
  for (const d of next.definitions) d.themes = d.source === 'builtin' ? builtinThemeCopy(d.id, d.title, d.description, d.themes) : themeCopy(d.title, d.description, d.themes);
  return next;
}
function assertHashMap(map, name, values) {
  object(map, name);
  for (const [id, value] of Object.entries(map)) { if (!HASH.test(id)) fail('CORRUPT_STATE', `${name} contains an invalid identity.`); values(value); }
}
function assertBudget(state, serialized) {
  if (Object.keys(state.facts).length + Object.keys(state.pending).length > JOURNAL_LIMITS.facts || Object.keys(state.requests).length > JOURNAL_LIMITS.requests || state.definitions.length > JOURNAL_LIMITS.definitions || state.awards.length > JOURNAL_LIMITS.awards || state.timeline.length > JOURNAL_LIMITS.timeline || Buffer.byteLength(serialized ?? JSON.stringify(state)) > JOURNAL_LIMITS.bytes) fail('BUDGET_EXCEEDED', 'The journal reached its explicit storage budget; no identities or history were discarded.');
}
function validateStored(state) {
  try {
    object(state, 'stored state');
    if (![1, VERSION].includes(state.schemaVersion)) fail('SCHEMA_UNSUPPORTED', 'The saved journal schema is unsupported.');
    const legacy = state.schemaVersion === 1, themeIds = legacy ? LEGACY_THEMES : THEMES, iconIds = legacy ? LEGACY_ICONS : ICONS;
    fields(state, ['schemaVersion', 'revision', 'createdAt', 'updatedAt', 'preferences', 'counts', 'sets', 'facts', 'pending', 'requests', 'definitions', 'awards', 'timeline', 'equipment', 'usage', 'usageMissing', 'firstFactAt', 'lastFactAt', ...legacy ? [] : ['collection', 'displayNames'], ...state.debug === true ? ['debug'] : []], 'stored state');
    integer(state.revision, 'revision'); integer(state.createdAt, 'createdAt'); integer(state.updatedAt, 'updatedAt');
    fields(state.preferences, ['theme', 'notifications', 'reducedMotion', ...legacy ? [] : ['frameStyle', 'frameHeight', 'portraitStyle']], 'preferences');
    option(state.preferences.theme, themeIds, 'theme'); option(state.preferences.notifications, ['all', 'unlocks', 'off'], 'notifications'); option(state.preferences.reducedMotion, ['system', 'reduce', 'full'], 'reducedMotion');
    if (!legacy) { option(state.preferences.frameStyle, FRAME_STYLES.map(style => style.id), 'frame style'); integer(state.preferences.frameHeight, 'frame height', COLLECTION_LIMITS.frameHeightMin); if (state.preferences.frameHeight > COLLECTION_LIMITS.frameHeightMax) fail('CORRUPT_STATE', 'Frame height is out of bounds.'); }
    if (!legacy && has(state.preferences, 'portraitStyle')) option(state.preferences.portraitStyle, PORTRAIT_STYLES, 'portrait style');
    for (const [kind, value] of Object.entries(object(state.counts, 'counts'))) { option(kind, KINDS, 'metric'); integer(value, 'count'); }
    for (const [kind, keys] of Object.entries(object(state.sets, 'sets'))) { option(kind, KINDS, 'metric'); assertHashMap(keys, 'distinct keys', value => { if (value !== true) fail('CORRUPT_STATE', 'Invalid distinct key.'); }); }
    assertHashMap(state.facts, 'fact identities', value => { if (typeof value !== 'string' || !HASH.test(value)) fail('CORRUPT_STATE', 'Invalid fact fingerprint.'); });
    assertHashMap(state.pending, 'pending identities', value => { fields(value, ['kind', 'at', 'workspaceKey'], 'pending fact'); option(value.kind, KINDS, 'pending metric'); integer(value.at, 'pending time'); if (value.workspaceKey !== undefined) opaque(value.workspaceKey, 'workspace key'); });
    for (const id of Object.keys(state.pending)) if (has(state.facts, id)) fail('CORRUPT_STATE', 'An identity is both settled and pending.');
    assertHashMap(state.requests, 'request identities', value => { fields(value, ['method', 'fingerprint'], 'request'); option(value.method, ['configure', 'report', ...legacy ? [] : ['draw', 'configureCharacters', 'rename'], ...state.debug === true ? ['debugAction'] : []], 'request method'); if (!HASH.test(value.fingerprint)) fail('CORRUPT_STATE', 'Invalid request fingerprint.'); });
    if (!Array.isArray(state.definitions) || !Array.isArray(state.awards) || !Array.isArray(state.timeline)) fail('CORRUPT_STATE', 'Collections must be arrays.');
    const ids = new Set();
    for (const d of state.definitions) {
      fields(d, ['id', 'title', 'description', 'icon', 'category', 'source', 'configuredBy', 'rule', 'scope', 'workspaceKey', 'baseline', 'baselineAt', 'hidden', 'revision', 'createdAt', 'updatedAt', 'status', 'value', 'keys', 'unknown', 'frozenIncomplete', 'themes', 'unlockedAt'], 'saved definition');
      opaque(d.id, 'definition id'); if (ids.has(d.id)) fail('CORRUPT_STATE', 'Duplicate definition identity.'); ids.add(d.id);
      text(d.title, 'title', 60); text(d.description, 'description', 240); option(d.icon, iconIds, 'icon'); text(d.category, 'category', 40);
      option(d.source, ['builtin', 'model'], 'definition source'); option(d.configuredBy, ['builtin', 'model', 'user'], 'configuration source');
      if (!same(normalizeRule(d.rule), d.rule)) fail('CORRUPT_STATE', 'A saved rule is not canonical.');
      option(d.scope, ['all', 'current_workspace'], 'scope'); if (d.scope === 'current_workspace') opaque(d.workspaceKey, 'workspace key');
      option(d.baseline, ['recorded_history', 'after_configuration'], 'baseline'); option(d.status, ['active', 'archived'], 'status');
      for (const key of ['baselineAt', 'createdAt', 'updatedAt', 'value']) integer(d[key], key); integer(d.revision, 'definition revision', 1); bool(d.hidden, 'hidden'); bool(d.frozenIncomplete, 'frozenIncomplete');
      assertHashMap(d.keys, 'definition keys', value => { if (value !== true) fail('CORRUPT_STATE', 'Invalid definition key.'); });
      assertHashMap(d.unknown, 'definition unknowns', value => { if (value !== true) fail('CORRUPT_STATE', 'Invalid unknown reference.'); });
      for (const id of Object.keys(d.unknown)) if (!has(state.pending, id)) fail('CORRUPT_STATE', 'Unknown progress has no pending source.');
      if (!same(themeCopy(d.title, d.description, d.themes, themeIds), d.themes)) fail('CORRUPT_STATE', 'Invalid theme copy.');
      if (d.unlockedAt !== undefined) integer(d.unlockedAt, 'unlockedAt');
    }
    const awarded = new Set(), awardIds = new Set();
    for (const award of state.awards) {
      fields(award, ['id', 'definitionId', 'definitionRevision', 'at', 'recordedAt', 'source', 'title', 'description', 'icon', 'category', 'themes', 'rule', 'scope', 'reportedBy', 'sessionId', 'turnKey'], 'award');
      opaque(award.id, 'award id'); opaque(award.definitionId, 'award definition'); if (!ids.has(award.definitionId) || awarded.has(award.definitionId) || awardIds.has(award.id)) fail('CORRUPT_STATE', 'Invalid or repeated award identity.'); awarded.add(award.definitionId); awardIds.add(award.id);
      integer(award.definitionRevision, 'award revision', 1); integer(award.at, 'award time'); integer(award.recordedAt, 'recorded time');
      option(award.source, ['automatic', 'model_report', 'user_record'], 'award source');
      text(award.title, 'award title', 60); text(award.description, 'award description', 240); option(award.icon, iconIds, 'award icon'); text(award.category, 'award category', 40);
      themeCopy(award.title, award.description, award.themes, themeIds); normalizeRule(award.rule); option(award.scope, ['all', 'current_workspace'], 'award scope');
      for (const key of ['sessionId', 'turnKey']) if (award[key] !== undefined) opaque(award[key], key);
      if (award.reportedBy !== undefined) option(award.reportedBy, ['model', 'user'], 'report source');
    }
    for (const d of state.definitions) if ((d.unlockedAt !== undefined) !== awarded.has(d.id)) fail('CORRUPT_STATE', 'An earned definition and its award disagree.');
    const timelineIds = new Set();
    for (const item of state.timeline) {
      fields(item, ['id', 'kind', 'at', 'title', 'description', 'definitionId', 'awardId', 'level', 'source', 'icon'], 'timeline entry');
      opaque(item.id, 'timeline id'); if (timelineIds.has(item.id)) fail('CORRUPT_STATE', 'Repeated timeline identity.'); timelineIds.add(item.id);
      option(item.kind, ['unlock', 'level'], 'timeline kind'); integer(item.at, 'timeline time'); text(item.title, 'timeline title', 60);
      if (item.description !== undefined) text(item.description, 'timeline description', 240);
      if (item.kind === 'level') integer(item.level, 'level', 1);
      else { if (!ids.has(item.definitionId) || !state.awards.some(a => a.id === item.awardId)) fail('CORRUPT_STATE', 'Invalid timeline award reference.'); }
    }
    fields(state.equipment, ['badges', 'charm', ...legacy ? [] : ['character']], 'equipment');
    if (!Array.isArray(state.equipment.badges) || state.equipment.badges.length > 3 || new Set(state.equipment.badges).size !== state.equipment.badges.length || state.equipment.badges.some(id => !awarded.has(id))) fail('CORRUPT_STATE', 'Invalid equipped badge.');
    if (state.equipment.charm !== null && !['compass', 'star', 'leaf'].includes(state.equipment.charm) && !awarded.has(state.equipment.charm)) fail('CORRUPT_STATE', 'Invalid charm.');
    if (!legacy) {
      validateCollection(state.collection, { awards: state.awards, requests: state.requests, character: state.equipment.character });
      if (has(state, 'displayNames')) {
        fields(state.displayNames, ['achievements', 'characters'], 'display names');
        for (const kind of ['achievements', 'characters']) {
          const records = kind === 'achievements' ? state.definitions : state.collection.characters;
          for (const [id, name] of Object.entries(object(state.displayNames[kind], `display names ${kind}`))) {
            opaque(id, 'display name identity'); displayName(name);
            if (!records.some(record => record.id === id)) fail('CORRUPT_STATE', 'A display name has no existing identity.');
          }
        }
      }
    }
    for (const bucket of ['usage', 'usageMissing']) for (const [key, value] of Object.entries(object(state[bucket], bucket))) { option(key, USAGE_FIELDS, 'usage field'); integer(value, 'usage count'); }
    for (const key of ['firstFactAt', 'lastFactAt']) if (state[key] !== null) integer(state[key], key);
    assertBudget(state);
    return state;
  } catch (error) {
    if (error.code === 'SCHEMA_UNSUPPORTED' || error.code === 'BUDGET_EXCEEDED') throw error;
    fail('CORRUPT_STATE', 'The saved journal is invalid; it was not reset or overwritten.');
  }
}

const USAGE_FIELDS = ['uncachedInputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'];
function normalizeEvidence(input) {
  if (input === undefined) return undefined;
  fields(input, ['source', 'eventSeq', 'callKey', 'step', 'usage', 'evidenceKeys'], 'evidence');
  const evidence = {};
  if (input.source !== undefined) evidence.source = option(input.source, ['session/event', 'tools/result', 'subagent/end', 'auxiliary_generation'], 'evidence.source');
  for (const key of ['eventSeq', 'step']) if (input[key] !== undefined) evidence[key] = integer(input[key], key);
  if (input.callKey !== undefined) evidence.callKey = opaque(input.callKey, 'evidence.callKey');
  if (input.evidenceKeys !== undefined) { if (!Array.isArray(input.evidenceKeys) || input.evidenceKeys.length > 32) fail('INVALID_INPUT', 'evidenceKeys must be a bounded list.'); evidence.evidenceKeys = input.evidenceKeys.map(key => opaque(key, 'evidence key')); }
  if (input.usage !== undefined) {
    fields(input.usage, USAGE_FIELDS, 'usage'); evidence.usage = {};
    for (const [key, value] of Object.entries(input.usage)) evidence.usage[key] = integer(value, `usage.${key}`);
    if (evidence.usage.reasoningTokens !== undefined && evidence.usage.outputTokens !== undefined && evidence.usage.reasoningTokens > evidence.usage.outputTokens) fail('INVALID_USAGE', 'Reasoning is a subset of output.');
    const { totalTokens, uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = evidence.usage;
    if ([totalTokens, uncachedInputTokens, outputTokens].every(value => value !== undefined)) {
      const minimum = uncachedInputTokens + outputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
      if (minimum > totalTokens || cacheReadTokens !== undefined && cacheWriteTokens !== undefined && minimum !== totalTokens) fail('INVALID_USAGE', 'Usage buckets disagree with the complete total.');
    }
  }
  return evidence;
}
function normalizeFact(input) {
  fields(input, ['id', 'kind', 'at', 'sessionId', 'turnKey', 'step', 'workspaceKey', 'amount', 'key', 'evidence'], 'fact');
  const kind = option(input.kind, KINDS, 'fact.kind');
  const fact = { id: hash(opaque(input.id, 'fact.id')), kind, at: integer(input.at, 'fact.at'), sessionId: opaque(input.sessionId, 'fact.sessionId'), turnKey: opaque(input.turnKey, 'fact.turnKey') };
  if (input.step !== undefined) fact.step = integer(input.step, 'fact.step');
  if (input.workspaceKey !== undefined) fact.workspaceKey = opaque(input.workspaceKey, 'fact.workspaceKey');
  if (input.amount !== undefined) { if (kind !== 'tokens') fail('INVALID_INPUT', 'Only token facts have an amount.'); fact.amount = integer(input.amount, 'fact.amount'); }
  if (input.key !== undefined) fact.key = kind === 'recipe' ? option(input.key, RECIPES, 'recipe key') : opaque(input.key, 'fact.key');
  fact.evidence = normalizeEvidence(input.evidence);
  if (fact.evidence?.usage?.totalTokens !== undefined && fact.amount !== undefined && fact.amount !== fact.evidence.usage.totalTokens) fail('INVALID_USAGE', 'The fact amount and usage total disagree.');
  fact.incomplete = kind === 'tokens' ? fact.amount === undefined : KEYED.has(kind) && fact.key === undefined;
  fact.fingerprint = hash(stable({ kind, at: fact.at, sessionId: fact.sessionId, turnKey: fact.turnKey, ...(fact.workspaceKey ? { workspaceKey: fact.workspaceKey } : {}), ...(fact.amount !== undefined ? { amount: fact.amount } : {}), ...(fact.key !== undefined ? { key: fact.key } : {}) }));
  return fact;
}
function inScope(d, fact) { return (d.scope === 'all' || d.workspaceKey === fact.workspaceKey) && fact.at >= d.baselineAt; }
function relevant(d, fact) { return d.rule.metric === fact.kind && (d.rule.template !== 'recipe' || d.rule.recipe === fact.key); }
function advance(d, fact) {
  if (d.rule.template === 'distinct') { const key = hash(fact.key); if (!has(d.keys, key)) { d.keys[key] = true; d.value = sum(d.value, 1); } }
  else if (d.rule.template !== 'model_report') d.value = sum(d.value, fact.kind === 'tokens' ? fact.amount : 1);
}
function award(state, d, at, source = 'automatic', context = {}) {
  if (d.status !== 'active' || d.unlockedAt !== undefined || d.value < d.rule.target) return undefined;
  d.unlockedAt = at;
  const entry = { id: `award:${d.id}`, definitionId: d.id, definitionRevision: d.revision, at, recordedAt: at, source, title: d.title, description: d.description, icon: d.icon, category: d.category, themes: clone(d.themes), rule: clone(d.rule), scope: d.scope };
  if (source !== 'automatic') { entry.reportedBy = context.source; for (const key of ['sessionId', 'turnKey']) if (context[key] !== undefined) entry[key] = context[key]; }
  state.awards.push(entry);
  const event = { id: `timeline:${entry.id}`, kind: 'unlock', at, title: entry.title, description: entry.description, definitionId: d.id, awardId: entry.id, source, icon: d.icon };
  state.timeline.push(event);
  return { kind: 'unlock', at, title: d.title, definitionId: d.id, awardId: entry.id, icon: d.icon, source };
}
function levelFor(tokens, incomplete = false) {
  const number = 1 + Math.floor(Math.sqrt(tokens / 100000));
  const start = (number - 1) ** 2 * 100000, threshold = number ** 2 * 100000;
  return { number, current: tokens - start, next: threshold - start, progress: incomplete ? null : (tokens - start) / (threshold - start), knownProgress: (tokens - start) / (threshold - start), total: tokens, start, threshold, incomplete, isLowerBound: incomplete };
}
function publicSnapshot(state, notifications, storageStatus) {
  const pendingByMetric = {};
  for (const p of Object.values(state.pending)) pendingByMetric[p.kind] = (pendingByMetric[p.kind] ?? 0) + 1;
  const count = kind => pendingByMetric[kind] ? null : (state.counts[kind] ?? 0);
  const distinct = kind => pendingByMetric[kind] ? null : Object.keys(state.sets[kind] ?? {}).length;
  const knownTokens = state.counts.tokens ?? 0;
  const totals = { tokens: count('tokens'), knownTokens, turns: count('turn_completed'), fileReads: count('file_read'), fileChanges: count('file_changed'), formats: distinct('format_read'), skills: distinct('skill_loaded'), delegations: count('delegate_completed'), presentations: count('file_presented'), routes: distinct('route_used'), recalls: count('recall_used'), byMetric: Object.fromEntries(KINDS.map(kind => [kind, count(kind)])) };
  totals.usage = Object.fromEntries(USAGE_FIELDS.map(key => [key, key === 'totalTokens' ? totals.tokens : state.usageMissing[key] ? null : state.usage[key] ?? (knownTokens === 0 && !pendingByMetric.tokens ? 0 : null)]));
  const displayNames = state.displayNames?.achievements ?? {}, byAward = new Map(state.awards.map(item => [item.id, item])), byDefinition = new Map(state.definitions.map(item => [item.id, item]));
  const named = (item, definitionId, themes = item.themes) => ({ ...item, defaultTitle: themes?.[state.preferences.theme]?.title ?? item.title, ...definitionId !== undefined && has(displayNames, definitionId) ? { customName: displayNames[definitionId] } : {} });
  const definitions = state.definitions.map(d => named({ id: d.id, title: d.title, description: d.description, icon: d.icon, category: d.category, source: d.source, configuredBy: d.configuredBy, rule: clone(d.rule), scope: d.scope, ...(d.workspaceKey ? { workspaceKey: d.workspaceKey } : {}), baseline: d.baseline, baselineAt: d.baselineAt, hidden: d.hidden, revision: d.revision, status: d.status, progress: (d.frozenIncomplete || Object.keys(d.unknown).length) && d.value < d.rule.target ? null : d.value, knownProgress: d.value, target: d.rule.target, progressRatio: Math.min(1, d.value / d.rule.target), incomplete: d.frozenIncomplete || Object.keys(d.unknown).length > 0, ...(d.unlockedAt !== undefined ? { unlockedAt: d.unlockedAt } : {}), themes: clone(d.themes) }, d.id));
  const awards = state.awards.map(item => named(item, item.definitionId));
  const historyCopy = item => named(item, item.definitionId, (byAward.get(item.awardId) ?? byDefinition.get(item.definitionId))?.themes);
  const timeline = [...state.timeline].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).map(historyCopy);
  return clone({ ...state.debug === true ? { debug: true } : {}, revision: state.revision, createdAt: state.createdAt, updatedAt: state.updatedAt, preferences: { portraitStyle: 'flat', ...state.preferences }, totals, level: levelFor(knownTokens, !!pendingByMetric.tokens), definitions, awards, timeline, notifications: notifications.map(historyCopy), equipment: state.equipment, collection: presentCollection(state.collection, { theme: state.preferences.theme, displayNames: state.displayNames?.characters }), coverage: { mode: 'observed_facts', startedAt: state.createdAt, firstFactAt: state.firstFactAt, lastFactAt: state.lastFactAt, pendingFacts: Object.keys(state.pending).length, pendingByMetric, complete: Object.keys(state.pending).length === 0, historyComplete: false, scope: 'collector_supplied', note: 'Coverage includes only facts actually supplied by the collector; account-wide history is not implied.' }, storage: { schemaVersion: VERSION, status: storageStatus, atomic: true, writer: 'exclusive_lock_single_process', limits: JOURNAL_LIMITS, usage: { facts: Object.keys(state.facts).length, pendingFacts: Object.keys(state.pending).length, requests: Object.keys(state.requests).length, definitions: state.definitions.length, awards: state.awards.length, characters: state.collection.characters.length, draws: state.collection.draws.length } } });
}
async function atomicWrite(file, data) {
  const serialized = JSON.stringify(data);
  assertBudget(data, serialized);
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  let committed = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(serialized + '\n', 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file); committed = true;
    await syncParentDirectory(file);
  } catch (cause) {
    throw new JournalError(committed ? 'DURABILITY_UNCERTAIN' : 'PERSISTENCE_FAILED', committed ? 'The state was replaced, but directory durability could not be confirmed.' : 'The new journal state could not be persisted; the previous state was retained.', { committed, cause });
  } finally { await unlink(temporary).catch(() => {}); }
}
async function acquireLock(file, at) {
  const lockFile = file + '.lock', token = randomUUID();
  let handle;
  try { handle = await open(lockFile, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('LOCK_HELD', 'A writer lock already exists. Close the other writer; a stale lock requires explicit recovery after verifying its owner.'); fail('PERSISTENCE_FAILED', 'The journal writer lock could not be acquired.'); }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, at, token })); await handle.sync(); }
  catch { await handle.close(); await unlink(lockFile).catch(() => {}); fail('PERSISTENCE_FAILED', 'The writer lock could not be persisted.'); }
  await handle.close();
  return async () => { try { const current = JSON.parse(await readFile(lockFile, 'utf8')); if (current.token === token) await unlink(lockFile); } catch (error) { if (error.code !== 'ENOENT') throw new JournalError('LOCK_RELEASE_FAILED', 'The journal writer lock could not be released.'); } };
}

export async function createJournal({ file, now = Date.now, randomInt, allowDebug = false } = {}) {
  if (typeof file !== 'string' || !file.trim() || typeof now !== 'function' || randomInt !== undefined && typeof randomInt !== 'function' || typeof allowDebug !== 'boolean') fail('INVALID_INPUT', 'A journal file, clock and optional random/debug controls are required.');
  const path = resolve(file), clock = () => integer(now(), 'clock time');
  await mkdir(dirname(path), { recursive: true });
  const release = await acquireLock(path, clock());
  let state;
  try {
    let data;
    try { data = await readFile(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw new JournalError('PERSISTENCE_FAILED', 'The saved journal could not be read.'); }
    if (data === undefined) { state = fresh(clock()); await atomicWrite(path, state); }
    else { try { state = JSON.parse(data); } catch { fail('CORRUPT_STATE', 'The saved journal is not valid JSON; it was not reset or overwritten.'); } if (state?.debug === true && !allowDebug) fail('DEBUG_ARCHIVE_FORBIDDEN', 'A debug archive cannot be opened as a real achievement journal.'); validateStored(state); if (state.schemaVersion === 1) { state = migrateLegacy(state); validateStored(state); await atomicWrite(path, state); } }
  } catch (error) { await release(); throw error; }
  let tail = Promise.resolve(), closing = false, closePromise, storageStatus = 'ready';
  const snapshot = () => publicSnapshot(state, [], storageStatus);
  function mutate(operation, { notify = true } = {}) {
    if (closing) return Promise.reject(new JournalError('CLOSED', 'The journal is closed.'));
    const run = tail.then(async () => {
      const next = clone(state), at = Math.max(clock(), state.updatedAt), previousLevel = levelFor(state.counts.tokens ?? 0).number;
      const result = operation(next, at) ?? { changed: false, notifications: [] };
      if (!result.changed) return snapshot();
      syncCollectionPoints(next.collection, next.awards);
      const notices = result.notifications ?? [];
      const nextLevel = levelFor(next.counts.tokens ?? 0).number;
      if (nextLevel > previousLevel) {
        const item = { id: `timeline:level:${nextLevel}`, kind: 'level', at, title: `等级提升至 ${nextLevel}`, level: nextLevel, icon: 'spark' };
        next.timeline.push(item); notices.push({ kind: 'level', at, title: item.title, level: nextLevel, icon: 'spark' });
      }
      next.revision = sum(state.revision, 1); next.updatedAt = at; assertBudget(next);
      try { await atomicWrite(path, next); storageStatus = 'ready'; state = next; }
      catch (error) { if (error.committed) { state = next; storageStatus = 'durability_uncertain'; } throw error; }
      const deliver = !notify || next.preferences.notifications === 'off' ? [] : notices.filter(n => next.preferences.notifications === 'all' || n.kind !== 'progress').map((n, index) => ({ ...n, id: `notification:${next.revision}:${index}` }));
      return publicSnapshot(state, deliver, storageStatus);
    });
    tail = run.catch(() => {}); return run;
  }
  function request(next, method, input, context) {
    const id = hash(opaque(input.requestId, 'requestId')), fingerprint = hash(stable({ method, input, context })), prior = next.requests[id];
    if (prior) { if (prior.method !== method || prior.fingerprint !== fingerprint) fail('REQUEST_ID_REUSED', 'This requestId was already used for different content.'); return false; }
    if (input.expectedRevision !== undefined && integer(input.expectedRevision, 'expectedRevision') !== next.revision) fail('REVISION_CONFLICT', 'The expected revision is stale.');
    if (Object.keys(next.requests).length >= JOURNAL_LIMITS.requests) fail('BUDGET_EXCEEDED', 'The request identity budget is full; no deduplication identities were discarded.');
    next.requests[id] = { method, fingerprint }; return true;
  }
  return {
    snapshot,
    debugAction(input) {
      // Capability denial precedes argument validation, including empty input.
      if (state.debug !== true) return Promise.reject(new JournalError('DEBUG_ONLY', 'Debug actions require an explicitly marked isolated archive.', { status: 403 }));
      try {
        fields(input, ['requestId', 'action', 'definitionId', 'theme', 'charm'], 'debug action'); input = clone(input);
        option(input.action, ['complete', 'complete_all', 'draw', 'charm'], 'debug action');
        if (input.definitionId !== undefined && input.action !== 'complete' || input.theme !== undefined && input.action !== 'draw' || input.charm !== undefined && input.action !== 'charm') fail('INVALID_INPUT', 'Debug action contains unrelated controls.');
      } catch (error) { return Promise.reject(error); }
      return mutate((next, at) => {
        // Draw receipts use the ordinary durable draw identity so ownership and
        // point validation remains identical even inside the isolated archive.
        if (!request(next, input.action === 'draw' ? 'draw' : 'debugAction', input, { source: 'debug' })) return { changed: false };
        const notifications = [];
        const complete = d => {
          if (!d) fail('NOT_FOUND', 'There is no unfinished active achievement to complete.');
          if (d.status !== 'active') fail('ARCHIVED', 'An archived achievement cannot be completed in debug mode.');
          d.value = Math.max(d.value, d.rule.target); d.unknown = {}; d.frozenIncomplete = false;
          const notice = award(next, d, at, d.rule.template === 'model_report' ? 'user_record' : 'automatic', { source: 'user' });
          if (notice) notifications.push(notice);
        };
        const first = () => next.definitions.find(d => d.status === 'active' && d.unlockedAt === undefined);
        if (input.action === 'complete') complete(input.definitionId === undefined ? first() : next.definitions.find(d => d.id === opaque(input.definitionId, 'definition id')));
        else if (input.action === 'complete_all') { for (const d of next.definitions) if (d.status === 'active' && d.unlockedAt === undefined) complete(d); }
        else if (input.action === 'charm') next.equipment.charm = option(input.charm ?? 'star', ['compass', 'star', 'leaf'], 'debug charm');
        else {
          const theme = drawTheme(next, input.theme);
          if (next.collection.points.balance < 1) complete(first());
          syncCollectionPoints(next.collection, next.awards);
          drawCollection(next.collection, { requestHash: hash(input.requestId), theme, at, randomInt });
          const results = next.collection.draws.at(-1).results;
          next.equipment.character = results.reduce((best, item) => RARITIES.indexOf(item.rarity) > RARITIES.indexOf(best.rarity) ? item : best).id;
        }
        return { changed: true, notifications };
      });
    },
    catalog() { return clone({ schemaVersion: VERSION, metricIds: KINDS, metrics: KINDS.map(id => ({ id, unit: id === 'tokens' ? 'tokens' : 'events', keyRequired: KEYED.has(id), templates: id === 'recipe' ? ['recipe'] : ['first_seen', 'count', ...(KEYED.has(id) ? ['distinct'] : [])], evidence: 'collector_verified' })), templates: TEMPLATES, recipes: RECIPES, themeIds: THEMES, iconIds: ICONS, scopes: ['all', 'current_workspace'], defaultBaseline: 'after_configuration', notificationModes: ['all', 'unlocks', 'off'], reducedMotionModes: ['system', 'reduce', 'full'], equipment: { badgeSlots: 3, charms: ['compass', 'star', 'leaf'], characterSlots: 1 }, collection: collectionCatalog(), limits: JOURNAL_LIMITS, defaultDefinitionCount: 16, levelRule: { version: 1, description: 'Level = 1 + floor(sqrt(recorded tokens / 100000)); display proposal, not a productivity score.' } }); },
    drawReceipt(requestId) { const id = hash(opaque(requestId, 'requestId')); return clone(state.collection.draws.find(draw => draw.requestId === id) ?? null); },
    draw(input) {
      try { fields(input, ['requestId', 'theme'], 'draw'); input = clone(input); } catch (error) { return Promise.reject(error); }
      return mutate((next, at) => {
        if (!request(next, 'draw', input, { source: 'user' })) return { changed: false };
        const theme = drawTheme(next, input.theme);
        drawCollection(next.collection, { requestHash: hash(input.requestId), theme, at, randomInt });
        return { changed: true };
      });
    },
    configureCharacters(input, context = {}) {
      let c; try { fields(input, ['requestId', 'expectedRevision', 'characters'], 'configureCharacters'); input = clone(input); c = safeContext(context); } catch (error) { return Promise.reject(error); }
      return mutate((next, at) => {
        if (!request(next, 'configureCharacters', input, c)) return { changed: false };
        configureCollectionCharacters(next.collection, input.characters, { requestHash: hash(input.requestId), source: c.source, at, defaultTheme: next.preferences.theme });
        return { changed: true };
      });
    },
    rename(input, context = {}) {
      let c, name;
      try {
        fields(input, ['requestId', 'expectedRevision', 'kind', 'id', 'name'], 'rename'); input = clone(input); c = safeContext(context);
        option(input.kind, ['achievement', 'character'], 'rename kind'); opaque(input.id, 'rename identity');
        name = input.name === null ? null : displayName(input.name);
      } catch (error) { return Promise.reject(error); }
      return mutate(next => {
        if (!request(next, 'rename', input, c)) return { changed: false };
        const record = (input.kind === 'achievement' ? next.definitions : next.collection.characters).find(item => item.id === input.id);
        if (!record) fail('NOT_FOUND', 'The display name identity does not exist.');
        if (input.kind === 'achievement' && record.scope === 'current_workspace' && c.source === 'model' && c.workspaceKey !== record.workspaceKey) fail('WORKSPACE_MISMATCH', 'This model rename does not belong to the bound workspace.');
        const bucket = input.kind === 'achievement' ? 'achievements' : 'characters';
        if (name === null) {
          if (next.displayNames) {
            delete next.displayNames[bucket][input.id];
            if (!Object.keys(next.displayNames.achievements).length && !Object.keys(next.displayNames.characters).length) delete next.displayNames;
          }
        } else {
          next.displayNames ??= { achievements: {}, characters: {} };
          next.displayNames[bucket][input.id] = name;
        }
        return { changed: true };
      });
    },
    deleteDefinitions(input, context = {}) {
      let c; try { fields(input, ['requestId', 'expectedRevision', 'ids'], 'deleteDefinitions'); input = clone(input); c = safeContext(context); if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > JOURNAL_LIMITS.definitions) fail('INVALID_INPUT', 'Delete a bounded nonempty list of custom achievements.'); } catch (error) { return Promise.reject(error); }
      return mutate((next, at) => {
        // Keep the schema-2 persisted request vocabulary readable by rc.2.
        // The ids payload still distinguishes deletion from ordinary config.
        if (!request(next, 'configure', input, c)) return { changed: false };
        archiveDefinitions(next, input.ids, c, at); return { changed: true };
      });
    },
    ingest(facts, { notify = true } = {}) {
      if (!Array.isArray(facts) || facts.length > JOURNAL_LIMITS.batch) return Promise.reject(new JournalError('INVALID_INPUT', 'Facts must be a bounded array.'));
      let normalized; try { normalized = facts.map(normalizeFact); bool(notify, 'notify'); } catch (error) { return Promise.reject(error); }
      return mutate((next, at) => {
        const notifications = []; let changed = false, tokens = 0, turns = 0;
        let identities = Object.keys(next.facts).length + Object.keys(next.pending).length;
        for (const fact of normalized) {
          if (has(next.facts, fact.id)) { if (!fact.incomplete && next.facts[fact.id] !== fact.fingerprint) fail('FACT_ID_REUSED', 'A settled fact identity was reused with different content.'); continue; }
          if (has(next.pending, fact.id) && (next.pending[fact.id].kind !== fact.kind || next.pending[fact.id].at !== fact.at || next.pending[fact.id].workspaceKey !== fact.workspaceKey)) fail('FACT_ID_REUSED', 'A pending identity was reused with another scope, time, or metric.');
          if (!has(next.pending, fact.id) && identities >= JOURNAL_LIMITS.facts) fail('BUDGET_EXCEEDED', 'The fact identity budget is full; no deduplication identities were discarded.');
          if (fact.incomplete) {
            if (!has(next.pending, fact.id)) { next.pending[fact.id] = { kind: fact.kind, at: fact.at, ...(fact.workspaceKey ? { workspaceKey: fact.workspaceKey } : {}) }; identities++; changed = true; }
            for (const d of next.definitions) if (d.status === 'active' && d.rule.metric === fact.kind && inScope(d, fact)) d.unknown[fact.id] = true;
            continue;
          }
          if (!has(next.pending, fact.id)) identities++;
          next.facts[fact.id] = fact.fingerprint; delete next.pending[fact.id]; changed = true;
          for (const d of next.definitions) delete d.unknown[fact.id];
          next.firstFactAt = next.firstFactAt === null ? fact.at : Math.min(next.firstFactAt, fact.at);
          next.lastFactAt = next.lastFactAt === null ? fact.at : Math.max(next.lastFactAt, fact.at);
          next.counts[fact.kind] = sum(next.counts[fact.kind] ?? 0, fact.kind === 'tokens' ? fact.amount : 1);
          if (fact.key !== undefined) { next.sets[fact.kind] ??= {}; next.sets[fact.kind][hash(fact.key)] = true; }
          if (fact.kind === 'tokens') {
            tokens = sum(tokens, fact.amount);
            for (const field of USAGE_FIELDS) { const value = field === 'totalTokens' ? fact.amount : fact.evidence?.usage?.[field]; if (value === undefined) next.usageMissing[field] = sum(next.usageMissing[field] ?? 0, 1); else next.usage[field] = sum(next.usage[field] ?? 0, value); }
          }
          if (fact.kind === 'turn_completed') turns = sum(turns, 1);
          for (const d of next.definitions) if (d.status === 'active' && relevant(d, fact) && inScope(d, fact)) { advance(d, fact); const notice = award(next, d, at); if (notice) notifications.push(notice); }
        }
        if (tokens > 0 || turns > 0) notifications.push({ kind: 'progress', at, title: turns ? `${turns} 轮已记录` : '使用积累已记录', tokens, turns });
        return { changed, notifications };
      }, { notify });
    },
    configure(input, context = {}) {
      let c; try { fields(input, ['requestId', 'expectedRevision', 'definitions', 'archiveIds', 'theme'], 'configure'); input = clone(input); c = safeContext(context); } catch (error) { return Promise.reject(error); }
      return mutate((next, at) => {
        if (!request(next, 'configure', input, c)) return { changed: false };
        const items = input.definitions ?? [], archives = input.archiveIds ?? [];
        if (!Array.isArray(items) || items.length > 64 || !Array.isArray(archives) || archives.length > JOURNAL_LIMITS.definitions) fail('INVALID_INPUT', 'Configuration lists must be bounded arrays.');
        const notifications = [], touched = new Set();
        for (const [index, item] of items.entries()) {
          fields(item, ['id', 'title', 'description', 'icon', 'category', 'rule', 'scope', 'hidden', 'themes'], 'definition');
          const id = item.id === undefined ? `custom-${hash(input.requestId).slice(0, 16)}-${index + 1}` : opaque(item.id, 'definition id');
          if (touched.has(id)) fail('INVALID_INPUT', 'A batch cannot configure the same identity twice.'); touched.add(id);
          const old = next.definitions.find(d => d.id === id), rule = normalizeRule(item.rule ?? old?.rule);
          if (old?.status === 'archived') fail('ARCHIVED', 'Archived definitions are frozen; create a new goal instead.');
          if (old?.scope === 'current_workspace' && c.source === 'model' && c.workspaceKey !== old.workspaceKey) fail('WORKSPACE_MISMATCH', 'This model configuration does not belong to the bound workspace.');
          const title = text(item.title ?? old?.title, 'title', 60), description = text(item.description ?? old?.description, 'description', 240, '记录一段属于自己的经历');
          const scope = option(item.scope ?? old?.scope ?? 'all', ['all', 'current_workspace'], 'scope');
          const workspaceKey = scope === 'current_workspace' ? old?.scope === scope ? old.workspaceKey : c.workspaceKey : undefined;
          if (scope === 'current_workspace' && workspaceKey === undefined) fail('WORKSPACE_REQUIRED', 'A trusted current workspace identity is required.');
          if (old && (old.rule.template !== rule.template || old.rule.metric !== rule.metric || old.rule.recipe !== rule.recipe || old.scope !== scope || old.workspaceKey !== workspaceKey)) fail(old.unlockedAt !== undefined ? 'AWARDED_RULE_IMMUTABLE' : 'NEW_DEFINITION_REQUIRED', 'Changing a metric, recipe, or scope requires a new definition identity; the old baseline was retained.');
          if (old?.unlockedAt !== undefined && !same(old.rule, rule)) fail('AWARDED_RULE_IMMUTABLE', 'Earned conditions are immutable; create a new goal instead.');
          if (old?.source === 'builtin' && !same(old.rule, rule)) fail('BUILTIN_RULE_IMMUTABLE', 'Create a custom definition instead of changing built-in conditions.');
          const d = old ?? { id, source: 'model', configuredBy: c.source, baseline: 'after_configuration', baselineAt: at, createdAt: at, revision: 0, status: 'active', value: 0, keys: {}, unknown: {}, frozenIncomplete: false };
          Object.assign(d, { title, description, icon: option(item.icon ?? old?.icon ?? 'book', ICONS, 'icon'), category: text(item.category ?? old?.category, 'category', 40, '个人纪念'), rule, scope, hidden: item.hidden === undefined ? old?.hidden ?? false : bool(item.hidden, 'hidden'), revision: d.revision + 1, updatedAt: at, themes: themeCopy(title, description, item.themes ?? (old && item.title === undefined && item.description === undefined ? old.themes : undefined)) });
          if (workspaceKey !== undefined) d.workspaceKey = workspaceKey;
          if (!old) next.definitions.push(d);
          const notice = award(next, d, at); if (notice) notifications.push(notice);
        }
        archiveDefinitions(next, archives, c, at);
        if (input.theme !== undefined) next.preferences.theme = option(input.theme, THEMES, 'theme');
        return { changed: true, notifications };
      });
    },
    report(input, context = {}) {
      let c; try { fields(input, ['requestId', 'expectedRevision', 'definitionId', 'note'], 'report'); input = clone(input); c = safeContext(context); if (input.note !== undefined) text(input.note, 'report note', 500); } catch (error) { return Promise.reject(error); }
      return mutate((next, at) => {
        if (!request(next, 'report', input, c)) return { changed: false };
        const d = next.definitions.find(d => d.id === opaque(input.definitionId, 'definitionId'));
        if (!d) fail('NOT_FOUND', 'The report definition does not exist.');
        if (d.rule.template !== 'model_report') fail('REPORT_NOT_ALLOWED', 'A report cannot grant automatic facts or change real usage.');
        if (d.status !== 'active') fail('ARCHIVED', 'An archived definition does not accept new reports.');
        if (d.scope === 'current_workspace' && c.workspaceKey !== d.workspaceKey) fail('WORKSPACE_MISMATCH', 'This report does not belong to the bound workspace.');
        d.value = 1; const notice = award(next, d, at, c.source === 'user' ? 'user_record' : 'model_report', c);
        return { changed: true, notifications: notice ? [notice] : [] };
      });
    },
    preferences(input) {
      try { fields(input, ['theme', 'portraitStyle', 'notifications', 'reducedMotion', 'frameStyle', 'frameHeight'], 'preferences'); input = clone(input); } catch (error) { return Promise.reject(error); }
      return mutate(next => {
        const value = { portraitStyle: 'flat', ...next.preferences };
        if (input.theme !== undefined) value.theme = option(input.theme, THEMES, 'theme');
        if (input.portraitStyle !== undefined) value.portraitStyle = option(input.portraitStyle, PORTRAIT_STYLES, 'portrait style');
        if (input.notifications !== undefined) value.notifications = option(input.notifications, ['all', 'unlocks', 'off'], 'notifications');
        if (input.reducedMotion !== undefined) value.reducedMotion = option(input.reducedMotion, ['system', 'reduce', 'full'], 'reducedMotion');
        if (input.frameStyle !== undefined) { const preset = FRAME_STYLES.find(style => style.id === input.frameStyle); if (!preset) fail('INVALID_INPUT', 'Unsupported frame style.'); value.frameStyle = preset.id; value.frameHeight = preset.height; }
        if (input.frameHeight !== undefined) { value.frameHeight = integer(input.frameHeight, 'frame height', COLLECTION_LIMITS.frameHeightMin); if (value.frameHeight > COLLECTION_LIMITS.frameHeightMax) fail('INVALID_INPUT', 'Frame height exceeds its limit.'); }
        const changed = !same(value, next.preferences); next.preferences = value; return { changed };
      });
    },
    equip(input) {
      try { fields(input, ['id', 'slot', 'equipped'], 'equip'); input = clone(input); opaque(input.id, 'equipment id'); option(input.slot, ['badge', 'charm', 'character'], 'equipment slot'); if (input.equipped !== undefined) bool(input.equipped, 'equipped'); } catch (error) { return Promise.reject(error); }
      return mutate(next => {
        const previous = clone(next.equipment), on = input.equipped !== false, owned = next.awards.some(a => a.definitionId === input.id);
        if (on && (input.slot === 'badge' || input.slot === 'charm' && !['compass', 'star', 'leaf', 'none'].includes(input.id)) && next.definitions.some(d => d.id === input.id && d.status === 'archived')) fail('ARCHIVED', 'A deleted achievement cannot be equipped again.');
        if (input.slot === 'badge') {
          if (on && !owned) fail('NOT_OWNED', 'Only an earned badge can be equipped.');
          if (!on) next.equipment.badges = next.equipment.badges.filter(id => id !== input.id);
          else if (!next.equipment.badges.includes(input.id)) { if (next.equipment.badges.length >= 3) fail('EQUIPMENT_FULL', 'Take off a badge before equipping another.'); next.equipment.badges.push(input.id); }
        } else if (input.slot === 'character') {
          if (on && !next.collection.owned.some(character => character.id === input.id)) fail('NOT_OWNED', 'Only a collected character can be equipped.');
          if (on) next.equipment.character = input.id;
          else if (next.equipment.character === input.id) next.equipment.character = null;
        } else {
          if (on && !['compass', 'star', 'leaf', 'none'].includes(input.id) && !owned) fail('NOT_OWNED', 'The charm is not available.');
          next.equipment.charm = !on || input.id === 'none' ? null : input.id;
        }
        return { changed: !same(previous, next.equipment) };
      });
    },
    close() {
      if (closePromise) return closePromise;
      closing = true; closePromise = tail.then(async () => { await release(); storageStatus = 'closed'; return snapshot(); }); return closePromise;
    },
  };
}
