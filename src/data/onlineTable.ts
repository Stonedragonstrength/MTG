import { isValidGame, migrateGame } from '../lib/migrate';
import type { GameState } from '../lib/types';
import { getSupabase } from './cloud';
import { kvDelete, kvGet, kvSet } from './db';

/** Bump ONLY when GameState gains a load-bearing field — peers compare it
 * to decide who is running a stale build at a live table.
 * 2: cards mode (SeatCards zones, feed ring). */
export const GAME_SCHEMA = 2;

export type TableStatus =
  | { kind: 'connecting' }
  | { kind: 'live'; peers: number }
  | { kind: 'offline' }
  | { kind: 'stale-build' }
  | { kind: 'ended' };

export interface TableHooks {
  getGame(): GameState | null;
  /** Replace local game with remote truth (validate + migrate + set +
   * persist + clear undo history + announce defeats — the store's job). */
  applyRemote(state: GameState): void;
  /** Table ended/vanished: keep the local snapshot as an ordinary save. */
  onEnded(): void;
  setStatus(status: TableStatus): void;
  notice(text: string): void;
}

export interface SyncOpts {
  /** Replay gate on rebase: false drops the op when the base moved. */
  guard?: (base: GameState, orig: GameState) => boolean;
  /** How long this op may wait out an offline stretch before a rebase
   * drops it. Tracker taps keep the 120s default; card ops pass the
   * table's lifetime — a player's seen draws must survive a nap. */
  maxAgeMs?: number;
}

interface PendingOp {
  op: (g: GameState) => GameState;
  orig: GameState;
  guard: (base: GameState, orig: GameState) => boolean;
  isUndo: boolean;
  queuedAt: number; // deps.now() — Date-based; performance.now can freeze in suspend
  maxAgeMs: number;
}

interface SaveResult {
  ok: boolean;
  duplicate?: boolean;
  gone?: boolean;
  ended?: boolean;
  version?: number;
  state?: GameState;
  app_schema?: number;
}

interface GetResult {
  state: GameState | null;
  version: number;
  ended: boolean;
  app_schema: number;
}

interface ChannelHandle {
  sendBump(payload: Record<string, unknown>): Promise<void>;
  close(): void;
}

/** All I/O behind one seam so the protocol logic is unit-testable. */
export const deps = {
  now: () => Date.now(),

  async rpcCreate(state: GameState): Promise<string> {
    const client = await getSupabase();
    if (!client) throw new Error('Cloud not configured');
    const { data, error } = await client.rpc('table_create', { p_state: state });
    if (error) throw new Error(error.message);
    return data as string;
  },

  async rpcGet(code: string, known: number): Promise<GetResult | null> {
    const client = await getSupabase();
    if (!client) throw new Error('Cloud not configured');
    const { data, error } = await client.rpc('table_get', { p_code: code, p_known: known });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return row ?? null;
  },

  async rpcSave(
    code: string,
    base: number,
    state: GameState,
    op: string,
    schema: number,
  ): Promise<SaveResult> {
    const client = await getSupabase();
    if (!client) throw new Error('Cloud not configured');
    const { data, error } = await client.rpc('table_save', {
      p_code: code,
      p_base: base,
      p_state: state,
      p_op: op,
      p_schema: schema,
    });
    if (error) throw new Error(error.message);
    return data as SaveResult;
  },

  async openChannel(
    code: string,
    handlers: {
      onBump(payload: Record<string, unknown>): void;
      onStatus(status: 'live' | 'offline', peers: number): void;
    },
  ): Promise<ChannelHandle> {
    const client = await getSupabase();
    if (!client) throw new Error('Cloud not configured');
    const channel = client.channel(`table:${code}`, {
      config: { broadcast: { self: false }, presence: { key: deviceId } },
    });
    channel
      .on('broadcast', { event: 'bump' }, (msg) => handlers.onBump(msg.payload ?? {}))
      .on('presence', { event: 'sync' }, () => {
        handlers.onStatus('live', Object.keys(channel.presenceState()).length || 1);
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          void channel.track({});
          handlers.onStatus('live', Object.keys(channel.presenceState()).length || 1);
          void reconcile();
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          handlers.onStatus('offline', 0);
        }
      });
    return {
      sendBump: async (payload) => {
        await channel.send({ type: 'broadcast', event: 'bump', payload });
      },
      close: () => {
        void client.removeChannel(channel);
      },
    };
  },

  async refreshAuth(): Promise<void> {
    const client = await getSupabase();
    if (client) await client.auth.getSession();
  },
};

