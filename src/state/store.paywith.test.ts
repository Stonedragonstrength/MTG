import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { createAppStore, flushPersistence } from './store';

vi.mock('../lib/sound', () => ({
  playLifeTick: vi.fn(),
  playTurnChime: vi.fn(),
  playDefeat: vi.fn(),
}));

vi.mock('../data/onlineTable', () => ({
  GAME_SCHEMA: 1,
  bindTable: vi.fn(),
  resumeTable: vi.fn(async () => null),
  hostTable: vi.fn(async () => ({ code: 'KQ7M2X' })),
  joinTable: vi.fn(async () => ({ error: 'nope' })),
  leaveTable: vi.fn(async () => {}),
  endTableForEveryone: vi.fn(async () => {}),
  setMySeat: vi.fn(),
  onLocalMutation: vi.fn(),
  onLocalUndo: vi.fn(),
}));

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: [
    { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  ],
};

function rec(id: string, name: string, typeLine: string, more: Partial<CardRecord> = {}): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText: '',
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
    ...more,
  };
}

const elves: BoardItem = {
  id: 'elves',
  cardId: null,
  name: 'Elf Druid',
  imageNormal: null,
  imageArtCrop: null,
  typeLine: 'Token Creature — Elf Druid',
  oracleText: '{T}: Add {G}.',
  basePower: 1,
  baseToughness: 1,
  count: 3,
  counters: {},
  color: null,
  zone: 'board',
};

beforeEach(async () => {
  await flushPersistence();
  const db = getDb();
  await db.kv.clear();
  await db.cards.clear();
  await db.cards.bulkPut([
    rec('c-forest', 'Forest', 'Basic Land — Forest', { oracleText: '({T}: Add {G}.)' }),
    rec('c-island', 'Island', 'Basic Land — Island', { oracleText: '({T}: Add {U}.)' }),
    rec('c-ring', 'Sol Ring', 'Artifact', { oracleText: '{T}: Add {C}{C}.' }),
    rec('c-cult', 'Cultivate', 'Sorcery', { manaCost: '{2}{G}' }),
    rec('c-tatyova', 'Tatyova, Benthic Druid', 'Legendary Creature — Merfolk Druid', { manaCost: '{3}{G}{U}' }),
  ]);
});

const land = (iid: string, kind: 'forest' | 'island'): CardInstance => ({
  iid,
  cardId: `c-${kind}`,
  name: kind === 'forest' ? 'Forest' : 'Island',
  row: 'lands',
});

/** Nathan: three Forests, three Islands and a Sol Ring; Cultivate in hand,
 * Tatyova in the command zone, three Elf Druid tokens. */
function table() {
  const store = createAppStore();
  store.getState().startGame(config);
  const g = store.getState().game!;
  const game: GameState = {
    ...g,
    players: [
      {
        ...g.players[0],
        board: [elves],
        cards: {
          library: [],
          hand: [{ iid: 'h-cult', cardId: 'c-cult', name: 'Cultivate' }],
          battlefield: [
            land('f1', 'forest'),
            land('f2', 'forest'),
            land('f3', 'forest'),
            land('i1', 'island'),
            land('i2', 'island'),
            land('i3', 'island'),
            { iid: 'ring', cardId: 'c-ring', name: 'Sol Ring' },
          ],
          graveyard: [],
          exile: [],
          command: [{ iid: 'cmd', cardId: 'c-tatyova', name: 'Tatyova, Benthic Druid' }],
          mulligans: 0,
          deckName: 'Test',
          cmd: { cmd: 0 },
        },
      },
      g.players[1],
    ],
  };
  store.setState({ game });
  return store;
}

type Store = ReturnType<typeof createAppStore>;
/** iid → what its tap has spent ('—' for a card that is tapped with nothing spent). */
const tappedOf = (store: Store) =>
  Object.fromEntries(
    store
      .getState()
      .game!.players[0].cards!.battlefield.filter((c) => c.tapped)
      .map((c) => [c.iid, c.spent ?? '—']),
  );

test('left to itself the table pays Cultivate with the Sol Ring and a Forest', async () => {
  const store = table();
  await store.getState().playCard(0, 'h-cult');
  expect(tappedOf(store)).toEqual({ f1: 1, ring: 2 });
});

test('told what to pay with, it taps exactly those and nothing else', async () => {
  const store = table();
  await store.getState().playCard(0, 'h-cult', { using: { f3: 1, i1: 1, i2: 1 } });
  expect(tappedOf(store)).toEqual({ f3: 1, i1: 1, i2: 1 });
  expect(store.getState().game!.players[0].cards!.graveyard.map((c) => c.iid)).toEqual(['h-cult']);
});

test('the card and its chosen mana are one move: one Undo takes both back', async () => {
  const store = table();
  const before = store.getState().game;
  await store.getState().playCard(0, 'h-cult', { using: { f3: 1, i1: 1, i2: 1 } });
  store.getState().undo();
  expect(store.getState().game).toBe(before);
});

test('fewer than the cost (a reducer on the board): the card is cast and what was lit is spent', async () => {
  const store = table();
  await store.getState().playCard(0, 'h-cult', { using: { f1: 1, i1: 1 } });
  expect(tappedOf(store)).toEqual({ f1: 1, i1: 1 });
  expect(store.getState().game!.players[0].cards!.hand).toEqual([]);
});

test('one more than the cost: it is tapped too, and its mana floats', async () => {
  const store = table();
  await store.getState().playCard(0, 'h-cult', { using: { f1: 1, f2: 1, i1: 1, i2: 1 } });
  const tapped = tappedOf(store);
  expect(Object.keys(tapped).sort()).toEqual(['f1', 'f2', 'i1', 'i2']);
  expect(Object.values(tapped).filter((spent) => spent === '—')).toHaveLength(1);
});

test('a chosen land somebody tapped out meanwhile is passed over; no other land steps in', async () => {
  const store = table();
  const g = store.getState().game!;
  store.setState({
    game: {
      ...g,
      players: g.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              cards: {
                ...p.cards!,
                battlefield: p.cards!.battlefield.map((c) =>
                  c.iid === 'i2' ? { ...c, tapped: true, spent: 1 } : c,
                ),
              },
            }
          : p,
      ),
    },
  });
  await store.getState().playCard(0, 'h-cult', { using: { f3: 1, i1: 1, i2: 1 } });
  expect(tappedOf(store)).toEqual({ f3: 1, i1: 1, i2: 1 }); // i2 as it already was
});

test('copies of a token stack pay by how many were lit', async () => {
  const store = table();
  await store.getState().playCard(0, 'h-cult', { using: { elves: 2, i1: 1 } });
  expect(store.getState().game!.players[0].board[0].tapped).toBe(2);
  expect(tappedOf(store)).toEqual({ i1: 1 });
});

test('a commander is paid for the same way', async () => {
  const store = table();
  store.getState().castCommander(0, 'cmd', { using: { f1: 1, f2: 1, f3: 1, i1: 1, i2: 1 } });
  await vi.waitFor(() =>
    expect(store.getState().game!.players[0].cards!.battlefield.some((c) => c.iid === 'cmd')).toBe(true),
  );
  expect(tappedOf(store)).toEqual({ f1: 1, f2: 1, f3: 1, i1: 1, i2: 1 });
});
