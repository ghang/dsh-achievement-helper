import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7E8AAAAASUVORK5CYII=';
const PIXEL_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function character(overrides = {}) { return { id: 'hero', name: '山海小狐', description: '带着莲灯的旅途同伴', theme: 'explorer', rarity: 'SR', icon: 'fox', animation: 'float', source: 'builtin', ...overrides }; }
const PORTRAIT_THEMES = ['explorer', 'xianxia', 'cyber', 'wuxia', 'fantasy', 'space', 'ocean', 'garden', 'academy', 'steampunk'];
function portraitManifest() {
  return { version: 2, styles: Object.fromEntries(['flat', 'pixel'].map(style => [style, { label: style === 'pixel' ? '微像素' : '清爽扁平', themes: Object.fromEntries(PORTRAIT_THEMES.map(theme => [theme, {
    url: `/dsh-achievement-journal/api/assets/portraits/${style}/${theme}.webp?version=abc123def456`, columns: 4, rows: 2, aspect: 1,
    characters: Array.from({ length: 8 }, (_, index) => ({ id: `builtin:${theme}:${index + 1}`, icon: 'fox', column: index % 4, row: Math.floor(index / 4) })),
  }])) }])) };
}
function journal(overrides = {}) {
  return {
    revision: 1, createdAt: 1792886400000, updatedAt: 1792886401000,
    preferences: { theme: 'explorer', notifications: 'all', reducedMotion: 'system' },
    totals: { tokens: 0, turns: 0, fileReads: 0, fileChanges: 0, formats: 0, skills: 0, delegations: 0 },
    level: { number: 1, current: 0, next: 100000, progress: 0 },
    definitions: [], awards: [], timeline: [], notifications: [], equipment: { badges: [], charm: null, character: null },
    collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: [], owned: [], draws: [] },
    ...overrides,
  };
}
function definition(overrides = {}) {
  return { id: 'first-read', title: '第一眼', description: '读过一个文件', icon: 'book', category: 'explore', source: 'builtin',
    rule: { template: 'count', metric: 'file_read', target: 1 }, status: 'active', progress: 0, target: 1, themes: {}, ...overrides };
}