const PUSH_DEBOUNCE_MS = 350;
const PUSH_MAX_WAIT_MS = 1500;
const STALE_OPS_MS = 120_000;
const POLL_MS = 30_000;
const MAX_REBASE_RETRIES = 4;

let hooks: TableHooks | null = null;
let session: { code: string; mySeat: number | null } | null = null;
let channel: ChannelHandle | null = null;
let deviceId = crypto.randomUUID();
let appliedVersion = 0;
let pendingOps: PendingOp[] = [];
let pushing = false;
let wantPush = false;
let opId: string | null = null;
let payloadRebuilt = true;
/** The last save that went out and was never answered. It may have landed,
 * so it goes out again VERBATIM (same op id, state and base) before
 * anything newer does: the table then answers "duplicate" instead of a
 * miss that would replay, on top of themselves, changes it already holds. */
let unanswered: { base: number; snapshot: GameState; ops: PendingOp[] } | null = null;
let rebaseRetries = 0;
let backoffMs = 1000;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let reconciling = false;
let lastPeers = 1;
let windowBound = false;

function onVisible() {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') void reconcile();
}
function onOnline() {
  void reconcile();
}

export function bindTable(h: TableHooks): void {
  hooks = h;
  if (!windowBound && typeof window !== 'undefined') {
    windowBound = true;
    window.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
  }
}

function clearTimers() {
  clearTimeout(debounceTimer);
  clearTimeout(maxWaitTimer);
  clearTimeout(retryTimer);
  clearInterval(pollTimer);
  debounceTimer = maxWaitTimer = retryTimer = undefined;
  pollTimer = undefined;
}

async function saveSession() {
  if (session) await kvSet('tableSession', session);
}

async function startSession(code: string, version: number, mySeat: number | null) {
  session = { code, mySeat };
  appliedVersion = version;
  pendingOps = [];
  opId = null;
  payloadRebuilt = true;
  unanswered = null;
  rebaseRetries = 0;
  backoffMs = 1000;
  deviceId = crypto.randomUUID();
  await saveSession();
  hooks?.setStatus({ kind: 'connecting' });
  try {
    channel = await deps.openChannel(code, {
      onBump,
      onStatus: (s, peers) => {
        if (!session) return;
        if (s === 'live') {
          lastPeers = peers;
          hooks?.setStatus({ kind: 'live', peers });
        } else {
          hooks?.setStatus({ kind: 'offline' });
        }
      },
    });
  } catch {
    hooks?.setStatus({ kind: 'offline' });
  }
  pollTimer = setInterval(() => void reconcile(), POLL_MS);
}

async function teardown() {
  clearTimers();
  channel?.close();
  channel = null;
  session = null;
  pendingOps = [];
  opId = null;
  unanswered = null;
  await kvDelete('tableSession').catch(() => {});
}

function endedFlow() {
  const h = hooks;
  void teardown();
  h?.setStatus({ kind: 'ended' });
  h?.onEnded();
}

export async function hostTable(state: GameState): Promise<{ code: string } | { error: string }> {
  try {
    const code = await deps.rpcCreate(state);
    await startSession(code, 1, null);
    return { code };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not create the table.' };
  }
}

