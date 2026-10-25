import { createHash } from 'node:crypto';

const DEFAULT_LIMITS = Object.freeze({ turns: 64, events: 4096, calls: 1024, paths: 256, steps: 512, runs: 128, queue: 2048 });
const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'];
const FALLBACK_FORMATS = Object.freeze({ ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', py: 'python', go: 'go', rs: 'rust', java: 'java', json: 'json', md: 'markdown', markdown: 'markdown', yaml: 'yaml', yml: 'yaml', toml: 'toml', css: 'css', html: 'html', sh: 'bash', ps1: 'powershell', sql: 'sql' });
const sha = value => createHash('sha256').update(String(value)).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.length > 0;
const absolute = value => text(value) && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value));

/**
 * Read-only bridge for DSH 0.2.1-rc.2. No raw message, file, skill, command or
 * provider text is retained in the journal. Coverage starts at a fresh turn
 * observed after start(); attaching to a running turn never reconstructs it.
 *
 * deriveTurnUsage/languageForPath are optional integration-test seams. Normal
 * operation loads the host's public token-meter helper and language table.
 */
export function createCollector({ ctx, ingest, hashKey = sha, clock = Date.now, deriveTurnUsage, languageForPath, limits = {} } = {}) {
  if (!ctx || typeof ctx.on !== 'function' || typeof ingest !== 'function') throw new TypeError('collector requires ctx.on and ingest');
  const cap = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [key, count(limits[key]) && limits[key] > 0 ? limits[key] : fallback]));
  const turns = new Map();
  const lastSeq = new WeakMap();
  const runs = new Map();
  const lifetime = new AbortController();
  const disposers = [];
  const counters = { events: 0, facts: 0, deliveredFacts: 0, ignoredPartial: 0, ignoredInherited: 0, duplicates: 0, malformed: 0, observerErrors: 0, ingestErrors: 0, failedFacts: 0, droppedQueue: 0, boundedDrops: 0, unknownUsage: 0, unownedDelegations: 0, abandonedTurns: 0 };
  let usageHelper = deriveTurnUsage;
  let language = languageForPath;
  let tail = Promise.resolve();
  let pending = 0;
  let startedAt = null;
  let started = false;
  let disposed = false;
  let startPromise;
  let disposePromise;
  let sessionSubscribed = false;
  let resultSubscribed = false;
  let delegationSubscribed = false;

  function h(namespace, value) {
    const input = JSON.stringify([namespace, value]);
    let output;
    try { output = hashKey(input); } catch { output = sha(input); }
    if (typeof output !== 'string' || !/^[A-Za-z0-9:_-]{8,192}$/.test(output)) output = sha(input);
    return `${namespace}:${output}`;
  }
  function service(name) {
    try { const found = ctx.get?.(name); if (found !== undefined) return found; } catch { /* optional service may be absent */ }
    try { return ctx[name]; } catch { return undefined; }
  }
  function time(value) {
    if (count(value)) return value;
    let now;
    try { now = clock(); } catch { now = Date.now(); }
    return count(now) ? now : Date.now();
  }
  function directory(session) {
    try {
      const current = service('workingDirectory')?.get?.(session);
      return absolute(current) ? current : (absolute(session?.header?.cwd) ? session.header.cwd : undefined);
    } catch { return absolute(session?.header?.cwd) ? session.header.cwd : undefined; }
  }
  function contextFor(agentOrSession) {
    const session = agentOrSession?.session ?? agentOrSession;
    if (!text(session?.id)) return {};
    // Changing the execution directory does not move the Session's project.
    const project = absolute(session.header?.cwd) ? session.header.cwd : directory(session);
    return { sessionId: h('session', session.id), ...(project === undefined ? {} : { workspaceKey: h('workspace', project) }) };
  }
  function enqueue(work) {
    if (pending >= cap.queue) { counters.droppedQueue++; return false; }
    pending++;
    tail = tail.then(work).catch(() => { counters.observerErrors++; }).finally(() => { pending--; });
    return true;
  }
  async function deliver(facts) {
    if (!facts.length) return;
    counters.facts += facts.length;
    try { await ingest(facts, { source: 'runtime_observed' }); counters.deliveredFacts += facts.length; }
    catch { counters.ingestErrors++; counters.failedFacts += facts.length; }
  }
  function fact(turn, kind, identity, at, extra = {}, evidence = {}) {
    return {
      id: h('fact', [turn.sessionId, turn.startSeq, identity, kind, extra.key ?? '']),
      kind, at: time(at), sessionId: turn.sessionId, turnKey: turn.turnKey,
      ...(turn.workspaceKey === undefined ? {} : { workspaceKey: turn.workspaceKey }),
      ...extra, evidence,
    };
  }
  function addBounded(map, key, value) {
    if (map.has(key)) return false;
    if (map.size >= cap.paths) { counters.boundedDrops++; return false; }
    map.set(key, value);
    return true;
  }
  function position(turn, step, identity) { return { step, key: h('evidence', [turn.turnKey, identity]) }; }
  const before = (left, right) => left && count(left.step) && count(right.step) && left.step < right.step;
  function recipe(turn, name, evidenceKeys) {
    if (!turn.recipes.has(name)) turn.recipes.set(name, evidenceKeys.slice(0, 4));
  }
  function format(path) {
    let result;
    try { result = typeof language === 'function' ? language(path) : undefined; } catch { /* conservative fallback */ }
    if (!text(result)) {
      const base = path.replaceAll('\\', '/').split('/').at(-1);
      result = FALLBACK_FORMATS[base?.split('.').at(-1)?.toLowerCase()];
    }
    return typeof result === 'string' && /^[a-z][a-z0-9_+-]{0,40}$/.test(result) ? result : undefined;
  }
  function evidence(source, eventSeq, callId, step) {
    return { source, ...(count(eventSeq) ? { eventSeq } : {}), ...(callId ? { callKey: h('call', callId) } : {}), ...(count(step) ? { step } : {}) };
  }
  function active(session) {
    const current = text(session?.id) ? turns.get(session.id) : undefined;
    return current?.session === session && !current.closed ? current : undefined;
  }
  function cleanTurn(turn) {
    for (const dispose of turn.scopedDisposers) { try { dispose(); } catch { counters.observerErrors++; } }
    turn.scopedDisposers.length = 0;
    for (const runId of turn.runIds) runs.delete(runId);
    turn.runIds.clear();
    if (turns.get(turn.rawId) === turn) turns.delete(turn.rawId);
  }
  function subscribe(onCtx, name, fn, owner = disposers) {
    try {
      const dispose = onCtx.on(name, (...args) => {
        if (disposed) return;
        try { fn(...args); } catch { counters.observerErrors++; }
      });
      if (typeof dispose === 'function') owner.push(dispose);
      return true;
    } catch { counters.observerErrors++; return false; }
  }
  function bindParent(turn) {
    const agent = service('agents')?.get?.(turn.rawId);
    if (!agent?.ctx || agent.ctx === ctx) return;
    subscribe(agent.ctx, 'subagent/start', info => onDelegateStart(info, turn), turn.scopedDisposers);
    subscribe(agent.ctx, 'subagent/end', onDelegateEnd, turn.scopedDisposers);
  }
  function onDelegateStart(info, attributedTurn) {
    if (!text(info?.runId) || !text(info.id)) return;
    if (runs.has(info.runId)) return;
    let turn = attributedTurn;
    if (!turn) {
      let initiator;
      try { initiator = service('agents')?.currentInitiator?.(); } catch { /* missing initiator */ }
      turn = active(initiator?.session);
    }
    if (!turn || turn.closed || turns.get(turn.rawId) !== turn) { counters.unownedDelegations++; return; }
    if (turn.runIds.size >= cap.runs) { counters.boundedDrops++; return; }
    runs.set(info.runId, { turn, childKey: h('child', info.id) });
    turn.runIds.add(info.runId);
  }
  function onDelegateEnd(info) {
    if (!text(info?.runId)) return;
    const owned = runs.get(info.runId);
    if (!owned) return;
    runs.delete(info.runId);
    owned.turn.runIds.delete(info.runId);
    const { turn, childKey } = owned;
    if (turn.closed || info.stopReason?.kind !== 'completed' || childKey !== h('child', info.id)) return;
    const step = turn.currentStep;
    const at = time(clock());
    const pos = position(turn, step, ['delegate', info.runId]);
    enqueue(async () => {
      addBounded(turn.delegates, childKey, pos);
      await deliver([fact(turn, 'delegate_completed', ['delegate', info.runId], at, { key: childKey, ...(count(step) ? { step } : {}) }, evidence('subagent/end', undefined, info.runId, step))]);
    });
  }
  function usageCopy(value) {
    if (!object(value)) return undefined;
    return Object.fromEntries(USAGE_FIELDS.filter(key => Object.hasOwn(value, key)).map(key => [key, typeof value[key] === 'number' ? value[key] : NaN]));
  }
  function tokenEvent(event) {
    const { type, seq, time: at, data } = event;
    if (!['turn/start', 'turn/end', 'step/start', 'step/end', 'llm/retry', 'llm/retry-started', 'assistant/message', 'assistant/attempt'].includes(type)) return undefined;
    const output = { type, seq, time: at, data: { turn: data.turn, ...(count(data.step) ? { step: data.step } : {}) } };
    if (type === 'turn/end') output.data.reason = { kind: data.reason?.kind };
    if (type.startsWith('assistant/')) {
      let sample;
      if (Array.isArray(data.stream)) for (const record of data.stream) if (record?.type === 'chunk' && record.chunk?.type === 'usage') sample = usageCopy(record.chunk.usage);
      output.data.stream = sample ? [{ type: 'chunk', time: at, chunk: { type: 'usage', usage: sample } }] : [];
      if (type === 'assistant/message') {
        const reported = usageCopy(data.usage);
        if (reported) output.data.usage = reported;
        const source = data.message?.source;
        output.data.message = { source: { provider: text(source?.provider) ? h('provider', source.provider) : '', model: text(source?.model) ? h('model', source.model) : '' } };
      }
    }
    return output;
  }
  function finish(turn, event) {
    turn.closed = true;
    cleanTurn(turn);
    const natural = !turn.invalid && event.data.reason?.kind === 'completed' && turn.steps.size > 0
      && [...turn.steps.values()].every(step => step.ended) && [...turn.steps.values()].some(step => step.normalMessage);
    enqueue(async () => {
      const facts = [];
      let usage;
      if (!turn.tokensTruncated && typeof usageHelper === 'function') {
        try { usage = usageHelper(turn.tokenEvents); } catch { /* unknown accounting */ }
      }
      const tokenEvidence = evidence('session/event', event.seq);
      if (usage && count(usage.totalTokens)) {
        tokenEvidence.usage = Object.fromEntries(['uncachedInputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].filter(key => count(usage[key])).map(key => [key, usage[key]]));
        facts.push(fact(turn, 'tokens', 'tokens', event.time, { amount: usage.totalTokens }, tokenEvidence));
      } else { counters.unknownUsage++; facts.push(fact(turn, 'tokens', 'tokens', event.time, {}, tokenEvidence)); }
      if (natural) {
        facts.push(fact(turn, 'turn_completed', ['turn', event.seq], event.time, {}, evidence('session/event', event.seq)));
        for (const [name, keys] of turn.recipes) facts.push(fact(turn, 'recipe', ['recipe', name], event.time, { key: name }, { ...evidence('session/event', event.seq), evidenceKeys: keys }));
      }
      await deliver(facts);
      turn.tokenEvents.length = 0;
      turn.calls.clear(); turn.settled.clear(); turn.reads.clear(); turn.searchedReads.clear(); turn.changes.clear(); turn.searches.clear(); turn.skills.clear(); turn.recalls.clear(); turn.delegates.clear(); turn.recipes.clear(); turn.steps.clear();
    });
  }
  function sessionEvent(session, event) {
    if (!session || !text(session.id) || !object(event) || !count(event.seq) || !object(event.data)) { counters.malformed++; return; }
    counters.events++;
    if (count(session.inheritedEventCount) && event.seq < session.inheritedEventCount) { counters.ignoredInherited++; return; }
    const previous = lastSeq.get(session);
    if (previous !== undefined && event.seq <= previous) { counters.duplicates++; return; }
    lastSeq.set(session, event.seq);
    if (event.type === 'turn/start') {
      if (!count(event.data.turn)) { counters.malformed++; return; }
      const old = active(session);
      if (old) { old.closed = true; cleanTurn(old); counters.abandonedTurns++; }
      if (turns.size >= cap.turns) { counters.boundedDrops++; return; }
      const binding = contextFor(session);
      const turn = {
        ...binding, session, rawId: session.id, number: event.data.turn, startSeq: event.seq,
        turnKey: h('turn', [binding.sessionId, event.seq]), currentStep: undefined, closed: false, invalid: false, tokensTruncated: false,
        tokenEvents: [], steps: new Map(), calls: new Map(), settled: new Set(), reads: new Map(), searchedReads: new Map(), changes: new Map(), searches: new Map(), skills: new Map(), recalls: new Map(), delegates: new Map(), recipes: new Map(), runIds: new Set(), scopedDisposers: [],
      };
      turns.set(session.id, turn); bindParent(turn);
    }
    const turn = active(session);
    if (!turn) { counters.ignoredPartial++; return; }
    const data = event.data;
    if (count(data.turn) && data.turn !== turn.number) { counters.malformed++; turn.invalid = true; return; }
    const framed = tokenEvent(event);
    if (framed) {
      if (turn.tokenEvents.length < cap.events) turn.tokenEvents.push(framed);
      else { turn.tokensTruncated = true; counters.boundedDrops++; }
    }
    if (event.type === 'step/start') {
      if (!count(data.step) || turn.currentStep !== undefined || turn.steps.has(data.step) || turn.steps.size >= cap.steps) { turn.invalid = true; return; }
      turn.currentStep = data.step; turn.steps.set(data.step, { ended: false, normalMessage: false });
    } else if (event.type === 'step/end') {
      const step = turn.steps.get(data.step);
      if (!step || step.ended || turn.currentStep !== data.step) turn.invalid = true;
      else { step.ended = true; turn.currentStep = undefined; }
    } else if (event.type === 'assistant/message') {
      const step = turn.steps.get(data.step);
      if (!step || turn.currentStep !== data.step) turn.invalid = true;
      else if (data.interrupted !== true) step.normalMessage = true;
      const route = data.message?.source;
      if (step && count(data.step) && data.interrupted !== true && text(route?.provider) && text(route.model)) {
        const key = h('route', [route.provider, route.model]);
        enqueue(() => deliver([fact(turn, 'route_used', ['route', event.seq], event.time, { key, step: data.step }, evidence('session/event', event.seq, undefined, data.step))]));
      }
    } else if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') {
      const id = event.type === 'tool/call' ? data.callId : data.subCallId;
      if (text(id) && turn.calls.size < cap.calls) turn.calls.set(id, { name: data.name, step: turn.currentStep, seq: event.seq, cwd: directory(session) });
      else counters.boundedDrops++;
    } else if (event.type === 'tool/result' || event.type === 'tool/ptc-dispatch') {
      const isPtc = event.type === 'tool/ptc-dispatch';
      const id = isPtc ? data.subCallId : data.message?.source?.callId;
      const call = turn.calls.get(id);
      if (call) toolResult(turn, call, id, { isError: isPtc ? data.isError : Boolean(data.error || data.message?.isError), meta: data.meta }, event.time, 'session/event', event.seq);
    } else if (event.type === 'user/message') {
      const source = data.source;
      const step = turn.currentStep;
      if (source?.kind === 'skill-invocation' && source.form === 'instructions' && text(source.name)) {
        const key = h('skill', source.name);
        enqueue(async () => { if (!addBounded(turn.skills, key, position(turn, step, event.seq))) return; await deliver([fact(turn, 'skill_loaded', ['skill-message', event.seq], event.time, { key, ...(count(step) ? { step } : {}) }, evidence('session/event', event.seq, undefined, step))]); });
      } else if (source?.kind === 'session-reference' && source.form === 'recall' && source.version === 1 && Array.isArray(source.references)) {
        const refs = source.references.slice(0, cap.paths).filter(ref => text(ref?.sessionId) && ref.sessionId !== session.id && count(ref.capturedThroughSeq) && ref.retainedMessages > 0).map(ref => h('session', ref.sessionId));
        enqueue(async () => {
          const facts = [];
          for (const key of refs) if (addBounded(turn.recalls, key, position(turn, step, event.seq))) facts.push(fact(turn, 'recall_used', ['recall', event.seq, key], event.time, { key, ...(count(step) ? { step } : {}) }, evidence('session/event', event.seq, undefined, step)));
          await deliver(facts);
        });
      }
    } else if (event.type === 'deliverables/presented') {
      if (!text(data.callId) || !Array.isArray(data.files)) return;
      const step = turn.calls.get(data.callId)?.step ?? turn.currentStep;
      const paths = data.files.slice(0, cap.paths).filter(file => absolute(file?.path)).map(file => h('path', file.path));
      enqueue(async () => {
        const facts = [...new Set(paths)].map(key => fact(turn, 'file_presented', ['present', data.callId, key], event.time, { key, ...(count(step) ? { step } : {}) }, evidence('session/event', event.seq, data.callId, step)));
        const pos = position(turn, step, ['present', event.seq]);
        const completed = [...turn.delegates.values()].filter(item => before(item, pos));
        if (facts.length > 0 && completed.length >= 2) recipe(turn, 'delegate_then_present', [...completed.slice(0, 2).map(item => item.key), pos.key]);
        await deliver(facts);
      });
    } else if (event.type === 'turn/end') finish(turn, event);
  }
  function mutation(value, meta, name) {
    if (object(value) && absolute(value.path) && typeof value.after === 'string') {
      if (name === 'edit' && typeof value.before === 'string' && value.before !== value.after) return value.path;
      if (name === 'write' && ((value.operation === 'create' && value.after.length > 0) || (value.operation === 'update' && typeof value.before === 'string' && value.before !== value.after))) return value.path;
      // A known but unchanged/unknown canonical outcome must not be upgraded by metadata.
      return undefined;
    }
    if (!object(meta) || !absolute(meta.path) || !Array.isArray(meta.diffs)) return undefined;
    return meta.diffs.some(diff => object(diff) && diff.path === meta.path && typeof diff.oldText === 'string' && typeof diff.newText === 'string' && diff.oldText !== diff.newText) ? meta.path : undefined;
  }
  function toolResult(turn, call, id, result, at, source, seq) {
    if (!text(id) || turn.settled.has(id)) { counters.duplicates++; return; }
    if (turn.settled.size >= cap.calls) { counters.boundedDrops++; return; }
    turn.settled.add(id);
    if (result?.isError !== false || !count(call.step)) return;
    const name = call.name;
    const value = result.value;
    const meta = result.meta;
    const pos = position(turn, call.step, ['call', id]);
    const proof = evidence(source, seq ?? call.seq, id, call.step);
    if (name === 'read') {
      const read = object(value) ? value : meta;
      if (!object(read) || !absolute(read.path) || !Array.isArray(read.lines) || read.lines.length === 0 || !read.lines.every(line => object(line) && count(line.number) && line.number > 0 && typeof line.text === 'string')) return;
      const key = h('path', read.path), lang = format(read.path);
      enqueue(async () => {
        addBounded(turn.reads, key, pos);
        if (before(turn.searches.get(key), pos)) addBounded(turn.searchedReads, key, pos);
        await deliver([fact(turn, 'file_read', ['call', id], at, { key, step: call.step }, proof), ...(lang ? [fact(turn, 'format_read', ['call-format', id], at, { key: lang, step: call.step }, proof)] : [])]);
      });
    } else if (name === 'write' || name === 'edit') {
      const path = mutation(value, meta, name);
      if (!path) return;
      const key = h('path', path);
      enqueue(async () => {
        addBounded(turn.changes, key, pos);
        if (before(turn.reads.get(key), pos)) recipe(turn, 'read_then_change', [turn.reads.get(key).key, pos.key]);
        if (before(turn.searchedReads.get(key), pos)) recipe(turn, 'search_read_change', [turn.searches.get(key).key, turn.searchedReads.get(key).key, pos.key]);
        const skill = [...turn.skills.values()].find(item => before(item, pos));
        if (skill) recipe(turn, 'skill_then_change', [skill.key, pos.key]);
        const recall = [...turn.recalls.values()].find(item => before(item, pos));
        if (recall) recipe(turn, 'recall_then_change', [recall.key, pos.key]);
        await deliver([fact(turn, 'file_changed', ['call', id], at, { key, step: call.step }, proof)]);
      });
    } else if (name === 'skill') {
      if (!object(value) || !text(value.name) || !text(value.provider) || !text(value.content)) return;
      const key = h('skill', value.name);
      enqueue(async () => { if (!addBounded(turn.skills, key, pos)) return; await deliver([fact(turn, 'skill_loaded', ['call', id], at, { key, step: call.step }, proof)]); });
    } else if (name === 'grep' || name === 'glob') {
      let paths = [];
      if (name === 'grep' && Array.isArray(value?.matches)) paths = value.matches.filter(item => text(item?.path)).map(item => item.path);
      else if (name === 'glob' && Array.isArray(value?.paths)) paths = value.paths.filter(text);
      else if (meta?.shape === 'matches' && Array.isArray(meta.files)) paths = meta.files.filter(item => text(item?.path) && Array.isArray(item.matches) && item.matches.length > 0).map(item => item.path);
      else if (meta?.shape === 'paths' && Array.isArray(meta.paths)) paths = meta.paths.filter(text);
      paths = [...new Set(paths)].slice(0, cap.paths);
      // Search returns workdir-relative paths, unlike read/edit's canonical value.
      // Only the official FS resolver may turn those into a comparable identity.
      enqueue(async () => {
        for (const path of paths) {
          let canonical;
          try {
            const fs = service('fs');
            if (fs?.resolve && fs?.processPath && absolute(call.cwd)) canonical = fs.processPath(await fs.resolve(path, { cwd: call.cwd, signal: lifetime.signal }));
          } catch { /* uncertain identity contributes no recipe */ }
          if (absolute(canonical)) addBounded(turn.searches, h('path', canonical), pos);
        }
      });
    }
  }
  function observedTool(exec, result) {
    const session = exec?.agent?.session;
    const turn = active(session);
    if (!turn) { counters.ignoredPartial++; return; }
    const known = turn.calls.get(exec.callId);
    const step = known?.step ?? turn.currentStep;
    if (!count(step) || !turn.steps.has(step) || turn.steps.get(step).ended) return;
    const call = known ?? { name: exec.name, step, cwd: directory(session) };
    toolResult(turn, call, exec.callId, result, time(clock()), 'tools/result');
  }
  async function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (usageHelper === undefined) { try { usageHelper = (await import('@deepseek-ai/dsh-token-meter/client')).deriveTurnTokenUsage; } catch { usageHelper = null; } }
      if (language === undefined) { try { language = (await import('@deepseek-ai/dsh-util-code-language')).languageForPath; } catch { language = null; } }
      if (disposed) return;
      startedAt = time(clock()); started = true;
      sessionSubscribed = subscribe(ctx, 'session/event', sessionEvent);
      subscribe(ctx, 'session/disposed', session => { const turn = active(session); if (turn) { turn.closed = true; cleanTurn(turn); counters.abandonedTurns++; } });
      resultSubscribed = subscribe(ctx, 'tools/result', observedTool);
      const a = subscribe(ctx, 'subagent/start', onDelegateStart);
      const b = subscribe(ctx, 'subagent/end', onDelegateEnd);
      delegationSubscribed = a && b;
    })();
    return startPromise;
  }
  function capabilities() {
    return {
      coverage: { mode: 'live_since_start', startedAt, history: false, partialTurns: 'excluded', inheritedEvents: 'excluded', externalAgentInternals: false, sequenceOrdering: 'cross_step_only' },
      sources: [
        { kind: 'tokens', connected: started && sessionSubscribed && typeof usageHelper === 'function', missing: typeof usageHelper === 'function' ? null : 'token_meter_helper_unavailable' },
        { kind: 'turn_completed', connected: started && sessionSubscribed, missing: sessionSubscribed ? null : 'session_event_unavailable' },
        ...['file_read', 'file_changed', 'format_read', 'skill_loaded'].map(kind => ({ kind, connected: started && resultSubscribed && Boolean(service('tools')), missing: service('tools') ? null : 'tools_service_unavailable', coverage: 'recognized_final_canonical_or_formal_metadata' })),
        { kind: 'delegate_completed', connected: started && delegationSubscribed && Boolean(service('subagents')), missing: service('subagents') ? null : 'subagent_service_unavailable', coverage: 'attributed_live_activations_within_fresh_parent_turn' },
        ...['file_presented', 'route_used', 'recall_used'].map(kind => ({ kind, connected: started && sessionSubscribed, missing: sessionSubscribed ? null : 'session_event_unavailable', coverage: 'recognized_durable_event' })),
        { kind: 'recipe', connected: started && sessionSubscribed, coverage: 'natural_complete_turn_and_cross_step_evidence' },
      ],
    };
  }
  function diagnostics() { return { ...counters, started, disposed, activeTurns: turns.size, activeRuns: runs.size, pendingWrites: pending, bufferedTokenEvents: [...turns.values()].reduce((sum, turn) => sum + turn.tokenEvents.length, 0) }; }
  async function dispose() {
    if (disposePromise) return disposePromise;
    disposed = true;
    lifetime.abort();
    disposePromise = (async () => {
      if (startPromise) await startPromise;
      for (const dispose of disposers.splice(0)) { try { await dispose(); } catch { counters.observerErrors++; } }
      for (const turn of [...turns.values()]) { turn.closed = true; cleanTurn(turn); }
      await tail;
      turns.clear(); runs.clear(); started = false;
    })();
    return disposePromise;
  }
  return { start, dispose, capabilities, diagnostics, contextFor, flush: () => tail };
}