// A small React/slots simulator keeps this client contract test independent of
// installed runtimes. The actual host/browser is verified separately.
function harness(initial = journal(), options = {}) {
  let now = 0, nextTimer = 0, nextId = 0, registration, getStore, dirty = false;
  let frame, hookIndex, renderedFrames;
  const timers = new Map(), frames = new Map(), requests = [], records = [], effects = [], cleanupCallbacks = [];
  const documentEvents = new Map(), windowEvents = new Map(), copied = [];
  const sessionListeners = new Set();
  const mediaListeners = new Set(), storage = options.storage ?? new Map(), drawReceipts = new Map(), generationReceipts = new Map();
  const debugStates = new Map();
  const debugTemplate = options.debugTemplate ?? journal({ definitions: [definition()], collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: ['explorer', 'xianxia', 'cyber', 'wuxia', 'fantasy', 'space', 'ocean', 'garden', 'academy', 'steampunk'].map(theme => character({ id: theme === 'explorer' ? 'hero' : 'hero-' + theme, theme })), owned: [], draws: [] } });
  const server = { state: clone(initial), sessionKey: options.sessionKey, uiSessionGetterReads: 0, wide: true, job: options.job ? clone(options.job) : null, failGenerationStart: null, failGenerationStartCode: 'GENERATION_UNAVAILABLE', failGenerationGet: null,
    generationWrites: 0, failGenerationAfterCommit: false, failGenerationAfterCommitCode: null,
    drawWrites: 0, failDrawAfterCommit: false, failDrawAfterCommitCode: null, systemReduce: false, canvasDraws: 0,
    debugStates, ignoreStateAbort: false, images: [], imageErrors: new Set(options.imageErrors ?? []),
    failState: null, hangState: false, deferNextState: false, failPost: null, failCatalog: null,
    catalog: { metrics: [{ id: 'tokens' }, { id: 'file_read' }, { id: 'recipe' }], templates: ['count', 'model_report'], equipment: { charms: ['compass', 'star', 'leaf'] },
      capabilities: options.capabilities, collection: { drawCost: 1, drawSize: 10, iconIds: ['fox', 'robot', 'lotus', 'ship'], animationIds: ['none', 'float', 'pulse', 'orbit', 'spark'], limits: options.collectionLimits },
      generation: options.generation ?? { available: true, route: { provider: 'fixture', model: 'fixture-model' }, routeSource: 'default', maxDefinitions: 6 } } };
  const timer = (callback, delay = 0) => { const id = ++nextTimer; timers.set(id, { callback, due: now + delay }); return id; };
  const clear = id => timers.delete(id);
  const add = (map, name, fn) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); };
  const remove = (map, name, fn) => map.get(name)?.delete(fn);
  const document = {
    hidden: false, activeElement: null, body: { style: { overflow: '' } },
    head: { children: [], appendChild(element) { this.children.push(element); element.isConnected = true; } },
    createElement(tag) { return { tagName: tag, dataset: {}, textContent: '', getContext() { return { drawImage() { server.canvasDraws += 1; } }; }, toDataURL() { return PIXEL_PNG; }, remove() { this.isConnected = false; document.head.children = document.head.children.filter(item => item !== this); } }; },
    addEventListener: (name, fn) => add(documentEvents, name, fn),
    removeEventListener: (name, fn) => remove(documentEvents, name, fn),
  };
  const window = {
    __ModuleLoader__: { load(value) { registration = value; } },
    addEventListener: (name, fn) => add(windowEvents, name, fn),
    removeEventListener: (name, fn) => remove(windowEvents, name, fn),
    crypto: { randomUUID: () => `fixture-${++nextId}` },
    navigator: { clipboard: { async writeText(text) { copied.push(text); } } },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    matchMedia: () => ({ get matches() { return server.systemReduce; }, addEventListener(_name, listener) { mediaListeners.add(listener); }, removeEventListener(_name, listener) { mediaListeners.delete(listener); } }),
    FileReader: class { readyState = 0; readAsDataURL(file) { this.readyState = 1; queueMicrotask(() => { if (this.readyState !== 1) return; this.readyState = 2; this.result = file.dataURL; this.onload?.(); }); } abort() { this.readyState = 2; this.onabort?.(); } },
    Image: class { naturalWidth = 1; naturalHeight = 1; set src(value) { server.images.push({ image: this, url: value, onload: this.onload, onerror: this.onerror }); if (!options.manualImages) queueMicrotask(() => server.imageErrors.has(value) ? this.onerror?.() : this.onload?.()); } },
  };
  const required = [];
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: { ...props, children: children.length === 1 ? children[0] : children } }; },
    useState(initialValue) {
      const index = hookIndex++, activeFrame = frame;
      if (!frame.hooks[index]) frame.hooks[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      return [frame.hooks[index].value, value => { const slot = activeFrame.hooks[index]; slot.value = typeof value === 'function' ? value(slot.value) : value; dirty = true; }];
    },
    useRef(value) { const index = hookIndex++; return (frame.hooks[index] ??= { current: value }); },
    useId() { const index = hookIndex++; return (frame.hooks[index] ??= { value: `:fixture-${++nextId}:` }).value; },
    useSyncExternalStore(subscribe, getSnapshot) {
      getStore = getSnapshot;
      const index = hookIndex++;
      frame.hooks[index] ??= { cleanup: subscribe(() => { dirty = true; }) };
      return getSnapshot();
    },
    useEffect(effect, deps) {
      const index = hookIndex++, activeFrame = frame, previous = frame.hooks[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        effects.push(() => { previous?.cleanup?.(); activeFrame.hooks[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  async function fetch(url, options) {
    requests.push({ url, options });
    const path = url.slice('/dsh-achievement-journal/api'.length).split('?')[0];
    const token = options.headers?.['x-daj-debug'];
    const result = body => ({ ok: true, status: 200, json: async () => body });
    const decorate = (value, scope = token) => ({ ...clone(value), debug: scope ? { active: true, sessionId: scope, label: '调试模式' } : { active: false } });
    if (path === '/debug/start' || path === '/debug/reset') {
      if (path === '/debug/reset' && !debugStates.has(token)) return { ok: false, status: 409, json: async () => ({ code: 'DEBUG_SCOPE_EXPIRED', error: '调试会话已失效' }) };
      if (token) debugStates.delete(token);
      const fresh = 'debug-' + ++nextId; debugStates.set(fresh, clone(debugTemplate));
      return result({ token: fresh, snapshot: decorate(debugStates.get(fresh), fresh) });
    }
    if (path === '/debug/exit') { debugStates.delete(token); return result({ debug: null }); }
    if (token && !debugStates.has(token)) return { ok: false, status: 409, json: async () => ({ code: 'DEBUG_SCOPE_EXPIRED', error: '调试会话已失效' }) };
    const target = token ? debugStates.get(token) : server.state;
    if (path === '/debug/action') {
      assert.ok(token, 'Debug actions require an explicit scope');
      const body = JSON.parse(options.body);
      function complete() {
        const selected = target.definitions.filter(item => item.status === 'active' && !item.unlockedAt && (!body.definitionId || item.id === body.definitionId));
        for (const item of body.action === 'complete_all' ? selected : selected.slice(0, 1)) {
          item.unlockedAt = 100; target.awards.push({ id: 'debug-award:' + item.id, definitionId: item.id, title: item.title, at: 100, source: 'automatic' });
        }
        target.collection.points.earned = target.awards.length; target.collection.points.balance = target.collection.points.earned - target.collection.points.spent;
      }
      let receipt;
      if (body.action === 'complete' || body.action === 'complete_all') complete();
      if (body.action === 'charm') target.equipment.charm = body.charm;
      if (body.action === 'draw') {
        if (!target.collection.points.balance) complete();
        const item = target.collection.characters.find(item => item.theme === body.theme);
        assert.ok(item); target.collection.points.spent += 1; target.collection.points.balance -= 1;
        target.collection.owned.push({ id: item.id, count: 10, firstAt: 100 }); target.equipment.character = item.id;
        receipt = { requestId: 'debug-draw:' + body.requestId, at: 100, theme: body.theme, cost: 1, results: Array.from({ length: 10 }, (_, index) => ({ id: item.id, rarity: item.rarity, isNew: index === 0 })) };
        target.collection.draws.push(receipt);
      }
      target.revision += 1;
      return result({ ...decorate(target), ...(receipt ? { draw: clone(receipt) } : {}) });
    }
    let response;
    if (path === '/state') {
      if (server.hangState) return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      if (server.failState) { const error = server.failState; server.failState = null; throw new Error(error); }
      response = decorate(target);
      if (server.deferNextState) {
        server.deferNextState = false;
        await new Promise((resolve, reject) => { server.releaseState = resolve; if (!server.ignoreStateAbort) options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
      }
    } else if (path === '/catalog') {
      if (server.failCatalog) return { ok: false, status: 503, json: async () => ({ error: server.failCatalog }) };
      response = clone(server.catalog);
      if (token) response.generation = { available: false, reason: '调试模式不调用模型生成' };
    } else if (path === '/generation' && options.method !== 'POST') {
      if (server.failGenerationGet) return { ok: false, status: 503, json: async () => ({ error: server.failGenerationGet }) };
      response = { job: token ? null : clone(server.job) };
    } else if (path === '/generation' && options.method === 'POST') {
      if (server.failGenerationStart) return { ok: false, status: 503, json: async () => ({ code: server.failGenerationStartCode, error: server.failGenerationStart }) };
      const body = JSON.parse(options.body), previous = generationReceipts.get(body.requestId);
      if (previous) {
        if (previous.body !== options.body) return { ok: false, status: 409, json: async () => ({ code: 'GENERATION_REQUEST_ID_REUSED', error: '原请求参数不得改变' }) };
        response = { job: clone(previous.job) };
      } else {
        if (body.theme !== target.preferences.theme) return { ok: false, status: 409, json: async () => ({ code: 'GENERATION_THEME_MISMATCH', error: '请使用当前全局主题' }) };
        server.job = { id: `job-${++nextId}`, kind: body.kind || 'achievements', count: body.count, status: 'running', stage: 'analyzing', message: '正在分析所选数据', createdAt: 100, updatedAt: 100, createdDefinitionIds: [], createdCharacterIds: [], usageSource: 'auxiliary_generation' };
        server.generationWrites += 1;
        if (server.failGenerationAfterCommit || server.failGenerationAfterCommitCode) server.job = { ...server.job, status: 'succeeded', stage: 'done', updatedAt: 200 };
        generationReceipts.set(body.requestId, { body: options.body, job: clone(server.job) });
        if (server.failGenerationAfterCommitCode) { const code = server.failGenerationAfterCommitCode; server.failGenerationAfterCommitCode = null; return { ok: false, status: 503, json: async () => ({ code, error: '生成启动持久性尚未确认' }) }; }
        if (server.failGenerationAfterCommit) { server.failGenerationAfterCommit = false; throw new Error('connection lost after accepted generation'); }
        response = { job: clone(server.job) };
      }
    } else if (path === '/generation/cancel') {
      assert.notEqual(server.job?.stage, 'applying');
      server.job = { ...server.job, status: 'cancelled', stage: 'done', message: '已取消生成', updatedAt: server.job.updatedAt + 1 };
      response = { job: clone(server.job) };
    } else if (path === '/draw') {
      const body = JSON.parse(options.body);
      if (!drawReceipts.has(body.requestId)) {
        if (body.theme !== target.preferences.theme) return { ok: false, status: 409, json: async () => ({ code: 'THEME_MISMATCH', error: '抽卡主题已变化，请使用当前全局主题重新发起抽卡。' }) };
        if (target.collection.points.balance < 1) return { ok: false, status: 409, json: async () => ({ code: 'NOT_ENOUGH_POINTS', error: '成就点不足' }) };
        const item = target.collection.characters.find(item => item.theme === body.theme);
        assert.ok(item, 'Draw fixture needs a character in the requested theme');
        const existing = target.collection.owned.find(entry => entry.id === item.id);
        const receipt = { requestId: 'stored:' + body.requestId, theme: body.theme, at: 200, cost: 1, results: Array.from({ length: 10 }, (_, index) => ({ id: item.id, rarity: item.rarity, isNew: !existing && index === 0 })) };
        drawReceipts.set(body.requestId, receipt); target.collection.draws.push(receipt);
        if (existing) existing.count += 10; else target.collection.owned.push({ id: item.id, count: 10, firstAt: 200 });
        target.collection.points.spent += 1; target.collection.points.balance -= 1; target.revision += 1; server.drawWrites += 1;
        if (server.failDrawAfterCommitCode) { const code = server.failDrawAfterCommitCode; server.failDrawAfterCommitCode = null; return { ok: false, status: 503, json: async () => ({ code, error: '写入已发生，但磁盘持久性尚未确认' }) }; }
        if (server.failDrawAfterCommit) { server.failDrawAfterCommit = false; throw new Error('connection lost after commit'); }
      }
      response = { ...decorate(target), draw: clone(drawReceipts.get(body.requestId)) };
    } else if (options.method === 'POST') {
      if (server.failPost) return { ok: false, status: 409, json: async () => ({ error: server.failPost }) };
      const body = JSON.parse(options.body);
      if (path === '/preferences') target.preferences = { ...target.preferences, ...body };
      if (path === '/equip') {
        if (body.slot === 'character') target.equipment.character = body.equipped === false ? null : body.id;
        else if (body.slot === 'charm') target.equipment.charm = body.equipped === false ? null : body.id;
        else target.equipment.badges = body.equipped === false ? [] : [body.id];
      }
      if (path === '/configure') target.definitions = target.definitions.map(item => body.archiveIds?.includes(item.id) ? { ...item, status: 'archived' } : item);
      if (path === '/delete') target.definitions = target.definitions.map(item => body.ids?.includes(item.id) ? { ...item, status: 'archived' } : item);
      if (path === '/characters') for (const declared of body.characters) {
        const previous = target.collection.characters.find(item => item.id === declared.id);
        if (previous) Object.assign(previous, declared);
        else target.collection.characters.push({ ...declared, id: `user-${++nextId}`, source: 'user' });
      }
      target.revision += 1;
      response = decorate(target);
    } else throw new Error(`Unexpected request ${url}`);
    return { ok: true, status: 200, json: async () => response };
  }
  const compiled = source.replace("'__ACHIEVEMENT_PORTRAITS__'", JSON.stringify(options.portraits ?? { version: 1, themes: {} }));
  vm.runInNewContext(compiled, { window, document, fetch, AbortController, setTimeout: timer, clearTimeout: clear, console });
  assert.equal(registration.id, 'dsh-achievement-journal');
  const plugin = registration.factory(name => {
    required.push(name);
    if (name === 'react') return React;
    if (name === 'react-dom') return { createPortal: children => ({ type: 'fixture-portal', props: { children } }) };
    throw new Error(`Unexpected dependency ${name}`);
  });
  const uiSession = { adapter: { current: { getSnapshot: () => ({ key: server.sessionKey }), subscribe(listener) { sessionListeners.add(listener); return () => sessionListeners.delete(listener); } } } };
  const context = {
    uiSession,
    slots: {
      inject(_name, callback) { return callback(); },
      register(meta, component) { const record = { meta, component, active: true }; records.push(record); return () => { record.active = false; }; },
    },
    effect(callback) { cleanupCallbacks.push(callback()); },
  };
  if (options.strictServices) {
    context.get = name => name === 'uiSession' ? uiSession : undefined;
    Object.defineProperty(context, 'uiSession', { get() { server.uiSessionGetterReads += 1; throw new Error('uiSession was not declared in inject'); } });
  }
  function stopFrame(target) { target.hooks.forEach(hook => hook?.cleanup?.()); }
  function renderNode(node, path) {
    if (node == null || typeof node === 'boolean') return null;
    if (Array.isArray(node)) return node.map((child, i) => renderNode(child, `${path}.${child?.props?.key ?? i}`));
    if (typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const key = `${path}:${node.type.name}`;
      const current = frames.get(key) ?? { hooks: [] }; frames.set(key, current); renderedFrames.add(key);
      const oldFrame = frame, oldIndex = hookIndex; frame = current; hookIndex = 0;
      const result = node.type(node.props); frame = oldFrame; hookIndex = oldIndex;
      return renderNode(result, `${key}.out`);
    }
    return { ...node, props: { ...node.props, children: renderNode(node.props?.children, `${path}.children`) } };
  }
  function render() {
    let result;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      dirty = false; renderedFrames = new Set();
      result = records.filter(record => record.active).map((record, i) => renderNode({ type: record.component, props: { wide: server.wide } }, `slot${i}`));
      for (const [key, value] of frames) if (!renderedFrames.has(key)) { stopFrame(value); frames.delete(key); }
      while (effects.length) effects.shift()();
      if (!dirty) return result;
    }
    throw new Error('Client did not settle after simulated render');
  }
  function nodes(tree = render()) {
    const result = [];
    function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (node && typeof node === 'object') { result.push(node); walk(node.props?.children); } }
    walk(tree); return result;
  }
  function textContent(tree = render()) {
    if (tree == null || typeof tree === 'boolean') return '';
    if (Array.isArray(tree)) return tree.map(textContent).join(' ');
    if (typeof tree === 'object') return textContent(tree.props?.children);
    return String(tree);
  }
  async function advance(ms) {
    const target = now + ms;
    for (let safety = 0; safety < 1000; safety += 1) {
      const entry = [...timers.entries()].filter(([, value]) => value.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry) { now = target; return; }
      now = entry[1].due; timers.delete(entry[0]); entry[1].callback(); await settle();
    }
    throw new Error('Timer loop did not settle');
  }
  function dispatch(map, name, event = {}) { [...(map.get(name) ?? [])].forEach(fn => fn(event)); }
  function click(label) {
    const matches = nodes().filter(node => node.type === 'button' && (node.props['aria-label'] === label || textContent(node).trim() === label));
    const button = matches.find(node => !node.props.disabled) || matches[0];
    assert.ok(button, `Missing button: ${label}`); assert.equal(Boolean(button.props.disabled), false, `${label} disabled`); button.props.onClick(); render();
  }
  function change(id, value) {
    const input = nodes().find(node => node.props?.id === id);
    assert.ok(input, `Missing field: ${id}`); input.props.onChange({ target: { value, checked: value } }); render();
  }
  plugin.apply(context); render();
  return {
    plugin, required, records, requests, server, document, window, timers, documentEvents, windowEvents, copied, storage,
    state: () => getStore(), render, nodes, textContent, advance, click, change,
    async ready() { await settle(); render(); },
    visibility(hidden) { document.hidden = hidden; dispatch(documentEvents, 'visibilitychange'); },
    online() { dispatch(windowEvents, 'online'); },
    session(key) { server.sessionKey = key; sessionListeners.forEach(listener => listener()); },
    systemMotion(value) { server.systemReduce = value; mediaListeners.forEach(listener => listener()); render(); },
    key(key) { const event = { key, preventDefault() {}, stopPropagation() {} }; dispatch(documentEvents, 'keydown', event); render(); },
    cleanup() { cleanupCallbacks.splice(0).forEach(callback => callback?.()); frames.forEach(stopFrame); frames.clear(); },
    remount() { plugin.apply(context); render(); },
  };
}

test('native slots open a single real-data center and clean up styles, keyboard and polling', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready();
  assert.deepEqual(app.required, ['react', 'react-dom']);
  assert.deepEqual(Array.from(app.plugin.inject), ['slots']);
  assert.deepEqual(app.records.map(item => [item.meta.name, item.meta.label]), [['settings.section', '成就手记'], ['sidebar.footer.action', undefined]]);
  assert.equal(app.document.head.children.length, 1);
  assert.equal(app.requests.filter(request => request.url.endsWith('/state')).length, 1);
  assert.ok(app.requests.every(request => request.options.credentials === 'same-origin'));
  app.click('打开成就中心');
  assert.equal(app.nodes().filter(node => node.props?.role === 'dialog').length, 1);
  assert.equal(app.nodes().filter(node => node.type === 'fixture-portal').length, 1);
  assert.match(app.textContent(), /等待第一段真实经历/);
  assert.equal(app.document.body.style.overflow, 'hidden');
  app.key('Escape'); assert.equal(app.state().open, false); assert.equal(app.document.body.style.overflow, '');
  app.cleanup(); await settle();
  assert.equal(app.document.head.children.length, 0);
  assert.ok(app.records.every(record => !record.active));
  assert.equal(app.timers.size, 0);
  assert.equal(app.documentEvents.get('visibilitychange').size, 0);
  assert.equal(app.windowEvents.get('online').size, 0);
});

test('notification watermark, coalescing, unlock priority and reconnect never replay old entries', async t => {
  const old = { id: 'old', kind: 'unlock', title: '旧成就', at: 1 };
  const app = harness(journal({ notifications: [old] })); t.after(() => app.cleanup()); await app.ready();
  await app.advance(700); assert.equal(app.state().toast, null);
  app.server.state.revision = 2;
  app.server.state.notifications.push({ id: 'progress', kind: 'progress', title: '新积累', tokens: 200, turns: 1, at: 2 });
  await app.advance(1100); await app.advance(650);
  assert.equal(app.state().toast.kind, 'progress'); assert.equal(app.state().toast.items.length, 1);
  app.server.state.revision = 3;
  app.server.state.notifications.push({ id: 'award', kind: 'unlock', title: '新成就', at: 3 }, { id: 'level', kind: 'level', level: 2, at: 3 });
  await app.advance(1150); await app.advance(650);
  assert.equal(app.state().toast.kind, 'unlock'); assert.equal(app.state().toast.items.length, 3);
  await app.advance(1150); assert.equal(app.state().toast.items.length, 3);
  app.click('关闭成长反馈'); await app.advance(1800); assert.equal(app.state().toast, null);
  app.server.failState = 'fixture offline'; await app.advance(1800);
  assert.equal(app.state().connected, false); assert.match(app.state().error, /fixture offline/);
  app.server.state.notifications.push({ id: 'offline-award', kind: 'unlock', title: '离线期间', at: 4 });
  app.online(); await app.ready(); await app.advance(700);
  assert.equal(app.state().connected, true); assert.equal(app.state().toast, null);
  app.visibility(true); app.server.state.notifications.push({ id: 'hidden-award', kind: 'unlock', at: 5 });
  app.visibility(false); await app.ready(); await app.advance(700);
  assert.equal(app.state().toast, null);
});

test('unknown progress stays unknown, hidden achievements stay surprising and history uses the award snapshot', async t => {
  const app = harness(journal({
    totals: { tokens: null, turns: null, fileReads: null },
    level: { number: 1, current: 600, next: 100000, progress: null, incomplete: true },
    definitions: [definition({ id: 'secret', hidden: true, title: '不应透出标题', description: '不应透出条件', progress: null }), definition({ id: 'earned', title: '后来改名', unlockedAt: 3 })],
    awards: [{ id: 'award:earned', definitionId: 'earned', at: 3, title: '当时的纪念', description: '当时的记录', source: 'user_record' }],
    timeline: [{ id: 'entry', kind: 'unlock', at: 3, definitionId: 'earned', awardId: 'award:earned', source: 'user_record' }],
    coverage: { complete: false },
  })); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心');
  assert.match(app.textContent(), /进度尚无可用记录/); assert.match(app.textContent(), /证据尚不完整/);
  assert.doesNotMatch(app.textContent(), /等待第一段真实经历/);
  app.click('成就收藏'); assert.match(app.textContent(), /尚未揭晓/);
  assert.doesNotMatch(app.textContent(), /不应透出标题|不应透出条件/);
  app.click('使用历程'); assert.match(app.textContent(), /当时的纪念/); assert.match(app.textContent(), /用户记录/);
  assert.doesNotMatch(app.textContent(), /后来改名/);
  assert.ok(app.nodes().every(node => !('dangerouslySetInnerHTML' in (node.props ?? {}))));
});

test('reconnect during an older in-flight request establishes a fresh server watermark', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready();
  app.server.deferNextState = true; await app.advance(1800);
  assert.equal(typeof app.server.releaseState, 'function');
  app.server.state.revision = 2;
  app.server.state.notifications.push({ id: 'while-disconnected', kind: 'unlock', title: '重连前完成', at: 2 });
  app.online(); app.server.releaseState(); await app.ready(); await app.advance(700);
  assert.equal(app.state().data.revision, 2); assert.equal(app.state().toast, null);
  app.server.state.revision = 3;
  app.server.state.notifications.push({ id: 'after-reconnect', kind: 'unlock', title: '重连后完成', at: 3 });
  await app.advance(1800); await app.advance(650);
  assert.equal(app.state().toast.leader.id, 'after-reconnect'); assert.equal(app.state().toast.items.length, 1);
});

test('preferences and equipment save through the API and failures preserve the saved state', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready();
  app.click('打开成就中心');
  app.change('daj-global-theme', 'xianxia'); await app.ready();
  assert.equal(app.state().data.preferences.theme, 'xianxia');
  app.change('daj-settings-charm', 'leaf'); await app.ready();
  assert.equal(app.state().data.equipment.charm, 'leaf');
  const equipRequest = app.requests.find(item => item.url.endsWith('/equip'));
  assert.deepEqual(JSON.parse(equipRequest.options.body), { id: 'leaf', slot: 'charm', equipped: true });
  app.server.failPost = '请先取下一枚勋章';
  app.change('daj-settings-charm', 'star'); await app.ready();
  assert.equal(app.state().data.equipment.charm, 'leaf'); assert.match(app.textContent(), /请先取下一枚勋章/);
});

test('one-click generation submits selected real sources and applies only the successful job result', async t => {
  const app = harness(journal(), { sessionKey: 'session:fixture' }); t.after(() => app.cleanup()); await app.ready();
  assert.ok(app.requests.some(item => item.url.endsWith('/catalog?sessionId=session%3Afixture')));
  app.click('打开成就中心'); app.click('自定义生成');
  assert.doesNotMatch(app.textContent(), /复制给模型|粘贴发送/);
  assert.ok(!app.nodes().some(node => node.props?.id === 'daj-metric-recipe'));
  app.change('daj-metric-tokens', false);
  app.change('daj-global-theme', 'cyber'); await app.ready(); app.change('daj-generation-direction', '城市夜航');
  app.nodes().find(node => node.type === 'input' && node.props.type === 'radio' && node.props.value === 'discovery').props.onChange(); app.render();
  app.click('分析并生成成就'); await app.ready();
  const submitted = JSON.parse(app.requests.find(item => item.url.endsWith('/generation') && item.options.method === 'POST').options.body);
  assert.deepEqual(submitted.metrics, ['file_read']); assert.equal(submitted.theme, 'cyber'); assert.equal(submitted.style, 'discovery');
  assert.equal(submitted.direction, '城市夜航'); assert.equal(submitted.sessionId, 'session:fixture'); assert.ok(submitted.requestId);
  assert.equal(app.copied.length, 0); assert.equal(app.state().data.definitions.length, 0);
  assert.equal(app.state().generationJob.stage, 'analyzing'); assert.match(app.textContent(), /分析使用记录/);
  app.server.job = { ...app.server.job, stage: 'generating', updatedAt: 101, message: '模型正在生成规则' };
  await app.advance(1200); assert.match(app.textContent(), /生成成就规则/);
  app.server.job = { ...app.server.job, stage: 'applying', updatedAt: 102, message: '正在校验并保存' };
  await app.advance(1200);
  assert.equal(app.nodes().find(node => node.type === 'button' && app.textContent(node).trim() === '正在应用').props.disabled, true);
  app.server.state.revision = 2;
  app.server.state.definitions.push(definition({ id: 'generated', source: 'model', title: '夜航第一眼' }));
  app.server.job = { ...app.server.job, status: 'succeeded', stage: 'done', updatedAt: 103, message: '已保存新的成就', createdDefinitionIds: ['generated'], totalTokens: 230 };
  await app.advance(1200); app.render();
  assert.match(app.textContent(), /已生成并应用 1 项成就/); assert.match(app.textContent(), /夜航第一眼/); assert.match(app.textContent(), /230 token/);
  assert.equal(app.state().data.definitions.length, 1);
  app.click('查看新成就'); assert.equal(app.state().tab, 'collection'); assert.match(app.textContent(), /夜航第一眼/);
});

test('generation unavailable, failed and cancelled states do not invent saved achievements', async t => {
  const app = harness(journal(), { generation: { available: false, reason: '请先配置默认模型' } }); t.after(() => app.cleanup());
  await app.ready(); app.click('打开成就中心'); app.click('自定义生成');
  assert.match(app.textContent(), /请先配置默认模型/);
  assert.equal(app.nodes().find(node => node.type === 'button' && app.textContent(node).trim() === '分析并生成成就').props.disabled, true);
  assert.equal(app.requests.filter(item => item.url.endsWith('/generation') && item.options.method === 'POST').length, 0);
  app.server.catalog.generation.available = true; app.click('重新检查'); await app.ready();
  app.server.failGenerationStart = '模型暂时不可用'; app.click('分析并生成成就'); await app.ready();
  assert.match(app.textContent(), /模型暂时不可用/); assert.equal(app.state().data.definitions.length, 0);
  app.server.failGenerationStart = null; app.click('分析并生成成就'); await app.ready(); app.click('取消生成'); await app.ready();
  assert.equal(app.state().generationJob.status, 'cancelled'); assert.match(app.textContent(), /已取消本次生成/);
  app.click('分析并生成成就'); await app.ready();
  app.server.job = { ...app.server.job, status: 'failed', stage: 'done', updatedAt: 200, message: '生成规则未通过校验', createdDefinitionIds: [] };
  await app.advance(1200); assert.match(app.textContent(), /本次生成未完成/); assert.match(app.textContent(), /未通过校验/);
  assert.equal(app.state().data.definitions.length, 0); assert.doesNotMatch(app.textContent(), /已生成并应用/);
});

test('source connectivity filters defaults, select-all and generation after active scope changes', async t => {
  const app = harness(journal(), { capabilities: { sources: [{ kind: 'tokens', connected: true }, { kind: 'file_read', connected: false }] } });
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('自定义生成');
  const field = id => app.nodes().find(node => node.props?.id === 'daj-metric-' + id);
  assert.equal(field('tokens').props.checked, true);
  assert.equal(field('file_read').props.checked, false); assert.equal(field('file_read').props.disabled, true);
  assert.match(app.textContent(), /当前环境不可用/);
  app.click('全选'); assert.equal(field('file_read').props.checked, false);
  app.server.catalog.capabilities.sources = [{ kind: 'tokens', connected: false }, { kind: 'file_read', connected: true }];
  app.session('scope:changed'); await app.ready();
  assert.equal(field('tokens').props.checked, false); assert.equal(field('tokens').props.disabled, true);
  assert.equal(field('file_read').props.disabled, false);
  app.click('全选'); assert.equal(field('file_read').props.checked, true);
  app.click('分析并生成成就'); await app.ready();
  const submitted = JSON.parse(app.requests.find(item => item.url.endsWith('/generation') && item.options.method === 'POST').options.body);
  assert.deepEqual(submitted.metrics, ['file_read']);
});

test('optional Cordis session service uses get without touching a guarded property getter', async t => {
  const app = harness(journal(), { strictServices: true, sessionKey: 'session:first' }); t.after(() => app.cleanup()); await app.ready();
  assert.ok(app.requests.some(item => item.url.endsWith('/catalog?sessionId=session%3Afirst')));
  app.session('session:second'); await app.ready();
  assert.ok(app.requests.some(item => item.url.endsWith('/catalog?sessionId=session%3Asecond')));
  app.click('打开成就中心'); app.click('自定义生成'); app.click('分析并生成成就'); await app.ready();
  const submitted = JSON.parse(app.requests.find(item => item.url.endsWith('/generation') && item.options.method === 'POST').options.body);
  assert.equal(submitted.sessionId, 'session:second'); assert.equal(app.server.uiSessionGetterReads, 0);
});

test('running generation restores independently of the open page and default routing omits a non-string session key', async t => {
  const restored = { id: 'restored-job', status: 'running', stage: 'generating', message: '仍在生成中', createdAt: 1, updatedAt: 2, createdDefinitionIds: [] };
  const app = harness(journal(), { job: restored, strictServices: true, sessionKey: { private: 'not-a-session-id' } }); t.after(() => app.cleanup()); await app.ready();
  assert.ok(app.requests.some(item => item.url.endsWith('/generation'))); assert.ok(!app.requests.some(item => item.url.includes('sessionId=')));
  app.click('打开成就中心'); app.click('自定义生成'); assert.match(app.textContent(), /仍在生成中/);
  app.key('Escape'); app.server.job = { ...app.server.job, status: 'cancelled', stage: 'done', updatedAt: 3 };
  await app.advance(1200); assert.equal(app.state().generationJob.status, 'cancelled');
  app.click('打开成就中心'); app.click('自定义生成'); app.click('分析并生成成就'); await app.ready();
  const submitted = JSON.parse(app.requests.find(item => item.url.endsWith('/generation') && item.options.method === 'POST').options.body);
  assert.equal('sessionId' in submitted, false);
});

test('footer decoration is a small native strip and collapses to one icon', async t => {
  const earned = definition({ unlockedAt: 3 });
  const app = harness(journal({ definitions: [earned], equipment: { badges: ['first-read'], charm: 'leaf' } })); t.after(() => app.cleanup()); await app.ready();
  assert.equal(app.records.find(record => record.meta.name === 'sidebar.footer.action').meta.order, 9990);
  let strip = app.nodes().find(node => node.type === 'button' && node.props.className?.includes('daj-profile-strip'));
  assert.match(app.textContent(strip), /Lv\.1/); assert.ok(app.nodes(strip).some(node => node.props?.className === 'daj-profile-badges'));
  app.server.wide = false; strip = app.nodes().find(node => node.type === 'button' && node.props.className?.includes('daj-profile-strip'));
  assert.match(strip.props.className, /daj-profile-narrow/); assert.equal(app.textContent(strip).trim(), '');
  strip.props.onClick(); app.render(); assert.equal(app.state().open, true);
});

test('ten themes and frame height previews stay local until saving and preserve earned records', async t => {
  const award = { id: 'award-1', definitionId: 'first-read', at: 3, title: '第一眼', source: 'automatic' };
  const app = harness(journal({ awards: [award] })); t.after(() => app.cleanup()); await app.ready();
  app.click('打开成就中心');
  const themeField = app.nodes().find(node => node.props?.id === 'daj-global-theme');
  assert.equal(app.nodes(themeField).filter(node => node.type === 'option').length, 10);
  const writes = app.requests.filter(item => item.options.method === 'POST').length;
  app.click('展示 104px'); app.change('daj-settings-frame-height', '145');
  assert.equal(app.requests.filter(item => item.options.method === 'POST').length, writes);
  assert.ok(app.nodes().some(node => node.props?.className?.includes('daj-account-frame') && node.props.style?.height === '145px'));
  app.click('保存展示框'); await app.ready();
  assert.equal(app.state().data.preferences.frameStyle, 'showcase'); assert.equal(app.state().data.preferences.frameHeight, 145);
  assert.equal(app.nodes().find(node => node.type === 'button' && node.props.className?.includes('daj-profile-strip')).props.style.height, '145px');
  for (const selected of ['wuxia', 'fantasy', 'space', 'ocean', 'garden', 'academy', 'steampunk']) {
    app.change('daj-global-theme', selected); await app.ready(); assert.equal(app.state().data.preferences.theme, selected);
    assert.equal(app.state().data.awards.length, 1);
  }
});

test('zero point draw stays disabled and a committed network failure retries the exact request across remount', async t => {
  const app = harness(journal({ collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: [character()], owned: [], draws: [] } }));
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('角色收藏');
  const drawButton = () => app.nodes().find(node => node.type === 'button' && app.textContent(node).trim() === '1 成就点 · 十连抽取');
  assert.equal(drawButton().props.disabled, true); assert.match(app.textContent(), /解锁一项成就/);
  app.server.state.collection.points = { earned: 1, spent: 0, balance: 1 }; app.server.state.revision = 2;
  await app.advance(1800); assert.equal(drawButton().props.disabled, false);
  app.server.failDrawAfterCommit = true; app.click('1 成就点 · 十连抽取'); await app.ready();
  assert.equal(app.server.drawWrites, 1); assert.ok(app.storage.has('dsh-achievement-journal.draw'));
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-global-theme').props.disabled, true);
  const pendingRequests = app.requests.length;
  app.change('daj-global-theme', 'garden'); await app.ready();
  assert.equal(app.requests.length, pendingRequests); assert.equal(app.state().data.preferences.theme, 'explorer');
  app.cleanup(); await settle(); app.remount(); await app.ready(); app.click('打开成就中心'); app.click('角色收藏');
  assert.equal(app.state().data.collection.points.balance, 0); app.click('重试这次十连'); await app.ready();
  const draws = app.requests.filter(item => item.url.endsWith('/draw'));
  assert.equal(draws.length, 2); assert.deepEqual(JSON.parse(draws[0].options.body), JSON.parse(draws[1].options.body));
  assert.equal(app.server.drawWrites, 1); assert.equal(app.state().data.collection.points.spent, 1);
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-global-theme').props.disabled, false);
  assert.equal(app.state().drawReceipt.results.length, 10); assert.match(app.textContent(), /已收藏 10 份/);
  app.click('佩戴角色 山海小狐'); await app.ready(); assert.equal(app.state().data.equipment.character, 'hero');
  assert.ok(app.nodes().some(node => node.props?.['data-animation'] === 'float'));
  assert.equal(app.storage.has('dsh-achievement-journal.draw'), false);
  const before = app.requests.filter(item => item.options.method === 'POST').length;
  app.cleanup(); await settle(); app.remount(); await app.ready();
  assert.equal(app.requests.filter(item => item.options.method === 'POST').length, before);
});

test('custom art validates MIME and header, joins the pool, and an owned custom appearance remains editable', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心');
  app.change('daj-global-theme', 'garden'); await app.ready(); app.click('角色收藏'); app.click('创作角色');
  app.change('daj-character-name', '抱莲小狐'); app.change('daj-character-icon', 'lotus'); app.change('daj-character-animation', 'orbit');
  const upload = file => app.nodes().find(node => node.props?.id === 'daj-character-art').props.onChange({ target: { files: [file] } });
  upload({ type: 'image/svg+xml', size: 12, dataURL: 'data:image/svg+xml;base64,PHN2Zz4=' }); app.render(); assert.match(app.textContent(), /PNG、JPEG、GIF/);
  upload({ type: 'image/png', size: 30, dataURL: PIXEL_GIF.replace('image/gif', 'image/png') }); await app.ready(); assert.match(app.textContent(), /内容与格式不匹配/);
  upload({ type: 'image/gif', size: 42, dataURL: PIXEL_GIF }); await app.ready(); app.click('保存角色到卡池'); await app.ready();
  const created = app.state().data.collection.characters.find(item => item.name === '抱莲小狐');
  assert.ok(created); assert.equal(created.art, PIXEL_GIF); assert.equal(created.theme, 'garden'); assert.equal(app.state().data.collection.owned.length, 0);
  app.click('返回角色收藏'); app.click('全部卡池'); assert.match(app.textContent(), /尚未获得 · 已在卡池/);
  app.server.state.collection.owned.push({ id: created.id, count: 2, firstAt: 20 }); app.server.state.revision += 1;
  await app.advance(1800); app.click('编辑角色 抱莲小狐');
  assert.ok(!app.nodes().some(node => node.props?.id === 'daj-character-theme'));
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-character-rarity').props.disabled, true);
  app.change('daj-character-name', '莲灯小狐'); app.change('daj-character-animation', 'pulse'); app.click('保存角色外观'); await app.ready();
  assert.equal(app.state().data.collection.characters.find(item => item.id === created.id).name, '莲灯小狐');
  assert.equal(app.state().data.collection.owned.find(item => item.id === created.id).count, 2);
  app.change('daj-settings-motion', 'reduce'); await app.ready();
  assert.ok(app.server.canvasDraws > 0);
  assert.ok(app.nodes().filter(node => node.type === 'img').every(node => node.props.src.startsWith('data:image/png;')));
  assert.equal(app.state().data.collection.characters.find(item => item.id === created.id).art, PIXEL_GIF);
  app.change('daj-settings-motion', 'system'); await app.ready(); app.systemMotion(true); await app.ready();
  assert.ok(app.nodes().filter(node => node.type === 'img').every(node => node.props.src.startsWith('data:image/png;')));
});

