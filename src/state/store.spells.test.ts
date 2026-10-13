import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import * as tableSync from '../data/onlineTable';
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
    { id: 'p1', name: 'Samantha', avatarUrl: null, commanderName: null },
  ],
};

function rec(id: string, name: string, typeLine: string, pt: string | null, more: Partial<CardRecord> = {}): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText: '',
    manaCost: '',
    power: pt,
    toughness: pt,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
    ...more,
  };
}

const seat = (battlefield: CardInstance[], hand: CardInstance[] = []) => ({
  library: [],
  hand,
  battlefield,
  graveyard: [],
  exile: [],
  command: [],
  mulligans: 0,
  deckName: 'Test',
});

const soldiers: BoardItem = {
  id: 'soldiers',
  cardId: null,
  name: 'Soldier',
  imageNormal: null,
  imageArtCrop: null,
  typeLine: 'Token Creature — Soldier',
  oracleText: '',
  basePower: 1,
  baseToughness: 1,
  count: 2,
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
    rec('c-bear', 'Grizzly Bears', 'Creature — Bear', '2'),
    rec('c-giant', 'Hill Giant', 'Creature — Giant', '3'),
    rec('c-blaze', 'Blaze', 'Sorcery', null, { manaCost: '{X}{R}', oracleText: 'Blaze deals X damage to any target.' }),
  ]);
  vi.mocked(tableSync.onLocalMutation).mockClear();
});

/** Nathan: a bear, and Blaze in hand. Samantha: a giant and two soldiers. */
function table() {
  const store = createAppStore();
  store.getState().startGame(config);
  const g = store.getState().game!;
  const game: GameState = {
    ...g,
    players: [
      {
        ...g.players[0],
        cards: seat(
          [{ iid: 'bear', cardId: 'c-bear', name: 'Grizzly Bears' }],
          [{ iid: 'h-blaze', cardId: 'c-blaze', name: 'Blaze' }],
        ),
      },
      {
        ...g.players[1],
        board: [soldiers],
        cards: seat([{ iid: 'giant', cardId: 'c-giant', name: 'Hill Giant' }]),
      },
    ],
  };
  store.setState({ game });
  return store;
}

type Store = ReturnType<typeof createAppStore>;
const feedOf = (store: Store) => (store.getState().game!.feed ?? []).map((e) => e.text);
const giant = { seat: 1, kind: 'card' as const, id: 'giant' };

test('damage to a player: their life, one line that names the spell, and one Undo', async () => {
  const store = table();
  const before = store.getState().game;
  await store.getState().castEffect(0, 'Lightning Bolt', { kind: 'damage', n: 3, on: { seat: 1, kind: 'player' } });
  expect(store.getState().game!.players[1].life).toBe(37);
  expect(feedOf(store)).toContain('Nathan’s Lightning Bolt deals 3 to Samantha');
  store.getState().undo();
  expect(store.getState().game).toBe(before);
});

test('damage that kills reads the creature’s size off its card', async () => {
  const store = table();
  await store.getState().castEffect(0, 'Lightning Bolt', { kind: 'damage', n: 3, on: giant });
  const sam = store.getState().game!.players[1].cards!;
  expect(sam.battlefield).toEqual([]);
  expect(sam.graveyard.map((c) => c.iid)).toEqual(['giant']);
  expect(feedOf(store)).toContain('Nathan’s Lightning Bolt deals 3 to Samantha’s Hill Giant (3/3), which dies');
});

test('damage that does not kill is said all the same, and changes nothing else', async () => {
  const store = table();
  const before = store.getState().game!;
  await store.getState().castEffect(0, 'Shock', { kind: 'damage', n: 2, on: giant });
  const after = store.getState().game!;
  expect(after.players).toBe(before.players);
  expect(feedOf(store)).toContain('Nathan’s Shock deals 2 to Samantha’s Hill Giant (3/3)');
});

test('a sweeper is one move: one line with the count, and one Undo brings everything back', async () => {
  const store = table();
  const before = store.getState().game;
  await store.getState().castEffect(0, 'Wrath of God', { kind: 'sweep', how: 'destroy' });
  const g = store.getState().game!;
  expect(g.players[0].cards!.battlefield).toEqual([]);
  expect(g.players[1].cards!.battlefield).toEqual([]);
  expect(g.players[1].board).toEqual([]);
  expect(feedOf(store).filter((line) => /Wrath of God/.test(line))).toEqual([
    'Nathan’s Wrath of God destroys all creatures (4)',
  ]);
  store.getState().undo();
  expect(store.getState().game).toBe(before);
});

test('removal and counters name whose permanent it was', async () => {
  const store = table();
  await store.getState().castEffect(0, 'Burst of Strength', { kind: 'counters', n: 2, on: giant });
  expect(store.getState().game!.players[1].cards!.battlefield[0].counters).toEqual({ p1p1: 2 });
  expect(feedOf(store)).toContain('Nathan’s Burst of Strength puts 2 +1/+1 counters on Samantha’s Hill Giant');
  await store.getState().castEffect(0, 'Murder', { kind: 'remove', how: 'destroy', on: giant });
  expect(store.getState().game!.players[1].cards!.graveyard.map((c) => c.iid)).toEqual(['giant']);
  expect(feedOf(store)).toContain('Nathan’s Murder destroys Samantha’s Hill Giant');
});

test('an effect whose target has left does nothing, and its replay is guarded the same way', async () => {
  const store = table();
  await store.getState().castEffect(0, 'Murder', { kind: 'remove', how: 'destroy', on: giant });
  const [op, , sync] = vi.mocked(tableSync.onLocalMutation).mock.lastCall!;
  const landed = store.getState().game!;
  // The same op arriving on a table the giant has already left: refused, and harmless if run.
  expect(sync!.guard!(landed, landed)).toBe(false);
  expect(op(landed)).toBe(landed);
  await store.getState().castEffect(0, 'Murder', { kind: 'remove', how: 'destroy', on: giant });
  await store.getState().castEffect(0, 'Shock', { kind: 'damage', n: 2, on: giant });
  expect(store.getState().game).toBe(landed);
});

test('a spell cast for X carries its X to the table', async () => {
  const store = table();
  await store.getState().playCard(0, 'h-blaze', { x: 4 });
  expect(store.getState().game!.reveal).toMatchObject({ from: 'cast', x: 4, cards: [{ name: 'Blaze' }] });
});
