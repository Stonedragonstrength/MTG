import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import { abilitiesOf } from '../lib/abilities';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { createAppStore, flushPersistence } from './store';

// Mana saved up as counters (lib/storedMana.ts): storing it, and a payment
// taking the counters off as it draws on them.

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
  rec('c-swamp', 'Swamp', 'Basic Land — Swamp', '({T}: Add {B}.)'),
  rec(
    'c-reef',
    'Dreadship Reef',
    'Land',
    '{T}: Add {C}.\n{1}, {T}: Put a storage counter on this land.\n{1}, Remove X storage counters from this land: Add X mana in any combination of {U} and/or {B}.',
  ),
  rec(
    'c-battery',
    'Black Mana Battery',
    'Artifact',
    '{2}, {T}: Put a charge counter on this artifact.\n{T}, Remove any number of charge counters from this artifact: Add {B}, then add an additional {B} for each charge counter removed this way.',
    '{4}',
  ),
  rec(
    'c-vault',
    'Bottomless Vault',
    'Land',
    'This land enters tapped.\nYou may choose not to untap this land during your untap step.\nAt the beginning of your upkeep, if this land is tapped, put a storage counter on it.\n{T}, Remove any number of storage counters from this land: Add {B} for each storage counter removed this way.',
  ),
  rec(
    'c-mine',
    'Gemstone Mine',
    'Land',
    'This land enters with three mining counters on it.\n{T}, Remove a mining counter from this land: Add one mana of any color. If there are no mining counters on this land, sacrifice it.',
  ),
  rec('c-prism', 'Pentad Prism', 'Artifact', 'Remove a charge counter from this artifact: Add one mana of any color.', '{2}'),
  rec('c-mindwipe', 'Mind Wipe Stand-in', 'Sorcery', '', '{U}{U}{B}'),
  rec('c-ogre', 'Ogre Stand-in', 'Creature — Ogre', '', '{3}{B}'),
  rec('c-bolt', 'Bolt Stand-in', 'Instant', '', '{R}'),
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

/** Nathan, with these on the battlefield and those in hand. */
function table(battlefield: CardInstance[], hand: CardInstance[] = []) {
  const store = createAppStore();
  store.getState().startGame(config);
  const g = store.getState().game!;
  const game: GameState = {
    ...g,
    players: [
      {
        ...g.players[0],
        cards: { library: [], hand, battlefield, graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'Test' },
      },
      g.players[1],
    ],
  };
  store.setState({ game });
  return store;
}

type Store = ReturnType<typeof createAppStore>;
const it = (store: Store, iid: string) => store.getState().game!.players[0].cards!.battlefield.find((c) => c.iid === iid);
const record = (id: string) => RECORDS.find((r) => r.id === id)!;

test('Dreadship Reef stores: {1} from an Island, the Reef taps, and a storage counter goes on', async () => {
  const store = table([card('reef', 'c-reef', { row: 'lands' }), card('i1', 'c-island', { row: 'lands' })]);
  const store1 = abilitiesOf(record('c-reef')).find((a) => a.label === 'Storage counter')!;
  await store.getState().activateAbility(0, 'reef', store1.key);
  expect(it(store, 'reef')).toMatchObject({ tapped: true, counters: { storage: 1 } });
  expect(it(store, 'i1')).toMatchObject({ tapped: true, spent: 1 });
  expect(store.getState().log.map((l) => l.text)).toContain('Nathan: Dreadship Reef gets a storage counter (1 now)');
});

test('a spell paid from a Reef with three storage counters: its {C} pays the {1} and two counters come off', async () => {
  const store = table(
    [card('reef', 'c-reef', { row: 'lands', counters: { storage: 3 } }), card('i1', 'c-island', { row: 'lands' })],
    [card('h1', 'c-mindwipe')],
  );
  await store.getState().playCard(0, 'h1');
  expect(it(store, 'i1')).toMatchObject({ tapped: true });
  expect(it(store, 'reef')).toMatchObject({ tapped: true, counters: { storage: 1 } });
});

test('a Mana Battery with three charge counters pays {3}{B} beside a Swamp: two of its counters come off', async () => {
  const store = table(
    [card('bat', 'c-battery', { counters: { charge: 3 } }), card('s1', 'c-swamp', { row: 'lands' })],
    [card('h1', 'c-ogre')],
  );
  await store.getState().playCard(0, 'h1');
  expect(it(store, 's1')).toMatchObject({ tapped: true });
  expect(it(store, 'bat')).toMatchObject({ tapped: true, counters: { charge: 1 } });
});

test('a Battery lit in Pay with gives what the cost asks, and keeps the counters it did not need', async () => {
  const store = table(
    [card('bat', 'c-battery', { counters: { charge: 3 } }), card('s1', 'c-swamp', { row: 'lands' })],
    [card('h1', 'c-ogre')],
  );
  await store.getState().playCard(0, 'h1', { using: { bat: 1 } });
  expect(it(store, 's1')?.tapped).toBeUndefined();
  expect(it(store, 'bat')).toMatchObject({ tapped: true });
  expect(it(store, 'bat')?.counters).toBeUndefined(); // all four: {B} and three counters
});

test('Pentad Prism pays without tapping: a counter for each mana', async () => {
  const store = table([card('p', 'c-prism', { counters: { charge: 2 } })], [card('h1', 'c-bolt')]);
  await store.getState().playCard(0, 'h1');
  expect(it(store, 'p')).toEqual({ iid: 'p', cardId: 'c-prism', name: 'Pentad Prism', counters: { charge: 1 } });
});

test('Gemstone Mine paying with its last mining counter goes to the graveyard', async () => {
  const store = table([card('gm', 'c-mine', { row: 'lands', counters: { mining: 1 } })], [card('h1', 'c-bolt')]);
  await store.getState().playCard(0, 'h1');
  expect(it(store, 'gm')).toBeUndefined();
  expect(store.getState().game!.players[0].cards!.graveyard.map((c) => c.iid)).toContain('gm');
});

test('Bottomless Vault left tapped stays tapped through its untap step, with nothing in the pool', () => {
  const store = table([card('v', 'c-vault', { row: 'lands', tapped: true, counters: { storage: 2 } }), card('s1', 'c-swamp', { row: 'lands', tapped: true, spent: 1 })]);
  // Round the table back to Nathan.
  store.getState().passTurn();
  store.getState().passTurn({ keep: ['v'] });
  expect(it(store, 'v')).toMatchObject({ tapped: true, spent: 999, counters: { storage: 2 } });
  expect(it(store, 's1')?.tapped).toBeUndefined();
  expect(store.getState().log.at(-1)?.text).toMatch(/^Turn \d+: Nathan · Bottomless Vault stays tapped$/);
});

test('without being kept, it untaps like everything else', () => {
  const store = table([card('v', 'c-vault', { row: 'lands', tapped: true })]);
  store.getState().passTurn();
  store.getState().passTurn();
  expect(it(store, 'v')?.tapped).toBeUndefined();
});