test('model character generation omits achievement metrics and saves into the pool without granting ownership or points', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心');
  app.change('daj-global-theme', 'xianxia'); await app.ready(); app.click('角色收藏'); app.click('创作角色');
  app.change('daj-character-generation-direction', '莲灯灵狐'); app.click('模型生成角色'); await app.ready();
  const submitted = JSON.parse(app.requests.find(item => item.url.endsWith('/generation') && item.options.method === 'POST').options.body);
  assert.equal(submitted.kind, 'characters'); assert.equal(submitted.theme, 'xianxia'); assert.equal('metrics' in submitted, false);
  app.server.state.collection.characters.push(character({ id: 'model-fox', name: '莲灯灵狐', theme: 'xianxia', source: 'model' })); app.server.state.revision += 1;
  app.server.job = { ...app.server.job, status: 'succeeded', stage: 'done', updatedAt: 200, createdCharacterIds: ['model-fox'], message: '角色已加入卡池' };
  await app.advance(1200); app.render(); assert.match(app.textContent(), /已生成并加入卡池 1 位角色/);
  assert.equal(app.state().data.collection.owned.length, 0); assert.equal(app.state().data.collection.points.balance, 0);
  app.click('查看新角色'); assert.match(app.textContent(), /莲灯灵狐/); assert.match(app.textContent(), /尚未获得 · 已在卡池/);
});

