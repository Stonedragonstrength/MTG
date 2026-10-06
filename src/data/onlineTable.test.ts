import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { adjustLife, createGame, passTurn } from '../lib/game';
import type { GameConfig, GameState } from '../lib/types';
import { getDb } from './db';
import {
  GAME_SCHEMA,
  _resetForTests,
  bindTable,
  deps,
  hostTable,
  onLocalMutation,
  onLocalUndo,
  type TableHooks,
} from './onlineTable';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
  ],
};

function freshGame(): GameState {
  return createGame(config);
}

interface Fake {
  hooks: TableHooks & {
    applyRemote: ReturnType<typeof vi.fn>;
    onEnded: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    notice: ReturnType<typeof vi.fn>;
  };
  bumpsSent: unknown[];
  fireBump(payload: Record<string, unknown>): void;
  game: { current: GameState };
}

function setup(game: GameState): Fake {
  const bumpsSent: unknown[] = [];
  let bumpHandler: ((p: Record<string, unknown>) => void) | null = null;
  const holder = { current: game };
  const hooks = {
    getGame: () => holder.current,
    applyRemote: vi.fn((state: GameState) => {
      holder.current = state;
    }),
    onEnded: vi.fn(),
    setStatus: vi.fn(),
    notice: vi.fn(),
  };
  bindTable(hooks);
  deps.rpcCreate = vi.fn(async () => 'KQ7M2X');
  deps.rpcGet = vi.fn(async () => null);
  deps.rpcSave = vi.fn(async () => ({ ok: true, version: 2 }));
  deps.openChannel = vi.fn(async (_code: string, handlers: { onBump: (p: Record<string, unknown>) => void }) => {
    bumpHandler = handlers.onBump;
    return {
      sendBump: async (p: unknown) => {
        bumpsSent.push(p);
      },
      close: () => {},
    };
  }) as typeof deps.openChannel;
  deps.refreshAuth = vi.fn(async () => {});
  return {
    hooks,
    bumpsSent,
    fireBump: (p) => bumpHandler?.(p),
    game: holder,
  };
}

async function flushDebounce() {
  await vi.advanceTimersByTimeAsync(400);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(async () => {
  await getDb().kv.clear();
  // Fake ONLY the four timer fns: fake-indexeddb schedules its work on
  // setImmediate, which must stay real or every kv call hangs forever.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(async () => {
  vi.useRealTimers();
  await _resetForTests();
});

describe('push loop', () => {
  test('a local mutation debounces into one CAS save plus a doorbell', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const next = adjustLife(g, 0, -3);
    f.game.current = next;
    onLocalMutation((s) => adjustLife(s, 0, -3), g);
    await flushDebounce();
    expect(deps.rpcSave).toHaveBeenCalledTimes(1);
    const [code, base, state, op, schema] = (deps.rpcSave as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(code).toBe('KQ7M2X');
    expect(base).toBe(1);
    expect((state as GameState).players[0].life).toBe(37);
    expect(typeof op).toBe('string');
    expect(schema).toBe(GAME_SCHEMA);
    expect(f.bumpsSent).toHaveLength(1);
    expect((f.bumpsSent[0] as { v: number }).v).toBe(2);
  });

  test('CAS miss rebases queued ops onto the server state and retries', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const serverState = adjustLife(freshGame(), 1, -5); // peer hit player 1
    (deps.rpcSave as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, gone: false, ended: false, version: 4, state: serverState, app_schema: 1 })
      .mockResolvedValueOnce({ ok: true, version: 5 });
    f.game.current = adjustLife(g, 0, -3);
    onLocalMutation((s) => adjustLife(s, 0, -3), g);
    await flushDebounce();
    expect(deps.rpcSave).toHaveBeenCalledTimes(2);
    const retry = (deps.rpcSave as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(retry[1]).toBe(4); // rebased onto server version
    const merged = retry[2] as GameState;
    expect(merged.players[0].life).toBe(37); // our delta survived
    expect(merged.players[1].life).toBe(35); // their delta kept
    expect(f.hooks.applyRemote).toHaveBeenCalled();
  });

  test('a guarded pass-turn is dropped when the turn already moved', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const serverState = passTurn(freshGame()); // peer passed first
    (deps.rpcSave as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, gone: false, ended: false, version: 4, state: serverState, app_schema: 1 })
      .mockResolvedValueOnce({ ok: true, version: 5 });
    f.game.current = passTurn(g);
    onLocalMutation((s) => passTurn(s), g, {
      guard: (base, orig) =>
        base.activePlayerIndex === orig.activePlayerIndex && base.turnNumber === orig.turnNumber,
    });
    await flushDebounce();
    // guard failed: nothing left to save, server state adopted, notice shown
    expect(deps.rpcSave).toHaveBeenCalledTimes(1);
    expect(f.hooks.applyRemote).toHaveBeenCalled();
    const applied = f.hooks.applyRemote.mock.calls.at(-1)![0] as GameState;
    expect(applied.activePlayerIndex).toBe(serverState.activePlayerIndex); // no double advance
    expect(f.hooks.notice).toHaveBeenCalled();
  });

  test('ops older than 120s are dropped on rebase, younger ones survive', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const t0 = Date.now();
    const nowSpy = vi.spyOn(deps, 'now');
    nowSpy.mockReturnValue(t0);
    onLocalMutation((s) => adjustLife(s, 0, -1), g); // will age out
    nowSpy.mockReturnValue(t0 + 130_000);
    onLocalMutation((s) => adjustLife(s, 1, -2), g); // fresh
    const serverState = freshGame();
    (deps.rpcSave as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, gone: false, ended: false, version: 7, state: serverState, app_schema: 1 })
      .mockResolvedValueOnce({ ok: true, version: 8 });
    await flushDebounce();
    const retry = (deps.rpcSave as ReturnType<typeof vi.fn>).mock.calls[1];
    const merged = retry[2] as GameState;
    expect(merged.players[0].life).toBe(40); // aged op gone
    expect(merged.players[1].life).toBe(38); // fresh op replayed
    expect(f.hooks.notice).toHaveBeenCalled();
  });

  test('lost-ack duplicate splices ops without replaying them', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const landed = adjustLife(freshGame(), 0, -3);
    (deps.rpcSave as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      duplicate: true,
      version: 3,
      state: landed,
      app_schema: 1,
    });
    f.game.current = adjustLife(g, 0, -3);
    onLocalMutation((s) => adjustLife(s, 0, -3), g);
    await flushDebounce();
    expect(deps.rpcSave).toHaveBeenCalledTimes(1); // nothing re-sent
    const applied = f.hooks.applyRemote.mock.calls.at(-1)![0] as GameState;
    expect(applied.players[0].life).toBe(37); // server truth, not 34
  });

  test('a network retry reuses the opId; a rebase regenerates it', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const saveMock = deps.rpcSave as ReturnType<typeof vi.fn>;
    saveMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false, gone: false, ended: false, version: 9, state: freshGame(), app_schema: 1 })
      .mockResolvedValueOnce({ ok: true, version: 10 });
    onLocalMutation((s) => adjustLife(s, 0, -1), g);
    await flushDebounce(); // attempt 1: network error
    expect(f.hooks.setStatus).toHaveBeenCalledWith({ kind: 'offline' });
    await vi.advanceTimersByTimeAsync(1100); // backoff retry
    const ops = saveMock.mock.calls.map((c) => c[3]);
    expect(ops[1]).toBe(ops[0]); // verbatim retry, same opId
    await vi.advanceTimersByTimeAsync(10); // rebase retry already in-flight chain
    expect(ops[2] ?? saveMock.mock.calls[2]?.[3]).not.toBe(ops[0]); // rebase = fresh opId
  });

  test('a build behind the table goes read-only instead of fighting', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    (deps.rpcSave as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      gone: false,
      ended: false,
      version: 4,
      state: freshGame(),
      app_schema: GAME_SCHEMA + 1,
    });
    onLocalMutation((s) => adjustLife(s, 0, -1), g);
    await flushDebounce();
    expect(f.hooks.setStatus).toHaveBeenCalledWith({ kind: 'stale-build' });
    expect(deps.rpcSave).toHaveBeenCalledTimes(1); // queue dropped, no retry
  });
});

