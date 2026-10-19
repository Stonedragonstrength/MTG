import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { createAppStore, flushPersistence } from './store';

// Crew and ward, carried out by the store: one move each.

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

function rec(id: string, name: string, typeLine: string, oracleText = '', size: [string, string] | null = null): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '{2}',
    power: size?.[0] ?? null,
    toughness: size?.[1] ?? null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

const RECORDS = [
  rec('c-island', 'Island', 'Basic Land — Island', '({T}: Add {U}.)'),
  rec('c-copter', "Smuggler's Copter", 'Artifact — Vehicle', 'Flying\nCrew 1', ['3', '3']),
  rec('c-bears', 'Grizzly Bears', 'Creature — Bear', '', ['2', '2']),
];

beforeEach(async () => {
  await flushPersistence();
  const db = getDb();
  await db.kv.clear();
  await db.cards.clear();
  await db.cards.bulkPut(RECORDS);
});

const card = (iid: string, cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId,
  name: RECORDS.find((r) => r.id === cardId)!.name,
  ...more,
});

function table(battlefield: CardInstance[]) {
  const store = createAppStore();
  store.getState().startGame(config);
  const g = store.getState().game!;
  const seat = (bf: CardInstance[]) => ({ library: [], hand: [], battlefield: bf, graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'Test' });
  const game: GameState = { ...g, players: [{ ...g.players[0], cards: seat(battlefield) }, { ...g.players[1], cards: seat([]) }] };
  store.setState({ game });
  return store;
}

type Store = ReturnType<typeof createAppStore>;
const mine = (store: Store) => store.getState().game!.players[0].cards!.battlefield;
const lastFeed = (store: Store) => store.getState().log.at(-1)?.text;

test('crewing: the Bears tap, the Copter is crewed this turn — one Undo takes both back', () => {
  const store = table([card('v', 'c-copter'), card('b', 'c-bears')]);
  store.getState().crewVehicle(0, 'v', [{ kind: 'card', id: 'b', n: 1 }]);
  const g = store.getState().game!;
  expect(mine(store).find((c) => c.iid === 'v')?.crewed).toEqual({ turn: g.turnNumber, active: g.activePlayerIndex });
  expect(mine(store).find((c) => c.iid === 'b')?.tapped).toBe(true);
  expect(lastFeed(store)).toBe("Nathan crews Smuggler's Copter with Grizzly Bears");
  store.getState().undo();
  expect(mine(store).find((c) => c.iid === 'v')?.crewed).toBeUndefined();
  expect(mine(store).find((c) => c.iid === 'b')?.tapped).toBeUndefined();
});

test('ward paid: the lands tap for its mana and the life is paid, in one move', async () => {
  const store = table([card('i1', 'c-island', { row: 'lands' }), card('i2', 'c-island', { row: 'lands' }), card('i3', 'c-island', { row: 'lands' })]);
  await store.getState().payWard(0, { mana: 2, life: 2 }, 'Koma, World-Eater', 'Murder');
  expect(mine(store).filter((c) => c.tapped)).toHaveLength(2);
  expect(store.getState().game!.players[0].life).toBe(38);
  expect(lastFeed(store)).toBe("Nathan pays {2} and 2 life for Koma, World-Eater's ward (Murder)");
});