test('full custom pool blocks model and manual creation while keeping existing custom editing available', async t => {
  const custom = character({ id: 'custom', name: '已有同伴', source: 'user' });
  const app = harness(journal({ collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: [character(), custom], owned: [], draws: [] } }), { collectionLimits: { customCharacters: 1 } });
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('角色收藏'); app.click('创作角色');
  assert.match(app.textContent(), /自定义卡池已满/);
  const modelButton = app.nodes().find(node => node.type === 'button' && app.textContent(node).trim() === '模型生成角色');
  assert.equal(modelButton.props.disabled, true); modelButton.props.onClick();
  const newButton = app.nodes().find(node => node.type === 'button' && app.textContent(node).trim() === '保存角色到卡池');
  assert.equal(newButton.props.disabled, true); newButton.props.onClick(); await app.ready();
  assert.equal(app.requests.filter(item => item.options.method === 'POST').length, 0);
  app.click('返回角色收藏'); app.click('全部卡池'); app.click('编辑角色 已有同伴');
  app.change('daj-character-name', '改名后的同伴'); app.click('保存角色外观'); await app.ready();
  assert.equal(app.state().data.collection.characters.find(item => item.id === 'custom').name, '改名后的同伴');
});

test('debug actions stay isolated, disable model requests, rotate reset tokens and restore real state on explicit exit', async t => {
  const real = journal({ totals: { tokens: 900, turns: 3 } });
  const app = harness(real); t.after(() => app.cleanup()); await app.ready();
  app.click('进入调试模式'); await app.ready();
  const firstToken = app.storage.get('dsh-achievement-journal.debug');
  assert.ok(firstToken); assert.equal(app.state().debugActive, true); assert.equal(app.state().data.totals.tokens, 0);
  assert.equal(app.requests.find(item => item.url.endsWith('/debug/start')).options.headers['x-daj-debug'], undefined);
  assert.ok(app.nodes().some(node => node.props?.className === 'daj-debug-banner'));
  assert.ok(app.nodes().some(node => node.props?.className === 'daj-frame-debug-label'));
  app.click('打开成就中心');
  app.change('daj-global-theme', 'garden'); await app.ready();
  assert.equal(app.server.debugStates.get(firstToken).preferences.theme, 'garden'); assert.equal(app.server.state.preferences.theme, 'explorer');
  app.click('完成所选成就'); await app.ready(); assert.equal(app.state().data.awards.length, 1);
  app.click('加一个挂件'); await app.ready(); assert.equal(app.state().data.equipment.charm, 'star');
  app.click('调试十连并佩戴'); await app.ready();
  assert.equal(app.state().data.equipment.character, 'hero-garden'); assert.equal(app.state().drawReceipt.results.length, 10);
  assert.equal(app.state().tab, 'characters'); assert.match(app.textContent(), /独立临时数据/);
  app.click('创作角色');
  const modelButton = app.nodes().find(node => node.type === 'button' && app.textContent(node).trim() === '模型生成角色');
  assert.equal(modelButton.props.disabled, true); modelButton.props.onClick(); await app.ready();
  assert.equal(app.requests.filter(item => item.url.endsWith('/generation') && item.options.method === 'POST').length, 0);
  app.click('重置调试数据'); await app.ready();
  const secondToken = app.storage.get('dsh-achievement-journal.debug');
  assert.notEqual(secondToken, firstToken); assert.equal(app.server.debugStates.has(firstToken), false); assert.equal(app.state().data.awards.length, 0);
  assert.equal(app.requests.find(item => item.url.endsWith('/debug/reset')).options.headers['x-daj-debug'], firstToken);
  app.click('退出调试'); await app.ready();
  assert.equal(app.storage.has('dsh-achievement-journal.debug'), false); assert.equal(app.state().debugActive, false);
  assert.equal(app.state().data.totals.tokens, 900); assert.deepEqual(app.server.state, real);
  assert.ok(!app.nodes().some(node => node.props?.className === 'daj-debug-banner'));
});

