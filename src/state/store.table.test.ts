import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import { GAME_SCHEMA, _resetForTests, deps } from '../data/onlineTable';
import { moveCard } from '../lib/cards';
import { addCard, changeCardCount, createDeck, setCommander } from '../lib/deck';
import { adjustLife } from '../lib/game';
import type { CardRecord, GameConfig, GameState } from '../lib/types';
import { createAppStore, flushPersistence } from './store';

// The reveal and the exile from the top, played at a REAL online table: the
// real store and the real sync module, with only the network swapped for the
// row that online-table-setup.sql keeps.

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: [
    { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
  ],
};

const record = (id: string, name: string, typeLine: string): CardRecord => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  typeLine,
  oracleText: '',
  manaCost: '',
  power: null,
  toughness: null,
  colors: [],
  colorIdentity: ['G'],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: typeLine.startsWith('Basic Land'),
});

/** The table's row: a save is a duplicate if its op is in the ring, a miss
 * if the version moved, and otherwise it lands. */
function table() {
  const row = { state: null as GameState | null, version: 0, recent: [] as string[] };
  deps.rpcCreate = async (state) => {
    row.state = state;
    row.version = 1;
    return 'KQ7M2X';
  };
  deps.rpcSave = async (_code, base, state, op) => {
    if (row.recent.includes(op))
      return { ok: true, duplicate: true, version: row.version, state: row.state!, app_schema: GAME_SCHEMA };
    if (row.version !== base)
      return { ok: false, gone: false, ended: false, version: row.version, state: row.state!, app_schema: GAME_SCHEMA };
    row.state = state;
    row.version += 1;
    row.recent = [op, ...row.recent].slice(0, 8);
    return { ok: true, version: row.version };
  };
  deps.rpcGet = async (_code, known) => ({
    state: row.version > known ? row.state : null,
    version: row.version,
    ended: false,
    app_schema: GAME_SCHEMA,
  });
  deps.openChannel = async () => ({ sendBump: async () => {}, close: () => {} });
  deps.refreshAuth = async () => {};
  return {
    row,
    state: () => row.state!,
    /** Another device writes on top of whatever the table holds. */
    someoneElse(change: (s: GameState) => GameState) {
      row.state = change(row.state!);
      row.version += 1;
      row.recent = [crypto.randomUUID(), ...row.recent].slice(0, 8);
    },
  };
}

/** A device hosting a two-seat cards table, seat 0 dealt in and in sync. */
async function hosted() {
  const store = createAppStore();
  await store.getState().init();
  const t = table();
  expect(await store.getState().hostOnlineGame(config)).toBeNull();
  let deck = setCommander(createDeck('Stompy'), record('c-cmd', 'Ashaya', 'Legendary Creature — Elemental'));
  deck = addCard(deck, record('c-forest', 'Forest', 'Basic Land — Forest'));
  deck = changeCardCount(deck, 'c-forest', 11); // twelve cards: seven in hand, five in the library
  store.getState().seedSeatFromDeck(0, deck, 42);
  await landed(store, t);
  return { store, t };
}

/** Waits until the table holds exactly what this device holds. */
async function landed(store: ReturnType<typeof createAppStore>, t: ReturnType<typeof table>) {
  await vi.waitFor(() => expect(t.state()).toEqual(store.getState().game), { timeout: 4000, interval: 50 });
}

const feedOf = (g: GameState) => (g.feed ?? []).map((e) => e.text);

beforeEach(async () => {
  await flushPersistence();
  const db = getDb();
  await db.kv.clear();
  await db.profiles.clear();
  await db.decks.clear();
  await db.garage.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await _resetForTests();
});

test('a reveal that raced someone else’s change reaches the table once, as the same reveal', async () => {
  const { store, t } = await hosted();
  const card = store.getState().game!.players[0].cards!.hand[0];
  t.someoneElse((s) => adjustLife(s, 1, -5)); // the table moved first
  store.getState().revealCards(0, [card.iid], 'hand');
  const id = store.getState().game!.reveal!.id;
  await landed(store, t);
  expect(t.state().reveal).toMatchObject({ id, seat: 0, from: 'hand', cards: [{ name: card.name }] });
  expect(t.state().players[1].life).toBe(35); // their change is kept
  expect(feedOf(t.state()).filter((line) => /reveals/.test(line))).toEqual([
    `A reveals ${card.name} from their hand`,
  ]);
  expect(store.getState().game!.reveal!.id).toBe(id); // the same reveal: this device does not show it twice
});

