import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJournal, JOURNAL_LIMITS } from './journal.mjs';

export const DEBUG_LIMITS = Object.freeze({ sessions: 4, ttlMs: 30 * 60 * 1000 });
const METHODS = Object.freeze({ preferences: 'preferences', equip: 'equip', configure: 'configure', report: 'report', draw: 'draw', configureCharacters: 'configureCharacters', characters: 'configureCharacters', deleteDefinitions: 'deleteDefinitions', rename: 'rename' });
const clone = value => structuredClone(value);
function failure(message, code, status = 409) { return Object.assign(new Error(message), { name: 'JournalError', code, status }); }
const expired = () => failure('调试会话已失效，请重新进入调试；未切换到真实档案。', 'DEBUG_SCOPE_EXPIRED');

/** Owns only its private temporary directories. No collector or model call is mounted here. */
export function createDebugController({ journal, statePath, now = Date.now, tmpRoot = tmpdir() }) {
  if (typeof statePath !== 'string' || !statePath.trim() || typeof journal?.snapshot !== 'function' || typeof now !== 'function' || typeof tmpRoot !== 'string' || !tmpRoot.trim()) throw failure('调试控制器配置无效。', 'DEBUG_INVALID', 400);
  const sessions = new Map(), owned = new Set(); let tail = Promise.resolve(), closed = false, closing;
  const clock = () => { const at = now(); if (!Number.isSafeInteger(at) || at < 0 || at > Number.MAX_SAFE_INTEGER - DEBUG_LIMITS.ttlMs) throw failure('调试时钟无效。', 'DEBUG_INVALID', 400); return at; };
  const enqueue = operation => { const run = tail.then(operation); tail = run.catch(() => {}); return run; };
  const ensureOpen = () => { if (closed) throw failure('调试控制器已关闭。', 'DEBUG_CLOSED', 503); };
  async function clean(scope) {
    clearTimeout(scope.timer); sessions.delete(scope.token);
    let failed = false;
    try { await scope.journal?.close(); } catch { failed = true; }
    try { await rm(scope.directory, { recursive: true, force: true }); owned.delete(scope); }
    catch { failed = true; }
    if (failed) throw failure('调试副本清理未完整完成，请重新启用插件后检查。', 'DEBUG_CLEANUP_FAILED', 503);
  }
  function retire(scope) {
    if (sessions.get(scope.token) !== scope) return;
    sessions.delete(scope.token); clearTimeout(scope.timer);
    void enqueue(() => clean(scope)).catch(() => { /* Kept in owned for the disposal cleanup retry. */ });
  }
  function find(token) {
    ensureOpen(); const scope = sessions.get(token);
    if (!scope) throw expired();
    if (clock() >= scope.expiresAt) { retire(scope); throw expired(); }
    return scope;
  }
  async function createScope() {
    ensureOpen();
    const sourceSnapshot = journal.snapshot();
    if (sourceSnapshot.debug === true || sourceSnapshot.debug?.active === true || ['unavailable', 'closed'].includes(sourceSnapshot.storage?.status)) throw failure('真实成就档案暂不可用，无法创建调试副本。', 'DEBUG_SOURCE_UNAVAILABLE', 503);
    let source;
    try {
      const handle = await open(statePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > JOURNAL_LIMITS.bytes) throw new Error('invalid archive');
        source = JSON.parse(await handle.readFile('utf8'));
      } finally { await handle.close(); }
      if (!source || ![1, 2].includes(source.schemaVersion) || Object.hasOwn(source, 'debug') || !Array.isArray(source.definitions) || !Array.isArray(source.awards) || !source.requests || source.createdAt !== sourceSnapshot.createdAt) throw new Error('not the owned real archive');
    } catch { throw failure('真实成就档案无法安全复制，原档案未更改。', 'DEBUG_SOURCE_UNAVAILABLE', 503); }
    ensureOpen();
    const data = JSON.stringify({ ...source, debug: true }) + '\n';
    if (Buffer.byteLength(data) > JOURNAL_LIMITS.bytes) throw failure('调试副本超过档案预算，原档案未更改。', 'DEBUG_BUDGET', 503);
    const directory = await mkdtemp(join(tmpRoot, 'dsh-achievement-debug-'));
    const scope = { directory, file: join(directory, 'journal-debug.json'), journal: undefined, token: randomBytes(32).toString('hex'), expiresAt: 0, timer: undefined };
    owned.add(scope);
    try {
      const temporary = join(directory, 'archive.tmp');
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, scope.file);
      let parent;
      try { parent = await open(directory, 'r'); await parent.sync(); }
      catch (e) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(e.code)) throw e; }
      finally { await parent?.close(); }
      scope.journal = await createJournal({ file: scope.file, now, allowDebug: true });
      ensureOpen(); scope.expiresAt = clock() + DEBUG_LIMITS.ttlMs;
      sessions.set(scope.token, scope);
      scope.timer = setTimeout(() => retire(scope), DEBUG_LIMITS.ttlMs); scope.timer.unref?.();
      return { token: scope.token, snapshot: scope.journal.snapshot() };
    } catch (e) { try { await clean(scope); } catch { /* Disposal retries owned cleanup. */ } throw e; }
  }
  async function prune() { for (const scope of [...sessions.values()]) if (clock() >= scope.expiresAt) { sessions.delete(scope.token); await clean(scope); } }
  const execute = (token, operation) => enqueue(async () => {
    const scope = find(token), result = await operation(scope.journal);
    // A result committed only to a disposable copy must never revive a token
    // that expired or was revoked while its local write was in flight.
    if (closed || sessions.get(token) !== scope || clock() >= scope.expiresAt) { retire(scope); throw expired(); }
    return result;
  });
  return {
    start() { return enqueue(async () => { ensureOpen(); await prune(); if (owned.size >= DEBUG_LIMITS.sessions) throw failure('最多同时保留四个调试会话，请先退出一个。', 'DEBUG_SESSION_LIMIT', 429); return createScope(); }); },
    get(token) {
      find(token);
      // Expose reads only. All writes must pass through execute(), so reset,
      // exit and expiry share the same queue as their last admitted mutation.
      return Object.freeze({ snapshot: () => find(token).journal.snapshot(), catalog: () => find(token).journal.catalog(), drawReceipt: requestId => find(token).journal.drawReceipt(requestId) });
    },
    action(token, input) { let value; try { value = clone(input); } catch { return Promise.reject(failure('调试操作无效。', 'DEBUG_INVALID', 400)); } return execute(token, copy => copy.debugAction(value)); },
    mutate(token, method, input) {
      if (!Object.hasOwn(METHODS, method)) return Promise.reject(failure('调试模式不支持模型生成或该写入方法。', 'DEBUG_METHOD_REJECTED', 400));
      let value; try { value = clone(input); } catch { return Promise.reject(failure('调试写入无效。', 'DEBUG_INVALID', 400)); }
      return execute(token, copy => copy[METHODS[method]](value, { source: 'user' }));
    },
    reset(token) { return enqueue(async () => { const scope = find(token); sessions.delete(token); await clean(scope); ensureOpen(); return createScope(); }); },
    exit(token) { return enqueue(async () => { const scope = sessions.get(token); if (scope) { sessions.delete(token); await clean(scope); } return { exited: true }; }); },
    diagnostics() { return { activeSessions: sessions.size, ownedDirectories: owned.size, closed }; },
    dispose() {
      if (closing) return closing; closed = true;
      for (const scope of sessions.values()) clearTimeout(scope.timer);
      sessions.clear();
      closing = enqueue(async () => {
        let failed = false;
        for (const scope of [...owned]) try { await clean(scope); } catch { failed = true; }
        if (failed) throw failure('部分调试副本未能清理。', 'DEBUG_CLEANUP_FAILED', 503);
      });
      return closing;
    },
  };
}
