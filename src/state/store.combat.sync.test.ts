import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import { liveCombat } from '../lib/combat';
import type { BoardItem, CombatUnit, GameConfig, GameState } from '../lib/types';

// Combat on an online table, with TWO REAL DEVICES: each one is its own instance of the real
// store and of the real sync module (data/onlineTable.ts). Only the network is stood in for:
// one in-memory row that behaves like online-table-setup.sql — a save is a duplicate if its
// op id is in the ring of the last 8, a miss if the version moved, and otherwise it lands.
// These are the races a single store with a mocked table cannot show.

type StoreModule = typeof import('./store');
type TableModule = typeof import('../data/onlineTable');

interface Device {
  name: string;
  store: ReturnType<StoreModule['createAppStore']>;
  /** false: every request from this device fails (no signal, a locked phone). */
  online: boolean;
  /** The next save lands, but the phone locks before the answer arrives. */
  loseNextAnswer: boolean;
  bump: ((payload: Record<string, unknown>) => void) | null;
  game(): GameState;
  /** What this device told its player about changes of theirs that did not stand. */
  skipped(): string[];
}

/** What a jsonb column hands back: the same value, object keys in ITS order (shorter keys
 * first, then by bytes) — never the order they were written in. */
function jsonb<T>(value: T): T {
  if (Array.isArray(value)) return value.map(jsonb) as unknown as T;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(keys.map((k) => [k, jsonb(obj[k])])) as T;
  }
  return value;
}

function makeTable() {
  const row = { state: null as GameState | null, version: 0, recent: [] as string[], schema: 1, misses: 0 };
  const devices: Device[] = [];
  const modules: TableModule[] = [];

  async function addDevice(name: string): Promise<Device> {
    vi.resetModules(); // a device of its own: its own store, its own sync module, its own queue
    const table = await import('../data/onlineTable');
    const { createAppStore } = await import('./store');
    const store = createAppStore();
    const d: Device = {
      name,
      store,
      online: true,
      loseNextAnswer: false,
      bump: null,
      game: () => store.getState().game!,
      skipped: () =>
        store
          .getState()
          .log.map((l) => l.text)
          .filter((text) => /overtaken|skipped|moved on/i.test(text)),
    };
    table.deps.refreshAuth = async () => {};
    table.deps.rpcCreate = async (state) => {
      row.state = jsonb(state);
      row.version = 1;
      return 'KQ7M2X';
    };
    table.deps.rpcGet = async (_code, known) => {
      if (!d.online) throw new Error('offline');
      return {
        state: row.version > known ? jsonb(row.state) : null,
        version: row.version,
        ended: false,
        app_schema: row.schema,
      };
    };
    table.deps.rpcSave = async (_code, base, state, op, schema) => {
      if (!d.online) throw new Error('offline');
      let answer;
      if (row.recent.includes(op)) {
        answer = { ok: true, duplicate: true, version: row.version, state: jsonb(row.state!), app_schema: row.schema };
      } else if (row.version !== base) {
        row.misses += 1; // the table moved first: this device has to replay its queue on top
        answer = { ok: false, gone: false, ended: false, version: row.version, state: jsonb(row.state!), app_schema: row.schema };
      } else {
        row.state = jsonb(state);
        row.version += 1;
        row.recent = [op, ...row.recent].slice(0, 8);
        row.schema = Math.max(row.schema, schema);
        answer = { ok: true, version: row.version };
      }
      if (d.loseNextAnswer) {
        d.loseNextAnswer = false;
        d.online = false;
        throw new Error('the answer never came back');
      }
      return answer;
    };
    table.deps.openChannel = (async (_code: string, handlers: { onBump(p: Record<string, unknown>): void }) => {
      d.bump = handlers.onBump;
      return {
        sendBump: async (payload: Record<string, unknown>) => {
          for (const other of devices) if (other !== d && other.online) other.bump?.(payload);
        },
        close: () => {},
      };
    }) as TableModule['deps']['openChannel'];
    await store.getState().init(); // binds the store to its sync module
    devices.push(d);
    modules.push(table);
    return d;
  }

  return {
    row,
    addDevice,
    /** Lets debounced saves (350 ms), their retries and their doorbells run dry. */
    async settle(ms = 2500) {
      await vi.advanceTimersByTimeAsync(ms);
      for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(0);
    },
    /** A device comes back: its signal returns and the table's doorbell reaches it. */
    wake(d: Device) {
      d.online = true;
      d.bump?.({ v: row.version, by: 'someone-else' });
    },
    /** The 30 s poll, now: the device asks the table whether anything moved. */
    poll(d: Device) {
      d.bump?.({ v: row.version, by: 'the-poll' });
    },
    async close() {
      for (const m of modules) await m._resetForTests();
    },
  };
}

