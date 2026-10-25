/* DSH browser entry. Uses the host's React; no bundled runtime or remote assets. */
window.__ModuleLoader__.load({
  id: 'dsh-achievement-journal',
  factory(require) {
    'use strict';
    const React = require('react');
    const { createPortal } = require('react-dom');
    const { useEffect, useId, useRef, useState, useSyncExternalStore } = React;
    const h = React.createElement;
    const STYLE = '__ACHIEVEMENT_CSS__';
    const PORTRAITS = '__ACHIEVEMENT_PORTRAITS__';
    const API = '/dsh-achievement-journal/api';
    const POLL_MS = 1800;
    const THEMES = {
      explorer: {
        name: '探索', title: '你的成就手记', subtitle: '自然积累，偶尔回头看看。',
        hero: '每一步，都留下印记', eyebrow: 'YOUR JOURNEY, IN SMALL MOMENTS',
        role: '探索者', currency: '累计 Token', collection: '成就收藏', history: '使用历程',
        tabs: ['概览', '成就收藏', '自定义生成', '使用历程'], wear: '勋章',
        progress: '本轮积累已记录', unlock: '新成就 · 留下印记', level: '新的成长阶段',
      },
      xianxia: {
        name: '修仙', title: '你的修行录', subtitle: '一问一答，皆是修行；点滴灵机，自有回响。',
        hero: '问道有迹，修行有成', eyebrow: '山海问道 · 点滴入卷',
        role: '问道行者', currency: '累计灵机', collection: '灵章阁', history: '问道年谱',
        tabs: ['修行总览', '灵章阁', '自定义生成', '问道年谱'], wear: '灵章',
        progress: '本轮灵机已入册', unlock: '新灵章 · 道有所成', level: '修行再进一境',
      },
      cyber: {
        name: '赛博朋克', title: '你的神经档案', subtitle: '每次连接，都在城市的暗处留下一道信号。',
        hero: '让每次连接留下信号', eyebrow: 'NEURAL ARCHIVE / LOCAL IDENTITY',
        role: '网络行者', currency: '累计脉冲', collection: '芯片收藏', history: '连接日志',
        tabs: ['信号总览', '芯片收藏', '自定义生成', '连接日志'], wear: '芯片',
        progress: '本轮信号已归档', unlock: '新芯片 · ACCESS GRANTED', level: '访问等级已提升',
      },
    };
    const EXTRA_THEMES = {
      wuxia: ['武侠', '江湖行者', '你的江湖行迹', '行走江湖，步步留名', '累计真气', '侠印阁', '江湖旧事', '侠印', '#6f4a3e', '#e8cba5', '#bb8950'],
      fantasy: ['奇幻', '旅途冒险家', '你的冒险之书', '每次启程，都有回响', '累计魔力', '纹章藏馆', '冒险纪年', '纹章', '#695188', '#d5c4ee', '#c4a16d'],
      space: ['星际', '星海领航员', '你的星图档案', '跨越星海，留下坐标', '累计星尘', '星徽陈列', '航行日志', '星徽', '#344f8d', '#b7d8ed', '#d6b77e'],
      ocean: ['深海', '深蓝潜行者', '你的深蓝航记', '向未知下潜，拾起微光', '累计潮汐', '海藏陈列', '深潜日志', '海章', '#286e81', '#b7dfe1', '#c1b37a'],
      garden: ['花园', '四季园丁', '你的四季手札', '点滴耕耘，自有花开', '累计晨露', '花笺收藏', '四季年谱', '花笺', '#57794b', '#d4e3b5', '#c1a66b'],
      academy: ['学院', '求知旅人', '你的学院手记', '每一次好奇，都有新页', '累计灵感', '校徽藏室', '求知年鉴', '校徽', '#4a5e83', '#c9d5e5', '#bca06a'],
      steampunk: ['蒸汽朋克', '机械漫游者', '你的黄铜档案', '让齿轮记住每次转动', '累计蒸汽', '齿轮藏馆', '机械年鉴', '机章', '#765c3f', '#e4d2aa', '#b98c50'],
    };
    Object.keys(EXTRA_THEMES).forEach(function (id) {
      const parts = EXTRA_THEMES[id];
      THEMES[id] = { name: parts[0], role: parts[1], title: parts[2], hero: parts[3], currency: parts[4], collection: parts[5], history: parts[6], wear: parts[7], art: { dark: parts[8], light: parts[9], gold: parts[10] }, subtitle: '日常的每一点积累，都有属于你的回响。', eyebrow: parts[0] + ' · 个人旅程', tabs: [parts[0] + '总览', parts[5], '自定义生成', parts[6]], progress: '新的积累已入册', unlock: '新' + parts[7] + ' · 旅程留痕', level: '新的成长阶段' };
    });
    Object.keys(THEMES).forEach(function (id) { THEMES[id].tabs[2] = '自定义生成'; THEMES[id].tabs = THEMES[id].tabs.concat('角色收藏'); });
    const TAB_IDS = ['overview', 'collection', 'model', 'history', 'characters'];
    const RARITIES = ['N', 'R', 'SR', 'SSR'];
    const ANIMATION_NAMES = { none: '静止', float: '轻浮动', pulse: '呼吸', orbit: '环游', spark: '星光' };
    const ICON_NAMES = { compass: '罗盘', star: '星光', book: '书卷', flag: '旗帜', chat: '对话', spark: '灵光', leaf: '叶片', code: '代码', medal: '勋章', sword: '剑', lotus: '莲花', orb: '灵球', fox: '狐狸', robot: '机器人', ship: '飞船', dragon: '龙', moon: '月亮', shell: '贝壳', flower: '花朵', feather: '羽毛', gear: '齿轮', lantern: '灯笼', cat: '猫', owl: '猫头鹰' };
    const CHARM_NAMES = { compass: '随行罗盘', star: '小小星光', leaf: '一叶闲心' };
    const METRIC_NAMES = {
      tokens: 'Token', turns: '完成回合', turn_completed: '完成回合',
      fileReads: '文件阅读', file_read: '文件阅读', fileChanges: '文件变更',
      file_changed: '文件变更', formats: '探索格式', format: '格式',
      skills: '技能足迹', skill_loaded: '技能加载', delegations: '协作经历',
      presentations: '交付展示', routes: '模型路由', recalls: '历史回顾',
      format_read: '格式探索', delegate_completed: '子代理协作', file_presented: '交付展示', route_used: '模型路由', recall_used: '历史回顾',
    };
    const METRIC_HINTS = { tokens: '已记录的模型用量', turn_completed: '完成的会话回合', file_read: '读过的文件', file_changed: '确认发生的变更', format_read: '不同文件格式', skill_loaded: '实际加载的技能', delegate_completed: '完成的子代理协作', file_presented: '真实的交付展示', route_used: '使用过的模型路由', recall_used: '历史回顾足迹' };
    const GENERATION_STYLES = [{ id: 'balanced', label: '均衡成长', description: '积累、探索和一点惊喜' }, { id: 'discovery', label: '探索惊喜', description: '首次经历与动作组合' }, { id: 'milestone', label: '长期里程碑', description: '更少目标，慢慢积累' }];
    const GLYPHS = {
      star: 'M12 2 15 9l7 3-7 3-3 7-3-7-7-3 7-3Z',
      spark: 'M12 2v5m0 10v5M2 12h5m10 0h5M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3',
      compass: 'm17 5-3 9-9 5 5-9 7-5Z M10 10l4 4',
      book: 'M4 4h7v16H4V4Zm9 0h7v16h-7V4ZM7 8h1m8 0h1M7 12h1m8 0h1',
      flag: 'M5 22V3h14l-3 5 3 5H5',
      chat: 'M4 4h16v12H9l-5 4V4ZM8 8h8m-8 4h5',
      code: 'm8 6-5 6 5 6m8-12 5 6-5 6m-3-15-3 18',
      leaf: 'M12 22V10m0 6C2 16 2 5 3 3c8 0 10 5 9 13Zm0-4c1-8 5-10 10-10 0 8-4 12-10 10',
      check: 'm5 12 4 4L19 6',
      close: 'm6 6 12 12M18 6 6 18',
      chevron: 'm9 5 7 7-7 7',
      settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
      copy: 'M9 9h11v12H9V9ZM5 16H3V3h12v2',
      history: 'M3 5v6h6M4 10a8 8 0 1 1 1 8m7-14v8l4 2',
      search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
      medal: 'm8 2 4 6 4-6m-4 6a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z',
      link: 'm10 14 4-4m-7 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
      sword: 'm5 19 9-9m-6 2 4 4M12 8l7-6 3 1-1 3-7 6-2-4ZM2 22l4-4m-4 0 4 4',
      lotus: 'M12 20C4 18 2 12 2 8c5 0 8 4 10 12Zm0 0C20 18 22 12 22 8c-5 0-8 4-10 12Zm0-1C6 11 8 5 12 2c4 3 6 9 0 17ZM5 21h14',
      orb: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM4 9c6 5 10 5 16 0M8 4c-3 8-1 13 7 16M12 1v3m0 16v3',
      fox: 'M3 3 9 7h6l6-4-2 12-7 7-7-7L3 3Zm3 7 4 3m8-3-4 3m-5 3 3 2 3-2',
      robot: 'M5 6h14v14H5V6Zm3 4h1m6 0h1M9 16h6M12 2v4M2 10v6m20-6v6M8 20v2m8-2v2',
      ship: 'm12 2 6 8v8l-6-3-6 3v-8l6-8Zm-6 8-4 8 4-2m12-6 4 8-4-2m-9 3-1 4m7-4 1 4M12 8v3',
      dragon: 'M3 18c3-4 8-2 8-6L8 9l5-4 1-3 3 2 4-1-1 5-4 3 3 4-4 2-3 5-3-2-5 2 2-4H3Zm10-9 3 1m-6 5-3-3',
      moon: 'M19 17A9 9 0 0 1 7 5a9 9 0 1 0 12 12Z',
      shell: 'M12 21 3 10C2 4 9 1 12 5c3-4 10-1 9 5l-9 11Zm0-15v15M6 7l6 14m6-14-6 14',
      flower: 'M12 8c-8-12-14 2-5 5-7 7 7 13 7 3 8 6 12-8 2-8 5-8-9-10-4 0Zm0 0a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
      feather: 'M3 21 17 7m-8 8C-1 6 12-3 21 3c3 9-5 18-12 12Zm0-5h5m0-5v5',
      gear: 'm9 2 1 3h4l1-3 4 2-1 4 3 2-1 5-4 1-1 4-5 1-2-3-4 1-2-4 3-3-1-4 4-1 1-3Zm3 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
      lantern: 'M7 3h10M12 1v3M6 5h12l3 6-3 7H6l-3-7 3-6Zm6 0v13m-6-7h12M8 20h8m-4-2v5',
      cat: 'M4 3 9 7h6l5-4v13l-8 6-8-6V3Zm3 9h2m6 0h2m-7 4 2 2 2-2M1 14l5 1m12 0 5-1',
      owl: 'M3 3 7 6h10l4-3-1 13-8 6-8-6L3 3Zm4 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm10 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-7 7 2 3 2-3',
    };
    let active = false;
    let generation = 0;
    let timer;
    let flight;
    let catalogFlight;
    let clientContext;
    let generationTimer;
    let generationFlight;
    let actionCount = 0;
    let feedbackTimer;
    let toastTimer;
    let noticeTimer;
    let needsBaseline = true;
    let baselineRefreshPending = false;
    let journalIdentity = null;
    let seenNotifications = new Set();
    let queuedFeedback = [];
    const controllers = new Set();
    const listeners = new Set();
    const surfaceOwners = new Set();
    const staticArtCache = new Map();
    let pendingDrawId = null;
    let pendingDrawTheme = null;
    let pendingGenerationBody = null;
    let debugToken = null;
    let modeSwitching = false;
    let nextSurface = 0;
    let snapshot = initialState();

    function initialState() {
      return {
        data: null, catalog: null, loading: true, connected: false,
        error: null, catalogError: null, actionError: null, busy: false,
        open: false, tab: 'overview', toast: null, notice: null, owner: null,
        generationJob: null, generationLoading: true, generationBusy: false, generationError: null, generationPending: Boolean(pendingGenerationBody) && !debugToken,
        drawReceipt: null, drawPending: false, drawTheme: null, drawRetry: false, motionVersion: 0,
        debugActive: Boolean(debugToken), debugExpired: false, debugTransition: false, debugPanelRequest: 0, closeSettingsRequest: 0,
      };
    }
    function publish(patch) {
      snapshot = Object.assign({}, snapshot, patch);
      snapshot.busy = actionCount > 0 || modeSwitching || snapshot.debugExpired;
      snapshot.generationPending = Boolean(pendingGenerationBody) && !debugToken;
      listeners.forEach(function (listener) { listener(); });
    }
    function subscribe(listener) { listeners.add(listener); return function () { listeners.delete(listener); }; }
    function currentSnapshot() { return snapshot; }
    function useJournal() { return useSyncExternalStore(subscribe, currentSnapshot, currentSnapshot); }
    function array(value) { return Array.isArray(value) ? value : []; }
    function optionalClientService(name) {
      if (!clientContext) return undefined;
      try {
        if (typeof clientContext.get === 'function') {
          const service = clientContext.get(name);
          if (service !== undefined && service !== null) return service;
        }
      } catch (_error) { /* Plain test contexts can still provide a data property. */ }
      try {
        const property = Object.getOwnPropertyDescriptor(clientContext, name);
        return property && Object.prototype.hasOwnProperty.call(property, 'value') ? property.value : undefined;
      } catch (_error) { return undefined; }
    }
    function currentSessionId() {
      try {
        const service = optionalClientService('uiSession');
        const source = service && service.adapter && service.adapter.current;
        const binding = source && typeof source.getSnapshot === 'function' && source.getSnapshot();
        return binding && typeof binding.key === 'string' && binding.key ? binding.key : undefined;
      } catch (_error) { return undefined; }
    }
    function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
    function exact(value) { return finite(value) ? value.toLocaleString('zh-CN') : '—'; }
    function compact(value) {
      if (!finite(value)) return '—';
      if (value >= 1000000000) return trimNumber(value / 1000000000) + 'B';
      if (value >= 1000000) return trimNumber(value / 1000000) + 'M';
      if (value >= 10000) return trimNumber(value / 1000) + 'K';
      return exact(value);
    }
    function trimNumber(value) { return value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/, ''); }
    function date(value, full) {
      const parsed = new Date(value);
      if (!value || !Number.isFinite(parsed.getTime())) return '日期未记录';
      return parsed.toLocaleString('zh-CN', full
        ? { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    function themeId(data) { return THEMES[data && data.preferences && data.preferences.theme] ? data.preferences.theme : 'explorer'; }
    function theme(data) { return THEMES[themeId(data)]; }
    function presentation(item, data) {
      if (concealed(item, data)) return { title: '尚未揭晓', description: '某个平常的瞬间，会留下一枚意外的印记。' };
      const local = item && item.themes && item.themes[themeId(data)];
      return {
        title: local && local.title || item && item.title || '未命名成就',
        description: local && local.description || item && item.description || '',
      };
    }
    function unlocked(item) { return Boolean(item && item.unlockedAt); }
    function modelReport(item) { return item && item.rule && item.rule.template === 'model_report'; }
    function sourceLabel(item) {
      if (item && item.source === 'user_record') return '用户记录';
      if (modelReport(item) || item && item.source === 'model_report') return '模型记录';
      return '自动统计';
    }
    function definitionLabel(item) { return item && item.source === 'model' ? '自定义生成' : '内置成就'; }
    function activeDefinitions(data) { return array(data && data.definitions).filter(function (item) { return item.status !== 'archived'; }); }
    function allAwards(data) { return array(data && data.awards); }
    function definitionFor(data, id) { return array(data && data.definitions).find(function (item) { return item.id === id; }); }
    function awardFor(data, id) { return allAwards(data).find(function (item) { return item.definitionId === id; }); }
    function concealed(item, data) { return Boolean(item && item.hidden && !unlocked(item) && !awardFor(data, item.id)); }
    function charmFor(data, id) {
      const found = definitionFor(data, id) || awardFor(data, id);
      return found ? found.status === 'archived' ? null : found : CHARM_NAMES[id] ? { id: id, title: CHARM_NAMES[id], icon: id } : null;
    }
    function characters(data) { return array(data && data.collection && data.collection.characters); }
    function characterFor(data, id) { return characters(data).find(function (item) { return item.id === id; }); }
    function visibleEquippedCharacter(data) {
      const item = characterFor(data, data && data.equipment && data.equipment.character);
      return item && item.theme === themeId(data) ? item : null;
    }
    function ownedCharacter(data, id) { return array(data && data.collection && data.collection.owned).find(function (item) { return item.id === id && item.count > 0; }); }
    function customPoolFull(data, catalog) {
      const limit = catalog && catalog.collection && catalog.collection.limits && catalog.collection.limits.customCharacters;
      return finite(limit) && characters(data).filter(function (item) { return item.source !== 'builtin'; }).length >= limit;
    }
    function portraitFor(character) {
      const atlas = PORTRAITS && typeof PORTRAITS === 'object' && PORTRAITS.themes && PORTRAITS.themes[character.theme];
      if (!atlas || !/^\/dsh-achievement-journal\/api\/assets\/portraits\/[a-z0-9_-]+\.webp(?:\?version=[a-f0-9]+)?$/.test(atlas.url || '') || !Number.isInteger(atlas.columns) || !Number.isInteger(atlas.rows) || atlas.columns < 1 || atlas.rows < 1) return null;
      const cell = array(atlas.characters).find(function (item) { return item.id === character.id; }) || array(atlas.characters).find(function (item) { return item.icon === character.icon; }) || array(atlas.characters)[0];
      if (!cell || !Number.isInteger(cell.column) || !Number.isInteger(cell.row) || cell.column < 0 || cell.row < 0 || cell.column >= atlas.columns || cell.row >= atlas.rows) return null;
      return { url: atlas.url, columns: atlas.columns, rows: atlas.rows, column: cell.column, row: cell.row, aspect: finite(atlas.aspect) && atlas.aspect > 0 ? atlas.aspect : .875 };
    }
    function frameSettings(data) {
      const prefs = data && data.preferences || {};
      return { frameStyle: ['compact', 'standard', 'showcase'].includes(prefs.frameStyle) ? prefs.frameStyle : 'standard', frameHeight: finite(prefs.frameHeight) ? Math.max(32, Math.min(160, prefs.frameHeight)) : 64 };
    }
    function validArt(value) {
      if (typeof value !== 'string') return false;
      const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
      if (!match || match[2].length % 4 || match[2].length * .75 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0) > 262144) return false;
      try {
        const header = window.atob(match[2].slice(0, 32));
        if (match[1] === 'png') return header.slice(0, 8) === '\x89PNG\r\n\x1a\n';
        if (match[1] === 'jpeg') return header.charCodeAt(0) === 255 && header.charCodeAt(1) === 216 && header.charCodeAt(2) === 255;
        if (match[1] === 'gif') return header.startsWith('GIF87a') || header.startsWith('GIF89a');
        return header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
      } catch (_error) { return false; }
    }
    function pendingDrawStorage() {
      try {
        if (pendingDrawId) window.sessionStorage.setItem('dsh-achievement-journal.draw', JSON.stringify({ id: pendingDrawId, theme: pendingDrawTheme, scope: debugToken || 'real' }));
        else window.sessionStorage.removeItem('dsh-achievement-journal.draw');
      } catch (_error) { /* The in-memory request id still protects an ordinary retry. */ }
    }
    function pendingGenerationInput() { try { return pendingGenerationBody ? JSON.parse(pendingGenerationBody) : null; } catch (_error) { return null; } }
    function pendingGenerationStorage() {
      try {
        if (pendingGenerationBody) window.sessionStorage.setItem('dsh-achievement-journal.generation-start', pendingGenerationBody);
        else window.sessionStorage.removeItem('dsh-achievement-journal.generation-start');
      } catch (_error) { /* Keep the exact request in memory when storage is unavailable. */ }
    }
    function validPendingGeneration(body) {
      return body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(function (key) { return ['requestId', 'kind', 'metrics', 'theme', 'direction', 'style', 'sessionId', 'count'].includes(key); }) &&
        typeof body.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@+\-]{0,255}$/.test(body.requestId) && THEMES[body.theme] &&
        (!body.kind || ['achievements', 'characters'].includes(body.kind)) && GENERATION_STYLES.some(function (choice) { return choice.id === body.style; }) &&
        (body.metrics === undefined || Array.isArray(body.metrics) && body.metrics.length <= 10 && body.metrics.every(function (metric) { return typeof metric === 'string' && metric.length <= 40; })) &&
        (body.direction === undefined || typeof body.direction === 'string' && body.direction.length <= 240) &&
        (body.sessionId === undefined || typeof body.sessionId === 'string' && body.sessionId.length <= 256) &&
        (body.count === undefined || Number.isInteger(body.count) && body.count >= 1 && body.count <= 6);
    }
    function debugStorage() {
      try {
        if (debugToken) window.sessionStorage.setItem('dsh-achievement-journal.debug', debugToken);
        else window.sessionStorage.removeItem('dsh-achievement-journal.debug');
      } catch (_error) { /* Scope remains explicit in this client lifetime. */ }
    }
    function invalidateModeView() {
      generation += 1;
      controllers.forEach(function (controller) { controller.abort(); }); controllers.clear();
      clearTimeout(timer); clearTimeout(generationTimer); clearTimeout(noticeTimer); clearFeedback();
      flight = null; catalogFlight = null; generationFlight = null; actionCount = 0;
      needsBaseline = true; baselineRefreshPending = false; journalIdentity = null; seenNotifications.clear();
      pendingDrawId = null; pendingDrawTheme = null; pendingDrawStorage();
      const previous = snapshot;
      publish(Object.assign(initialState(), { open: previous.open, tab: previous.tab, owner: previous.owner, debugPanelRequest: previous.debugPanelRequest, debugExpired: previous.debugExpired, debugTransition: true }));
    }
    async function switchDebug(action) {
      if (!active || modeSwitching) return;
      modeSwitching = true; invalidateModeView();
      const epoch = generation;
      let failure = null;
      try {
        const reply = await request('/debug/' + action, { method: 'POST', body: '{}' });
        if (!active || epoch !== generation) return;
        if (action !== 'exit') {
          if (!reply || typeof reply.token !== 'string' || !/^[A-Za-z0-9_.:-]{1,512}$/.test(reply.token) || !validSnapshot(reply.snapshot)) throw new Error('调试会话返回无效，请重试或退出调试。');
          debugToken = reply.token; debugStorage();
          publish({ debugActive: true, debugExpired: false });
          accept(reply.snapshot);
        }
      } catch (error) { if (active && epoch === generation) failure = error.message || '调试模式切换失败。'; }
      finally {
        if (active && epoch === generation) {
          if (action === 'exit') { debugToken = null; debugStorage(); }
          modeSwitching = false;
          publish({ debugActive: Boolean(debugToken), debugTransition: false, debugExpired: action === 'exit' ? false : snapshot.debugExpired, actionError: failure ? action === 'exit' ? '已退出本机调试，服务端清理暂未确认。' : failure : null });
          void refresh(); void refreshCatalog(); void refreshGeneration();
        }
      }
    }
    function showDebugPanel() { openCenter('overview'); publish({ debugPanelRequest: snapshot.debugPanelRequest + 1 }); }
    async function debugAction(action, details) {
      if (!active || !debugToken || modeSwitching || snapshot.debugExpired || actionCount) return;
      const epoch = generation;
      actionCount += 1; publish({ busy: true, actionError: null });
      try {
        const input = Object.assign({ requestId: requestId(), action: action }, details || {});
        if (action === 'draw') input.theme = themeId(snapshot.data);
        const value = await request('/debug/action', { method: 'POST', body: JSON.stringify(input) });
        if (active && epoch === generation) { accept(value); if (value.draw) publish({ drawReceipt: value.draw, open: true, tab: 'characters', closeSettingsRequest: snapshot.closeSettingsRequest + 1 }); }
      } catch (error) { if (active && epoch === generation) publish({ actionError: error.message || '调试操作未完成。' }); }
      finally { if (active && epoch === generation) { actionCount -= 1; publish({ busy: false }); } }
    }
    async function drawCharacters() {
      if (!active || actionCount) return;
      if (!pendingDrawId) { pendingDrawId = requestId(); pendingDrawTheme = themeId(snapshot.data); pendingDrawStorage(); }
      const epoch = generation;
      actionCount += 1; publish({ busy: true, drawPending: true, drawTheme: pendingDrawTheme, actionError: null });
      try {
        const value = await request('/draw', { method: 'POST', body: JSON.stringify({ requestId: pendingDrawId, theme: pendingDrawTheme }) });
        if (!active || epoch !== generation) return;
        accept(value);
        if (!value.draw || !Array.isArray(value.draw.results)) throw new Error('抽取结果尚未同步。请重试这一次抽取，不会另开一次请求。');
        pendingDrawId = null; pendingDrawTheme = null; pendingDrawStorage();
        publish({ drawReceipt: value.draw, drawTheme: null });
      } catch (error) {
        if (active && epoch === generation) {
          const notCommitted = ['THEME_MISMATCH', 'NOT_ENOUGH_POINTS', 'INSUFFICIENT_POINTS', 'INVALID_INPUT', 'BUDGET_EXCEEDED', 'RANDOM_UNAVAILABLE', 'COUNTER_OVERFLOW'].includes(error.code);
          if (notCommitted) {
            pendingDrawId = null; pendingDrawTheme = null; pendingDrawStorage();
            publish({ drawTheme: null, drawRetry: false, actionError: (error.message || '本次抽取已拒绝。') + ' 本次未扣除成就点，正在同步最新状态。' });
            // An older poll may have captured the state before the rejection.
            // Finish it, then read again before allowing another draw.
            const previous = flight; if (previous) await previous;
            if (active && epoch === generation) await refresh();
          } else publish({ actionError: error.message || '抽取暂未完成，请使用同一次请求重试。' });
        }
      } finally {
        if (active && epoch === generation) { actionCount -= 1; publish({ busy: false, drawPending: false, drawRetry: Boolean(pendingDrawId) }); }
      }
    }
    function isWorn(data, item, slot) {
      const equipment = data && data.equipment || {};
      return slot === 'charm' ? equipment.charm === item.id : array(equipment.badges).includes(item.id);
    }
    function ratio(value, target) {
      return finite(value) && finite(target) && target > 0 ? Math.max(0, Math.min(1, value / target)) : null;
    }
    function reducedMotion(data) {
      const preference = data && data.preferences && data.preferences.reducedMotion;
      if (preference === 'reduce') return true;
      if (preference === 'full') return false;
      return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    function notificationMode(data) { return data && data.preferences && data.preferences.notifications || 'all'; }
    function validSnapshot(data) {
      return data && typeof data === 'object' && Array.isArray(data.definitions) &&
        data.preferences && typeof data.preferences === 'object' && data.level && data.totals;
    }
    function clearFeedback() {
      clearTimeout(feedbackTimer); feedbackTimer = undefined;
      clearTimeout(toastTimer); toastTimer = undefined;
      queuedFeedback = [];
      if (snapshot.toast) publish({ toast: null });
    }
    function establishWatermark(data) {
      seenNotifications = new Set(array(data.notifications).filter(function (item) { return item && item.id; }).map(function (item) { return String(item.id); }));
      journalIdentity = data.createdAt || 'journal';
      needsBaseline = false;
    }
    function accept(data) {
      if (!validSnapshot(data)) throw new Error('成就手记返回了无法识别的数据，请刷新后重试。');
      if (debugToken && (!data.debug || data.debug.active !== true || data.debug.sessionId !== debugToken) || !debugToken && data.debug && data.debug.active === true) throw new Error('记录的调试作用域不匹配，已停止同步。');
      const old = snapshot.data;
      if (old && old.createdAt === data.createdAt && finite(old.revision) && finite(data.revision) && data.revision < old.revision) return;
      const fresh = needsBaseline || journalIdentity !== (data.createdAt || 'journal') || document.hidden;
      if (fresh) {
        clearFeedback();
        establishWatermark(data);
      } else {
        const additions = [];
        array(data.notifications).forEach(function (item) {
          if (!item || !item.id) return;
          const id = String(item.id);
          if (seenNotifications.has(id)) return;
          seenNotifications.add(id);
          if (item.committed === false || !['progress', 'unlock', 'level'].includes(item.kind)) return;
          additions.push(item);
        });
        if (seenNotifications.size > 4096) seenNotifications = new Set(Array.from(seenNotifications).slice(-2048));
        const mode = notificationMode(data);
        if (mode === 'off') clearFeedback();
        else {
          if (mode === 'unlocks') {
            queuedFeedback = queuedFeedback.filter(function (item) { return item.kind !== 'progress'; });
            if (snapshot.toast && snapshot.toast.kind === 'progress' && !snapshot.toast.demo) {
              clearTimeout(toastTimer); publish({ toast: null });
            }
          }
          queuedFeedback.push.apply(queuedFeedback, additions.filter(function (item) {
            return mode !== 'unlocks' || item.kind === 'unlock' || item.kind === 'level';
          }));
          if (queuedFeedback.length && !feedbackTimer) feedbackTimer = setTimeout(flushFeedback, 650);
        }
      }
      publish({ data: data, loading: false, connected: true, error: null });
    }
    function flushFeedback() {
      feedbackTimer = undefined;
      if (!active || document.hidden || !queuedFeedback.length || notificationMode(snapshot.data) === 'off') { queuedFeedback = []; return; }
      const items = queuedFeedback.splice(0);
      const priority = { unlock: 3, level: 2, progress: 1 };
      items.sort(function (a, b) { return priority[b.kind] - priority[a.kind]; });
      const previous = snapshot.toast && !snapshot.toast.demo ? snapshot.toast.items : [];
      const combined = previous.concat(items);
      combined.sort(function (a, b) { return priority[b.kind] - priority[a.kind]; });
      const leader = combined[0];
      clearTimeout(toastTimer);
      publish({ toast: { id: leader.id, kind: leader.kind, items: combined, leader: leader, demo: false } });
      toastTimer = setTimeout(function () { publish({ toast: null }); }, leader.kind === 'progress' ? 5000 : 7200);
    }
    function showNotice(text) {
      clearTimeout(noticeTimer); publish({ notice: text });
      noticeTimer = setTimeout(function () { publish({ notice: null }); }, 5000);
    }
    function previewFeedback() {
      clearFeedback();
      publish({ toast: { id: 'local-preview', kind: 'unlock', demo: true, items: [], leader: { title: '这是一次本地特效预览', icon: 'spark' } } });
      toastTimer = setTimeout(function () { publish({ toast: null }); }, 5000);
    }
    function openCenter(tab) { publish({ open: true, tab: TAB_IDS.includes(tab) ? tab : 'overview', actionError: null }); }
    function closeCenter() { publish({ open: false, actionError: null }); }

    async function request(path, options) {
      if (modeSwitching && !path.startsWith('/debug/')) throw new Error('正在切换数据模式，请稍候。');
      if (debugToken && options && options.method === 'POST' && (path === '/generation' || path === '/generation/cancel')) throw new Error('调试模式不调用模型生成。');
      if (debugToken && snapshot.debugExpired && options && options.method === 'POST' && !path.startsWith('/debug/')) throw new Error('调试会话已失效，请显式退出调试后继续。');
      const controller = new AbortController();
      controllers.add(controller);
      const epoch = generation;
      let timedOut = false;
      const timeout = setTimeout(function () { timedOut = true; controller.abort(); }, 12000);
      try {
        const headers = Object.assign({ Accept: 'application/json' }, options && options.body ? { 'Content-Type': 'application/json' } : {}, options && options.headers || {});
        if (debugToken && path !== '/debug/start') headers['x-daj-debug'] = debugToken;
        const response = await fetch(API + path, Object.assign({
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        }, options || {}, { headers: headers }));
        let body;
        try { body = await response.json(); } catch (_error) { throw new Error('服务未返回有效数据（HTTP ' + response.status + '）。'); }
        if (!response.ok) {
          const detail = body && (typeof body.error === 'string' ? body.error : body.error && body.error.message || body.message);
          const error = new Error(detail || '请求失败（HTTP ' + response.status + '）。');
          error.code = body && (body.code || body.error && body.error.code);
          if (error.code === 'DEBUG_SCOPE_EXPIRED' && debugToken && generation === epoch && active) publish({ debugExpired: true });
          throw error;
        }
        if (generation !== epoch || !active) throw new Error('成就手记已卸载。');
        return body;
      } catch (error) {
        if (timedOut) throw new Error('连接成就手记超时，请重试。');
        throw error;
      } finally { clearTimeout(timeout); controllers.delete(controller); }
    }
    function schedulePoll() {
      clearTimeout(timer);
      if (active && !modeSwitching) timer = setTimeout(refresh, POLL_MS);
    }
    function refresh() {
      if (!active || modeSwitching) return Promise.resolve();
      if (flight) return flight;
      if (document.hidden) { needsBaseline = true; schedulePoll(); return Promise.resolve(); }
      const epoch = generation;
      flight = request('/state').then(function (data) {
        if (active && generation === epoch) accept(data);
      }).catch(function (error) {
        if (!active || generation !== epoch) return;
        needsBaseline = true; clearFeedback();
        publish({ loading: false, connected: false, error: error.message || '暂时无法连接成就手记。' });
      }).finally(function () {
        if (generation !== epoch) return;
        flight = null;
        const repeat = baselineRefreshPending; baselineRefreshPending = false;
        if (repeat && !document.hidden) { needsBaseline = true; void refresh(); }
        else schedulePoll();
      });
      return flight;
    }
    function refreshBaseline() {
      needsBaseline = true; clearFeedback();
      if (document.hidden) return;
      if (flight) baselineRefreshPending = true;
      else void refresh();
    }
    function refreshCatalog() {
      if (catalogFlight || !active || modeSwitching) return catalogFlight || Promise.resolve();
      const epoch = generation;
      const sessionId = currentSessionId();
      catalogFlight = request('/catalog' + (sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : '')).then(function (data) {
        if (active && generation === epoch) publish({ catalog: data, catalogError: null });
      }).catch(function (error) {
        if (active && generation === epoch) publish({ catalogError: error.message || '能力目录暂不可用。' });
      }).finally(function () { if (generation === epoch) catalogFlight = null; });
      return catalogFlight;
    }
    function runningJob(job) { return Boolean(job && job.status === 'running'); }
    function acceptGeneration(value, requestedId) {
      const job = value && value.job;
      if (job !== null && (!job || typeof job.id !== 'string' || !['running', 'succeeded', 'failed', 'cancelled'].includes(job.status))) throw new Error('生成任务返回了无法识别的状态，请重试同步。');
      const previous = snapshot.generationJob;
      if (requestedId && previous && previous.id !== requestedId) return;
      if (previous && job && previous.id === job.id) {
        if (!runningJob(previous) && runningJob(job)) return;
        if (new Date(job.updatedAt).getTime() < new Date(previous.updatedAt).getTime()) return;
      }
      publish({ generationJob: job, generationLoading: false, generationError: null });
      clearTimeout(generationTimer);
      if (runningJob(job)) generationTimer = setTimeout(function () { void refreshGeneration(job.id); }, 1200);
      else if (job && job.status === 'succeeded' && (!previous || previous.id !== job.id || previous.status !== 'succeeded')) {
        const epoch = generation, pending = flight;
        if (pending) void pending.then(function () { if (active && generation === epoch) void refresh(); });
        else void refresh();
      }
    }
    function refreshGeneration(id) {
      if (!active || modeSwitching || generationFlight) return generationFlight || Promise.resolve();
      // GET latest cannot identify the request whose POST response was lost.
      // Only replaying its exact body may acknowledge and release this id.
      if (pendingGenerationBody && !debugToken) { publish({ generationLoading: false }); return Promise.resolve(); }
      const epoch = generation;
      generationFlight = request('/generation' + (id ? '?id=' + encodeURIComponent(id) : '')).then(function (value) {
        if (active && epoch === generation) {
          if (debugToken) publish({ generationJob: null, generationLoading: false, generationError: null });
          else acceptGeneration(value, id);
        }
      }).catch(function (error) {
        if (!active || epoch !== generation) return;
        publish({ generationLoading: false, generationError: error.message || '暂时无法同步生成任务。' });
        if (runningJob(snapshot.generationJob)) generationTimer = setTimeout(function () { void refreshGeneration(snapshot.generationJob.id); }, 2500);
      }).finally(function () { if (epoch === generation) generationFlight = null; });
      return generationFlight;
    }
    async function startGeneration(options) {
      if (debugToken || modeSwitching) { publish({ generationError: '调试模式不调用模型。退出调试后可使用自定义生成。' }); return; }
      if (!active || actionCount || snapshot.generationBusy || snapshot.generationLoading || !pendingGenerationBody && runningJob(snapshot.generationJob)) return;
      const epoch = generation;
      if (!pendingGenerationBody) {
        const body = Object.assign({ requestId: requestId() }, options, { theme: themeId(snapshot.data) });
        const sessionId = currentSessionId(); if (sessionId) body.sessionId = sessionId;
        pendingGenerationBody = JSON.stringify(body); pendingGenerationStorage();
      }
      const body = pendingGenerationBody;
      publish({ generationBusy: true, generationError: null });
      try {
        const value = await request('/generation', { method: 'POST', body: body });
        if (!value || !value.job) throw new Error('服务没有返回生成任务，请重试同步。');
        if (active && epoch === generation) {
          acceptGeneration(value);
          if (pendingGenerationBody === body) { pendingGenerationBody = null; pendingGenerationStorage(); publish({ generationError: null }); }
        }
      } catch (error) {
        if (active && epoch === generation) {
          const refused = ['GENERATION_INVALID', 'GENERATION_OUTPUT', 'GENERATION_UNAVAILABLE', 'GENERATION_SOURCE_UNAVAILABLE', 'GENERATION_CHARACTER_CAPACITY', 'GENERATION_ACHIEVEMENT_CAPACITY', 'GENERATION_THEME_MISMATCH', 'GENERATION_BUSY', 'GENERATION_BUDGET', 'GENERATION_CLOSED'].includes(error.code);
          if (refused && pendingGenerationBody === body) { pendingGenerationBody = null; pendingGenerationStorage(); }
          publish({ generationError: error.message || '生成任务启动结果尚未确认，请重试原请求。' });
          if (refused) void refresh();
        }
      } finally { if (active && epoch === generation) publish({ generationBusy: false }); }
    }
    async function cancelGeneration() {
      if (debugToken || modeSwitching) return;
      const job = snapshot.generationJob;
      if (!runningJob(job) || job.stage === 'applying' || snapshot.generationBusy) return;
      const epoch = generation; publish({ generationBusy: true, generationError: null });
      try {
        const value = await request('/generation/cancel', { method: 'POST', body: JSON.stringify({ id: job.id }) });
        if (active && epoch === generation) acceptGeneration(value, job.id);
      } catch (error) {
        if (active && epoch === generation) publish({ generationError: error.message || '取消失败，请重试同步。' });
      } finally { if (active && epoch === generation) publish({ generationBusy: false }); }
    }
    async function mutate(path, body) {
      if (!active || actionCount) return false;
      const epoch = generation;
      actionCount += 1; publish({ busy: true, actionError: null });
      try {
        const data = await request(path, { method: 'POST', body: JSON.stringify(body) });
        if (generation === epoch) accept(data);
        return true;
      } catch (error) {
        if (active && generation === epoch) publish({ actionError: error.message || '保存失败，请重试。' });
        return false;
      } finally {
        if (generation === epoch) { actionCount -= 1; publish({ busy: false }); }
      }
    }
    function preferences(patch) {
      const data = snapshot.data;
      if (!data) return Promise.resolve(false);
      if (patch.theme && (pendingDrawId || snapshot.drawPending || snapshot.drawRetry)) { publish({ actionError: '请先重试并确认这次十连结果，再切换主题。' }); return Promise.resolve(false); }
      return mutate('/preferences', Object.assign({}, data.preferences, patch));
    }
    function requestId() {
      return window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID() : 'ui-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
    function deleteDefinition(item) {
      const data = snapshot.data;
      return mutate('/delete', { requestId: requestId(), expectedRevision: data.revision, ids: [item.id] });
    }
    async function copyText(text) {
      if (debugToken) { publish({ actionError: '调试模式请使用快速完成，不向工作会话发送记录请求。' }); return; }
      try {
        if (!window.navigator || !window.navigator.clipboard || typeof window.navigator.clipboard.writeText !== 'function') {
          throw new Error('此环境不能直接复制。请选中文本，使用系统复制后粘贴到工作会话。');
        }
        await window.navigator.clipboard.writeText(text);
        showNotice('已复制。回到工作会话粘贴，由模型读取目录并保存配置。');
      } catch (error) { publish({ actionError: error.message || '复制失败，请手动选择文本复制。' }); }
    }

    function Icon(props) {
      const name = props.name || 'star';
      const size = Math.max(12, Math.round((props.size || 18) * .83));
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: GLYPHS[name] || GLYPHS.star }));
    }
    function Button(props) {
      const copy = Object.assign({ type: 'button' }, props);
      delete copy.children;
      copy.className = 'daj-button ' + (props.className || '');
      return h('button', copy, props.children);
    }
    function Pill(props) { return h('span', { className: 'daj-pill ' + (props.className || '') }, props.children); }
    function Badge(props) {
      const item = props.item || {};
      const skin = props.theme || 'explorer';
      const id = 'daj-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
      const size = Math.round((props.size || 64) * .8);
      const locked = props.locked;
      const glyph = locked && item.hidden ? GLYPHS.spark : GLYPHS[item.icon] || GLYPHS[item.category] || GLYPHS.star;
      const svgProps = { width: size, height: Math.round(size * 1.12), viewBox: '0 0 100 112', className: 'daj-badge' + (locked ? ' daj-locked-art' : ''), 'aria-hidden': true };
      if (EXTRA_THEMES[skin]) {
        const colors = THEMES[skin].art;
        const outlines = {
          wuxia: 'M50 5 82 23v42L50 92 18 65V23Z', fantasy: 'm50 3 35 27-8 47-27 20-27-20-8-47Z',
          space: 'm50 6 31 13 13 31-13 31-31 13-31-13L6 50l13-31Z', ocean: 'M50 8C10 7 2 38 17 69l33 29 33-29C98 38 90 7 50 8Z',
          garden: 'M50 6c13-18 32 0 24 15 23-5 31 21 12 32 19 14 2 37-17 29-4 24-34 24-38 0-19 8-36-15-17-29C-5 42 3 16 26 21 18 6 37-12 50 6Z',
          academy: 'M16 11h68v52L68 89 50 98 32 89 16 63Z', steampunk: 'm37 5 26 0 5 12 13-2 14 22-7 13 7 13-14 22-13-2-5 12H37l-5-12-13 2L5 63l7-13-7-13 14-22 13 2Z',
        };
        return h('svg', svgProps, h('defs', null, h('linearGradient', { id: id, x1: 0, y1: 0, x2: 1, y2: 1 }, h('stop', { stopColor: colors.light }), h('stop', { offset: 1, stopColor: colors.dark }))),
          h('path', { d: outlines[skin], fill: 'url(#' + id + ')', stroke: colors.gold, strokeWidth: 2 }),
          h('circle', { cx: 50, cy: 49, r: 28, fill: colors.dark, stroke: colors.gold, opacity: .85 }),
          h('g', { transform: 'translate(33 32) scale(1.45)', fill: 'none', stroke: '#fff2cc', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: glyph })),
          h('path', { d: 'M44 93v15m12-15v15', stroke: colors.gold, strokeWidth: 3 }));
      }
      if (skin === 'xianxia') return h('svg', svgProps,
        h('defs', null,
          h('linearGradient', { id: id, x1: '0', y1: '0', x2: '1', y2: '1' }, h('stop', { stopColor: '#dce7d0' }), h('stop', { offset: '.42', stopColor: '#87ae96' }), h('stop', { offset: '1', stopColor: '#416a59' }))),
        h('path', { d: 'M50 1v13m-9 2c-2-15 20-15 18 0', fill: 'none', stroke: '#b49661', strokeWidth: 2 }),
        h('path', { d: 'm28 16 44 0 10 14v43L66 89H34L18 73V30Z', fill: '#c9aa71' }),
        h('path', { d: 'm30 20 40 0 8 12v39L64 85H36L22 71V32Z', fill: 'url(#' + id + ')' }),
        h('path', { d: 'M32 29h36v39L60 76H40l-8-8Z', fill: 'none', stroke: '#e9ecd5', opacity: .7 }),
        h('circle', { cx: 50, cy: 50, r: 21, fill: '#426d5b', opacity: .5 }),
        h('g', { transform: 'translate(36 35) scale(1.2)', fill: 'none', stroke: '#f2e5b7', strokeWidth: 1.4, strokeLinejoin: 'round', strokeLinecap: 'round' }, h('path', { d: glyph })),
        h('path', { d: 'M50 87v14m-6-9v18m12-18v18', stroke: '#9e8657', strokeWidth: 2 }),
        h('path', { d: 'm44 100-4 10h8Zm12 0-4 10h8Z', fill: '#a87b50' }));
      if (skin === 'cyber') return h('svg', svgProps,
        h('defs', null, h('linearGradient', { id: id, x1: '0', y1: '0', x2: '1', y2: '1' }, h('stop', { stopColor: '#28405a' }), h('stop', { offset: '1', stopColor: '#10192d' }))),
        h('path', { d: 'm50 7 36 21v44L50 94 14 72V28Z', fill: 'url(#' + id + ')', stroke: '#68ead5', strokeWidth: 1.5 }),
        h('path', { d: 'm50 14 30 18v36L50 87 20 68V32Z', fill: 'none', stroke: '#68ead5', opacity: .4 }),
        h('path', { d: 'M27 36h7v-7m39 7h-7v-7M27 65h7v7m39-7h-7v7M14 44H6m80 0h8M14 55H5m81 0h9M45 94v8m10-8v8', fill: 'none', stroke: '#68ead5', strokeWidth: 1.5 }),
        h('g', { transform: 'translate(33 34) scale(1.45)', fill: 'none', stroke: '#8ff3dd', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: glyph })));
      return h('svg', svgProps,
        h('defs', null, h('linearGradient', { id: id, x1: '0', y1: '0', x2: '1', y2: '1' }, h('stop', { stopColor: '#f4d695' }), h('stop', { offset: '.5', stopColor: '#d3ad65' }), h('stop', { offset: '1', stopColor: '#aa7e42' }))),
        h('path', { d: 'm30 72-7 34 17-9 10 12 4-35m0-1 10 31 10-12 16 4-14-32', fill: '#7596cf' }),
        h('path', { d: 'm50 6 14 5 15 1 5 14 9 12-6 15-1 15-14 6-12 9-15-6-15-1-6-14-9-12 6-15 1-15 14-6Z', fill: 'url(#' + id + ')' }),
        h('circle', { cx: 50, cy: 44, r: 28, fill: '#4d70a6', stroke: '#f0d99f', strokeWidth: 2 }),
        h('circle', { cx: 50, cy: 44, r: 23, fill: 'none', stroke: '#b7d0ef', opacity: .6 }),
        h('g', { transform: 'translate(36 30) scale(1.2)', fill: 'none', stroke: '#f9edc8', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: glyph })));
    }
    function Scene(props) {
      if (props.theme === 'xianxia') return h('svg', { className: 'daj-scene', viewBox: '0 0 520 190', 'aria-hidden': true },
        h('circle', { cx: 395, cy: 48, r: 30, fill: '#dfc88a', opacity: .24 }),
        h('path', { d: 'M0 190 100 93l65 62 80-130 96 122 82-78 97 121Z', fill: '#4b7c6b', opacity: .12 }),
        h('path', { d: 'm115 190 114-95 45 54 50-87 106 128', fill: '#315d50', opacity: .1 }),
        h('path', { d: 'M50 60c40-20 60 15 108-1M294 90c34-20 70 13 117-5', fill: 'none', stroke: '#8caa98', opacity: .45 }));
      if (props.theme === 'cyber') return h('svg', { className: 'daj-scene', viewBox: '0 0 520 190', 'aria-hidden': true },
        h('g', { fill: 'none', stroke: '#5de9d4', opacity: .24 },
          h('path', { d: 'M10 170h70l28-35h92l37-49h99l38-32h110M140 190v-34l35-32V26M340 190v-42l35-35V0M30 15h108l40 25h162' }),
          h('circle', { cx: 238, cy: 85, r: 4 }), h('circle', { cx: 373, cy: 54, r: 4 })));
      return h('div', { className: 'daj-orbits', 'aria-hidden': true }, h('i'), h('i'), h('i'));
    }
    function CharacterArt(props) {
      const character = props.character || { name: '尚未佩戴角色', icon: 'star', animation: 'none' };
      const reduce = props.reduce;
      const art = validArt(character.art) ? character.art : null;
      const portrait = portraitFor(character);
      const [failedPortrait, setFailedPortrait] = useState(null);
      const [still, setStill] = useState(function () { return art && staticArtCache.get(art) || null; });
      useEffect(function () {
        let live = true;
        setFailedPortrait(null);
        if (!portrait || typeof window.Image !== 'function') return;
        const picture = new window.Image();
        picture.onerror = function () { if (live) setFailedPortrait(portrait.url); };
        picture.src = portrait.url;
        return function () { live = false; picture.onerror = null; picture.onload = null; };
      }, [portrait && portrait.url]);
      useEffect(function () {
        let live = true;
        if (!reduce || !art) { setStill(null); return; }
        const cached = staticArtCache.get(art);
        if (cached) { setStill(cached); return; }
        setStill(null);
        if (typeof window.Image !== 'function') return;
        const picture = new window.Image();
        picture.onload = function () {
          if (!live) return;
          try {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 240 / Math.max(picture.naturalWidth || 1, picture.naturalHeight || 1));
            canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
            canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height);
            const value = canvas.toDataURL('image/png');
            staticArtCache.set(art, value);
            if (staticArtCache.size > 32) staticArtCache.delete(staticArtCache.keys().next().value);
            setStill(value);
          } catch (_error) { /* The vector portrait remains a motion-free fallback. */ }
        };
        picture.src = art;
        return function () { live = false; picture.onload = null; picture.onerror = null; };
      }, [art, reduce]);
      const colors = THEMES[character.theme] && THEMES[character.theme].art || { dark: '#477a70', light: '#d8e7cf', gold: '#c3a35d' };
      const ears = ['fox', 'cat', 'dragon'].includes(character.icon);
      const robot = character.icon === 'robot';
      return h('span', { className: 'daj-character-art ' + (props.className || ''), 'data-animation': reduce ? 'none' : character.animation || 'none', style: { '--daj-character-size': (props.size || 100) + 'px', '--daj-character-aspect': portrait && portrait.url !== failedPortrait ? portrait.aspect : .875, '--daj-character-accent': colors.dark, '--daj-character-light': colors.light } },
        art && (!reduce || still) ? h('img', { src: reduce ? still : art, alt: '', draggable: false }) : portrait && portrait.url !== failedPortrait ? h('span', { className: 'daj-character-portrait', 'aria-hidden': true, style: { backgroundImage: 'url("' + portrait.url + '")', backgroundSize: portrait.columns * 100 + '% ' + portrait.rows * 100 + '%', backgroundPosition: (portrait.columns === 1 ? 0 : portrait.column / (portrait.columns - 1) * 100) + '% ' + (portrait.rows === 1 ? 0 : portrait.row / (portrait.rows - 1) * 100) + '%' } }) : h('svg', { viewBox: '0 0 140 160', 'aria-hidden': true },
          h('ellipse', { cx: 70, cy: 145, rx: 41, ry: 8, fill: colors.dark, opacity: .12 }),
          h('circle', { cx: 70, cy: 70, r: 57, fill: colors.light, opacity: .48 }),
          h('path', { d: 'M30 141v-25c0-27 80-27 80 0v25Z', fill: colors.dark }),
          ears ? h('path', { d: 'm36 52-8-34 32 19m20 0 32-19-8 34', fill: colors.gold, stroke: colors.dark, strokeWidth: 3, strokeLinejoin: 'round' }) : h('path', { d: 'M35 49C30 5 110 5 105 49Z', fill: colors.dark }),
          robot ? h('rect', { x: 35, y: 39, width: 70, height: 57, rx: 13, fill: colors.light, stroke: colors.dark, strokeWidth: 4 }) : h('ellipse', { cx: 70, cy: 64, rx: 35, ry: 34, fill: '#f5dfc5', stroke: colors.dark, strokeWidth: 2 }),
          h('path', { d: 'M49 59h6m30 0h6', stroke: colors.dark, strokeWidth: 4, strokeLinecap: 'round' }),
          h('path', { d: 'M62 77q8 7 16 0', fill: 'none', stroke: colors.dark, strokeWidth: 2, strokeLinecap: 'round' }),
          h('path', { d: 'm57 96 13 15 13-15', fill: 'none', stroke: colors.gold, strokeWidth: 5 }),
          h('g', { transform: 'translate(59 116) scale(.9)', fill: 'none', stroke: colors.light, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: GLYPHS[character.icon] || GLYPHS.star })),
          h('circle', { cx: 111, cy: 27, r: 4, fill: colors.gold }), h('path', { d: 'M20 71h10m-5-5v10', stroke: colors.gold, strokeWidth: 2 })),
        character.animation === 'orbit' || character.animation === 'spark' ? h('i', { className: 'daj-character-aura', 'aria-hidden': true }) : null);
    }
    function ProfileFrame(props) {
      const data = props.data, settings = props.settings || frameSettings(data);
      const character = visibleEquippedCharacter(data);
      const badges = array(data && data.equipment && data.equipment.badges).slice(0, 3).map(function (id) { return definitionFor(data, id) || awardFor(data, id); }).filter(function (item) { return item && item.status !== 'archived'; });
      const charm = data && data.equipment && charmFor(data, data.equipment.charm);
      const short = settings.frameHeight <= 40;
      const debugging = snapshot.debugActive;
      return h('div', { className: 'daj-account-frame daj-frame-' + settings.frameStyle + (short ? ' daj-frame-short' : '') + (debugging ? ' daj-frame-debug' : ''), style: { height: props.fit ? '100%' : settings.frameHeight + 'px' }, 'data-daj-reduce': reducedMotion(data) ? 'true' : 'false' },
        debugging ? h('b', { className: 'daj-frame-debug-label' }, '调试') : null,
        character ? h(CharacterArt, { character: character, reduce: reducedMotion(data), size: Math.max(23, Math.min(145, settings.frameHeight - 6)), className: 'daj-frame-character' }) : h('span', { className: 'daj-frame-empty-icon' }, h(Icon, { name: 'medal', size: short ? 18 : 28 })),
        h('span', { className: 'daj-frame-copy' }, h('strong', { title: character ? character.name : '成就手记' }, character ? character.name : '成就手记', props.interactive && character ? h('small', { className: 'daj-frame-change' }, '更换') : null),
          h('span', { className: 'daj-profile-level' }, data ? 'Lv.' + (data.level.isLowerBound || data.level.incomplete ? '≥' : '') + exact(data.level.number) + (short ? '' : ' · ' + allAwards(data).length + ' 枚成就') : '正在连接'),
          h('span', { className: 'daj-profile-badges' }, badges.length ? badges.map(function (item) { return h('span', { key: item.id, title: presentation(item, data).title }, h(Badge, { item: item, theme: themeId(data), size: 18 })); }) : !short ? h('small', null, character ? THEMES[character.theme] && THEMES[character.theme].role || '旅途同伴' : '等待第一枚纪念') : null)),
        charm ? h('span', { className: 'daj-profile-charm', title: presentation(charm, data).title }, h(Badge, { item: charm, theme: themeId(data), size: 20 })) : null);
    }
    function FrameSettings(props) {
      const actual = frameSettings(props.data);
      const [draft, setDraft] = useState(actual);
      useEffect(function () { setDraft(actual); }, [actual.frameStyle, actual.frameHeight]);
      const options = [{ id: 'compact', label: '紧凑', height: 32 }, { id: 'standard', label: '标准', height: 64 }, { id: 'showcase', label: '展示', height: 104 }];
      const changed = draft.frameStyle !== actual.frameStyle || draft.frameHeight !== actual.frameHeight;
      return h('section', { className: 'daj-frame-settings', 'aria-label': '账户成就框设置' },
        h('div', { className: 'daj-section-heading' }, h('div', null, h('h3', null, '账户成就框'), h('p', { className: 'daj-hint' }, '在账户入口附近展示角色、等级、勋章和挂件。'))),
        h('div', { className: 'daj-frame-presets' }, options.map(function (option) {
          return h('button', { type: 'button', key: option.id, className: 'daj-frame-preset' + (draft.frameStyle === option.id ? ' daj-selected' : ''), disabled: props.busy, 'aria-label': option.label + ' ' + option.height + 'px', 'aria-pressed': draft.frameStyle === option.id, onClick: function () { setDraft({ frameStyle: option.id, frameHeight: option.height }); } },
            h('span', null, option.label + ' · ' + option.height + 'px'), h(ProfileFrame, { data: props.data, settings: { frameStyle: option.id, frameHeight: option.height } }));
        })),
        h('div', { className: 'daj-frame-controls' }, h('label', null, h('span', { className: 'daj-field-label' }, '框样式'), h('select', { id: props.idPrefix + '-frame-style', value: draft.frameStyle, disabled: props.busy, onChange: function (event) { setDraft(Object.assign({}, draft, { frameStyle: event.target.value })); } }, options.map(function (option) { return h('option', { key: option.id, value: option.id }, option.label); }))),
          h('label', { className: 'daj-grow' }, h('span', { className: 'daj-field-label' }, '高度 · ' + draft.frameHeight + 'px'), h('input', { id: props.idPrefix + '-frame-height', type: 'range', min: 32, max: 160, step: 1, value: draft.frameHeight, disabled: props.busy, onChange: function (event) { setDraft(Object.assign({}, draft, { frameHeight: Math.max(32, Math.min(160, Number(event.target.value) || 32)) })); } })),
          h(Button, { disabled: props.busy || !changed, onClick: function () { void preferences(draft); } }, '保存展示框')),
        h('div', { className: 'daj-frame-live-preview', 'aria-label': '展示框实时预览' }, h('small', null, '实时预览 · 保存后应用到账户附近'), h(ProfileFrame, { data: props.data, settings: draft })));
    }
    function DebugPanel() {
      const state = useJournal(), data = state.data;
      const [definitionId, setDefinitionId] = useState('');
      const [charm, setCharm] = useState('star');
      const disabled = state.busy || state.debugTransition || state.debugExpired;
      return h('section', { className: 'daj-debug-panel', 'aria-label': '调试模式面板' },
        h('div', { className: 'daj-section-heading' }, h('div', null, h('h3', null, '调试模式'), h('p', null, '使用独立临时数据快速体验成就与角色。工作会话和真实积累保持独立。')),
          !state.debugActive ? h(Button, { disabled: state.debugTransition, onClick: function () { void switchDebug('start'); } }, state.debugTransition ? '正在进入…' : '进入调试模式') : h(Pill, null, state.debugExpired ? '调试已失效' : '独立演示数据')),
        state.debugActive ? h(React.Fragment, null,
          state.debugExpired ? h('p', { role: 'alert', className: 'daj-debug-expired' }, '调试会话已失效，尚未切回真实数据。请点击退出调试。') : h('div', { className: 'daj-debug-actions' },
            h('label', null, h('span', { className: 'daj-field-label' }, '快速完成成就'), h('select', { id: 'daj-debug-definition', value: definitionId, disabled: disabled, onChange: function (event) { setDefinitionId(event.target.value); } }, h('option', { value: '' }, '自动选择下一项'), activeDefinitions(data).map(function (item) { return h('option', { key: item.id, value: item.id }, presentation(item, data).title); }))),
            h('div', { className: 'daj-row' }, h(Button, { disabled: disabled, onClick: function () { void debugAction('complete', definitionId ? { definitionId: definitionId } : {}); } }, '完成所选成就'), h(Button, { disabled: disabled, onClick: function () { void debugAction('complete_all'); } }, '完成全部成就')),
            h('span', { className: 'daj-current-theme' }, '当前主题 · ' + theme(data).name),
            h(Button, { disabled: disabled, onClick: function () { void debugAction('draw', { theme: themeId(data) }); } }, '调试十连并佩戴'),
            h('label', null, h('span', { className: 'daj-field-label' }, '体验挂件'), h('select', { id: 'daj-debug-charm', value: charm, disabled: disabled, onChange: function (event) { setCharm(event.target.value); } }, Object.keys(CHARM_NAMES).map(function (id) { return h('option', { key: id, value: id }, CHARM_NAMES[id]); }))),
            h(Button, { disabled: disabled, onClick: function () { void debugAction('charm', { charm: charm }); } }, '加一个挂件')),
          h('div', { className: 'daj-debug-management' }, h(Button, { disabled: disabled, onClick: function () { void switchDebug('reset'); } }, '重置调试数据'), h(Button, { disabled: state.debugTransition, onClick: function () { void switchDebug('exit'); } }, '退出调试模式'))) : null);
    }
    function DebugBanner(props) {
      const state = props.state;
      if (!state.debugActive && !state.debugTransition) return null;
      return h('aside', { className: 'daj-debug-banner', role: 'status', 'aria-live': 'polite' },
        h('strong', null, state.debugExpired ? '调试已失效' : state.debugTransition ? '正在切换模式…' : '调试模式'), h('span', null, state.debugExpired ? '未切回真实数据' : '当前为独立临时数据'),
        h('button', { type: 'button', disabled: state.debugTransition, onClick: showDebugPanel }, '打开面板'), h('button', { type: 'button', disabled: state.debugTransition, onClick: function () { void switchDebug('exit'); } }, '退出调试'));
    }
    function CharacterEditor(props) {
      const item = props.item;
      const [form, setForm] = useState(function () { return item ? { name: item.name, description: item.description || '', rarity: item.rarity, icon: item.icon, animation: item.animation, art: item.art } : { name: '', description: '', rarity: 'R', icon: 'fox', animation: 'float', art: undefined }; });
      const [uploading, setUploading] = useState(false);
      const [error, setError] = useState(null);
      const reader = useRef(null), live = useRef(true), submission = useRef(null);
      const info = props.catalog && props.catalog.collection || {};
      const icons = array(info.iconIds).length ? info.iconIds : Object.keys(ICON_NAMES);
      const animations = array(info.animationIds).length ? info.animationIds : Object.keys(ANIMATION_NAMES);
      const owned = item && ownedCharacter(props.data, item.id);
      const full = !item && customPoolFull(props.data, props.catalog);
      useEffect(function () { live.current = true; return function () { live.current = false; if (reader.current && reader.current.readyState === 1) reader.current.abort(); }; }, []);
      function change(key, value) { submission.current = null; setForm(Object.assign({}, form, { [key]: value })); setError(null); }
      function upload(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || !file.size || file.size > 262144) { setError('请选择不超过 256 KiB 的 PNG、JPEG、GIF 或 WebP 图片。'); return; }
        if (typeof window.FileReader !== 'function') { setError('当前环境不能读取本机图片。'); return; }
        if (reader.current && reader.current.readyState === 1) reader.current.abort();
        const current = new window.FileReader(); reader.current = current; setUploading(true); setError(null);
        current.onload = function () {
          if (!live.current || reader.current !== current) return;
          setUploading(false);
          if (typeof current.result !== 'string' || !current.result.startsWith('data:' + file.type + ';base64,') || !validArt(current.result)) { setError('图片内容与格式不匹配，无法使用。'); return; }
          change('art', current.result);
        };
        current.onerror = function () { if (live.current && reader.current === current) { setUploading(false); setError('本机图片读取失败，请重试。'); } };
        current.onabort = function () { if (live.current && reader.current === current) setUploading(false); };
        current.readAsDataURL(file);
      }
      async function save(event) {
        if (event && event.preventDefault) event.preventDefault();
        if (props.busy || uploading || full || !form.name.trim()) return;
        if (!submission.current) {
          const character = { name: form.name.trim(), description: form.description.trim(), theme: item ? item.theme : themeId(props.data), rarity: form.rarity, icon: form.icon, animation: form.animation };
          if (!character.description) delete character.description;
          if (item) character.id = item.id;
          if (form.art !== undefined) character.art = form.art;
          submission.current = { requestId: requestId(), expectedRevision: props.data.revision, characters: [character] };
        }
        const ok = await mutate('/characters', submission.current);
        if (ok && live.current) { submission.current = null; showNotice(item ? '角色外观已保存。' : '角色已加入卡池，抽取后即可佩戴。'); }
      }
      const disabled = props.busy || uploading || full;
      return h('form', { id: 'daj-character-editor', className: 'daj-card daj-section daj-character-editor', onSubmit: save },
        h('div', { className: 'daj-section-heading' }, h('h3', null, item ? '编辑角色外观' : '手工创作角色'), item ? h(Button, { className: 'daj-text-button', onClick: props.clear }, '新建角色') : null),
        h('div', { className: 'daj-character-form-preview' }, h(CharacterArt, { character: Object.assign({}, form, { name: form.name || '角色预览', theme: themeId(props.data) }), reduce: reducedMotion(props.data), size: 112 }), h('span', null, h('strong', null, form.name || '角色预览'), h('small', null, theme(props.data).name + ' · 外观预览'))),
        h('label', null, h('span', { className: 'daj-field-label' }, '角色名字'), h('input', { id: 'daj-character-name', className: 'daj-direction-input', value: form.name, maxLength: 60, required: true, disabled: disabled, onChange: function (event) { change('name', event.target.value); } })),
        h('label', null, h('span', { className: 'daj-field-label' }, '一句介绍 · 可选'), h('input', { id: 'daj-character-description', className: 'daj-direction-input', value: form.description, maxLength: 240, disabled: disabled, onChange: function (event) { change('description', event.target.value); } })),
        h('div', { className: 'daj-character-form-grid' },
          h('label', null, h('span', { className: 'daj-field-label' }, '稀有度'), h('select', { id: 'daj-character-rarity', value: form.rarity, disabled: disabled || Boolean(owned), onChange: function (event) { change('rarity', event.target.value); } }, RARITIES.map(function (rarity) { return h('option', { key: rarity, value: rarity }, rarity); }))),
          h('label', null, h('span', { className: 'daj-field-label' }, '角色图标'), h('select', { id: 'daj-character-icon', value: form.icon, disabled: disabled, onChange: function (event) { change('icon', event.target.value); } }, icons.map(function (icon) { return h('option', { key: icon, value: icon }, ICON_NAMES[icon] || icon); }))),
          h('label', null, h('span', { className: 'daj-field-label' }, '动态效果'), h('select', { id: 'daj-character-animation', value: form.animation, disabled: disabled, onChange: function (event) { change('animation', event.target.value); } }, animations.map(function (animation) { return h('option', { key: animation, value: animation }, ANIMATION_NAMES[animation] || animation); })))),
        h('label', { className: 'daj-art-upload' }, h('span', { className: 'daj-field-label' }, '上传图片或动图 · 可选'), h('input', { id: 'daj-character-art', type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', disabled: disabled, onChange: upload }), h('small', null, 'PNG / JPEG / GIF / WebP，最多 256 KiB。只在本机读取和保存，不上传到图片服务。')),
        form.art ? h(Button, { className: 'daj-text-button', disabled: disabled, onClick: function () { change('art', null); } }, '移除上传图片') : null,
        error ? h('p', { className: 'daj-inline-error', role: 'alert' }, error) : null,
        full ? h('p', { className: 'daj-hint', role: 'status' }, '自定义卡池已满，仍可编辑已有角色的外观。') : null,
        h('p', { className: 'daj-hint' }, owned ? '已获得角色可修改外观；主题和稀有度保持原记录。' : '保存会加入相应主题卡池，抽取后才能佩戴。'),
        h(Button, { className: 'daj-primary daj-wide', disabled: disabled || !form.name.trim(), onClick: save }, uploading ? '正在读取图片…' : item ? '保存角色外观' : '保存角色到卡池'));
    }
    function CharacterGenerator(props) {
      const [direction, setDirection] = useState('');
      const [style, setStyle] = useState('balanced');
      const info = props.state.catalog && props.state.catalog.generation;
      const retryBusy = props.state.busy || props.state.generationBusy || props.state.generationLoading || props.state.debugExpired || props.state.debugTransition;
      const busy = retryBusy || runningJob(props.state.generationJob) || props.state.generationPending;
      const full = customPoolFull(props.data, props.state.catalog);
      return h('section', { className: 'daj-card daj-section daj-character-generator' }, h('h3', null, '让模型创作角色'), h('p', { className: 'daj-hint' }, '沿用当前或默认模型，生成后自动加入卡池。抽取仍使用成就点。'),
        h('p', { className: 'daj-current-theme' }, '当前主题 · ' + theme(props.data).name),
        h('label', { className: 'daj-direction-row' }, h('span', { className: 'daj-field-label' }, '角色方向 · 可选'), h('input', { id: 'daj-character-generation-direction', className: 'daj-direction-input', value: direction, maxLength: 120, disabled: busy, placeholder: '例如：抱着莲灯的狐狸、星海领航机器人', onChange: function (event) { setDirection(event.target.value); } })),
        h('label', null, h('span', { className: 'daj-field-label' }, '创作风格'), h('select', { id: 'daj-character-generation-style', value: style, disabled: busy, onChange: function (event) { setStyle(event.target.value); } }, GENERATION_STYLES.map(function (choice) { return h('option', { key: choice.id, value: choice.id }, choice.label); }))),
        h(Button, { className: 'daj-primary daj-wide', disabled: props.state.debugActive || (props.state.generationPending ? retryBusy : busy || full || !info || info.available !== true), onClick: function () { if (props.state.generationPending) void startGeneration(); else if (!full) void startGeneration({ kind: 'characters', theme: themeId(props.data), direction: direction.trim() || undefined, style: style }); } }, props.state.generationBusy ? '正在启动…' : props.state.generationPending ? '重试本次生成' : busy ? '模型任务进行中…' : '模型生成角色'),
        props.state.debugActive ? h('p', { className: 'daj-hint' }, '调试模式不调用模型，可在调试面板快速体验。') : null,
        full ? h('p', { className: 'daj-hint', role: 'status' }, '自定义卡池已满，仍可编辑已有角色的外观。') : null,
        info && info.available === false ? h('p', { className: 'daj-hint' }, info.reason || '当前没有可用模型。') : null,
        h(GenerationStatus, { state: props.state, selectCharacter: props.view, select: function () { openCenter('collection'); } }));
    }
    function CharactersPage(props) {
      const data = props.data, state = props.state, pool = characters(data).filter(function (item) { return item.theme === themeId(data); });
      const [mode, setMode] = useState('collection');
      const [filter, setFilter] = useState('owned'), [editing, setEditing] = useState(null);
      const collection = data.collection || {}, points = collection.points || {};
      const info = state.catalog && state.catalog.collection || {};
      const cost = finite(info.drawCost) ? info.drawCost : 1;
      const receipt = state.drawReceipt && state.drawReceipt.theme === themeId(data) ? state.drawReceipt : array(collection.draws).filter(function (draw) { return draw.theme === themeId(data); }).slice().sort(function (a, b) { return new Date(b.at) - new Date(a.at); })[0];
      const visible = pool.filter(function (item) { return filter === 'pool' || Boolean(ownedCharacter(data, item.id)); });
      function view() { setMode('collection'); setFilter('pool'); }
      return h(React.Fragment, null,
        h(PageHeading, { title: '角色收藏', description: '用成就点遇见同伴，让喜欢的角色陪你留在账户旁。' }, h(Button, { onClick: function () { setMode(mode === 'create' ? 'collection' : 'create'); setEditing(null); } }, mode === 'create' ? '返回角色收藏' : '创作角色')),
        h('section', { className: 'daj-card daj-draw-hero' }, h('div', { className: 'daj-draw-points' }, h('small', null, '可用成就点'), h('strong', null, exact(points.balance)), h('p', null, '每解锁一项成就获得 1 点；每 1 点可十连。')),
          h('div', { className: 'daj-draw-controls' }, h('span', { className: 'daj-current-theme' }, '当前卡池 · ' + theme(data).name),
            h(Button, { className: 'daj-primary', disabled: state.busy || !state.drawRetry && (!finite(points.balance) || points.balance < cost), onClick: function () { void drawCharacters(); } }, state.drawPending ? '正在揭晓…' : state.drawRetry ? '重试这次十连' : '1 成就点 · 十连抽取'),
            h('small', null, state.drawRetry ? '待确认：' + (THEMES[state.drawTheme] && THEMES[state.drawTheme].name || theme(data).name) + '主题。沿用同一次请求重试。' : points.balance === 0 ? '先在日常使用中解锁一项成就，就能开始。' : '十连至少包含 1 位 SR 或更高稀有度角色。'))),
        receipt ? h('section', { className: 'daj-card daj-section daj-draw-results', 'aria-label': '十连抽取结果' }, h('div', { className: 'daj-section-heading' }, h('h3', null, '最近一次十连'), h('small', { className: 'daj-muted' }, (THEMES[receipt.theme] && THEMES[receipt.theme].name || '') + ' · ' + date(receipt.at, true))),
          h('div', { className: 'daj-draw-result-grid' }, array(receipt.results).map(function (result, index) {
            const item = characterFor(data, result.id), worn = data.equipment && data.equipment.character === result.id;
            return h('div', { key: index, className: 'daj-draw-result daj-rarity-' + result.rarity }, h(CharacterArt, { character: item, reduce: reducedMotion(data), size: 78 }), h('strong', null, item ? item.name : '角色记录同步中'), h('small', null, result.rarity + ' · ' + (result.isNew ? '新角色' : '重复角色')),
              h(Button, { className: worn ? '' : 'daj-primary', disabled: state.busy || !item || !ownedCharacter(data, result.id) || worn, 'aria-label': '佩戴到成就框 ' + (item ? item.name : result.id), onClick: function () { void mutate('/equip', { id: result.id, slot: 'character', equipped: true }); } }, worn ? '已佩戴到成就框' : '佩戴到成就框'));
          }))) : null,
        mode === 'create' ? h('div', { className: 'daj-character-studio' }, h(CharacterGenerator, { data: data, state: state, view: view }), h(CharacterEditor, { key: editing && editing.id || 'new', item: editing, data: data, catalog: state.catalog, busy: state.busy, clear: function () { setEditing(null); } })) : h(React.Fragment, null,
          h('div', { className: 'daj-filters' }, [['owned', '已获得'], ['pool', '全部卡池']].map(function (choice) { return h(Button, { key: choice[0], className: 'daj-chip' + (filter === choice[0] ? ' daj-selected' : ''), 'aria-pressed': filter === choice[0], onClick: function () { setFilter(choice[0]); } }, choice[1]); })),
          visible.length ? h('div', { className: 'daj-character-grid' }, visible.map(function (item) {
            const own = ownedCharacter(data, item.id), worn = data.equipment && data.equipment.character === item.id;
            return h('article', { key: item.id, className: 'daj-card daj-character-card daj-rarity-' + item.rarity + (worn ? ' daj-character-worn' : '') }, h('div', { className: 'daj-character-topline' }, h('span', { className: 'daj-rarity' }, item.rarity), h('small', null, THEMES[item.theme] && THEMES[item.theme].name)),
              h(CharacterArt, { character: item, reduce: reducedMotion(data), size: 110 }), h('h3', null, item.name), h('p', null, item.description), h('small', { className: 'daj-character-count' }, own ? '已收藏 ' + exact(own.count) + ' 份' : '尚未获得 · 已在卡池'),
              h(Button, { className: worn ? '' : 'daj-primary', disabled: state.busy || !own, 'aria-label': (worn ? '取下角色 ' : '佩戴角色 ') + item.name, onClick: function () { void mutate('/equip', { id: item.id, slot: 'character', equipped: !worn }); } }, worn ? '正在陪伴 · 取下' : own ? '佩戴到成就框' : '抽取后可佩戴'),
              item.source !== 'builtin' ? h(Button, { className: 'daj-text-button', 'aria-label': '编辑角色 ' + item.name, onClick: function () { setEditing(item); setMode('create'); } }, '编辑外观') : null);
          })) : h('section', { className: 'daj-card' }, h(Empty, { title: filter === 'owned' ? '还没有遇见第一位同伴' : '这个主题的卡池还很安静', icon: 'star', action: h(Button, { onClick: function () { setFilter('pool'); } }, '看看全部卡池') }, filter === 'owned' ? '解锁成就积累点数，再来抽取喜欢的主题。' : '可以让模型或自己创作新角色。'))));
    }
    function Progress(props) {
      const progress = ratio(props.value, props.target);
      return h('div', { className: 'daj-progress-block' },
        h('div', Object.assign({ className: 'daj-progress' }, progress === null ? {} : { role: 'progressbar', 'aria-label': props.label || '成就进度', 'aria-valuenow': Math.round(progress * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }),
          h('i', { style: { width: progress === null ? '0%' : String(progress * 100) + '%' } })),
        h('div', { className: 'daj-progress-label' }, h('span', null, progress === null ? '进度尚无可用记录' : exact(props.value) + ' / ' + exact(props.target)), progress === null ? null : h('span', null, trimNumber(progress * 100) + '%')));
    }
    function Empty(props) {
      return h('div', { className: 'daj-empty' }, h(Icon, { name: props.icon || 'compass', size: 34 }), h('h3', null, props.title), h('p', null, props.children), props.action || null);
    }
    function PageHeading(props) {
      return h('div', { className: 'daj-page-heading' }, h('div', null, h('h2', null, props.title), props.description ? h('p', null, props.description) : null), props.children);
    }
    function DefinitionRow(props) {
      const item = props.item;
      const name = presentation(item, props.data);
      return h('button', { type: 'button', className: 'daj-definition-row', onClick: props.onClick },
        h(Badge, { item: item, theme: themeId(props.data), size: 43, locked: !unlocked(item) }),
        h('span', { className: 'daj-grow' }, h('strong', null, name.title), h('small', null, name.description),
          concealed(item, props.data) ? h('small', null, '把惊喜，留给自然发生的那一刻') : modelReport(item) ? h('small', null, '由当前会话模型核对后记录') : h(Progress, { value: item.progress, target: item.target, label: name.title })),
        h(Icon, { name: 'chevron', size: 14 }));
    }

    function Overview(props) {
      const data = props.data, t = theme(data);
      const defs = activeDefinitions(data);
      const next = defs.filter(function (item) { return !unlocked(item) && !modelReport(item) && !item.hidden; })
        .sort(function (a, b) { return (ratio(b.progress, b.target) || 0) - (ratio(a.progress, a.target) || 0); }).slice(0, 3);
      const models = defs.filter(function (item) { return item.source === 'model'; }).slice(0, 2);
      const awards = allAwards(data).slice().sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
      const visibleAwards = awards.filter(function (award) { const item = definitionFor(data, award.definitionId); return !item || item.status !== 'archived'; });
      const worn = array(data.equipment && data.equipment.badges).map(function (id) { return definitionFor(data, id) || awardFor(data, id); }).filter(function (item) { return item && item.status !== 'archived'; });
      const charm = data.equipment && charmFor(data, data.equipment.charm);
      const level = data.level;
      const levelNumber = (level.isLowerBound || level.incomplete ? '≥' : '') + exact(level.number);
      const levelText = themeId(data) === 'xianxia' ? '修行 · ' + levelNumber + ' 阶' : themeId(data) === 'cyber' ? 'ACCESS · ' + levelNumber : 'Lv.' + levelNumber;
      return h(React.Fragment, null,
        h(PageHeading, { title: t.title, description: t.subtitle },
          h(Button, { onClick: function () { props.navigate('collection'); } }, h(Icon, { name: 'medal', size: 15 }), '调整佩戴')),
        h('section', { className: 'daj-card daj-hero' },
          h(Scene, { theme: themeId(data) }),
          h('div', { className: 'daj-avatar' }, h(Icon, { name: themeId(data) === 'cyber' ? 'code' : 'star', size: 32 }), charm ? h('span', { className: 'daj-avatar-charm' }, h(Badge, { item: charm, theme: themeId(data), size: 28 })) : null),
          h('div', { className: 'daj-hero-copy' },
            h('div', { className: 'daj-eyebrow' }, t.eyebrow),
            h('h3', null, t.hero, h('span', { className: 'daj-level' }, levelText)),
            h('p', null, t.role + ' · 从第一轮对话，到属于你的每一个里程碑'),
            h('div', { className: 'daj-equipped' }, h('span', null, '正在佩戴'), worn.length ? worn.map(function (item) { return h('button', { type: 'button', key: item.id, title: presentation(item, data).title, onClick: function () { props.select(item.id); } }, h(Badge, { item: item, theme: themeId(data), size: 29 })); }) : h('span', { className: 'daj-muted' }, '等第一枚' + t.wear + '，慢慢来'),
              h(Button, { className: 'daj-icon-button', 'aria-label': '选择佩戴', onClick: function () { props.navigate('collection'); } }, '+'))),
          h('div', { className: 'daj-hero-art' }, [0, 1, 2].map(function (index) {
            const item = visibleAwards[index] || defs[index];
            return item ? h(Badge, { key: item.id, item: item, theme: themeId(data), size: index === 1 ? 92 : 66, locked: !visibleAwards[index] && !unlocked(item) }) : null;
          }))),
        h('section', { className: 'daj-card daj-metrics', 'aria-label': '真实累计记录' },
          h('div', { className: 'daj-metric' }, h('span', null, t.currency), h('strong', { title: exact(data.totals.tokens) }, compact(data.totals.tokens)), h('small', null, '已记录用量 · 不代表工作质量')),
          h('div', { className: 'daj-metric' }, h('span', null, '完成回合'), h('strong', null, exact(data.totals.turns)), h('small', null, '来自完成的会话回合')),
          h('div', { className: 'daj-metric' }, h('span', null, '获得成就'), h('strong', null, exact(awards.length), h('i', null, ' / ' + defs.length)), h('small', null, awards.length ? '每一枚，都有自己的来处' : '还没有获得，记录已经开始'))),
        h('section', { className: 'daj-card daj-level-progress' }, h('span', null, '下一阶段'), h(Progress, { value: level.progress === null ? null : level.current, target: level.next, label: '等级积累' }), h('small', null, level.progress === null ? '部分用量尚不完整，先保留已确认的积累。' : '等级随已记录用量积累；佩戴与主题不会改变进度。')),
        data.totals.turns === 0 && !awards.length ? h('section', { className: 'daj-welcome' }, h(Icon, { name: 'leaf', size: 20 }), h('div', null, h('strong', null, '手记已翻开，等待第一段真实经历'), h('p', null, '正常使用 DSH 即可开始积累。当前未导入过去的会话记录。'))) : null,
        h('div', { className: 'daj-overview-grid' },
          h('section', { className: 'daj-card daj-section' }, h('div', { className: 'daj-section-heading' }, h('h3', null, '下一枚，正在路上'), h(Button, { className: 'daj-text-button', onClick: function () { props.navigate('collection'); } }, '查看全部', h(Icon, { name: 'chevron', size: 12 }))),
            next.length ? next.map(function (item) { return h(DefinitionRow, { key: item.id, data: data, item: item, onClick: function () { props.select(item.id); } }); }) : h(Empty, { title: defs.some(function (item) { return !unlocked(item); }) ? '还藏着一些小惊喜' : defs.length ? '这一页，已经写得很满' : '还没有成就定义', icon: 'medal' }, defs.length ? '已经获得的纪念都在收藏里，其他经历可以慢慢来。' : '让模型帮你配置一份自己的成就手记。')),
          h('section', { className: 'daj-card daj-section' }, h('div', { className: 'daj-section-heading' }, h('h3', null, '你的自选目标'), h(Button, { className: 'daj-text-button', onClick: function () { props.navigate('model'); } }, '自定义生成', h(Icon, { name: 'chevron', size: 12 }))),
            models.length ? models.map(function (item) { return h(DefinitionRow, { key: item.id, data: data, item: item, onClick: function () { props.select(item.id); } }); }) : h(Empty, { title: '也可以，什么都不赶', icon: 'leaf', action: h(Button, { onClick: function () { props.navigate('model'); } }, '让模型帮我配置') }, '目标是可选的。你的日常积累一直都在。'))),
        h('section', { className: 'daj-recent' }, h('div', { className: 'daj-section-heading' }, h('h3', null, '最近收藏'), h(Button, { className: 'daj-text-button', onClick: function () { props.navigate('history'); } }, '查看历程', h(Icon, { name: 'chevron', size: 12 }))),
          visibleAwards.length ? h('div', { className: 'daj-recent-grid' }, visibleAwards.slice(0, 4).map(function (award) {
            return h('button', { key: award.id, type: 'button', className: 'daj-card daj-recent-item', onClick: function () { props.select(award.definitionId); } }, h(Badge, { item: award, theme: themeId(data), size: 40 }), h('span', null, h('strong', null, presentation(award, data).title), h('small', null, date(award.at) + ' · ' + sourceLabel(award))));
          })) : h('div', { className: 'daj-quiet-empty' }, '第一枚成就获得后，会留在这里。')));
    }

    function DeleteDefinitionButton(props) {
      const [confirmed, setConfirmed] = useState(false);
      useEffect(function () { setConfirmed(false); }, [props.item.id]);
      const title = presentation(props.item, props.data).title;
      if (props.item.source === 'builtin' || props.item.status === 'archived') return null;
      return h('div', { className: 'daj-delete-control' }, h(Button, { className: 'daj-text-button', disabled: props.busy, 'aria-label': (confirmed ? '确认删除成就 ' : '删除成就 ') + title, onClick: function () {
        if (!confirmed) { setConfirmed(true); return; }
        void deleteDefinition(props.item).then(function (ok) { if (ok) setConfirmed(false); });
      } }, confirmed ? '确认删除' : '删除成就'), confirmed ? h(React.Fragment, null, h('small', null, '删除后保留已获记录和点数'), h(Button, { className: 'daj-text-button', disabled: props.busy, onClick: function () { setConfirmed(false); } }, '取消')) : null);
    }
    function DefinitionDetail(props) {
      const item = props.item, data = props.data;
      const name = presentation(item, data);
      const award = awardFor(data, item.id);
      const owned = unlocked(item) || Boolean(award);
      const worn = isWorn(data, item, 'badge');
      const charm = isWorn(data, item, 'charm');
      return h('aside', { className: 'daj-card daj-detail', 'aria-label': name.title + '详情' },
        h('div', { className: 'daj-detail-art' }, h(Badge, { item: award || item, theme: themeId(data), size: 112, locked: !owned })),
        h('div', { className: 'daj-eyebrow' }, owned ? 'COLLECTED MOMENT' : 'A MOMENT AHEAD'),
        h('h3', null, name.title), h('p', { className: 'daj-description' }, name.description),
        !owned && !modelReport(item) && !concealed(item, data) ? h(Progress, { value: item.progress, target: item.target, label: name.title }) : null,
        h('dl', { className: 'daj-details-list' },
          h('div', null, h('dt', null, '配置来源'), h('dd', null, definitionLabel(item))),
          h('div', null, h('dt', null, '达成依据'), h('dd', null, sourceLabel(award || item))),
          h('div', null, h('dt', null, '当前状态'), h('dd', null, owned ? '已获得' : '积累中')),
          owned ? h('div', null, h('dt', null, '获得时间'), h('dd', null, date(award && award.at || item.unlockedAt))) : null,
          !concealed(item, data) && item.rule && item.rule.metric ? h('div', null, h('dt', null, '记录指标'), h('dd', null, METRIC_NAMES[item.rule.metric] || item.rule.metric)) : null),
        owned ? h('div', { className: 'daj-detail-actions' },
          h(Button, { className: worn ? '' : 'daj-primary', disabled: props.busy, onClick: function () { void mutate('/equip', { id: item.id, slot: 'badge', equipped: !worn }); } }, h(Icon, { name: 'medal', size: 15 }), worn ? '取下' + theme(data).wear : '佩戴' + theme(data).wear),
          h(Button, { disabled: props.busy, onClick: function () { void mutate('/equip', { id: item.id, slot: 'charm', equipped: !charm }); } }, charm ? '取下挂件' : '作为挂件佩戴'))
          : modelReport(item) ? h(Button, { className: 'daj-primary', onClick: function () {
            if (snapshot.debugActive) { showDebugPanel(); return; }
            void copyText('请核对当前会话的实际证据。如果确已达成，请用成就手记的模型记录接口记录成就 ' + item.id + '（' + name.title + '），附简短依据；不要凭空记录完成。');
          } }, h(Icon, { name: snapshot.debugActive ? 'settings' : 'copy', size: 14 }), snapshot.debugActive ? '在调试面板完成' : '复制达成记录请求') : null,
        h('p', { className: 'daj-detail-note' }, owned ? '摘下只改变展示。已获得的记录会一直留在手记里。' : modelReport(item) ? '此项由会话中的模型核对后记录，始终保留模型记录来源。' : '自然积累即可。这里的数字描述使用经历，不评价能力或产出。'),
        h(DeleteDefinitionButton, { item: item, data: data, busy: props.busy }));
    }
    function Collection(props) {
      const data = props.data, t = theme(data);
      const [filter, setFilter] = useState('all');
      const [search, setSearch] = useState('');
      const [selected, setSelected] = useState(props.selected || null);
      useEffect(function () { if (props.selected) setSelected(props.selected); }, [props.selected]);
      const definitions = activeDefinitions(data);
      const found = definitions.filter(function (item) {
        const own = unlocked(item) || Boolean(awardFor(data, item.id));
        if (filter === 'owned' && !own || filter === 'pending' && own) return false;
        const text = presentation(item, data);
        return !search.trim() || (text.title + ' ' + text.description).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
      });
      const selectedItem = found.find(function (item) { return item.id === selected; }) || found[0];
      return h(React.Fragment, null,
        h(PageHeading, { title: t.collection, description: '把已经走过的路，收进自己的小小展柜。' }, h('span', { className: 'daj-count' }, definitions.filter(function (item) { return unlocked(item) || Boolean(awardFor(data, item.id)); }).length + ' 枚当前收藏')),
        h('div', { className: 'daj-filters' }, [['all', '全部'], ['owned', '已获得'], ['pending', '积累中']].map(function (entry) {
          return h(Button, { key: entry[0], className: 'daj-chip' + (filter === entry[0] ? ' daj-selected' : ''), 'aria-pressed': filter === entry[0], onClick: function () { setFilter(entry[0]); } }, entry[1]);
        }), h('label', { className: 'daj-search' }, h(Icon, { name: 'search', size: 15 }), h('input', { type: 'search', value: search, placeholder: '寻找一枚成就', 'aria-label': '搜索成就', onChange: function (event) { setSearch(event.target.value); } }))),
        h('div', { className: 'daj-collection-layout' },
          found.length ? h('div', { className: 'daj-badge-grid' }, found.map(function (item) {
            const name = presentation(item, data);
            const owned = unlocked(item) || Boolean(awardFor(data, item.id));
            return h('button', { type: 'button', key: item.id, className: 'daj-badge-tile' + (selectedItem && selectedItem.id === item.id ? ' daj-selected' : '') + (!owned ? ' daj-locked' : ''), 'aria-pressed': Boolean(selectedItem && selectedItem.id === item.id), onClick: function () { setSelected(item.id); } },
              isWorn(data, item, 'badge') || isWorn(data, item, 'charm') ? h('span', { className: 'daj-wear-mark' }, isWorn(data, item, 'charm') ? '挂件' : '佩戴中') : null,
              h(Badge, { item: item, theme: themeId(data), size: 76, locked: !owned }), h('strong', null, name.title),
              h('small', null, owned ? date(item.unlockedAt || awardFor(data, item.id).at) : sourceLabel(item)),
              !owned && !modelReport(item) && !concealed(item, data) ? h(Progress, { value: item.progress, target: item.target, label: name.title }) : null);
          })) : h('section', { className: 'daj-card' }, h(Empty, { title: search ? '没有找到这枚成就' : '这一页暂时是空的', action: h(Button, { onClick: function () { setSearch(''); setFilter('all'); } }, '查看全部') }, '可以换一个关键词，或回到全部收藏。')),
          selectedItem ? h(DefinitionDetail, { key: selectedItem.id, item: selectedItem, data: data, busy: props.busy }) : null));
    }

    function ruleSummary(item) {
      const rule = item.rule || {};
      if (rule.template === 'model_report') return '模型依据当前会话记录达成';
      if (rule.template === 'recipe') return '真实动作组合 · ' + (rule.recipe || rule.metric || '组合规则');
      const type = { count: '累计', distinct: '不同足迹', first_seen: '首次遇见' }[rule.template] || '自动规则';
      return type + ' · ' + (METRIC_NAMES[rule.metric] || rule.metric || '未提供指标') + (finite(item.target) ? ' · 目标 ' + exact(item.target) : '');
    }
    function ModelConfiguration(props) {
      const data = props.data;
      const state = props.state;
      const [selectedMetrics, setSelectedMetrics] = useState(null);
      const [count, setCount] = useState(3);
      const [direction, setDirection] = useState('');
      const [style, setStyle] = useState('balanced');
      const [showSummary, setShowSummary] = useState(false);
      const models = activeDefinitions(data).filter(function (item) { return item.source !== 'builtin'; });
      const metrics = array(props.catalog && props.catalog.metrics).filter(function (item) { return item && typeof item.id === 'string' && item.id !== 'recipe'; });
      const metricIds = metrics.map(function (item) { return item.id; });
      const sources = array(props.catalog && props.catalog.capabilities && props.catalog.capabilities.sources);
      const unavailableIds = sources.filter(function (item) { return item && item.connected === false; }).map(function (item) { return item.kind; });
      const availableIds = metricIds.filter(function (id) { return !unavailableIds.includes(id); });
      const selected = selectedMetrics === null ? availableIds : selectedMetrics.filter(function (id) { return availableIds.includes(id); });
      const capability = props.catalog && props.catalog.generation;
      const styles = array(capability && capability.styles).filter(function (item) { return item && GENERATION_STYLES.some(function (choice) { return choice.id === item.id; }); });
      const choices = styles.length ? styles : GENERATION_STYLES;
      const job = state.generationJob;
      const running = runningJob(job), retryBusy = state.busy || state.generationBusy || state.generationLoading || state.debugTransition || state.debugExpired;
      const busy = retryBusy || running || state.generationPending, pendingInput = state.generationPending && pendingGenerationInput();
      const route = capability && capability.route;
      const routeLabel = route && [route.provider, route.model].filter(function (part) { return typeof part === 'string' && part; }).join(' / ');
      function toggleMetric(id) {
        if (!availableIds.includes(id)) return;
        setSelectedMetrics(selected.includes(id) ? selected.filter(function (value) { return value !== id; }) : selected.concat(id));
      }
      return h(React.Fragment, null,
        h(PageHeading, { title: '生成一份自己的成就手记', description: '选好数据来源和风格，让模型分析、生成，并自动应用。' }),
        h('div', { className: 'daj-model-layout' },
          h('section', { className: 'daj-card daj-section daj-model-panel' },
            h('fieldset', { className: 'daj-generation-fieldset', disabled: busy },
              h('legend', null, h('span', null, '1'), '选择数据来源'),
              h('div', { className: 'daj-source-tools' }, h('small', null, '已选 ' + selected.length + ' 项'), h(Button, { className: 'daj-text-button', disabled: busy || !availableIds.length, onClick: function () { setSelectedMetrics(availableIds); } }, '全选'), h(Button, { className: 'daj-text-button', disabled: busy || !selected.length, onClick: function () { setSelectedMetrics([]); } }, '清空')),
              h('div', { className: 'daj-source-grid' }, metrics.map(function (item) {
                const available = availableIds.includes(item.id);
                return h('label', { className: 'daj-source-choice' + (selected.includes(item.id) ? ' daj-selected' : '') + (!available ? ' daj-source-unavailable' : ''), key: item.id },
                  h('input', { id: 'daj-metric-' + item.id, type: 'checkbox', checked: selected.includes(item.id), disabled: busy || !available, onChange: function () { toggleMetric(item.id); } }),
                  h('span', null, h('strong', null, item.label || METRIC_NAMES[item.id] || item.id), h('small', null, available ? METRIC_HINTS[item.id] || '已接入的真实使用记录' : '当前环境不可用')));
              })),
              !metrics.length ? h('p', { className: 'daj-hint' }, props.catalogError ? '数据来源暂时无法读取。' : '正在读取可用的数据来源…') : null),
            h('fieldset', { className: 'daj-generation-fieldset', disabled: busy }, h('legend', null, h('span', null, '2'), '设置数量和方向'),
              h('div', { className: 'daj-direction-row' },
                h('label', { className: 'daj-generation-count' }, h('span', { className: 'daj-field-label' }, '生成数量 · 1–6 项'), h('input', { id: 'daj-generation-count', className: 'daj-direction-input', type: 'number', min: 1, max: 6, step: 1, value: pendingInput && pendingInput.count || count, disabled: busy, onChange: function (event) { if (!busy) setCount(Math.max(1, Math.min(6, Math.trunc(Number(event.target.value)) || 1))); } })),
                h('label', { className: 'daj-grow' }, h('span', { className: 'daj-field-label' }, '方向补充 · 可选'), h('input', { id: 'daj-generation-direction', className: 'daj-direction-input', type: 'text', value: direction, maxLength: 120, disabled: busy, placeholder: '例如：山海问道、城市夜航、星际漫游', onChange: function (event) { setDirection(event.target.value); } })))),
            h('fieldset', { className: 'daj-generation-fieldset', disabled: busy }, h('legend', null, h('span', null, '3'), '选择模板风格'),
              h('div', { className: 'daj-style-grid' }, choices.map(function (choice) {
                return h('label', { key: choice.id, className: 'daj-style-choice' + (style === choice.id ? ' daj-selected' : '') }, h('input', { type: 'radio', name: 'daj-generation-style', value: choice.id, checked: style === choice.id, disabled: busy, onChange: function () { setStyle(choice.id); } }), h('strong', null, choice.label), h('small', null, choice.description));
              }))),
            capability && capability.available === false ? h('div', { className: 'daj-generation-unavailable', role: 'status' }, capability.reason || '当前没有可用的生成模型。请先在 DSH 中选择模型，再重试。', h(Button, { className: 'daj-text-button', onClick: refreshCatalog }, '重新检查')) : null,
            h(Button, { className: 'daj-primary daj-wide', disabled: state.debugActive || (state.generationPending ? retryBusy : !capability || capability.available !== true || !selected.length || busy), onClick: function () {
              if (state.generationPending) { void startGeneration(); return; }
              const options = { kind: 'achievements', count: count, metrics: selected, theme: themeId(data), style: style };
              if (direction.trim()) options.direction = direction.trim();
              void startGeneration(options);
            } }, h(Icon, { name: 'spark', size: 17 }), state.generationBusy ? '正在启动…' : state.generationPending ? '重试本次生成' : running ? '正在生成…' : state.generationLoading ? '正在同步任务…' : '分析并生成成就'),
            state.debugActive ? h('p', { className: 'daj-hint daj-generation-caption' }, '调试模式不调用模型，可在调试面板快速体验。') : null,
            h('p', { className: 'daj-hint daj-generation-caption' }, routeLabel ? '本次使用' + (capability.routeSource === 'session' ? '当前会话模型' : '默认模型') + ' · ' + routeLabel : '使用当前会话或默认模型。', ' 一次生成会调用模型；校验通过后自动应用，失败不应用。'),
            h(GenerationStatus, { state: state, select: props.select }),
            props.catalogError ? h('div', { className: 'daj-inline-error', role: 'alert' }, props.catalogError, h(Button, { className: 'daj-text-button', onClick: refreshCatalog }, '重试目录')) : null,
            props.catalog ? h('p', { className: 'daj-hint daj-generation-caption' }, '组合经历会根据所选数据自动匹配；用量与次数描述使用经历，不评价工作质量。') : null),
          h('section', { className: 'daj-model-list' },
            h('div', { className: 'daj-section-heading' }, h('h3', null, '模型已配置'), h('span', { className: 'daj-count' }, models.length + ' 项')),
            models.length ? models.map(function (item) {
              const name = presentation(item, data);
              return h('article', { className: 'daj-card daj-model-definition', key: item.id },
                h('div', { className: 'daj-row' }, h(Badge, { item: item, theme: themeId(data), size: 45, locked: !unlocked(item) }), h('div', { className: 'daj-grow' }, h('h3', null, name.title), h('p', null, name.description)), h(Pill, null, sourceLabel(awardFor(data, item.id) || item))),
                unlocked(item) ? h('small', { className: 'daj-muted' }, '已达成 · ' + date(item.unlockedAt)) : concealed(item, data) ? h('small', { className: 'daj-muted' }, '尚未揭晓 · 期待某个自然发生的瞬间') : !modelReport(item) ? h(Progress, { value: item.progress, target: item.target, label: name.title }) : h('small', { className: 'daj-muted' }, '等待会话中的模型核对后记录'),
                h('div', { className: 'daj-row daj-model-footer' }, h('span', { className: 'daj-hint' }, concealed(item, data) ? '惊喜条件暂不展示' : ruleSummary(item)), h(Button, { className: 'daj-text-button', onClick: function () { props.select(item.id); } }, '查看')),
                h(DeleteDefinitionButton, { item: item, data: data, busy: state.busy })); })
              : h('section', { className: 'daj-card daj-model-empty' }, h(Empty, { title: '你的第一份配置，还没到来', icon: 'spark' }, '选择数据和风格，点击生成。实际保存的成就会出现在这里。')),
            h('label', { className: 'daj-summary-toggle' }, h('input', { type: 'checkbox', checked: showSummary, onChange: function (event) { setShowSummary(event.target.checked); } }), '显示当前配置摘要'),
            showSummary ? h('pre', { className: 'daj-config-summary' }, JSON.stringify(models.map(function (item) { return { id: item.id, title: item.title, status: item.status, rule: item.rule, scope: item.scope }; }), null, 2)) : null)));
    }
    function GenerationStatus(props) {
      const state = props.state, job = state.generationJob;
      const pending = state.generationPending && pendingGenerationInput();
      const characterJob = job && (job.kind === 'characters' || array(job.createdCharacterIds).length > 0);
      const labels = { analyzing: characterJob ? '分析角色主题' : '分析使用记录', generating: characterJob ? '创作主题角色' : '生成成就规则', applying: characterJob ? '校验并加入卡池' : '校验并自动应用', done: '处理完成' };
      const running = runningJob(job);
      const createdIds = array(job && (characterJob ? job.createdCharacterIds : job.createdDefinitionIds));
      const readyId = createdIds.find(function (id) { const item = characterJob ? characterFor(state.data, id) : definitionFor(state.data, id); return item && (characterJob ? item.theme === themeId(state.data) : item.status !== 'archived'); });
      const deletedResults = !characterJob && createdIds.length > 0 && createdIds.every(function (id) { const item = definitionFor(state.data, id); return item && item.status === 'archived'; });
      return h(React.Fragment, null,
        job ? h('section', { className: 'daj-generation-status daj-generation-' + job.status, role: 'status', 'aria-live': 'polite', 'aria-atomic': true },
          h('div', { className: 'daj-row' }, h(Icon, { name: job.status === 'succeeded' ? 'check' : job.status === 'failed' ? 'flag' : 'spark', size: 18 }), h('strong', { className: 'daj-grow' }, running ? labels[job.stage] || '生成任务进行中' : job.status === 'succeeded' ? characterJob ? '已生成并加入卡池 ' + createdIds.length + ' 位角色' : '已生成并应用 ' + createdIds.length + ' 项成就' : job.status === 'cancelled' ? '已取消本次生成' : '本次生成未完成'),
            running ? h(Button, { className: 'daj-text-button', disabled: state.generationBusy || job.stage === 'applying', onClick: function () { void cancelGeneration(); } }, job.stage === 'applying' ? '正在应用' : '取消生成') : null),
          running ? h('div', { className: 'daj-job-progress', role: 'progressbar', 'aria-label': '成就生成进度', 'aria-valuetext': labels[job.stage] || job.message || '正在处理' }, h('i')) : null,
          job.message ? h('p', null, job.message) : null,
          job.status === 'succeeded' && createdIds.length ? h(Button, { className: 'daj-text-button', disabled: !readyId, onClick: function () { if (!readyId) return; if (characterJob) { if (props.selectCharacter) props.selectCharacter(readyId); else openCenter('characters'); } else props.select(readyId); } }, readyId ? characterJob ? '查看新角色' : '查看新成就' : deletedResults ? '相关成就已删除' : characterJob && createdIds.some(function (id) { return characterFor(state.data, id); }) ? '切换至对应主题后查看' : '正在同步新记录…', h(Icon, { name: 'chevron', size: 12 })) : null,
          finite(job.totalTokens) ? h('small', null, '本次生成模型用量 · ' + exact(job.totalTokens) + ' token') : null) : null,
        state.generationError || pending ? h('div', { className: 'daj-inline-error', role: 'alert' }, h('span', null, state.generationError || '生成启动结果尚未确认。'),
          pending ? h('p', null, '正在确认原' + (pending.kind === 'characters' ? '角色生成' : '成就生成' + (pending.count ? ' · ' + pending.count + ' 项' : '')) + '（' + (THEMES[pending.theme] && THEMES[pending.theme].name || pending.theme) + '）。参数暂时锁定，重试沿用原请求，不会另开任务。') : null,
          h(Button, { className: 'daj-text-button', disabled: state.generationBusy || state.busy || state.debugActive || state.debugTransition || state.debugExpired, onClick: function () { if (pending) void startGeneration(); else void refreshGeneration(job && job.id); } }, pending ? '重试原生成请求' : '重试任务同步')) : null);
    }

    function History(props) {
      const data = props.data, t = theme(data);
      const [filter, setFilter] = useState('all');
      const entries = array(data.timeline).filter(function (item) { return filter === 'all' || item.kind === filter; }).slice().sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
      return h(React.Fragment, null,
        h(PageHeading, { title: t.history, description: '不只是一串数字，也是一路走来的小小回响。' }),
        h('div', { className: 'daj-filters' }, [['all', '全部经历'], ['unlock', '获得成就'], ['level', '成长阶段']].map(function (entry) {
          return h(Button, { key: entry[0], className: 'daj-chip' + (filter === entry[0] ? ' daj-selected' : ''), 'aria-pressed': filter === entry[0], onClick: function () { setFilter(entry[0]); } }, entry[1]);
        })),
        h('div', { className: 'daj-history-layout' },
          entries.length ? h('ol', { className: 'daj-timeline' }, entries.map(function (entry) {
            const item = allAwards(data).find(function (award) { return award.id === entry.awardId; }) || definitionFor(data, entry.definitionId);
            const deleted = definitionFor(data, entry.definitionId) && definitionFor(data, entry.definitionId).status === 'archived';
            return h('li', { key: entry.id, className: 'daj-history-entry' }, h('time', { dateTime: entry.at }, date(entry.at, true)),
              h('div', { className: 'daj-card daj-history-card' }, entry.kind === 'unlock' ? h(Badge, { item: item || entry, theme: themeId(data), size: 50 }) : h('span', { className: 'daj-history-level' }, h(Icon, { name: 'star', size: 24 })),
                h('div', { className: 'daj-grow' }, h('h3', null, item ? presentation(item, data).title : entry.title || '新的成长阶段'), h('p', null, entry.kind === 'unlock' ? '获得一枚成就 · ' + sourceLabel(entry) : '等级提升 · ' + (finite(entry.level) ? exact(entry.level) + ' 阶' : '新的积累'))),
                item && entry.definitionId && !deleted ? h(Button, { className: 'daj-icon-button', 'aria-label': '查看成就详情', onClick: function () { props.select(entry.definitionId); } }, h(Icon, { name: 'chevron', size: 16 })) : deleted ? h(Pill, null, '已获记录保留') : null),
              deleted && item && item.description ? h('p', { className: 'daj-history-preserved' }, presentation(item, data).description) : null);
          })) : h('section', { className: 'daj-card' }, h(Empty, { title: '还没有这一类记录', icon: 'history' }, '第一枚成就或新的成长阶段到来后，会在这里留下日期。')),
          h('aside', { className: 'daj-card daj-section daj-history-summary' }, h('h3', null, '已写下的日常'), h('div', { className: 'daj-small-metrics' },
            [['完成回合', data.totals.turns], ['文件阅读', data.totals.fileReads], ['文件变更', data.totals.fileChanges], ['探索格式', data.totals.formats], ['技能足迹', data.totals.skills], ['协作经历', data.totals.delegations]].map(function (entry) { return h('div', { key: entry[0] }, h('strong', null, exact(entry[1])), h('span', null, entry[0])); })),
            h('p', { className: 'daj-hint' }, '手记始于 ' + date(data.createdAt) + '。未导入既往会话；这里记录的是接入后的真实经历。'))));
    }

    function PreferencesPanel(props) {
      const data = props.data, pref = data.preferences;
      const charms = array(props.catalog && props.catalog.equipment && props.catalog.equipment.charms);
      const equippedCharm = data.equipment && charmFor(data, data.equipment.charm) ? data.equipment.charm : null;
      return h('section', { className: 'daj-preferences', 'aria-label': '主题与反馈设置' },
        h(DebugPanel),
        h(FrameSettings, { data: data, busy: props.busy, idPrefix: props.idPrefix }),
        charms.length ? h('div', { className: 'daj-preference-row' }, h('label', { htmlFor: props.idPrefix + '-charm' }, h('strong', null, '随身挂件'), h('small', null, '选一件小装饰，也可以从收藏里佩戴已获得的成就。')),
          h('select', { id: props.idPrefix + '-charm', value: equippedCharm || 'none', disabled: props.busy, onChange: function (event) { void mutate('/equip', { id: event.target.value, slot: 'charm', equipped: event.target.value !== 'none' }); } },
            h('option', { value: 'none' }, '暂不佩戴'), charms.map(function (id) { return h('option', { key: id, value: id }, CHARM_NAMES[id] || id); }),
            equippedCharm && !charms.includes(equippedCharm) ? h('option', { value: equippedCharm }, presentation(charmFor(data, equippedCharm), data).title) : null)) : null,
        h('div', { className: 'daj-preference-row' }, h('label', { htmlFor: props.idPrefix + '-notifications' }, h('strong', null, '成长反馈'), h('small', null, '短时间的多个进度会合并，成就解锁优先。')),
          h('select', { id: props.idPrefix + '-notifications', value: pref.notifications || 'all', disabled: props.busy, onChange: function (event) { void preferences({ notifications: event.target.value }); } },
            h('option', { value: 'all' }, '进度与成就'), h('option', { value: 'unlocks' }, '仅成就与升级'), h('option', { value: 'off' }, '关闭反馈'))),
        h('div', { className: 'daj-preference-row' }, h('label', { htmlFor: props.idPrefix + '-motion' }, h('strong', null, '动画表现'), h('small', null, '减少动画时保留静态提示，不播放烟花。')),
          h('select', { id: props.idPrefix + '-motion', value: pref.reducedMotion || 'system', disabled: props.busy, onChange: function (event) { void preferences({ reducedMotion: event.target.value }); } },
            h('option', { value: 'system' }, '跟随系统'), h('option', { value: 'reduce' }, '减少动画'), h('option', { value: 'full' }, '完整动画'))),
        h('div', { className: 'daj-preference-row' }, h('div', null, h('strong', null, '看看轻庆祝'), h('small', null, '仅本地预览，不增加用量或获得记录。')), h(Button, { onClick: previewFeedback }, '预览效果')));
    }
    function useDialogFocus(ref, onClose) {
      const close = useRef(onClose); close.current = onClose;
      useEffect(function () {
        const previous = document.activeElement;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const target = ref.current;
        if (target) target.focus();
        function keydown(event) {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
          if (event.key !== 'Tab' || !target) return;
          const controls = Array.from(target.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(function (element) { return element.getClientRects().length; });
          if (!controls.length) { event.preventDefault(); target.focus(); return; }
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || !target.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || !target.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        }
        document.addEventListener('keydown', keydown, true);
        return function () {
          document.removeEventListener('keydown', keydown, true);
          document.body.style.overflow = overflow;
          if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
        };
      }, []);
    }
    function Center(props) {
      const state = props.state;
      const data = state.data;
      const panel = useRef(null);
      const body = useRef(null);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [selection, setSelection] = useState(null);
      useDialogFocus(panel, function () { if (settingsOpen) setSettingsOpen(false); else closeCenter(); });
      useEffect(function () { if (body.current) body.current.scrollTop = 0; }, [state.tab, settingsOpen, themeId(data)]);
      useEffect(function () { if (state.debugPanelRequest) { setSettingsOpen(true); if (body.current) body.current.scrollTop = 0; } }, [state.debugPanelRequest]);
      useEffect(function () { if (state.closeSettingsRequest) setSettingsOpen(false); }, [state.closeSettingsRequest]);
      const t = theme(data);
      function navigate(tab) { publish({ tab: tab }); }
      function select(id) { setSelection(id); navigate('collection'); }
      return h('div', { className: 'daj-backdrop' + (state.debugActive || state.debugTransition ? ' daj-debug-backdrop' : ''), onMouseDown: function (event) { if (event.target === event.currentTarget) closeCenter(); } },
        h('section', { className: 'daj-surface daj-center', 'data-daj-theme': themeId(data), 'data-daj-reduce': reducedMotion(data) ? 'true' : 'false', ref: panel, role: 'dialog', 'aria-modal': true, 'aria-label': '成就手记', tabIndex: -1 },
          h('header', { className: 'daj-center-header' }, h('div', { className: 'daj-brand' }, h(Icon, { name: 'medal', size: 20 }), h('strong', null, '成就手记'), h('span', null, '留给自己的每一步')),
            h('div', { className: 'daj-header-actions' },
              data ? h('label', { className: 'daj-theme-select' }, h('span', null, '主题'), h('select', { id: 'daj-global-theme', value: themeId(data), disabled: state.busy || state.drawPending || state.drawRetry, title: state.drawPending || state.drawRetry ? '请先确认这次十连结果，再切换主题' : '切换全部页面的主题', 'aria-label': '成就主题', onChange: function (event) { void preferences({ theme: event.target.value }); } }, Object.keys(THEMES).map(function (id) { return h('option', { key: id, value: id }, THEMES[id].name); }))) : null,
              h(Button, { className: 'daj-icon-button', 'aria-label': '主题与反馈设置', 'aria-expanded': settingsOpen, onClick: function () { setSettingsOpen(!settingsOpen); } }, h(Icon, { name: 'settings', size: 18 })),
              h(Button, { className: 'daj-icon-button', 'aria-label': '关闭成就手记', onClick: closeCenter }, h(Icon, { name: 'close', size: 19 })))),
          h('nav', { className: 'daj-tabs', 'aria-label': '成就页面' }, TAB_IDS.map(function (id, index) {
            return h('button', { type: 'button', key: id, className: state.tab === id ? 'daj-active-tab' : '', 'aria-current': state.tab === id ? 'page' : undefined, onClick: function () { navigate(id); } }, t.tabs[index]);
          })),
          h('div', { className: 'daj-center-body', ref: body },
            state.error ? h('div', { className: 'daj-error-banner', role: 'alert' }, h('span', null, state.error + (data ? ' 当前显示上次同步的记录。' : '')), h(Button, { onClick: refresh }, '重新连接')) : null,
            state.actionError ? h('div', { className: 'daj-error-banner', role: 'alert' }, h('span', null, state.actionError), h(Button, { className: 'daj-icon-button', 'aria-label': '收起操作错误', onClick: function () { publish({ actionError: null }); } }, h(Icon, { name: 'close', size: 14 }))) : null,
            data && data.coverage && data.coverage.complete === false ? h('p', { className: 'daj-coverage-note', role: 'status' }, '部分经历的证据尚不完整，相关进度暂时显示为 —；已确认的记录仍会保留。') : null,
            settingsOpen && data ? h('div', { className: 'daj-card daj-settings-card' }, h('div', { className: 'daj-section-heading' }, h('h3', null, '主题与反馈'), h(Button, { className: 'daj-text-button', onClick: function () { setSettingsOpen(false); } }, '收起')), h(PreferencesPanel, { data: data, catalog: state.catalog, busy: state.busy, idPrefix: 'daj-center' })) : null,
            data ? h('div', { className: 'daj-page' },
              state.tab === 'overview' ? h(Overview, { data: data, navigate: navigate, select: select }) : null,
              state.tab === 'collection' ? h(Collection, { data: data, busy: state.busy, selected: selection }) : null,
              state.tab === 'model' ? h(ModelConfiguration, { data: data, state: state, catalog: state.catalog, catalogError: state.catalogError, select: select }) : null,
              state.tab === 'history' ? h(History, { data: data, select: select }) : null,
              state.tab === 'characters' ? h(CharactersPage, { key: themeId(data), data: data, state: state }) : null,
              h('footer', { className: 'daj-page-footer' }, h('span', null, h(Icon, { name: 'check', size: 12 }), '个人积累，留在自己的手记里'), h('span', null, state.connected ? '已同步 · ' + date(data.updatedAt, true) : '等待重新连接')))
              : h(Empty, { title: state.loading ? '正在翻开你的手记…' : '暂时还没连接上手记', icon: 'book' }, state.loading ? '正在读取本机已保存的真实记录。' : '请重试连接，或检查插件是否已在宿主中启用。'))));
    }
    function Fireworks() {
      return h('div', { className: 'daj-fireworks', 'aria-hidden': true }, Array.from({ length: 18 }, function (_unused, index) {
        const angle = index * Math.PI * 2 / 18;
        const radius = 42 + index % 3 * 15;
        return h('i', { key: index, style: { '--daj-x': Math.cos(angle) * radius + 'px', '--daj-y': Math.sin(angle) * radius + 'px', '--daj-delay': index % 4 * .045 + 's', '--daj-particle': index % 2 ? 'var(--daj-gold)' : 'var(--daj-accent)' } });
      }));
    }
    function Feedback(props) {
      const state = props.state, feedback = state.toast;
      if (!feedback) return null;
      const data = state.data, t = theme(data);
      const item = allAwards(data).find(function (award) { return award.id === feedback.leader.awardId; }) || definitionFor(data, feedback.leader.definitionId);
      const title = feedback.demo ? feedback.leader.title : item ? presentation(item, data).title : feedback.leader.title || (feedback.kind === 'progress' ? t.progress : t.level);
      const unlocks = feedback.items.filter(function (entry) { return entry.kind === 'unlock'; }).length;
      const progress = feedback.items.filter(function (entry) { return entry.kind === 'progress'; });
      const tokens = progress.reduce(function (sum, entry) { return sum + (finite(entry.tokens) ? entry.tokens : 0); }, 0);
      const turns = progress.reduce(function (sum, entry) { return sum + (finite(entry.turns) ? entry.turns : 0); }, 0);
      const caption = feedback.demo ? '演示效果 · 不写入任何成就或使用记录'
        : unlocks > 1 ? '这次一共收下了 ' + unlocks + ' 枚新成就'
          : feedback.kind === 'progress' ? (turns ? turns + ' 轮完成 · ' : '') + (tokens ? '+' + exact(tokens) + ' token' : '新的经历已记入手记')
            : feedback.items.length > 1 ? '还有 ' + (feedback.items.length - 1) + ' 条新积累，一并收好' : '已经保存在你的手记里';
      return h('aside', { className: 'daj-surface daj-feedback daj-feedback-' + feedback.kind, 'data-daj-theme': themeId(data), 'data-daj-reduce': reducedMotion(data) ? 'true' : 'false', role: 'status', 'aria-live': 'polite', 'aria-atomic': true },
        feedback.kind === 'unlock' && !reducedMotion(data) ? h(Fireworks, { key: feedback.id }) : null,
        feedback.kind === 'progress' ? h('div', { className: 'daj-feedback-mark' }, h(Icon, { name: 'leaf', size: 23 })) : h(Badge, { item: item || feedback.leader, theme: themeId(data), size: 57 }),
        h('div', { className: 'daj-feedback-copy' }, h('small', null, feedback.demo ? '本地预览' : feedback.kind === 'unlock' ? t.unlock : feedback.kind === 'level' ? t.level : t.progress), h('strong', null, title), h('p', null, caption),
          h(Button, { className: 'daj-text-button', onClick: function () { openCenter(feedback.kind === 'unlock' ? 'collection' : 'overview'); clearFeedback(); } }, '打开手记', h(Icon, { name: 'chevron', size: 11 }))),
        h(Button, { className: 'daj-icon-button daj-feedback-close', 'aria-label': '关闭成长反馈', onClick: clearFeedback }, h(Icon, { name: 'close', size: 14 })));
    }
    function GlobalSurface() {
      const state = useJournal();
      const token = useRef(null);
      if (!token.current) token.current = 'surface-' + ++nextSurface;
      useEffect(function () {
        surfaceOwners.add(token.current);
        publish({ owner: surfaceOwners.values().next().value });
        return function () {
          surfaceOwners.delete(token.current);
          publish({ owner: surfaceOwners.values().next().value || null });
        };
      }, []);
      if (state.owner !== token.current) return null;
      return createPortal(h(React.Fragment, null,
        h(DebugBanner, { state: state }),
        state.open ? h(Center, { state: state }) : null,
        h(Feedback, { state: state }),
        state.notice ? h('div', { className: 'daj-notice', role: 'status', 'aria-live': 'polite' }, state.notice) : null), document.body);
    }
    function SidebarEntry(props) {
      const state = useJournal(), data = state.data;
      const frame = frameSettings(data);
      const narrow = props.wide === false;
      return h(React.Fragment, null,
        h('button', { type: 'button', className: 'daj-surface daj-profile-strip' + (narrow ? ' daj-profile-narrow' : ''), style: { height: narrow ? '22px' : frame.frameHeight + 'px' }, 'data-daj-theme': themeId(data), 'data-daj-reduce': reducedMotion(data) ? 'true' : 'false', title: '打开成就手记 · 点击更换当前角色', 'aria-label': '打开成就手记', onClick: function () { openCenter(visibleEquippedCharacter(data) ? 'characters' : 'overview'); } },
          narrow ? h(Icon, { name: 'medal', size: 17 }) : h(ProfileFrame, { data: data, settings: frame, fit: true, interactive: true })),
        h(GlobalSurface));
    }
    function SettingsSection() {
      const state = useJournal(), data = state.data;
      return h('section', { className: 'daj-surface daj-settings', 'data-daj-theme': themeId(data), 'data-daj-reduce': reducedMotion(data) ? 'true' : 'false' },
        h('div', { className: 'daj-settings-intro' }, h('div', null, h('h3', null, '成就手记'), h('p', null, '自然积累使用经历，收藏勋章，留下自己的成长轨迹。')), h(Button, { className: 'daj-primary', onClick: function () { openCenter('overview'); } }, '打开成就中心', h(Icon, { name: 'chevron', size: 13 }))),
        state.error ? h('p', { className: 'daj-inline-error', role: 'alert' }, state.error, ' ', h(Button, { className: 'daj-text-button', onClick: refresh }, '重试')) : null,
        state.actionError ? h('p', { className: 'daj-inline-error', role: 'alert' }, state.actionError) : null,
        data ? h(React.Fragment, null,
          h('p', { className: 'daj-current-theme' }, '当前主题 · ' + theme(data).name + '。在成就中心顶部统一切换。'),
          h(PreferencesPanel, { data: data, catalog: state.catalog, busy: state.busy, idPrefix: 'daj-settings' }),
          h('p', { className: 'daj-hint' }, '从接入时开始记录；尚未提供历史会话导入。' + (data.storage && data.storage.warning ? ' ' + data.storage.warning : '')),
          data.coverage && data.coverage.notes ? h('p', { className: 'daj-hint' }, array(data.coverage.notes).join('；')) : null)
          : h('p', { className: 'daj-muted' }, state.loading ? '正在读取本机成就记录…' : '恢复连接后可调整设置。'),
        h(GlobalSurface));
    }

    function apply(ctx) {
      clientContext = ctx;
      active = true; generation += 1;
      modeSwitching = false;
      try {
        const savedDebug = window.sessionStorage.getItem('dsh-achievement-journal.debug');
        debugToken = typeof savedDebug === 'string' && /^[A-Za-z0-9_.:-]{1,512}$/.test(savedDebug) ? savedDebug : null;
      } catch (_error) { /* Preserve an in-memory debug scope when storage is unavailable. */ }
      try {
        const savedGeneration = window.sessionStorage.getItem('dsh-achievement-journal.generation-start');
        pendingGenerationBody = typeof savedGeneration === 'string' && savedGeneration.length <= 8192 && validPendingGeneration(JSON.parse(savedGeneration)) ? savedGeneration : null;
      } catch (_error) { /* Keep the exact in-memory request when storage is unavailable. */ }
      snapshot = initialState();
      try {
        const savedDraw = JSON.parse(window.sessionStorage.getItem('dsh-achievement-journal.draw') || 'null');
        if (savedDraw && (savedDraw.scope || 'real') === (debugToken || 'real') && typeof savedDraw.id === 'string' && savedDraw.id.length <= 256 && THEMES[savedDraw.theme]) { pendingDrawId = savedDraw.id; pendingDrawTheme = savedDraw.theme; }
      } catch (_error) { /* Browser storage can be unavailable. */ }
      snapshot.drawRetry = Boolean(pendingDrawId); snapshot.drawTheme = pendingDrawTheme;
      actionCount = 0; needsBaseline = true; baselineRefreshPending = false; journalIdentity = null;
      seenNotifications.clear(); surfaceOwners.clear();
      const style = document.createElement('style');
      style.dataset.dshAchievementJournal = 'true';
      style.textContent = STYLE;
      document.head.appendChild(style);
      const disposers = [];
      function slot(name, id, order, component, options) {
        const dispose = ctx.slots.inject(name, function () { return ctx.slots.register(Object.assign({ name: name, id: id, order: order }, options || {}), component); });
        if (typeof dispose === 'function') disposers.push(dispose);
      }
      slot('settings.section', 'dsh-achievement-journal', 210, SettingsSection, { label: '成就手记' });
      slot('sidebar.footer.action', 'dsh-achievement-journal-entry', 9990, SidebarEntry);
      if (typeof window.matchMedia === 'function') {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const motion = function () { publish({ motionVersion: snapshot.motionVersion + 1 }); };
        if (typeof media.addEventListener === 'function') { media.addEventListener('change', motion); disposers.push(function () { media.removeEventListener('change', motion); }); }
        else if (typeof media.addListener === 'function') { media.addListener(motion); disposers.push(function () { media.removeListener(motion); }); }
      }
      try {
        const service = optionalClientService('uiSession');
        const source = service && service.adapter && service.adapter.current;
        if (source && typeof source.subscribe === 'function') {
          const unsubscribe = source.subscribe(function () {
            const pending = catalogFlight;
            if (pending) void pending.then(function () { if (active) void refreshCatalog(); });
            else void refreshCatalog();
          });
          if (typeof unsubscribe === 'function') disposers.push(unsubscribe);
        }
      } catch (_error) { /* The backend can use the configured default model. */ }
      function visibility() {
        refreshBaseline();
      }
      function reconnect() { refreshBaseline(); }
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('online', reconnect);
      void refresh(); void refreshCatalog(); void refreshGeneration();
      ctx.effect(function () { return function () {
        active = false; generation += 1;
        clearTimeout(timer); clearTimeout(noticeTimer); clearTimeout(generationTimer); clearFeedback();
        controllers.forEach(function (controller) { controller.abort(); }); controllers.clear();
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('online', reconnect);
        disposers.forEach(function (dispose) { dispose(); });
        style.remove();
        listeners.clear(); surfaceOwners.clear(); seenNotifications.clear(); staticArtCache.clear();
        flight = null; catalogFlight = null; generationFlight = null; clientContext = null; actionCount = 0;
      }; }, 'dsh-achievement-journal client cleanup');
    }
    return { inject: ['slots'], apply: apply };
  },
});
