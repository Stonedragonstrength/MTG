import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import { stackNow } from '../lib/counterspells';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { createAppStore, flushPersistence } from './store';

// What a spell costs on the table (lib/costs.ts), paid by the store: cost
// reducers, cycling, flashback, overload, convoke, delve, free spells.

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

function rec(id: string, name: string, typeLine: string, oracleText = '', manaCost = '', more: Partial<CardRecord> = {}): CardRecord {
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
    ...more,
  };
}

const RECORDS = [
  rec('c-island', 'Island', 'Basic Land — Island', '({T}: Add {U}.)'),
  rec('c-mountain', 'Mountain', 'Basic Land — Mountain', '({T}: Add {R}.)'),
  rec('c-forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  rec('c-ruby', 'Ruby Medallion', 'Artifact', 'Red spells you cast cost {1} less to cast.', '{2}'),
  rec('c-giant', 'Hill Giant', 'Creature — Giant', '', '{3}{R}', { power: '3', toughness: '3', colors: ['R'] }),
  rec('c-bears', 'Grizzly Bears', 'Creature — Bear', '', '{1}{G}', { power: '2', toughness: '2', colors: ['G'] }),
  rec('c-cave', 'Forgotten Cave', 'Land', 'Forgotten Cave enters tapped.\n{T}: Add {R}.\nCycling {R} ({R}, Discard this card: Draw a card.)'),
  rec(
    'c-abom',
    'Twisted Abomination',
    'Creature — Zombie Mutant',
    '{B}: Regenerate Twisted Abomination.\nSwampcycling {2} ({2}, Discard this card: Search your library for a Swamp card, reveal it, put it into your hand, then shuffle.)',
    '{5}{B}',
  ),
  rec('c-looting', 'Faithless Looting', 'Sorcery', 'Draw two cards, then discard two cards.\nFlashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)', '{R}', { colors: ['R'] }),
  rec('c-cs', 'Counterspell', 'Instant', 'Counter target spell.', '{U}{U}', { colors: ['U'] }),
  rec(
    'c-rift',
    'Cyclonic Rift',
    'Instant',
    'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of "target" with "each.")',
    '{1}{U}',
    { colors: ['U'] },
  ),
  rec(
    'c-chord',
    'Chord of Calling',
    'Instant',
    "Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\nSearch your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.",
    '{X}{G}{G}{G}',
    { colors: ['G'] },
  ),
  rec('c-cruise', 'Treasure Cruise', 'Sorcery', 'Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)\nDraw three cards.', '{7}{U}', { colors: ['U'] }),
  rec('c-guard', 'Fierce Guardianship', 'Instant', 'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.', '{2}{U}', { colors: ['U'] }),
  rec('c-cmd', 'Atraxa Stand-in', 'Legendary Creature — Angel', 'Flying', '{G}{W}{U}{B}', { power: '4', toughness: '4' }),
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
  ...(/Land/.test(RECORDS.find((r) => r.id === cardId)!.typeLine) ? { row: 'lands' as const } : { row: 'front' as const }),
  ...more,
});

/** Nathan holds `hand`, has `battlefield` out, `graveyard` and `library`; Sam has two Islands. */
function table(
  mine: { battlefield?: CardInstance[]; hand?: CardInstance[]; graveyard?: CardInstance[]; library?: CardInstance[]; cmd?: string[] },
) {
  const store = createAppStore();
  store.getState().startGame(config);
  const g = store.getState().game!;
  const seat = (s: typeof mine) => ({
    library: s.library ?? [],
    hand: s.hand ?? [],
    battlefield: s.battlefield ?? [],
    graveyard: s.graveyard ?? [],
    exile: [],
    command: [],
    mulligans: 0,
    deckName: 'Test',
    ...(s.cmd ? { cmd: Object.fromEntries(s.cmd.map((iid) => [iid, 0])) } : {}),
  });
  const game: GameState = {
    ...g,
    players: [
      { ...g.players[0], cards: seat(mine) },
      { ...g.players[1], cards: seat({ battlefield: [card('si1', 'c-island'), card('si2', 'c-island')], hand: [card('s-cs', 'c-cs')] }) },
    ],
  };
  store.setState({ game });
  return store;
}

type Store = ReturnType<typeof createAppStore>;
const mine = (store: Store) => store.getState().game!.players[0].cards!;
const tapped = (store: Store) => mine(store).battlefield.filter((c) => c.tapped).map((c) => c.iid);
const lastFeed = (store: Store) => store.getState().log.at(-1)?.text;
const lands = (id: string, n: number, prefix = id) => Array.from({ length: n }, (_, i) => card(`${prefix}${i + 1}`, id));

test('Ruby Medallion takes one off a red spell: three Mountains pay for Hill Giant', async () => {
  const store = table({ battlefield: [card('ruby', 'c-ruby'), ...lands('c-mountain', 3, 'm')], hand: [card('h-giant', 'c-giant')] });
  await store.getState().playCard(0, 'h-giant');
  expect(mine(store).battlefield.map((c) => c.iid)).toContain('h-giant');
  expect(tapped(store).sort()).toEqual(['m1', 'm2', 'm3']);
});