export async function joinTable(
  code: string,
): Promise<{ state: GameState } | { error: string }> {
  try {
    const row = await deps.rpcGet(code.toUpperCase().trim(), -1);
    if (!row || !row.state) return { error: 'No table with that code — codes last 24 hours.' };
    if (row.ended) return { error: 'That table has already ended.' };
    if (!isValidGame(row.state)) return { error: 'That table holds something unreadable.' };
    await startSession(code.toUpperCase().trim(), row.version, null);
    return { state: migrateGame(row.state) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not reach the table.' };
  }
}

export async function resumeTable(): Promise<{
  code: string;
  mySeat: number | null;
  state: GameState;
} | null> {
  const saved = await kvGet<{ code: string; mySeat: number | null }>('tableSession');
  if (!saved?.code) return null;
  try {
    const row = await deps.rpcGet(saved.code, -1);
    if (!row || !row.state || row.ended || !isValidGame(row.state)) {
      await kvDelete('tableSession').catch(() => {});
      return null;
    }
    await startSession(saved.code, row.version, saved.mySeat);
    return { code: saved.code, mySeat: saved.mySeat, state: migrateGame(row.state) };
  } catch {
    // Offline at launch: keep the session for a later reconcile.
    await startSession(saved.code, 0, saved.mySeat);
    hooks?.setStatus({ kind: 'offline' });
    const g = hooks?.getGame();
    return g ? { code: saved.code, mySeat: saved.mySeat, state: g } : null;
  }
}

export async function leaveTable(): Promise<void> {
  await teardown();
}

export async function endTableForEveryone(): Promise<void> {
  const code = session?.code;
  const h = channel;
  if (!code) return;
  try {
    const client = await getSupabase();
    if (client) await client.rpc('table_end', { p_code: code });
    await h?.sendBump({ v: appliedVersion + 1, by: deviceId, ended: true, schema: GAME_SCHEMA });
  } catch {
    // The 30s poll tells the others soon enough.
  }
  await teardown();
}

export function setMySeat(seat: number | null): void {
  if (!session) return;
  session = { ...session, mySeat: seat };
  void saveSession();
}

export function getMySeat(): number | null {
  return session?.mySeat ?? null;
}

export function onLocalMutation(
  fn: (g: GameState) => GameState,
  orig: GameState,
  opts?: SyncOpts,
): void {
  if (!session) return;
  pendingOps.push({
    op: fn,
    orig,
    guard: opts?.guard ?? (() => true),
    isUndo: false,
    queuedAt: deps.now(),
    maxAgeMs: opts?.maxAgeMs ?? STALE_OPS_MS,
  });
  payloadRebuilt = true;
  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = undefined;
      void push();
    }, PUSH_MAX_WAIT_MS);
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void push(), PUSH_DEBOUNCE_MS);
}

export function onLocalUndo(snapshot: GameState): void {
  if (!session) return;
  // APPEND, never replace: earlier queued ops (a draw the player already
  // saw) must survive a conflicted undo, and an undo arriving while a
  // push is in flight must not be spliced away with the acked prefix
  // (review findings). Only stale older undos are superseded.
  pendingOps = [
    ...pendingOps.filter((p) => !p.isUndo),
    {
      op: () => snapshot,
      orig: snapshot,
      guard: () => false, // an undo is never replayed onto a moved table
      isUndo: true,
      queuedAt: deps.now(),
      maxAgeMs: STALE_OPS_MS,
    },
  ];
  payloadRebuilt = true;
  clearTimeout(debounceTimer);
  clearTimeout(maxWaitTimer);
  maxWaitTimer = undefined;
  void push();
}

function noticeDrops(droppedUndo: boolean, droppedOther: number) {
  if (droppedUndo) hooks?.notice('Undo skipped — the table moved first');
  if (droppedOther > 0)
    hooks?.notice(
      droppedOther === 1
        ? 'One change was overtaken by the table and skipped'
        : `${droppedOther} changes were overtaken by the table and skipped`,
    );
}