test('expired debug scope remains explicit, prevents writes and never retries against real state', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('进入调试模式'); await app.ready();
  const token = app.storage.get('dsh-achievement-journal.debug'); app.server.debugStates.delete(token);
  const beforeExpiry = app.requests.length;
  await app.advance(1800); app.render();
  assert.equal(app.state().debugActive, true); assert.equal(app.state().debugExpired, true); assert.equal(app.state().busy, true);
  assert.equal(app.storage.get('dsh-achievement-journal.debug'), token);
  assert.match(app.textContent(), /未切回真实数据/);
  const beforeWrite = app.requests.length;
  app.change('daj-global-theme', 'cyber'); await app.ready();
  assert.equal(app.requests.length, beforeWrite); assert.equal(app.server.state.preferences.theme, 'explorer');
  assert.ok(app.requests.slice(beforeExpiry).every(item => item.options.headers['x-daj-debug'] === token));
  app.click('退出调试'); await app.ready(); assert.equal(app.state().debugActive, false);
  app.change('daj-global-theme', 'cyber'); await app.ready();
  assert.equal(app.server.state.preferences.theme, 'cyber'); assert.equal(app.requests.at(-1).options.headers['x-daj-debug'], undefined);
});

test('mode switches discard late state responses in both directions and clear a previous draw retry', async t => {
  const storage = new Map([['dsh-achievement-journal.draw', JSON.stringify({ id: 'old-real-draw', theme: 'explorer', scope: 'real' })]]);
  const app = harness(journal({ totals: { tokens: 500, turns: 1 } }), { storage }); t.after(() => app.cleanup()); await app.ready();
  assert.equal(app.state().drawRetry, true);
  app.server.ignoreStateAbort = true; app.server.deferNextState = true; await app.advance(1800);
  const releaseReal = app.server.releaseState;
  app.click('进入调试模式'); await app.ready();
  assert.equal(app.state().drawRetry, false); assert.equal(storage.has('dsh-achievement-journal.draw'), false);
  releaseReal(); await app.ready(); assert.equal(app.state().debugActive, true); assert.equal(app.state().data.totals.tokens, 0);
  app.server.deferNextState = true; await app.advance(1800); const releaseDebug = app.server.releaseState;
  app.server.state.totals.tokens = 700;
  app.click('退出调试'); await app.ready(); releaseDebug(); await app.ready();
  assert.equal(app.state().debugActive, false); assert.equal(app.state().data.totals.tokens, 700);
  assert.equal(app.state().data.debug.active, false);
});

test('portrait atlas uses the exact cell crop, user art takes priority and loading failures fall back', async t => {
  const url = '/dsh-achievement-journal/api/assets/portraits/explorer.webp?version=abc123def456';
  const portraits = { version: 1, themes: { explorer: { url, columns: 4, rows: 2, aspect: .75, characters: [{ id: 'hero', name: '山海小狐', icon: 'fox', column: 2, row: 1 }] } } };
  const state = journal({ equipment: { badges: [], charm: null, character: 'hero' }, collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: [character()], owned: [{ id: 'hero', count: 1, firstAt: 1 }], draws: [] } });
  const app = harness(state, { portraits }); t.after(() => app.cleanup()); await app.ready();
  let sprite = app.nodes().find(node => node.props?.className === 'daj-character-portrait');
  assert.ok(sprite); assert.equal(sprite.props.style.backgroundSize, '400% 200%'); assert.match(sprite.props.style.backgroundPosition, /^66\.666.*% 100%$/);
  assert.equal(sprite.props.style.backgroundImage, `url("${url}")`);
  assert.ok(app.nodes().some(node => node.props?.['data-animation'] === 'float'));
  app.server.state.collection.characters[0].art = PIXEL_PNG; app.server.state.revision += 1; await app.advance(1800);
  assert.ok(app.nodes().some(node => node.type === 'img' && node.props.src === PIXEL_PNG));
  assert.ok(!app.nodes().some(node => node.props?.className === 'daj-character-portrait'));
  const failed = harness(state, { portraits, imageErrors: [url] }); t.after(() => failed.cleanup()); await failed.ready();
  assert.ok(!failed.nodes().some(node => node.props?.className === 'daj-character-portrait'));
  assert.ok(failed.nodes().some(node => node.type === 'svg' && node.props.viewBox === '0 0 140 160'));
});

test('one global portrait style switches the frame, collection, ten-pull results and editor without changing game state', async t => {
  const hero = character({ id: 'hero-explorer', source: 'model' });
  const receipt = { requestId: 'style-draw', theme: 'explorer', at: 100, cost: 1, results: Array.from({ length: 10 }, (_, index) => ({ id: hero.id, rarity: hero.rarity, isNew: index === 0 })) };
  const initial = journal({ equipment: { badges: [], charm: 'star', character: hero.id }, collection: { points: { earned: 1, spent: 1, balance: 0 }, characters: [hero], owned: [{ id: hero.id, count: 10, firstAt: 100 }], draws: [receipt] } });
  const app = harness(initial, { portraits: portraitManifest() }); t.after(() => app.cleanup());
  await app.ready(); app.click('打开成就中心'); app.click('角色收藏');
  const selector = app.nodes().filter(node => node.props?.id === 'daj-global-portrait-style');
  assert.equal(selector.length, 1); assert.equal(selector[0].props.value, 'flat');
  assert.ok(!app.requests.some(item => item.options.method === 'POST'), 'Displaying the default style must not write legacy preferences');
  assert.deepEqual(Array.from(selector[0].props.children, node => node.props.value), ['flat', 'pixel']);
  assert.match(app.textContent(selector[0]), /清爽扁平.*微像素/);
  assert.equal(app.nodes().filter(node => node.props?.['aria-label'] === '成就页面').length, 1);
  const sprites = () => app.nodes().filter(node => node.props?.className === 'daj-character-portrait');
  assert.ok(sprites().length >= 12);
  assert.ok(sprites().every(node => node.props.style.backgroundImage.includes('/flat/explorer.webp')));
  app.change('daj-global-portrait-style', 'pixel'); await app.ready();
  assert.ok(sprites().every(node => node.props.style.backgroundImage.includes('/pixel/explorer.webp')));
  assert.ok(app.nodes().filter(node => node.props?.className?.startsWith('daj-character-art')).every(node => node.props['data-portrait-style'] === 'pixel'));
  app.click('编辑角色 山海小狐'); app.change('daj-character-name', '尚未保存的名字');
  app.change('daj-global-portrait-style', 'flat'); await app.ready();
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-character-name').props.value, '尚未保存的名字');
  assert.ok(sprites().every(node => node.props.style.backgroundImage.includes('/flat/explorer.webp')));
  app.change('daj-global-portrait-style', 'pixel'); await app.ready();
  app.change('daj-settings-motion', 'reduce'); await app.ready();
  assert.ok(sprites().every(node => node.props.style.backgroundImage.includes('/pixel/explorer.webp')));
  assert.ok(app.nodes().filter(node => node.props?.className?.startsWith('daj-character-art')).every(node => node.props['data-animation'] === 'none'));
  for (const key of ['collection', 'equipment', 'definitions', 'awards', 'timeline', 'totals', 'level']) assert.deepEqual(clone(app.state().data[key]), initial[key]);
  const posts = app.requests.filter(item => item.options.method === 'POST');
  assert.ok(posts.every(item => item.url.endsWith('/preferences')));
  assert.deepEqual(JSON.parse(posts.at(-2).options.body), { portraitStyle: 'pixel' });
  assert.deepEqual(JSON.parse(posts.at(-1).options.body), { reducedMotion: 'reduce' });
});