const NAMES = ['Nathan', 'Sam', 'Alex', 'Kim'];
const config = (seats: number): GameConfig => ({
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: NAMES.slice(0, seats).map((name, i) => ({ id: `p${i}`, name, avatarUrl: null, commanderName: null })),
});

/** A creature kept as a tile: this table has no decks, so nothing depends on card records. */
const tile = (id: string): BoardItem => ({
  id,
  cardId: null,
  name: id,
  imageNormal: null,
  imageArtCrop: null,
  typeLine: 'Token Creature',
  oracleText: '',
  basePower: 2,
  baseToughness: 2,
  count: 1,
  counters: {},
  color: null,
  zone: 'board',
});
const unit = (id: string): CombatUnit => ({ kind: 'stack', id });

let table: ReturnType<typeof makeTable>;

/** A tablet hosting a table of `seats` and a phone that joined it. Nathan has a bear, a wolf
 * and a dragon; Sam a wall; Alex a knight. It is Nathan's turn. */
async function pair(seats: number): Promise<{ T: Device; P: Device }> {
  table = makeTable();
  const T = await table.addDevice('tablet');
  const P = await table.addDevice('phone');
  expect(await T.store.getState().hostOnlineGame(config(seats))).toBeNull();
  for (const id of ['bear', 'wolf', 'dragon']) T.store.getState().addItem(0, tile(id));
  T.store.getState().addItem(1, tile('wall'));
  if (seats > 2) T.store.getState().addItem(2, tile('knight'));
  await table.settle();
  expect(await P.store.getState().joinOnlineGame('KQ7M2X')).toBeNull();
  await table.settle();
  expect(P.game().players[0].board.map((it) => it.id)).toEqual(['bear', 'wolf', 'dragon']);
  return { T, P };
}

/** What the table holds, as any device would read it. */
const onTable = () => table.row.state!;
const show = (g: GameState) => {
  const c = liveCombat(g);
  return c
    ? `${c.step}${c.defender !== undefined ? ` (defender ${c.defender})` : ''}: ${(c.attacks ?? [])
        .map((a) => `${a.unit.id}>${a.target}${a.blockers ? ` blocked by ${a.blockers.map((b) => b.id).join('+')}` : ''}`)
        .join(', ')}`
    : 'no combat';
};

beforeEach(async () => {
  await getDb().kv.clear();
  // Only the four timer functions: fake-indexeddb does its work on setImmediate.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(async () => {
  await table?.close();
  vi.useRealTimers();
});