/** Progressive rebase: each op's guard sees the state AFTER the ops kept
 * before it, so chains (draw → play the drawn card) survive intact —
 * guards against the raw base would mass-drop everything downstream of
 * the first queued op (review finding). Undo entries never replay. */
function rebaseQueue(base: GameState): {
  state: GameState;
  kept: PendingOp[];
  droppedUndo: boolean;
  droppedOther: number;
} {
  const now = deps.now();
  let state = base;
  const kept: PendingOp[] = [];
  let droppedUndo = false;
  let droppedOther = 0;
  for (const p of pendingOps) {
    if (p.isUndo) {
      droppedUndo = true;
      continue;
    }
    if (now - p.queuedAt >= p.maxAgeMs || !p.guard(state, p.orig)) {
      droppedOther += 1;
      continue;
    }
    try {
      state = p.op(state);
      kept.push(p);
    } catch {
      droppedOther += 1;
      hooks?.notice('One change could not be replayed and was skipped');
    }
  }
  return { state, kept, droppedUndo, droppedOther };
}

async function push(): Promise<void> {
  if (!session || !hooks) return;
  if (pushing) {
    wantPush = true;
    return;
  }
  pushing = true;
  clearTimeout(debounceTimer);
  clearTimeout(maxWaitTimer);
  maxWaitTimer = undefined;
  try {
    for (;;) {
      if (!session) return;
      if (pendingOps.length === 0) return;
      // Only while this device still stands where that save left from: a
      // remote state applied since makes its base meaningless.
      const again = unanswered && unanswered.base === appliedVersion && opId ? unanswered : null;
      unanswered = null;
      const snapshot = again ? again.snapshot : hooks.getGame();
      if (!snapshot) return;
      const sent = again ? again.ops : pendingOps.slice();
      const sentBase = appliedVersion;
      // By identity, not by count: an undo may have reshaped the queue meanwhile.
      const landed = () => {
        pendingOps = pendingOps.filter((op) => !sent.includes(op));
      };
      if (!again && (payloadRebuilt || !opId)) {
        opId = crypto.randomUUID();
        payloadRebuilt = false;
      }
      let r: SaveResult;
      try {
        r = await deps.rpcSave(session.code, sentBase, snapshot, opId!, GAME_SCHEMA);
      } catch {
        unanswered = { base: sentBase, snapshot, ops: sent };
        hooks.setStatus({ kind: 'offline' });
        retryTimer = setTimeout(() => void push(), backoffMs);
        backoffMs = Math.min(backoffMs * 2, 15_000);
        return;
      }
      backoffMs = 1000;
      if (r.gone) {
        endedFlow();
        return;
      }
      if (r.ended) {
        endedFlow();
        return;
      }
      if (r.ok && !r.duplicate) {
        appliedVersion = r.version ?? appliedVersion + 1;
        landed();
        payloadRebuilt = true;
        rebaseRetries = 0;
        try {
          await channel?.sendBump({ v: appliedVersion, by: deviceId, schema: GAME_SCHEMA });
        } catch {
          try {
            await channel?.sendBump({ v: appliedVersion, by: deviceId, schema: GAME_SCHEMA });
          } catch {
            // Poll covers it.
          }
        }
        if (pendingOps.length === 0) return;
        continue;
      }
      if (r.ok && r.duplicate) {
        landed();
        payloadRebuilt = true;
        if (r.version === sentBase + 1) {
          // The table moved by this very save and nothing else, so what is
          // queued behind it (an undo, say) still stands on what it saw.
          appliedVersion = r.version;
        } else if ((r.version ?? 0) > appliedVersion && r.state && isValidGame(r.state)) {
          const base = migrateGame(r.state);
          appliedVersion = r.version!;
          const rb = rebaseQueue(base); // guards apply here too
          noticeDrops(rb.droppedUndo, rb.droppedOther);
          pendingOps = rb.kept;
          hooks.applyRemote(rb.state);
        }
        if (pendingOps.length === 0) return;
        continue;
      }
      // CAS miss
      if ((r.app_schema ?? 1) > GAME_SCHEMA) {
        pendingOps = [];
        if (r.state && isValidGame(r.state)) {
          appliedVersion = r.version ?? appliedVersion;
          hooks.applyRemote(migrateGame(r.state));
        }
        hooks.setStatus({ kind: 'stale-build' });
        return;
      }
      if (!r.state || !isValidGame(r.state)) {
        hooks.setStatus({ kind: 'offline' });
        retryTimer = setTimeout(() => void push(), backoffMs);
        backoffMs = Math.min(backoffMs * 2, 15_000);
        return;
      }
      const base = migrateGame(r.state);
      appliedVersion = r.version ?? appliedVersion;
      const rb = rebaseQueue(base);
      noticeDrops(rb.droppedUndo, rb.droppedOther);
      pendingOps = rb.kept;
      hooks.applyRemote(rb.state);
      payloadRebuilt = true;
      rebaseRetries += 1;
      if (pendingOps.length === 0) return;
      if (rebaseRetries > MAX_REBASE_RETRIES) {
        pendingOps = [];
        hooks.applyRemote(base);
        hooks.notice('The table is moving fast — this device re-synced to it');
        return;
      }
    }
  } finally {
    pushing = false;
    if (wantPush) {
      wantPush = false;
      void push();
    }
  }
}