test('both portrait families cover all ten global themes and keep the same character identities and rarity', async t => {
  const rarities = ['N', 'N', 'R', 'R', 'SR', 'SR', 'SSR', 'SSR'];
  const cards = PORTRAIT_THEMES.flatMap(theme => Array.from({ length: 8 }, (_, index) => character({ id: `builtin:${theme}:${index + 1}`, theme, name: theme + '同伴' + (index + 1), rarity: rarities[index] })));
  const initial = journal({ collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: cards, owned: cards.map(item => ({ id: item.id, count: 1, firstAt: 1 })), draws: [] } });
  const app = harness(initial, { portraits: portraitManifest() }); t.after(() => app.cleanup()); await app.ready();
  app.click('打开成就中心'); app.click('角色收藏');
  for (const theme of PORTRAIT_THEMES) {
    app.change('daj-global-theme', theme); await app.ready();
    for (const style of ['pixel', 'flat']) {
      app.change('daj-global-portrait-style', style); await app.ready();
      const visible = app.nodes().filter(node => node.type === 'article' && node.props.className?.includes('daj-character-card'));
      assert.equal(visible.length, 8);
      visible.forEach((card, index) => {
        assert.match(app.textContent(card), new RegExp(theme + '同伴' + (index + 1)));
        const sprite = app.nodes(card).find(node => node.props?.className === 'daj-character-portrait');
        assert.ok(sprite); assert.equal(sprite.props.style.backgroundImage, `url("/dsh-achievement-journal/api/assets/portraits/${style}/${theme}.webp?version=abc123def456")`);
        assert.equal(sprite.props.style.backgroundPosition, `${index % 4 / 3 * 100}% ${Math.floor(index / 4) * 100}%`);
        const art = app.nodes(card).find(node => node.props?.['data-portrait-style']);
        assert.equal(art.props['data-portrait-style'], style); assert.equal(art.props.style['--daj-character-aspect'], 1);
        assert.match(card.props.className, new RegExp('daj-rarity-' + rarities[index] + '(?: |$)'));
      });
    }
  }
  assert.deepEqual(clone(app.state().data.collection), initial.collection);
  assert.ok(!app.requests.some(item => item.options.method === 'POST' && !item.url.endsWith('/preferences')));
});

test('theme, portrait style, feedback and frame saves preserve each other and a failed style save keeps the current atlas', async t => {
  const hero = character({ id: 'builtin:xianxia:1', theme: 'xianxia' });
  const initial = journal({ preferences: { theme: 'explorer', notifications: 'unlocks', reducedMotion: 'system', frameStyle: 'standard', frameHeight: 77 }, equipment: { badges: [], charm: null, character: hero.id }, collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: [hero], owned: [{ id: hero.id, count: 1, firstAt: 1 }], draws: [] } });
  const app = harness(initial, { portraits: portraitManifest() }); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心');
  app.change('daj-global-portrait-style', 'pixel'); await app.ready();
  app.change('daj-global-theme', 'xianxia'); await app.ready();
  assert.equal(app.state().data.preferences.portraitStyle, 'pixel');
  app.change('daj-settings-motion', 'reduce'); await app.ready();
  app.click('主题与反馈设置'); app.change('daj-center-frame-height', '101'); app.click('保存展示框'); await app.ready();
  assert.deepEqual(clone(app.state().data.preferences), { ...initial.preferences, theme: 'xianxia', portraitStyle: 'pixel', reducedMotion: 'reduce', frameHeight: 101 });
  app.server.failPost = '暂时无法保存画风'; app.change('daj-global-portrait-style', 'flat'); await app.ready();
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-global-portrait-style').props.value, 'pixel');
  assert.equal(app.state().data.preferences.theme, 'xianxia'); assert.match(app.textContent(), /暂时无法保存画风/);
  const sprites = app.nodes().filter(node => node.props?.className === 'daj-character-portrait');
  assert.ok(sprites.length); assert.ok(sprites.every(node => node.props.style.backgroundImage.includes('/pixel/xianxia.webp')));
  assert.ok(app.requests.filter(item => item.options.method === 'POST').every(item => item.url.endsWith('/preferences')));
});

test('a stale window changing portrait style preserves another window theme, feedback and frame changes and synchronizes the response', async t => {
  const cards = ['explorer', 'xianxia'].map(theme => character({ id: `builtin:${theme}:1`, theme }));
  const initial = journal({ preferences: { theme: 'explorer', portraitStyle: 'flat', notifications: 'all', reducedMotion: 'system', frameStyle: 'standard', frameHeight: 64 }, collection: { points: { earned: 1, spent: 0, balance: 1 }, characters: cards, owned: cards.map(item => ({ id: item.id, count: 1, firstAt: 1 })), draws: [] } });
  const app = harness(initial, { portraits: portraitManifest() }); t.after(() => app.cleanup()); await app.ready();
  app.click('打开成就中心'); app.click('角色收藏');
  const otherWindow = { ...initial.preferences, theme: 'xianxia', notifications: 'off', reducedMotion: 'reduce', frameStyle: 'showcase', frameHeight: 119 };
  app.server.state.preferences = otherWindow; app.server.state.revision++;
  assert.deepEqual(clone(app.state().data.preferences), initial.preferences, 'This window has not polled the other window changes yet');
  app.change('daj-global-portrait-style', 'pixel'); await app.ready();
  const expected = { ...otherWindow, portraitStyle: 'pixel' };
  assert.deepEqual(JSON.parse(app.requests.filter(item => item.url.endsWith('/preferences')).at(-1).options.body), { portraitStyle: 'pixel' });
  assert.deepEqual(app.server.state.preferences, expected); assert.deepEqual(clone(app.state().data.preferences), expected);
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-global-theme').props.value, 'xianxia');
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-global-portrait-style').props.value, 'pixel');
  const portraits = app.nodes().filter(node => node.props?.className === 'daj-character-portrait');
  assert.ok(portraits.length); assert.ok(portraits.every(node => node.props.style.backgroundImage.includes('/pixel/xianxia.webp')));
  assert.deepEqual(clone(app.state().data.collection), initial.collection);
});

test('a stale window changing only theme preserves another window portrait style and synchronizes the new atlas', async t => {
  const hero = character({ id: 'builtin:garden:1', theme: 'garden' });
  const initial = journal({ preferences: { theme: 'explorer', portraitStyle: 'flat', notifications: 'all', reducedMotion: 'system', frameStyle: 'standard', frameHeight: 64 }, collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: [hero], owned: [{ id: hero.id, count: 1, firstAt: 1 }], draws: [] } });
  const app = harness(initial, { portraits: portraitManifest() }); t.after(() => app.cleanup()); await app.ready();
  app.click('打开成就中心'); app.click('角色收藏');
  const otherWindow = { ...initial.preferences, portraitStyle: 'pixel', notifications: 'unlocks' };
  app.server.state.preferences = otherWindow; app.server.state.revision++;
  assert.equal(app.state().data.preferences.portraitStyle, 'flat', 'The local selector still contains the previous style');
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-global-portrait-style').props.value, 'flat');
  app.change('daj-global-theme', 'garden'); await app.ready();
  const expected = { ...otherWindow, theme: 'garden' };
  assert.deepEqual(JSON.parse(app.requests.filter(item => item.url.endsWith('/preferences')).at(-1).options.body), { theme: 'garden' });
  assert.deepEqual(app.server.state.preferences, expected); assert.deepEqual(clone(app.state().data.preferences), expected);
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-global-portrait-style').props.value, 'pixel');
  const portraits = app.nodes().filter(node => node.props?.className === 'daj-character-portrait');
  assert.ok(portraits.length); assert.ok(portraits.every(node => node.props.style.backgroundImage.includes('/pixel/garden.webp')));
  assert.deepEqual(clone(app.state().data.collection), initial.collection);
});

test('an unavailable or mismatched selected portrait family falls back without requesting another theme or a remote image', async t => {
  const hero = character({ id: 'builtin:explorer:1' });
  const initial = journal({ preferences: { theme: 'explorer', portraitStyle: 'pixel', reducedMotion: 'system' }, equipment: { badges: [], charm: null, character: hero.id }, collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: [hero], owned: [{ id: hero.id, count: 1, firstAt: 1 }], draws: [] } });
  for (const invalid of ['missing', '/dsh-achievement-journal/api/assets/portraits/flat/explorer.webp?version=abc123def456', '/dsh-achievement-journal/api/assets/portraits/pixel/xianxia.webp?version=abc123def456', 'https://example.invalid/portrait.webp']) {
    const portraits = portraitManifest();
    if (invalid === 'missing') delete portraits.styles.pixel;
    else portraits.styles.pixel.themes.explorer.url = invalid;
    const app = harness(initial, { portraits }); t.after(() => app.cleanup()); await app.ready();
    assert.ok(!app.nodes().some(node => node.props?.className === 'daj-character-portrait'));
    assert.ok(app.nodes().some(node => node.type === 'svg' && node.props.viewBox === '0 0 140 160'));
    assert.equal(app.server.images.length, 0);
  }
});

test('delayed portrait errors from a previous style cannot replace the current atlas or a newer retry', async t => {
  const hero = character({ id: 'hero-explorer' });
  const app = harness(journal({ equipment: { badges: [], charm: null, character: hero.id }, collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: [hero], owned: [{ id: hero.id, count: 1, firstAt: 1 }], draws: [] } }), { portraits: portraitManifest(), manualImages: true });
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心');
  const previous = app.server.images.find(item => item.url.includes('/flat/explorer.webp'));
  assert.equal(typeof previous.onerror, 'function');
  const sprites = () => app.nodes().filter(node => node.props?.className === 'daj-character-portrait');
  app.change('daj-global-portrait-style', 'pixel'); await app.ready();
  previous.onerror(); app.render();
  assert.ok(sprites().length); assert.ok(sprites().every(node => node.props.style.backgroundImage.includes('/pixel/')));
  app.change('daj-global-portrait-style', 'flat'); await app.ready();
  const latest = app.server.images.filter(item => item.url.includes('/flat/explorer.webp')).at(-1);
  assert.notEqual(latest, previous); previous.onerror(); app.render();
  assert.ok(sprites().length); assert.ok(sprites().every(node => node.props.style.backgroundImage.includes('/flat/')));
  const beforeFailure = sprites().length; latest.onerror(); app.render(); assert.ok(sprites().length < beforeFailure);
  app.change('daj-global-portrait-style', 'pixel'); await app.ready();
  assert.ok(sprites().length); assert.ok(sprites().every(node => node.props.style.backgroundImage.includes('/pixel/')));
  app.change('daj-global-portrait-style', 'flat'); await app.ready();
  assert.equal(sprites().length, beforeFailure);
  latest.onerror(); app.render(); assert.equal(sprites().length, beforeFailure);
});