describe('combat on an online table: two real devices, one stand-in row', () => {
  test('a declaration made on the tablet reaches the phone whole, through a jsonb round trip', async () => {
    const { T, P } = await pair(2);
    T.store.getState().startCombat();
    T.store.getState().setAttacker(unit('bear'), 1, 1);
    T.store.getState().setAttacker(unit('wolf'), 1, 1);
    await T.store.getState().confirmAttackers();
    await table.settle();
    expect(show(P.game())).toBe('blockers (defender 1): bear>1, wolf>1');
    expect(liveCombat(P.game())).toEqual(liveCombat(T.game()));
    expect(P.game().players[0].board.map((it) => it.tapped ?? 0)).toEqual([1, 1, 0]); // the attackers are tapped there too
    expect(P.store.getState().log.some((l) => l.text === 'Nathan attacks Sam with 2 creatures')).toBe(true);
    // The defender blocks on his phone, and the tablet applies what they agree on.
    P.store.getState().setBlocker(1, unit('bear'), unit('wall'), 1);
    P.store.getState().finishBlocks(1);
    await table.settle();
    expect(show(T.game())).toBe('damage: bear>1 blocked by wall, wolf>1');
    T.store.getState().applyCombat({ players: [{ seat: 1, life: -2 }], deaths: [{ seat: 1, unit: unit('wall'), n: 1 }] });
    await table.settle();
    for (const g of [onTable(), T.game(), P.game()]) {
      expect(g.players[1].life).toBe(38);
      expect(g.players[1].board).toEqual([]);
      expect(liveCombat(g)).toBeNull();
    }
    expect([...T.skipped(), ...P.skipped()]).toEqual([]);
  });

  test('a whole fight queued behind somebody else’s change is replayed whole: the guards do not eat honest moves', async () => {
    const { T, P } = await pair(2);
    P.store.getState().adjustLife(1, -1); // Sam pays a life on his phone: this save lands first
    // …while the tablet, not having heard of it yet, plays a whole fight in one breath.
    T.store.getState().startCombat();
    T.store.getState().setAttacker(unit('bear'), 1, 1);
    T.store.getState().setAttacker(unit('wolf'), 1, 1);
    await T.store.getState().confirmAttackers();
    T.store.getState().setBlocker(1, unit('bear'), unit('wall'), 1);
    T.store.getState().setAttackBlocked(1, unit('wolf'), true);
    T.store.getState().finishBlocks(1);
    T.store.getState().applyCombat({ players: [{ seat: 1, life: -1 }], deaths: [{ seat: 1, unit: unit('wall'), n: 1 }] });
    await table.settle();
    expect(table.row.misses).toBeGreaterThan(0); // the tablet's save did lose the race and was rebased
    for (const g of [onTable(), T.game(), P.game()]) {
      expect(g.players[1].life).toBe(38); // his own life paid, and the fight's point on top
      expect(g.players[1].board).toEqual([]);
      expect(g.players[0].board.map((it) => it.tapped ?? 0)).toEqual([1, 1, 0]);
      expect(liveCombat(g)).toBeNull();
      expect(g.combat?.step).toBe('done');
    }
    expect([...T.skipped(), ...P.skipped()]).toEqual([]);
    expect(P.store.getState().log.map((l) => l.text)).toEqual(
      expect.arrayContaining([
        'Nathan attacks Sam with 2 creatures',
        'Sam blocks 2 attackers',
        'Combat: Sam takes 1 · wall dies',
      ]),
    );
  });

  test('in a pod, "no blocks" pressed for Sam on his phone AND on the tablet does not skip Alex', async () => {
    const { T, P } = await pair(4);
    T.store.getState().startCombat();
    T.store.getState().setAttacker(unit('bear'), 1, 1); // at Sam
    T.store.getState().setAttacker(unit('wolf'), 2, 1); // at Alex
    await T.store.getState().confirmAttackers();
    await table.settle();
    expect(show(P.game())).toBe('blockers (defender 1): bear>1, wolf>2');
    P.store.getState().finishBlocks(1); // Sam taps it on his phone…
    T.store.getState().finishBlocks(1); // …and Nathan, hearing him, taps it on the tablet
    await table.settle();
    for (const g of [onTable(), T.game(), P.game()]) {
      expect(show(g)).toBe('blockers (defender 2): bear>1, wolf>2'); // Alex is asked
    }
    expect([...T.skipped(), ...P.skipped()]).toHaveLength(1); // one of the two presses was dropped, and said so
  });

  test('a Pass turn pressed on a phone that had not heard of the combat does not erase it', async () => {
    const { T, P } = await pair(2);
    P.online = false; // the phone's connection hiccups
    T.store.getState().startCombat();
    T.store.getState().setAttacker(unit('bear'), 1, 1);
    await T.store.getState().confirmAttackers();
    await table.settle();
    expect(liveCombat(P.game())).toBeNull(); // its hub shows no combat: Pass turn is live
    P.store.getState().passTurn();
    await table.settle(200);
    table.wake(P);
    await table.settle();
    table.poll(T);
    await table.settle();
    for (const g of [onTable(), T.game(), P.game()]) {
      expect(g.activePlayerIndex).toBe(0); // still Nathan's turn
      expect(show(g)).toBe('blockers (defender 1): bear>1');
    }
    expect(onTable().players[0].board[0].tapped).toBe(1); // and his attacker is still tapped for a reason
    expect(P.skipped()).toHaveLength(1);
  });

  test('a defender who finishes on a napping phone does not block an attack that was re-declared meanwhile', async () => {
    const { T, P } = await pair(2);
    T.store.getState().startCombat();
    T.store.getState().setAttacker(unit('bear'), 1, 1);
    await T.store.getState().confirmAttackers();
    await table.settle();
    P.online = false; // the defender's phone drops off
    P.store.getState().setBlocker(1, unit('bear'), unit('wall'), 1);
    P.store.getState().finishBlocks(1);
    expect(show(P.game())).toBe('damage: bear>1 blocked by wall'); // what the phone believes
    // Meanwhile the attacker takes the declaration back (Undo) and attacks with the dragon instead.
    T.store.getState().undo();
    await table.settle();
    expect(show(onTable())).toBe('attackers: bear>1');
    T.store.getState().setAttacker(unit('bear'), 1, 0);
    T.store.getState().setAttacker(unit('dragon'), 1, 1);
    await T.store.getState().confirmAttackers();
    await table.settle();
    table.wake(P);
    await table.settle();
    table.poll(T);
    await table.settle();
    for (const g of [onTable(), T.game(), P.game()]) {
      expect(show(g)).toBe('blockers (defender 1): dragon>1'); // Sam is asked about the dragon
    }
    expect(P.skipped().join(' ')).toMatch(/2 changes were overtaken/);
  });

  test('a declaration whose answer was lost does not come back to life after the combat is over', async () => {
    const { T, P } = await pair(2);
    // The attacker declares on his phone and puts it down: the save lands, the phone locks
    // before the answer arrives.
    P.store.getState().startCombat();
    P.store.getState().setAttacker(unit('bear'), 1, 1);
    await P.store.getState().confirmAttackers();
    P.loseNextAnswer = true;
    await table.settle();
    expect(P.online).toBe(false);
    table.poll(T); // the tablet's poll picks the attack up
    await table.settle();
    expect(show(T.game())).toBe('blockers (defender 1): bear>1');
    T.store.getState().finishBlocks(1);
    await table.settle();
    T.store.getState().applyCombat({ players: [{ seat: 1, life: -2 }], deaths: [] });
    await table.settle();
    // The table plays on: nine more saves push the phone's save out of the table's ring of eight.
    for (let i = 0; i < 9; i++) {
      T.store.getState().adjustLife(0, i % 2 ? 1 : -1);
      await table.settle(600);
    }
    expect(onTable().players[1].life).toBe(38);
    expect(liveCombat(onTable())).toBeNull();
    table.wake(P); // same turn: he picks the phone back up, and its whole queue is replayed
    await table.settle();
    table.poll(T);
    await table.settle();
    for (const g of [onTable(), T.game(), P.game()]) {
      expect(show(g)).toBe('no combat'); // no blockers bar pops up again
      expect(g.players[1].life).toBe(38); // and nothing can be dealt a second time
      expect(g.players[0].board[0].tapped).toBe(1); // the bear attacked once
    }
    expect(P.skipped().join(' ')).toMatch(/3 changes were overtaken/);
  });

  test('two devices pressing Apply apply it once', async () => {
    const { T, P } = await pair(2);
    T.store.getState().startCombat();
    T.store.getState().setAttacker(unit('bear'), 1, 1);
    await T.store.getState().confirmAttackers();
    T.store.getState().finishBlocks(1);
    await table.settle();
    expect(show(P.game())).toBe('damage: bear>1');
    T.store.getState().applyCombat({ players: [{ seat: 1, life: -2 }], deaths: [] });
    P.store.getState().applyCombat({ players: [{ seat: 1, life: -2 }], deaths: [] });
    await table.settle();
    for (const g of [onTable(), T.game(), P.game()]) {
      expect(g.players[1].life).toBe(38);
      expect(liveCombat(g)).toBeNull();
    }
  });

  test('an Apply pressed against blocks that were then changed is dropped', async () => {
    const { T, P } = await pair(2);
    T.store.getState().startCombat();
    T.store.getState().setAttacker(unit('bear'), 1, 1);
    await T.store.getState().confirmAttackers();
    await table.settle();
    T.store.getState().finishBlocks(1); // no blocks: the bar says "Sam −2"
    await table.settle();
    P.online = false;
    P.store.getState().applyCombat({ players: [{ seat: 1, life: -2 }], deaths: [] }); // pressed as the phone drops off
    T.store.getState().undo(); // "wait, I do block": back to blockers on the tablet
    await table.settle();
    T.store.getState().setBlocker(1, unit('bear'), unit('wall'), 1);
    T.store.getState().finishBlocks(1); // the bar now says "Sam −0"
    await table.settle();
    table.wake(P);
    await table.settle();
    table.poll(T);
    await table.settle();
    for (const g of [onTable(), T.game(), P.game()]) {
      expect(g.players[1].life).toBe(40);
      expect(show(g)).toBe('damage: bear>1 blocked by wall');
    }
    expect(P.skipped()).toHaveLength(1);
  });

  test('a Cancel pressed on a napping phone does not call off the attack that replaced the one it saw', async () => {
    const { T, P } = await pair(2);
    T.store.getState().startCombat();
    T.store.getState().setAttacker(unit('bear'), 1, 1);
    await T.store.getState().confirmAttackers();
    await table.settle();
    P.online = false;
    P.store.getState().cancelCombat();
    T.store.getState().undo();
    await table.settle();
    T.store.getState().setAttacker(unit('wolf'), 1, 1);
    await T.store.getState().confirmAttackers();
    await table.settle();
    table.wake(P);
    await table.settle();
    for (const g of [onTable(), T.game(), P.game()]) {
      expect(show(g)).toBe('blockers (defender 1): bear>1, wolf>1');
    }
    expect(onTable().players[0].board.map((it) => it.tapped ?? 0)).toEqual([1, 1, 0]); // nothing was stood back up
  });
});