test('cycling: pay, discard, draw — one move, one Undo', async () => {
  const store = table({
    battlefield: lands('c-mountain', 2, 'm'),
    hand: [card('h-cave', 'c-cave')],
    library: [card('l1', 'c-bears'), card('l2', 'c-giant')],
  });
  await store.getState().cycleCard(0, 'h-cave', 0);
  expect(mine(store).graveyard.map((c) => c.iid)).toEqual(['h-cave']);
  expect(mine(store).hand.map((c) => c.iid)).toEqual(['l1']);
  expect(tapped(store)).toHaveLength(1);
  expect(lastFeed(store)).toBe('Nathan cycles Forgotten Cave and draws a card');
  store.getState().undo();
  expect(mine(store).hand.map((c) => c.iid)).toEqual(['h-cave']);
  expect(tapped(store)).toHaveLength(0);
});

test('typecycling discards and draws nothing: the player goes looking instead', async () => {
  const store = table({ battlefield: lands('c-mountain', 2, 'm'), hand: [card('h-abom', 'c-abom')], library: [card('l1', 'c-bears')] });
  await store.getState().cycleCard(0, 'h-abom', 0);
  expect(mine(store).graveyard.map((c) => c.iid)).toEqual(['h-abom']);
  expect(mine(store).hand).toEqual([]);
  expect(tapped(store).sort()).toEqual(['m1', 'm2']);
  expect(lastFeed(store)).toBe('Nathan cycles Twisted Abomination (Swampcycling)');
});

test('flashback: cast from the graveyard for its cost, shown, then exiled — and countered, it stays exiled', async () => {
  const store = table({ battlefield: lands('c-mountain', 3, 'm'), graveyard: [card('g-loot', 'c-looting')] });
  await store.getState().castFromGraveyard(0, 'g-loot');
  expect(mine(store).exile.map((c) => c.iid)).toEqual(['g-loot']);
  expect(mine(store).graveyard).toEqual([]);
  expect(tapped(store).sort()).toEqual(['m1', 'm2', 'm3']);
  expect(store.getState().game!.reveal?.cards[0].name).toBe('Faithless Looting');
  expect(lastFeed(store)).toBe('Nathan casts Faithless Looting with flashback');
  const spell = stackNow(store.getState().game!)[0];
  expect(spell).toMatchObject({ from: 'graveyard', to: 'exile' });
  store.getState().counterSpell(1, 'Counterspell', spell.id);
  expect(mine(store).exile.map((c) => c.iid)).toEqual(['g-loot']);
});

test('overload: Cyclonic Rift pays {6}{U} and its banner reads "each"', async () => {
  const store = table({ battlefield: lands('c-island', 7, 'i'), hand: [card('h-rift', 'c-rift')] });
  await store.getState().playCard(0, 'h-rift', { way: 'overload' });
  expect(tapped(store)).toHaveLength(7);
  expect(store.getState().game!.reveal?.overload).toBe(true);
  expect(lastFeed(store)).toBe('Nathan casts Cyclonic Rift (overload)');
});

test('convoke: a Forest and two Bears — one only just arrived — pay {G}{G}{G}; the Bears are not attacking', async () => {
  const store = table({
    battlefield: [card('f1', 'c-forest'), card('b1', 'c-bears'), card('b2', 'c-bears', { sick: true })],
    hand: [card('h-chord', 'c-chord')],
  });
  await store.getState().playCard(0, 'h-chord', { x: 0 });
  expect(tapped(store).sort()).toEqual(['b1', 'b2', 'f1']);
  const bears = mine(store).battlefield.filter((c) => c.iid.startsWith('b'));
  expect(bears.every((c) => (c.spent ?? 0) > 0)).toBe(true);
});

test('delve: Treasure Cruise exiles seven cards from the graveyard and taps one Island', async () => {
  const graveyard = Array.from({ length: 7 }, (_, i) => card(`g${i}`, i % 2 ? 'c-bears' : 'c-giant'));
  const store = table({ battlefield: lands('c-island', 2, 'i'), hand: [card('h-cruise', 'c-cruise')], graveyard });
  await store.getState().playCard(0, 'h-cruise');
  expect(mine(store).exile).toHaveLength(7);
  expect(mine(store).graveyard.map((c) => c.iid)).toEqual(['h-cruise']);
  expect(tapped(store)).toHaveLength(1);
});

test('Fierce Guardianship is free with a commander out: nothing taps', async () => {
  const store = table({
    battlefield: [card('cmd', 'c-cmd'), ...lands('c-island', 3, 'i')],
    hand: [card('h-guard', 'c-guard')],
    cmd: ['cmd'],
  });
  await store.getState().playCard(0, 'h-guard');
  expect(tapped(store)).toEqual([]);
  expect(lastFeed(store)).toBe('Nathan casts Fierce Guardianship without paying its mana cost');
});