describe('undo', () => {
  test('clean undo pushes the snapshot immediately as a new version', async () => {
    const g = freshGame();
    setup(g);
    await hostTable(g);
    onLocalUndo(g);
    await vi.advanceTimersByTimeAsync(10); // no debounce on undo
    expect(deps.rpcSave).toHaveBeenCalledTimes(1);
    expect((deps.rpcSave as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe(g);
  });

  test('conflicted undo is dropped, never rebased', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const serverState = adjustLife(freshGame(), 1, -4);
    (deps.rpcSave as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      gone: false,
      ended: false,
      version: 6,
      state: serverState,
      app_schema: 1,
    });
    onLocalUndo(g);
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.rpcSave).toHaveBeenCalledTimes(1); // no second attempt
    const applied = f.hooks.applyRemote.mock.calls.at(-1)![0] as GameState;
    expect(applied.players[1].life).toBe(36); // peer's write preserved
    expect(f.hooks.notice).toHaveBeenCalledWith(expect.stringMatching(/undo skipped/i));
  });
});

describe('doorbell + reconcile', () => {
  test('own and stale doorbells are ignored; newer ones fetch and apply', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    f.fireBump({ v: 1, by: 'someone-else' }); // not newer than appliedVersion 1
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.rpcGet).not.toHaveBeenCalled();
    const newer = adjustLife(freshGame(), 0, -7);
    (deps.rpcGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      state: newer,
      version: 3,
      ended: false,
      app_schema: 1,
    });
    f.fireBump({ v: 3, by: 'someone-else' });
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.rpcGet).toHaveBeenCalled();
    const applied = f.hooks.applyRemote.mock.calls.at(-1)![0] as GameState;
    expect(applied.players[0].life).toBe(33);
  });

  test('a tap landing mid-fetch wins over the fetched state', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    let resolveGet: (v: unknown) => void = () => {};
    (deps.rpcGet as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise((r) => (resolveGet = r)),
    );
    (deps.rpcSave as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, version: 9 });
    f.fireBump({ v: 5, by: 'someone-else' }); // reconcile begins, fetch hangs
    await vi.advanceTimersByTimeAsync(5);
    onLocalMutation((s) => adjustLife(s, 0, -2), g); // tap lands mid-fetch
    const fetched = adjustLife(freshGame(), 1, -9);
    resolveGet({ state: fetched, version: 5, ended: false, app_schema: 1 });
    await vi.advanceTimersByTimeAsync(500);
    // the fetched state must NOT have been applied over the dirty queue
    const fetchApplied = f.hooks.applyRemote.mock.calls.some((c) => c[0] === fetched);
    expect(fetchApplied).toBe(false);
    expect(deps.rpcSave).toHaveBeenCalled(); // queue pushed instead
  });

  test('an ended table closes the session and keeps the game local', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    (deps.rpcGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      state: null,
      version: 4,
      ended: true,
      app_schema: 1,
    });
    f.fireBump({ v: 4, by: 'someone-else', ended: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(f.hooks.onEnded).toHaveBeenCalled();
    expect(await getDb().kv.get('tableSession')).toBeUndefined();
  });
});
