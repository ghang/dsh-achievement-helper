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
  const mediaListeners = new Set(), storage = options.storage ?? new Map(), drawReceipts = new Map();
  const server = { state: clone(initial), sessionKey: options.sessionKey, uiSessionGetterReads: 0, wide: true, job: options.job ? clone(options.job) : null, failGenerationStart: null, failGenerationGet: null,
    drawWrites: 0, failDrawAfterCommit: false, systemReduce: false, canvasDraws: 0,
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
    Image: class { naturalWidth = 1; naturalHeight = 1; set src(_value) { queueMicrotask(() => this.onload?.()); } },
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
    let response;
    if (path === '/state') {
      if (server.hangState) return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      if (server.failState) { const error = server.failState; server.failState = null; throw new Error(error); }
      response = clone(server.state);
      if (server.deferNextState) {
        server.deferNextState = false;
        await new Promise((resolve, reject) => { server.releaseState = resolve; options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
      }
    } else if (path === '/catalog') {
      if (server.failCatalog) return { ok: false, status: 503, json: async () => ({ error: server.failCatalog }) };
      response = clone(server.catalog);
    } else if (path === '/generation' && options.method !== 'POST') {
      if (server.failGenerationGet) return { ok: false, status: 503, json: async () => ({ error: server.failGenerationGet }) };
      response = { job: clone(server.job) };
    } else if (path === '/generation' && options.method === 'POST') {
      if (server.failGenerationStart) return { ok: false, status: 503, json: async () => ({ error: server.failGenerationStart }) };
      server.job = { id: `job-${++nextId}`, kind: JSON.parse(options.body).kind || 'achievements', status: 'running', stage: 'analyzing', message: '正在分析所选数据', createdAt: 100, updatedAt: 100, createdDefinitionIds: [], createdCharacterIds: [], usageSource: 'auxiliary_generation' };
      response = { job: clone(server.job) };
    } else if (path === '/generation/cancel') {
      assert.notEqual(server.job?.stage, 'applying');
      server.job = { ...server.job, status: 'cancelled', stage: 'done', message: '已取消生成', updatedAt: server.job.updatedAt + 1 };
      response = { job: clone(server.job) };
    } else if (path === '/draw') {
      const body = JSON.parse(options.body);
      if (!drawReceipts.has(body.requestId)) {
        if (server.state.collection.points.balance < 1) return { ok: false, status: 409, json: async () => ({ error: '成就点不足' }) };
        const item = server.state.collection.characters.find(item => item.theme === body.theme);
        assert.ok(item, 'Draw fixture needs a character in the requested theme');
        const existing = server.state.collection.owned.find(entry => entry.id === item.id);
        const receipt = { requestId: 'stored:' + body.requestId, theme: body.theme, at: 200, cost: 1, results: Array.from({ length: 10 }, (_, index) => ({ id: item.id, rarity: item.rarity, isNew: !existing && index === 0 })) };
        drawReceipts.set(body.requestId, receipt); server.state.collection.draws.push(receipt);
        if (existing) existing.count += 10; else server.state.collection.owned.push({ id: item.id, count: 10, firstAt: 200 });
        server.state.collection.points.spent += 1; server.state.collection.points.balance -= 1; server.state.revision += 1; server.drawWrites += 1;
        if (server.failDrawAfterCommit) { server.failDrawAfterCommit = false; throw new Error('connection lost after commit'); }
      }
      response = { ...clone(server.state), draw: clone(drawReceipts.get(body.requestId)) };
    } else if (options.method === 'POST') {
      if (server.failPost) return { ok: false, status: 409, json: async () => ({ error: server.failPost }) };
      const body = JSON.parse(options.body);
      if (path === '/preferences') server.state.preferences = { ...server.state.preferences, ...body };
      if (path === '/equip') {
        if (body.slot === 'character') server.state.equipment.character = body.equipped === false ? null : body.id;
        else if (body.slot === 'charm') server.state.equipment.charm = body.equipped === false ? null : body.id;
        else server.state.equipment.badges = body.equipped === false ? [] : [body.id];
      }
      if (path === '/configure') server.state.definitions = server.state.definitions.map(item => body.archiveIds?.includes(item.id) ? { ...item, status: 'archived' } : item);
      if (path === '/characters') for (const declared of body.characters) {
        const previous = server.state.collection.characters.find(item => item.id === declared.id);
        if (previous) Object.assign(previous, declared);
        else server.state.collection.characters.push({ ...declared, id: `user-${++nextId}`, source: 'user' });
      }
      server.state.revision += 1;
      response = clone(server.state);
    } else throw new Error(`Unexpected request ${url}`);
    return { ok: true, status: 200, json: async () => response };
  }
  vm.runInNewContext(source, { window, document, fetch, AbortController, setTimeout: timer, clearTimeout: clear, console });
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
  app.change('daj-settings-theme', 'xianxia'); await app.ready();
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
  app.click('打开成就中心'); app.click('模型配置');
  assert.doesNotMatch(app.textContent(), /复制给模型|粘贴发送/);
  assert.ok(!app.nodes().some(node => node.props?.id === 'daj-metric-recipe'));
  app.change('daj-metric-tokens', false);
  app.change('daj-generation-theme', 'cyber'); app.change('daj-generation-direction', '城市夜航');
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
  await app.ready(); app.click('打开成就中心'); app.click('模型配置');
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
  t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('模型配置');
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
  app.click('打开成就中心'); app.click('模型配置'); app.click('分析并生成成就'); await app.ready();
  const submitted = JSON.parse(app.requests.find(item => item.url.endsWith('/generation') && item.options.method === 'POST').options.body);
  assert.equal(submitted.sessionId, 'session:second'); assert.equal(app.server.uiSessionGetterReads, 0);
});