test('a reveal whose card left the hand first never reaches the table, and the device says so', async () => {
  const { store, t } = await hosted();
  const card = store.getState().game!.players[0].cards!.hand[0];
  t.someoneElse((s) => moveCard(s, 0, card.iid, 'hand', 'graveyard')); // discarded from another device
  store.getState().revealCards(0, [card.iid], 'hand');
  expect(store.getState().game!.reveal).toBeDefined(); // shown here for a moment
  await landed(store, t);
  expect(t.state().reveal).toBeUndefined();
  expect(feedOf(t.state()).some((line) => /reveals/.test(line))).toBe(false);
  expect(store.getState().game!.reveal).toBeUndefined(); // …and taken back with the table's answer
  expect(store.getState().log.map((l) => l.text)).toContain(
    'One change was overtaken by the table and skipped',
  );
});

test('a reveal from the top is dropped when a shuffle got to the table first; an exile aimed at the same card is not', async () => {
  const { store, t } = await hosted();
  const [x, y, z] = store.getState().game!.players[0].cards!.library;
  // Another device shuffles seat 0's library: x is buried now.
  t.someoneElse((s) => ({
    ...s,
    players: s.players.map((p, i) =>
      i === 0 ? { ...p, cards: { ...p.cards!, library: [z, y, ...p.cards!.library.slice(3), x] } } : p,
    ),
  }));
  store.getState().revealCards(0, [x.iid], 'library'); // "the top card is x" — not any more
  store.getState().exileCards(0, 1); // x itself, wherever it now sits: exiled first stands
  await landed(store, t);
  expect(t.state().reveal).toBeUndefined();
  expect(t.state().players[0].cards!.exile.map((c) => c.iid)).toEqual([x.iid]);
  expect(feedOf(t.state())).toContain('A exiles the top 1');
  expect(feedOf(t.state()).some((line) => /reveals/.test(line))).toBe(false);
});

test('a reveal that waited too long to reach the table does not push a newer one off it', async () => {
  const { store, t } = await hosted();
  const card = store.getState().game!.players[0].cards!.hand[0];
  const clock = vi.spyOn(deps, 'now');
  const t0 = Date.now();
  clock.mockReturnValue(t0);
  const newer = {
    id: 'r-newer',
    seat: 1,
    from: 'hand' as const,
    cards: [{ cardId: 'c-x', name: 'Their Card' }],
    t: t0 + 170_000,
  };
  t.someoneElse((s) => ({ ...s, reveal: newer })); // revealed by someone else while this device was away
  store.getState().revealCards(0, [card.iid], 'hand'); // made just before the nap…
  store.getState().exileCards(0, 1); // …together with a card that actually moved
  clock.mockReturnValue(t0 + 180_000); // …and only pushed three minutes later
  await landed(store, t);
  expect(t.state().reveal).toEqual(newer); // the table's reveal stands
  expect(store.getState().game!.reveal).toEqual(newer);
  expect(t.state().players[0].cards!.exile).toHaveLength(1); // the exile is not lost with it
  expect(feedOf(t.state())).toContain('A exiles the top 1');
  expect(feedOf(t.state()).some((line) => /A reveals/.test(line))).toBe(false);
});

test('a look that exiles and bottoms lands whole on a table that moved meanwhile', async () => {
  const { store, t } = await hosted();
  const [a, b, c] = store.getState().game!.players[0].cards!.library.map((x) => x.iid);
  t.someoneElse((s) => adjustLife(s, 1, -2));
  store.getState().arrangeTop(0, [a, b, c], { top: [], bottom: [c, a], graveyard: [], hand: [], exile: [b] });
  await landed(store, t);
  const seat = t.state().players[0].cards!;
  expect(seat.exile.map((x) => x.iid)).toEqual([b]);
  expect(seat.library.slice(-2).map((x) => x.iid)).toEqual([c, a]); // in the order the plan gave
  expect(t.state().players[1].life).toBe(38);
  expect(feedOf(t.state())).toContain('A puts 2 on the bottom, 1 exiled');
});
