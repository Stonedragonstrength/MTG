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
  leaveTable,
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

/** Drains multi-await push chains (several RPC round-trips) under the
 * scoped fake timers, where one tick only settles one await. */
async function drain() {
  for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(0);
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
    const applied = f.hooks.applyRemote.mock.lastCall![0] as GameState;
    expect(applied.activePlayerIndex).toBe(serverState.activePlayerIndex); // no double advance
    expect(f.hooks.notice).toHaveBeenCalled();
  });

  test('card ops with a long maxAgeMs survive rebases that kill tracker ops', async () => {
    const g = freshGame();
    setup(g);
    await hostTable(g);
    const t0 = Date.now();
    const nowSpy = vi.spyOn(deps, 'now');
    nowSpy.mockReturnValue(t0);
    onLocalMutation((s) => adjustLife(s, 0, -1), g); // tracker op: 120s rule
    onLocalMutation((s) => adjustLife(s, 1, -2), g, { maxAgeMs: 24 * 3600_000 }); // card-style op
    nowSpy.mockReturnValue(t0 + 7200_000); // two hours asleep
    const serverState = freshGame();
    (deps.rpcSave as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, gone: false, ended: false, version: 7, state: serverState, app_schema: GAME_SCHEMA })
      .mockResolvedValueOnce({ ok: true, version: 8 });
    await flushDebounce();
    const retry = (deps.rpcSave as ReturnType<typeof vi.fn>).mock.calls[1];
    const merged = retry[2] as GameState;
    expect(merged.players[0].life).toBe(40); // tracker op aged out
    expect(merged.players[1].life).toBe(38); // card op survived the sleep
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
    const applied = f.hooks.applyRemote.mock.lastCall![0] as GameState;
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

  test('this build writes schema 3, so one that predates turn rules stops writing at its table', () => {
    // Sick flags and land plays live in the shared state. A build that does not
    // know them would pass turns without readying anything: it has to go read-only.
    expect(GAME_SCHEMA).toBe(3);
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

describe('rebase correctness (review findings)', () => {
  test('a chained op whose precondition an earlier queued op creates survives the rebase', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const op1 = (s: GameState) => ({
      ...s,
      players: s.players.map((p, i) => (i === 0 ? { ...p, life: 10 } : p)),
    });
    const op2 = (s: GameState) => ({
      ...s,
      players: s.players.map((p, i) => (i === 0 ? { ...p, life: p.life + 1 } : p)),
    });
    onLocalMutation(op1, g);
    onLocalMutation(op2, g, { guard: (base) => base.players[0].life === 10 }); // depends on op1
    (deps.rpcSave as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, gone: false, ended: false, version: 4, state: freshGame(), app_schema: GAME_SCHEMA })
      .mockResolvedValueOnce({ ok: true, version: 5 });
    await flushDebounce();
    const merged = (deps.rpcSave as ReturnType<typeof vi.fn>).mock.calls[1][2] as GameState;
    expect(merged.players[0].life).toBe(11); // chain intact: guards see the folded state
    expect(f.hooks.notice).not.toHaveBeenCalled();
  });

  test('the duplicate path honors guards for ops that joined mid-flight', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const saveMock = deps.rpcSave as ReturnType<typeof vi.fn>;
    const landed = adjustLife(freshGame(), 0, -3);
    let resolveSave: (v: unknown) => void = () => {};
    saveMock
      .mockImplementationOnce(() => new Promise((r) => (resolveSave = r)))
      .mockResolvedValue({ ok: true, version: 4 });
    onLocalMutation((s) => adjustLife(s, 0, -3), g);
    await flushDebounce(); // first push in flight, hanging
    onLocalMutation((s) => adjustLife(s, 1, -1), g, {
      guard: (base) => base.players[0].life === 40, // false vs the landed state
    });
    resolveSave({ ok: true, duplicate: true, version: 3, state: landed, app_schema: GAME_SCHEMA });
    await drain();
    const applied = f.hooks.applyRemote.mock.lastCall![0] as GameState;
    expect(applied.players[1].life).toBe(40); // mid-flight op dropped by its guard
    expect(f.hooks.notice).toHaveBeenCalled();
  });

  test('an undo queued behind a card op keeps the op alive on conflict', async () => {
    vi.useRealTimers(); // multi-roundtrip push chain: fake ticks stall microtasks
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const serverState = adjustLife(freshGame(), 1, -5);
    (deps.rpcSave as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, gone: false, ended: false, version: 6, state: serverState, app_schema: GAME_SCHEMA })
      .mockResolvedValueOnce({ ok: true, version: 7 });
    const afterDraw = adjustLife(g, 0, -1); // stands in for a draw
    f.game.current = afterDraw;
    onLocalMutation((s) => adjustLife(s, 0, -1), g, { maxAgeMs: 24 * 3600_000 });
    onLocalUndo(afterDraw); // undo of a LATER action must not kill the draw
    await new Promise((r) => setTimeout(r, 100));
    const merged = (deps.rpcSave as ReturnType<typeof vi.fn>).mock.calls[1][2] as GameState;
    expect(merged.players[0].life).toBe(39); // the draw survived
    expect(merged.players[1].life).toBe(35); // on the server's base
    expect(f.hooks.notice).toHaveBeenCalledWith(expect.stringMatching(/undo skipped/i));
  });

  test('an undo arriving while a push is in flight is not spliced away', async () => {
    const g = freshGame();
    setup(g);
    await hostTable(g);
    let resolveSave: (v: unknown) => void = () => {};
    (deps.rpcSave as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => new Promise((r) => (resolveSave = r)))
      .mockResolvedValue({ ok: true, version: 3 });
    onLocalMutation((s) => adjustLife(s, 0, -1), g);
    await flushDebounce(); // push in flight, hanging
    onLocalUndo(g); // user undoes while the save hangs
    resolveSave({ ok: true, version: 2 });
    await vi.advanceTimersByTimeAsync(50);
    const calls = (deps.rpcSave as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2); // the undo got its own push
    expect(calls[1][2]).toBe(g); // carrying the undone snapshot
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
    const applied = f.hooks.applyRemote.mock.lastCall![0] as GameState;
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
    const applied = f.hooks.applyRemote.mock.lastCall![0] as GameState;
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

describe('a save whose answer never came back', () => {
  /** The online_games row as online-table-setup.sql keeps it: a save is a
   * duplicate if its op is in the ring, a miss if the version moved, and
   * otherwise it lands. */
  function table(initial: GameState) {
    const row = { state: initial, version: 1, recent: [] as string[] };
    let lose = false;
    let drop = false;
    const save = vi.fn(async (_code: string, base: number, state: GameState, op: string) => {
      if (drop) {
        drop = false;
        throw new Error('the request never reached the table');
      }
      let answer;
      if (row.recent.includes(op)) {
        answer = { ok: true, duplicate: true, version: row.version, state: row.state, app_schema: GAME_SCHEMA };
      } else if (row.version !== base) {
        answer = { ok: false, gone: false, ended: false, version: row.version, state: row.state, app_schema: GAME_SCHEMA };
      } else {
        row.state = state;
        row.version += 1;
        row.recent = [op, ...row.recent].slice(0, 8);
        answer = { ok: true, version: row.version };
      }
      if (lose) {
        lose = false;
        throw new Error('the answer never came back');
      }
      return answer;
    });
    deps.rpcSave = save as typeof deps.rpcSave;
    deps.rpcGet = vi.fn(async (_code: string, known: number) => ({
      state: row.version > known ? row.state : null,
      version: row.version,
      ended: false,
      app_schema: GAME_SCHEMA,
    })) as typeof deps.rpcGet;
    return {
      row,
      save,
      /** The next save lands, but this device never hears so. */
      loseNextAnswer: () => (lose = true),
      /** The next save does not even reach the table. */
      dropNextRequest: () => (drop = true),
      /** Another device writes on top of whatever the table holds. */
      someoneElse(change: (s: GameState) => GameState) {
        row.state = change(row.state);
        row.version += 1;
        row.recent = [crypto.randomUUID(), ...row.recent].slice(0, 8);
      },
    };
  }

  /** One tap on this device: the store applies it, then tells the module. */
  function tap(f: Fake, change: (s: GameState) => GameState) {
    const before = f.game.current;
    f.game.current = change(before);
    onLocalMutation(change, before);
  }
  const hit = (seat: number) => (s: GameState) => adjustLife(s, seat, -1);
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(2500);
    await drain();
  };

  test('is not applied a second time when another change follows before the retry', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const t = table(g);
    t.loseNextAnswer();
    tap(f, hit(0));
    await flushDebounce(); // landed as v2; this device does not know
    expect(t.row.state.players[0].life).toBe(39);
    tap(f, hit(0)); // a second tap before the retry
    await settle();
    expect(t.row.state.players[0].life).toBe(38); // two taps, two points: not three
    expect(f.game.current.players[0].life).toBe(38);
    expect(f.hooks.notice).not.toHaveBeenCalled();
  });

  test('goes out again exactly as it was, so the table can recognise it', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const t = table(g);
    t.loseNextAnswer();
    tap(f, hit(0));
    await flushDebounce();
    tap(f, hit(0));
    await settle();
    const [first, again, next] = t.save.mock.calls;
    expect(again.slice(1)).toEqual(first.slice(1)); // same base, same state, same op id
    expect(next[3]).not.toBe(first[3]); // what was queued behind it is a save of its own
    expect((next[2] as GameState).players[0].life).toBe(38);
    expect(t.save).toHaveBeenCalledTimes(3);
  });

  test('simply lands on the retry when it had not reached the table, and what was queued behind it follows once', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const t = table(g);
    t.dropNextRequest();
    tap(f, hit(0));
    await flushDebounce();
    expect(t.row.version).toBe(1); // nothing landed
    tap(f, hit(1));
    await settle();
    expect(t.row.state.players.map((p) => p.life)).toEqual([39, 39]);
    expect(f.game.current.players.map((p) => p.life)).toEqual([39, 39]);
    expect(f.hooks.notice).not.toHaveBeenCalled();
  });

  test('is recognised even after someone else wrote, and only the newer change is replayed on top', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const t = table(g);
    t.loseNextAnswer();
    tap(f, hit(0));
    await flushDebounce(); // ours landed as v2
    t.someoneElse((s) => adjustLife(s, 1, -5)); // v3, on top of ours
    tap(f, hit(0));
    await settle();
    expect(t.row.state.players.map((p) => p.life)).toEqual([38, 35]);
    expect(f.game.current.players.map((p) => p.life)).toEqual([38, 35]);
  });

  test('is not replayed by a doorbell that arrives before the retry', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const t = table(g);
    t.loseNextAnswer();
    tap(f, hit(0));
    await flushDebounce(); // ours landed as v2
    t.someoneElse((s) => adjustLife(s, 1, -5)); // v3
    f.fireBump({ v: 3, by: 'someone-else' }); // reconcile runs with our save still unanswered
    await settle();
    expect(t.row.state.players.map((p) => p.life)).toEqual([39, 35]); // our tap counted once
    expect(f.game.current.players.map((p) => p.life)).toEqual([39, 35]);
  });

  test('does not cost an undo made meanwhile: the table had only moved by that very save', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const t = table(g);
    t.loseNextAnswer();
    tap(f, hit(0));
    await flushDebounce(); // landed as v2 (life 39)
    f.game.current = g; // the player undoes it
    onLocalUndo(g);
    await settle();
    expect(t.row.state.players[0].life).toBe(40); // the undo reached the table
    expect(f.game.current.players[0].life).toBe(40);
    expect(f.hooks.notice).not.toHaveBeenCalledWith(expect.stringMatching(/undo skipped/i));
  });

  test('is forgotten when the table is left: a new table never receives it', async () => {
    const g = freshGame();
    const f = setup(g);
    await hostTable(g);
    const t = table(g);
    t.dropNextRequest();
    tap(f, hit(0));
    await flushDebounce(); // unanswered, and still queued
    await leaveTable();
    await hostTable(g); // a fresh table, version 1 again
    const fresh = table(g);
    f.game.current = g;
    tap(f, hit(1));
    await settle();
    expect(fresh.save).toHaveBeenCalledTimes(1);
    expect(fresh.row.state.players.map((p) => p.life)).toEqual([40, 39]); // only the new table's own tap
  });
});