test('uploaded artwork stays original in pixel style and stale reduced-motion image loads cannot restore old artwork', async t => {
  const hero = character({ id: 'hero-explorer', source: 'user', art: PIXEL_GIF });
  const app = harness(journal({ equipment: { badges: [], charm: null, character: hero.id }, collection: { points: { earned: 0, spent: 0, balance: 0 }, characters: [hero], owned: [{ id: hero.id, count: 1, firstAt: 1 }], draws: [] } }), { portraits: portraitManifest(), manualImages: true });
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心');
  app.change('daj-global-portrait-style', 'pixel'); await app.ready();
  assert.ok(app.nodes().filter(node => node.type === 'img').every(node => node.props.src === PIXEL_GIF));
  assert.ok(app.nodes().filter(node => node.props?.className?.startsWith('daj-character-art')).every(node => node.props['data-portrait-style'] === 'custom'));
  assert.ok(!app.server.images.some(item => item.url.includes('/assets/portraits/')));
  app.change('daj-settings-motion', 'reduce'); await app.ready();
  const old = app.server.images.find(item => item.url === PIXEL_GIF);
  assert.equal(typeof old.onload, 'function');
  app.server.state.collection.characters[0].art = PIXEL_PNG; app.server.state.revision++; await app.advance(1800); app.render();
  const current = app.server.images.filter(item => item.url === PIXEL_PNG).at(-1);
  assert.ok(current); old.onload(); app.render(); assert.equal(app.server.canvasDraws, 0);
  current.onload(); app.render(); assert.equal(app.server.canvasDraws, 1);
  assert.ok(app.nodes().filter(node => node.type === 'img').every(node => node.props.src === PIXEL_PNG));
  assert.equal(app.state().data.collection.characters[0].art, PIXEL_PNG);
  assert.ok(app.nodes().filter(node => node.props?.className?.startsWith('daj-character-art')).every(node => node.props['data-animation'] === 'none'));
  app.cleanup(); old.onload(); current.onload(); assert.equal(app.server.canvasDraws, 1);
});

test('debug portrait preferences stay scoped and resetting or exiting restores the real style', async t => {
  const app = harness(journal({ preferences: { theme: 'explorer', portraitStyle: 'flat', notifications: 'all', reducedMotion: 'system' } }), { portraits: portraitManifest() });
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('主题与反馈设置');
  app.click('进入调试模式'); await app.ready(); const token = app.state().data.debug.sessionId;
  app.change('daj-global-portrait-style', 'pixel'); await app.ready();
  assert.equal(app.state().data.preferences.portraitStyle, 'pixel'); assert.equal(app.server.state.preferences.portraitStyle, 'flat');
  const post = app.requests.filter(item => item.url.endsWith('/preferences')).at(-1);
  assert.equal(post.options.headers['x-daj-debug'], token); assert.equal(JSON.parse(post.options.body).portraitStyle, 'pixel');
  app.click('重置调试数据'); await app.ready();
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-global-portrait-style').props.value, 'flat');
  assert.notEqual(app.state().data.debug.sessionId, token);
  app.click('退出调试模式'); await app.ready();
  assert.equal(app.state().debugActive, false); assert.equal(app.state().data.preferences.portraitStyle, 'flat');
  assert.equal(app.server.state.preferences.portraitStyle, 'flat');
  app.change('daj-global-portrait-style', 'pixel'); await app.ready();
  assert.equal(app.server.state.preferences.portraitStyle, 'pixel');
  assert.equal(app.requests.filter(item => item.url.endsWith('/preferences')).at(-1).options.headers['x-daj-debug'], undefined);
});

test('every drawn card exposes an immediate equip action and the frame shows the current character', async t => {
  const receipt = { requestId: 'saved-draw', theme: 'explorer', at: 200, cost: 1, results: Array.from({ length: 10 }, (_, index) => ({ id: 'hero', rarity: 'SR', isNew: index === 0 })) };
  const app = harness(journal({ collection: { points: { earned: 1, spent: 1, balance: 0 }, characters: [character()], owned: [{ id: 'hero', count: 10, firstAt: 200 }], draws: [receipt] } }));
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('角色收藏');
  const actions = app.nodes().filter(node => node.type === 'button' && node.props['aria-label'] === '佩戴到成就框 山海小狐');
  assert.equal(actions.length, 10); app.click('佩戴到成就框 山海小狐'); await app.ready();
  assert.equal(app.state().data.equipment.character, 'hero');
  assert.ok(app.nodes().some(node => node.props?.className === 'daj-frame-change' && app.textContent(node) === '更换'));
  assert.ok(app.nodes().filter(node => node.type === 'button' && node.props['aria-label'] === '佩戴到成就框 山海小狐').every(node => node.props.disabled));
});

test('achievement generation count defaults to three, clamps to the exact range and submits the global theme', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心');
  app.change('daj-global-theme', 'ocean'); await app.ready(); app.click('自定义生成');
  const countField = () => app.nodes().find(node => node.props?.id === 'daj-generation-count');
  assert.equal(countField().props.value, 3); assert.equal(countField().props.min, 1); assert.equal(countField().props.max, 6);
  app.change('daj-generation-count', '9'); assert.equal(countField().props.value, 6);
  app.change('daj-generation-count', '0'); assert.equal(countField().props.value, 1);
  app.change('daj-generation-count', '4'); app.click('分析并生成成就'); await app.ready();
  const request = app.requests.find(item => item.url.endsWith('/generation') && item.options.method === 'POST');
  const body = JSON.parse(request.options.body);
  assert.equal(body.kind, 'achievements'); assert.equal(body.count, 4); assert.equal(body.theme, 'ocean');
  assert.equal(app.state().generationJob.count, 4);
  assert.ok(!app.nodes().some(node => node.props?.id === 'daj-generation-theme'));
});

test('deleting custom achievements hides active collections while preserving awards, points and history', async t => {
  const custom = definition({ id: 'custom-earned', title: '已获自选纪念', source: 'model', unlockedAt: 100 });
  const old = definition({ id: 'already-deleted', title: '旧删除纪念', source: 'model', status: 'archived', unlockedAt: 90 });
  const awards = [custom, old].map((item, index) => ({ id: 'award:' + item.id, definitionId: item.id, at: 100 - index, title: item.title, description: '已经走过的一段路', source: 'automatic' }));
  const app = harness(journal({ definitions: [definition(), custom, old], awards,
    timeline: awards.map(award => ({ id: 'history:' + award.id, kind: 'unlock', at: award.at, title: award.title, definitionId: award.definitionId, awardId: award.id, source: 'automatic' })),
    collection: { points: { earned: 2, spent: 0, balance: 2 }, characters: [], owned: [], draws: [] }, equipment: { badges: ['custom-earned'], charm: null, character: null },
  })); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('自定义生成');
  assert.match(app.textContent(), /已获自选纪念/); assert.doesNotMatch(app.textContent(), /旧删除纪念/);
  const before = app.requests.filter(item => item.options.method === 'POST').length;
  app.click('删除成就 已获自选纪念'); assert.match(app.textContent(), /删除后保留已获记录和点数/);
  assert.equal(app.requests.filter(item => item.options.method === 'POST').length, before);
  app.click('确认删除成就 已获自选纪念'); await app.ready();
  const deletion = app.requests.find(item => item.url.endsWith('/delete'));
  assert.ok(deletion); const body = JSON.parse(deletion.options.body);
  assert.deepEqual(body.ids, ['custom-earned']); assert.equal(body.expectedRevision, 1); assert.ok(body.requestId);
  assert.equal(app.state().data.definitions.find(item => item.id === 'custom-earned').status, 'archived');
  assert.equal(app.state().data.awards.length, 2); assert.equal(app.state().data.collection.points.balance, 2);
  assert.doesNotMatch(app.textContent(), /已获自选纪念|旧删除纪念/);
  app.click('成就收藏'); assert.doesNotMatch(app.textContent(), /已获自选纪念|旧删除纪念|已归档/);
  app.click('使用历程'); assert.match(app.textContent(), /已获自选纪念/); assert.match(app.textContent(), /旧删除纪念/); assert.match(app.textContent(), /已经走过的一段路/);
  assert.ok(!app.nodes().some(node => node.type === 'button' && node.props['aria-label'] === '查看成就详情'));
});

test('one global theme scopes characters and receipts, resets local editing and restores a matching equipped character', async t => {
  const explorer = character({ name: '探索同伴' });
  const garden = character({ id: 'garden-friend', name: '花园同伴', source: 'user', theme: 'garden' });
  const gardenPending = character({ id: 'garden-pending', name: '花园未获角色', theme: 'garden' });
  const receipts = [explorer, garden].map((item, index) => ({ requestId: 'saved:' + item.id, theme: item.theme, at: 100 + index, cost: 1, results: [{ id: item.id, rarity: item.rarity, isNew: true }] }));
  const app = harness(journal({ equipment: { badges: [], charm: null, character: explorer.id }, collection: { points: { earned: 2, spent: 2, balance: 0 }, characters: [explorer, garden, gardenPending], owned: [{ id: explorer.id, count: 1, firstAt: 100 }, { id: garden.id, count: 1, firstAt: 101 }], draws: receipts } }));
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('角色收藏');
  let results = app.nodes().find(node => node.props?.['aria-label'] === '十连抽取结果');
  assert.match(app.textContent(results), /探索同伴/); assert.doesNotMatch(app.textContent(), /花园同伴|花园未获角色/);
  for (const id of ['daj-settings-theme', 'daj-draw-theme', 'daj-character-theme-filter', 'daj-generation-theme', 'daj-character-generation-theme', 'daj-character-theme', 'daj-debug-theme']) assert.ok(!app.nodes().some(node => node.props?.id === id));
  assert.equal(app.nodes().filter(node => node.type === 'select' && node.props.id === 'daj-global-theme').length, 1);
  app.change('daj-global-theme', 'garden'); await app.ready();
  assert.match(app.textContent(), /花园同伴/); assert.doesNotMatch(app.textContent(), /探索同伴|花园未获角色/);
  results = app.nodes().find(node => node.props?.['aria-label'] === '十连抽取结果'); assert.match(app.textContent(results), /花园同伴/);
  let footer = app.nodes().find(node => node.type === 'button' && node.props['aria-label'] === '打开成就手记');
  assert.doesNotMatch(app.textContent(footer), /探索同伴/); assert.equal(app.state().data.equipment.character, explorer.id);
  footer.props.onClick(); app.render(); assert.equal(app.state().tab, 'overview');
  app.click('角色收藏'); app.click('全部卡池'); assert.match(app.textContent(), /花园未获角色/);
  app.click('编辑角色 花园同伴'); app.change('daj-character-name', '不应跨主题残留');
  app.change('daj-global-theme', 'explorer'); await app.ready();
  assert.ok(!app.nodes().some(node => node.props?.id === 'daj-character-name'));
  assert.doesNotMatch(app.textContent(), /花园同伴|花园未获角色/);
  footer = app.nodes().find(node => node.type === 'button' && node.props['aria-label'] === '打开成就手记'); assert.match(app.textContent(footer), /探索同伴/);
  assert.equal(app.requests.filter(item => item.url.endsWith('/equip')).length, 0);
  app.click('创作角色'); assert.equal(app.nodes().find(node => node.props?.id === 'daj-character-name').props.value, '');
});