test('running generation restores independently of the open page and default routing omits a non-string session key', async t => {
  const restored = { id: 'restored-job', status: 'running', stage: 'generating', message: '仍在生成中', createdAt: 1, updatedAt: 2, createdDefinitionIds: [] };
  const app = harness(journal(), { job: restored, strictServices: true, sessionKey: { private: 'not-a-session-id' } }); t.after(() => app.cleanup()); await app.ready();
  assert.ok(app.requests.some(item => item.url.endsWith('/generation'))); assert.ok(!app.requests.some(item => item.url.includes('sessionId=')));
  app.click('打开成就中心'); app.click('模型配置'); assert.match(app.textContent(), /仍在生成中/);
  app.key('Escape'); app.server.job = { ...app.server.job, status: 'cancelled', stage: 'done', updatedAt: 3 };
  await app.advance(1200); assert.equal(app.state().generationJob.status, 'cancelled');
  app.click('打开成就中心'); app.click('模型配置'); app.click('分析并生成成就'); await app.ready();
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
  const themeField = app.nodes().find(node => node.props?.id === 'daj-settings-theme');
  assert.equal(app.nodes(themeField).filter(node => node.type === 'option').length, 10);
  const writes = app.requests.filter(item => item.options.method === 'POST').length;
  app.click('展示 104px'); app.change('daj-settings-frame-height', '145');
  assert.equal(app.requests.filter(item => item.options.method === 'POST').length, writes);
  assert.ok(app.nodes().some(node => node.props?.className?.includes('daj-account-frame') && node.props.style?.height === '145px'));
  app.click('保存展示框'); await app.ready();
  assert.equal(app.state().data.preferences.frameStyle, 'showcase'); assert.equal(app.state().data.preferences.frameHeight, 145);
  assert.equal(app.nodes().find(node => node.type === 'button' && node.props.className?.includes('daj-profile-strip')).props.style.height, '145px');
  for (const selected of ['wuxia', 'fantasy', 'space', 'ocean', 'garden', 'academy', 'steampunk']) {
    app.change('daj-settings-theme', selected); await app.ready(); assert.equal(app.state().data.preferences.theme, selected);
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
  app.cleanup(); await settle(); app.remount(); await app.ready(); app.click('打开成就中心'); app.click('角色收藏');
  assert.equal(app.state().data.collection.points.balance, 0); app.click('重试这次十连'); await app.ready();
  const draws = app.requests.filter(item => item.url.endsWith('/draw'));
  assert.equal(draws.length, 2); assert.equal(JSON.parse(draws[0].options.body).requestId, JSON.parse(draws[1].options.body).requestId);
  assert.equal(app.server.drawWrites, 1); assert.equal(app.state().data.collection.points.spent, 1);
  assert.equal(app.state().drawReceipt.results.length, 10); assert.match(app.textContent(), /已收藏 10 份/);
  app.click('佩戴角色 山海小狐'); await app.ready(); assert.equal(app.state().data.equipment.character, 'hero');
  assert.ok(app.nodes().some(node => node.props?.['data-animation'] === 'float'));
  assert.equal(app.storage.has('dsh-achievement-journal.draw'), false);
  const before = app.requests.filter(item => item.options.method === 'POST').length;
  app.cleanup(); await settle(); app.remount(); await app.ready();
  assert.equal(app.requests.filter(item => item.options.method === 'POST').length, before);
});

test('custom art validates MIME and header, joins the pool, and an owned custom appearance remains editable', async t => {
  const app = harness(); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('角色收藏'); app.click('创作角色');
  app.change('daj-character-name', '抱莲小狐'); app.change('daj-character-theme', 'garden'); app.change('daj-character-icon', 'lotus'); app.change('daj-character-animation', 'orbit');
  const upload = file => app.nodes().find(node => node.props?.id === 'daj-character-art').props.onChange({ target: { files: [file] } });
  upload({ type: 'image/svg+xml', size: 12, dataURL: 'data:image/svg+xml;base64,PHN2Zz4=' }); app.render(); assert.match(app.textContent(), /PNG、JPEG、GIF/);
  upload({ type: 'image/png', size: 30, dataURL: PIXEL_GIF.replace('image/gif', 'image/png') }); await app.ready(); assert.match(app.textContent(), /内容与格式不匹配/);
  upload({ type: 'image/gif', size: 42, dataURL: PIXEL_GIF }); await app.ready(); app.click('保存角色到卡池'); await app.ready();
  const created = app.state().data.collection.characters.find(item => item.name === '抱莲小狐');
  assert.ok(created); assert.equal(created.art, PIXEL_GIF); assert.equal(created.theme, 'garden'); assert.equal(app.state().data.collection.owned.length, 0);
  app.click('返回角色收藏'); app.click('全部卡池'); assert.match(app.textContent(), /尚未获得 · 已在卡池/);
  app.server.state.collection.owned.push({ id: created.id, count: 2, firstAt: 20 }); app.server.state.revision += 1;
  await app.advance(1800); app.click('编辑角色 抱莲小狐');
  assert.equal(app.nodes().find(node => node.props?.id === 'daj-character-theme').props.disabled, true);
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
  const app = harness(); t.after(() => app.cleanup()); await app.ready(); app.click('打开成就中心'); app.click('角色收藏'); app.click('创作角色');
  app.change('daj-character-generation-theme', 'xianxia'); app.change('daj-character-generation-direction', '莲灯灵狐'); app.click('模型生成角色'); await app.ready();
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
