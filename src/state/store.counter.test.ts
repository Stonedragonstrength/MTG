import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import { stackNow } from '../lib/counterspells';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { createAppStore, flushPersistence } from './store';

// Counterspells: every spell cast goes on the turn's stack (GameState.stack),
// and countering one puts its card where a countered spell goes.

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

function rec(id: string, name: string, typeLine: string, oracleText = '', manaCost = ''): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost,
    power: null,
    toughness: null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

const RECORDS = [
  rec('c-island', 'Island', 'Basic Land — Island', '({T}: Add {U}.)'),
  rec('c-mountain', 'Mountain', 'Basic Land — Mountain', '({T}: Add {R}.)'),
  rec('c-forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  rec('c-cs', 'Counterspell', 'Instant', 'Counter target spell.', '{U}{U}'),
  rec('c-bolt', 'Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.', '{R}'),
  rec('c-bears', 'Grizzly Bears', 'Creature — Bear', '', '{1}{G}'),
  rec('c-artist', 'Blood Artist', 'Creature — Vampire', 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.', '{1}{B}'),
  rec('c-cmd', 'Ghalta Stand-in', 'Legendary Creature — Dinosaur', '', '{1}{G}'),
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

/** Nathan: two Islands and Counterspell. Sam: Mountains, Forests, a Bolt and Grizzly Bears, a commander at home. */
function table() {
  const store = createAppStore();
  store.getState().startGame(config);
  const g = store.getState().game!;
  const seat = (battlefield: CardInstance[], hand: CardInstance[], command: CardInstance[] = []) => ({
    library: [],
    hand,
    battlefield,
    graveyard: [],
    exile: [],
    command,
    mulligans: 0,
    deckName: 'Test',
    ...(command.length > 0 ? { cmd: Object.fromEntries(command.map((c) => [c.iid, 0])) } : {}),
  });
  const game: GameState = {
    ...g,
    players: [
      { ...g.players[0], cards: seat([card('i1', 'c-island', { row: 'lands' }), card('i2', 'c-island', { row: 'lands' }), card('art', 'c-artist')], [card('h-cs', 'c-cs')]) },
      {
        ...g.players[1],
        cards: seat(
          [
            card('m1', 'c-mountain', { row: 'lands' }),
            card('m2', 'c-mountain', { row: 'lands' }),
            card('f1', 'c-forest', { row: 'lands' }),
            card('f2', 'c-forest', { row: 'lands' }),
          ],
          [card('h-bolt', 'c-bolt'), card('h-bears', 'c-bears')],
          [card('cmd', 'c-cmd')],
        ),
      },
    ],
  };
  store.setState({ game });
  return store;
}

type Store = ReturnType<typeof createAppStore>;
const zone = (store: Store, seat: number, z: 'battlefield' | 'graveyard' | 'hand' | 'command') =>
  store.getState().game!.players[seat].cards![z].map((c) => c.iid);
const stack = (store: Store) => stackNow(store.getState().game!);
const lastFeed = (store: Store) => store.getState().log.at(-1)?.text;

test('Sam’s Bolt and Nathan’s Counterspell are on the stack; countering the Bolt marks it, and one Undo takes that back', async () => {
  const store = table();
  await store.getState().playCard(1, 'h-bolt');
  await store.getState().playCard(0, 'h-cs');
  expect(stack(store).map((s) => [s.name, s.seat, s.to])).toEqual([
    ['Lightning Bolt', 1, 'graveyard'],
    ['Counterspell', 0, 'graveyard'],
  ]);
  const bolt = stack(store)[0];
  store.getState().counterSpell(0, 'Counterspell', bolt.id);
  expect(stack(store)[0].countered).toBe('Counterspell');
  expect(zone(store, 1, 'graveyard')).toEqual(['h-bolt']);
  expect(lastFeed(store)).toBe('Nathan: Counterspell counters Sam’s Lightning Bolt'.replace('’', "'"));
  // Countered once is enough.
  const before = store.getState().game;
  store.getState().counterSpell(0, 'Counterspell', bolt.id);
  expect(store.getState().game).toBe(before);
  store.getState().undo();
  expect(stack(store)[0].countered).toBeUndefined();
});

test('a countered creature leaves the battlefield for the graveyard without dying', async () => {
  const store = table();
  await store.getState().playCard(1, 'h-bears');
  expect(zone(store, 1, 'battlefield')).toContain('h-bears');
  store.getState().counterSpell(0, 'Counterspell', stack(store)[0].id);
  expect(zone(store, 1, 'battlefield')).not.toContain('h-bears');
  expect(zone(store, 1, 'graveyard')).toEqual(['h-bears']);
  // Blood Artist waits for deaths: this was none.
  expect(store.getState().happened?.events.some((e) => e.kind === 'dies')).toBe(false);
});

test('a countered commander goes home, its next cast two more', async () => {
  const store = table();
  store.getState().castCommander(1, 'cmd');
  await vi.waitFor(() => expect(zone(store, 1, 'battlefield')).toContain('cmd'));
  store.getState().counterSpell(0, 'Counterspell', stack(store)[0].id);
  expect(zone(store, 1, 'command')).toEqual(['cmd']);
  expect(store.getState().game!.players[1].cards!.cmd).toEqual({ cmd: 1 });
  expect(lastFeed(store)).toMatch(/counters Sam's Ghalta Stand-in — back to the command zone$/);
});

test('Remand-style: back to its owner’s hand instead', async () => {
  const store = table();
  await store.getState().playCard(1, 'h-bears');
  store.getState().counterSpell(0, 'Remand', stack(store)[0].id, 'hand');
  expect(zone(store, 1, 'hand')).toContain('h-bears');
});

test('"unless its controller pays {2}": Sam pays from their lands, and the spell stands', async () => {
  const store = table();
  await store.getState().playCard(1, 'h-bolt');
  const tapped = () => store.getState().game!.players[1].cards!.battlefield.filter((c) => c.tapped).length;
  expect(tapped()).toBe(1);
  await store.getState().payForSpell(stack(store)[0].id, '{2}', 'Mana Leak');
  expect(tapped()).toBe(3);
  expect(stack(store)[0].countered).toBeUndefined();
  expect(lastFeed(store)).toBe('Sam pays {2} — Lightning Bolt is not countered (Mana Leak)');
});

test('the stack is this turn’s: once the turn passes there is nothing to counter', async () => {
  const store = table();
  await store.getState().playCard(1, 'h-bolt');
  store.getState().passTurn();
  expect(stack(store)).toEqual([]);
});