test('feedback preferences take effect immediately and preview never writes real achievements', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready();
  app.server.state.notifications.push({ id: 'progress', kind: 'progress', tokens: 10, at: 2 });
  await app.advance(2450); assert.equal(app.state().toast.kind, 'progress');
  app.change('daj-settings-notifications', 'unlocks'); await app.ready(); assert.equal(app.state().toast, null);
  app.server.state.notifications.push({ id: 'ignored-progress', kind: 'progress', at: 3 }, { id: 'unlock', kind: 'unlock', title: '已保存', at: 3 });
  await app.advance(1800); await app.advance(650); assert.equal(app.state().toast.kind, 'unlock');
  app.change('daj-settings-notifications', 'off'); await app.ready(); assert.equal(app.state().toast, null);
  const before = app.requests.filter(item => item.options.method === 'POST').length;
  app.click('预览效果'); assert.equal(app.state().toast.demo, true); assert.match(app.textContent(), /演示效果/);
  assert.equal(app.requests.filter(item => item.options.method === 'POST').length, before);
  app.change('daj-settings-motion', 'reduce'); await app.ready();
  assert.equal(app.nodes().filter(node => node.props?.className === 'daj-fireworks').length, 0);
});

test('timeouts surface errors, teardown aborts work, and remount resets notification watermarks', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready();
  app.server.hangState = true; await app.advance(1800);
  assert.ok(app.requests.at(-1).url.endsWith('/state'));
  await app.advance(12000); assert.match(app.state().error, /超时/);
  app.server.hangState = false;
  app.server.state.notifications.push({ id: 'retained', kind: 'unlock', title: '已存在', at: 2 });
  app.cleanup(); await settle(); assert.equal(app.timers.size, 0);
  assert.ok(app.requests.filter(item => item.url.endsWith('/state')).at(-1).options.signal.aborted);
  app.remount(); await app.ready(); await app.advance(700);
  assert.equal(app.document.head.children.length, 1); assert.equal(app.state().toast, null);
  app.click('打开成就中心'); assert.equal(app.nodes().filter(node => node.props?.role === 'dialog').length, 1);
});

test('a draw rejected after another window changes the theme releases its old request and follows the refreshed global theme', async t => {
  const app = harness(journal({ collection: { points: { earned: 1, spent: 0, balance: 1 },
    characters: [character(), character({ id: 'cyber-hero', theme: 'cyber', name: '网络旅伴' })], owned: [], draws: [] } }));
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('角色收藏');
  app.server.state.preferences.theme = 'cyber'; app.server.state.revision += 1;
  app.click('1 成就点 · 十连抽取'); await app.ready();
  assert.equal(app.state().data.preferences.theme, 'cyber');
  assert.equal(app.state().drawRetry, false); assert.equal(app.state().drawTheme, null);
  assert.equal(app.storage.has('dsh-achievement-journal.draw'), false); assert.equal(app.server.drawWrites, 0);
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-global-theme').props.disabled, false);
  app.click('1 成就点 · 十连抽取'); await app.ready();
  const draws = app.requests.filter(item => item.url.endsWith('/draw')).map(item => JSON.parse(item.options.body));
  assert.equal(draws.length, 2); assert.notEqual(draws[0].requestId, draws[1].requestId);
  assert.equal(draws[0].theme, 'explorer'); assert.equal(draws[1].theme, 'cyber');
  assert.equal(app.server.drawWrites, 1); assert.equal(app.state().data.collection.points.spent, 1);
});

test('an explicitly uncommitted insufficient-points draw does not lock theme preferences behind a futile retry', async t => {
  const app = harness(journal({ collection: { points: { earned: 1, spent: 0, balance: 1 }, characters: [character()], owned: [], draws: [] } }));
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('角色收藏');
  app.server.state.collection.points = { earned: 1, spent: 1, balance: 0 }; app.server.state.revision += 1;
  app.click('1 成就点 · 十连抽取'); await app.ready();
  assert.equal(app.state().drawRetry, false); assert.equal(app.storage.has('dsh-achievement-journal.draw'), false);
  assert.equal(app.state().data.collection.points.balance, 0); assert.equal(app.server.drawWrites, 0);
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-global-theme').props.disabled, false);
  app.change('daj-global-theme', 'garden'); await app.ready();
  assert.equal(app.state().data.preferences.theme, 'garden');
});

test('uncertain draw durability retains the complete original body until its committed receipt is confirmed', async t => {
  const app = harness(journal({ collection: { points: { earned: 1, spent: 0, balance: 1 }, characters: [character()], owned: [], draws: [] } }));
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('角色收藏');
  app.server.failDrawAfterCommitCode = 'DURABILITY_UNCERTAIN';
  app.click('1 成就点 · 十连抽取'); await app.ready();
  assert.equal(app.state().drawRetry, true); assert.equal(app.storage.has('dsh-achievement-journal.draw'), true);
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-global-theme').props.disabled, true);
  app.click('重试这次十连'); await app.ready();
  const draws = app.requests.filter(item => item.url.endsWith('/draw')).map(item => JSON.parse(item.options.body));
  assert.equal(draws.length, 2); assert.deepEqual(draws[0], draws[1]);
  assert.equal(app.server.drawWrites, 1); assert.equal(app.state().data.collection.points.spent, 1);
  assert.equal(app.state().drawRetry, false); assert.equal(app.storage.has('dsh-achievement-journal.draw'), false);
});

test('a lost generation start response locks its original count and repeats the exact body rather than charging a new task', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('自定义生成');
  app.change('daj-generation-count', 4); app.change('daj-generation-direction', '保留原方向');
  app.server.failGenerationAfterCommit = true;
  app.click('分析并生成成就'); await app.ready();
  assert.equal(app.server.generationWrites, 1); assert.equal(app.server.job.status, 'succeeded');
  assert.equal(app.state().generationJob, null); assert.equal(app.state().generationPending, true);
  assert.equal(app.storage.has('dsh-achievement-journal.generation-start'), true);
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-generation-count').props.disabled, true);
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-generation-direction').props.disabled, true);
  app.change('daj-generation-count', 6);
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-generation-count').props.value, 4);
  // Another actor's latest job, even when visible through state polling, is
  // not an acknowledgement of this original POST identity.
  app.server.job = { id: 'another-actors-job', status: 'succeeded', stage: 'done', updatedAt: 300, createdDefinitionIds: [] };
  app.server.state.generation = { job: clone(app.server.job) }; app.server.state.revision += 1;
  await app.advance(1800); assert.equal(app.state().generationPending, true);
  app.click('重试本次生成'); await app.ready();
  const posts = app.requests.filter(item => item.url.endsWith('/generation') && item.options.method === 'POST');
  assert.equal(posts.length, 2); assert.equal(posts[0].options.body, posts[1].options.body);
  assert.equal(JSON.parse(posts[1].options.body).count, 4); assert.equal(JSON.parse(posts[1].options.body).direction, '保留原方向');
  assert.equal(app.server.generationWrites, 1); assert.equal(app.state().generationJob.status, 'succeeded');
  assert.equal(app.state().generationPending, false); assert.equal(app.storage.has('dsh-achievement-journal.generation-start'), false);
});

test('pending real generation survives remount, theme changes and debug mode without replaying against the debug scope', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('自定义生成');
  app.change('daj-generation-count', 2); app.server.failGenerationAfterCommit = true;
  app.click('分析并生成成就'); await app.ready();
  const original = app.requests.find(item => item.url.endsWith('/generation') && item.options.method === 'POST').options.body;
  app.server.state.preferences.theme = 'cyber'; app.server.state.revision += 1;
  app.cleanup(); await settle(); app.remount(); await app.ready();
  assert.equal(app.state().data.preferences.theme, 'cyber'); assert.equal(app.state().generationPending, true);
  app.click('打开成就中心'); app.click('主题与反馈设置'); app.click('进入调试模式'); await app.ready();
  assert.equal(app.state().debugActive, true); assert.equal(app.state().generationPending, false);
  assert.equal(app.storage.get('dsh-achievement-journal.generation-start'), original);
  assert.equal(app.requests.filter(item => item.url.endsWith('/generation') && item.options.method === 'POST').length, 1);
  app.click('退出调试模式'); await app.ready(); app.click('自定义生成');
  assert.equal(app.state().generationPending, true);
  app.click('重试原生成请求'); await app.ready();
  const posts = app.requests.filter(item => item.url.endsWith('/generation') && item.options.method === 'POST');
  assert.equal(posts.length, 2); assert.equal(posts[1].options.body, original);
  assert.ok(posts.every(item => !item.options.headers['x-daj-debug']));
  assert.equal(JSON.parse(posts[1].options.body).theme, 'explorer'); assert.equal(app.state().data.preferences.theme, 'cyber');
  assert.equal(app.server.generationWrites, 1); assert.equal(app.state().generationPending, false);
});

test('only explicit unaccepted generation errors release intent; uncertain storage retries the original request', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('自定义生成');
  app.server.state.preferences.theme = 'cyber'; app.server.state.revision += 1;
  app.click('分析并生成成就'); await app.ready();
  assert.equal(app.server.generationWrites, 0); assert.equal(app.state().generationPending, false);
  assert.equal(app.storage.has('dsh-achievement-journal.generation-start'), false);
  assert.equal(app.state().data.preferences.theme, 'cyber');
  app.change('daj-generation-count', 2); app.click('分析并生成成就'); await app.ready();
  assert.equal(app.server.generationWrites, 1); assert.equal(app.state().generationJob.count, 2);

  const other = harness(); t.after(() => other.cleanup()); await other.ready(); other.click('打开成就中心'); other.click('自定义生成');
  other.server.failGenerationAfterCommitCode = 'GENERATION_STORAGE';
  other.click('分析并生成成就'); await other.ready();
  assert.equal(other.state().generationPending, true);
  other.click('重试原生成请求'); await other.ready();
  const posts = other.requests.filter(item => item.url.endsWith('/generation') && item.options.method === 'POST');
  assert.equal(posts.length, 2); assert.equal(posts[0].options.body, posts[1].options.body);
  assert.equal(other.server.generationWrites, 1); assert.equal(other.state().generationPending, false);
});