function onBump(payload: Record<string, unknown>): void {
  if (!session) return;
  if (payload.by === deviceId) return;
  if (payload.ended) {
    endedFlow();
    return;
  }
  const v = typeof payload.v === 'number' ? payload.v : 0;
  if (v <= appliedVersion) return;
  void reconcile();
}

async function reconcile(): Promise<void> {
  if (!session || !hooks || reconciling) return;
  reconciling = true;
  try {
    await deps.refreshAuth().catch(() => {});
    let r: GetResult | null;
    try {
      r = await deps.rpcGet(session.code, appliedVersion);
    } catch {
      hooks.setStatus({ kind: 'offline' });
      return;
    }
    if (!session) return;
    if (!r) {
      endedFlow();
      return;
    }
    if (r.ended) {
      endedFlow();
      return;
    }
    if (r.app_schema > GAME_SCHEMA) {
      pendingOps = [];
      if (r.state && isValidGame(r.state)) {
        appliedVersion = r.version;
        hooks.applyRemote(migrateGame(r.state));
      }
      hooks.setStatus({ kind: 'stale-build' });
      return;
    }
    if (r.version > appliedVersion) {
      if (pendingOps.length > 0) {
        const now = deps.now();
        const kept = pendingOps.filter((p) => p.isUndo || now - p.queuedAt < p.maxAgeMs);
        if (kept.length < pendingOps.length)
          hooks.notice('Table moved on while this device was away');
        pendingOps = kept;
        payloadRebuilt = true;
        void push();
        return;
      }
      // The fetch awaited; a tap may have landed meanwhile — re-check.
      if (pendingOps.length > 0) {
        void push();
        return;
      }
      if (r.state && isValidGame(r.state)) {
        appliedVersion = r.version;
        hooks.applyRemote(migrateGame(r.state));
        hooks.setStatus({ kind: 'live', peers: lastPeers });
      }
      return;
    }
    if (pendingOps.length > 0) void push();
  } finally {
    reconciling = false;
  }
}

/** Test hook: tears the module back to virgin state. */
export async function _resetForTests(): Promise<void> {
  await teardown();
  hooks = null;
  appliedVersion = 0;
  pushing = false;
  wantPush = false;
  reconciling = false;
  backoffMs = 1000;
  rebaseRetries = 0;
}
