import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import { abilitiesOf, abilitiesWorn } from '../lib/abilities';
import { boostOf } from '../lib/boost';
import type { CascadePlan } from '../lib/cascade';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
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

function rec(id: string, name: string, typeLine: string, oracleText = '', pt: [string, string] | null = null): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '',
    power: pt ? pt[0] : null,
    toughness: pt ? pt[1] : null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

const RECORDS = [
  rec('c-mountain', 'Mountain', 'Basic Land — Mountain', '({T}: Add {R}.)'),
  rec('c-forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  rec('c-swallower', 'Ember Swallower', 'Creature — Elemental', '{5}{R}{R}: Monstrosity 3.', ['4', '5']),
  rec('c-druid', 'Incubation Druid', 'Creature — Elf Druid', '{3}{G}{G}: Adapt 3.', ['0', '2']),
  rec('c-priest', 'Abzan Battle Priest', 'Creature — Human Cleric', 'Outlast {W}', ['3', '2']),
  rec('c-shade', 'Fire Shade', 'Creature — Shade', '{R}: This creature gets +1/+0 until end of turn.', ['1', '1']),
  rec('c-hydra', 'Polukranos Stand-in', 'Creature — Hydra', '{X}{X}{G}: Monstrosity X.', ['5', '5']),
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

/** Nathan: seven Mountains, three Forests, and the creatures. */
function table(creatures: CardInstance[]) {
  const store = createAppStore();
  store.getState().startGame(config);
  const g = store.getState().game!;
  const lands = [
    ...Array.from({ length: 7 }, (_, i) => card(`m${i}`, 'c-mountain', { row: 'lands' })),
    ...Array.from({ length: 3 }, (_, i) => card(`f${i}`, 'c-forest', { row: 'lands' })),
  ];
  const game: GameState = {
    ...g,
    players: [
      {
        ...g.players[0],
        cards: { library: [], hand: [], battlefield: [...lands, ...creatures], graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'Test' },
      },
      g.players[1],
    ],
  };
  store.setState({ game });
  return store;
}

type Store = ReturnType<typeof createAppStore>;
const it = (store: Store, iid: string) => store.getState().game!.players[0].cards!.battlefield.find((c) => c.iid === iid)!;
const tappedLands = (store: Store) => store.getState().game!.players[0].cards!.battlefield.filter((c) => c.row === 'lands' && c.tapped).length;
const keyOf = (cardId: string) => abilitiesOf(RECORDS.find((r) => r.id === cardId)!)[0].key;

test('Monstrosity 3: seven lands pay for it, three counters go on, and it is monstrous — once', async () => {
  const store = table([card('e1', 'c-swallower')]);
  await store.getState().activateAbility(0, 'e1', keyOf('c-swallower'));
  expect(it(store, 'e1').counters).toEqual({ p1p1: 3, monstrous: 1 });
  expect(tappedLands(store)).toBe(7);
  expect(store.getState().game!.feed?.at(-1)?.text).toBe('Nathan: Ember Swallower becomes monstrous (3 +1/+1 counters)');
  // Again: it is monstrous already — nothing happens, nothing is paid.
  const before = store.getState().game;
  await store.getState().activateAbility(0, 'e1', keyOf('c-swallower'));
  expect(store.getState().game).toBe(before);
});

test('it and its mana are one move: one Undo takes both back', async () => {
  const store = table([card('e1', 'c-swallower')]);
  const before = store.getState().game;
  await store.getState().activateAbility(0, 'e1', keyOf('c-swallower'));
  store.getState().undo();
  expect(store.getState().game).toBe(before);
});

test('Monstrosity X is paid for the X asked', async () => {
  const store = table([card('h1', 'c-hydra')]);
  await store.getState().activateAbility(0, 'h1', keyOf('c-hydra'), { x: 2 });
  expect(it(store, 'h1').counters).toEqual({ p1p1: 2, monstrous: 1 });
  expect(tappedLands(store)).toBe(5); // {X}{X}{G} for X=2
});

test('Adapt: only while it has no +1/+1 counters', async () => {
  const store = table([card('d1', 'c-druid'), card('d2', 'c-druid', { counters: { p1p1: 1 } })]);
  await store.getState().activateAbility(0, 'd1', keyOf('c-druid'));
  expect(it(store, 'd1').counters).toEqual({ p1p1: 3 });
  const before = store.getState().game;
  await store.getState().activateAbility(0, 'd2', keyOf('c-druid'));
  expect(store.getState().game).toBe(before);
});

test('Outlast taps the creature as part of its cost', async () => {
  const store = table([card('p1', 'c-priest')]);
  // No Plains: it cannot be paid — "without paying" puts the counter on all the same.
  await store.getState().activateAbility(0, 'p1', keyOf('c-priest'), { free: true });
  expect(it(store, 'p1')).toMatchObject({ tapped: true, counters: { p1p1: 1 } });
  expect(tappedLands(store)).toBe(0);
});

test('firebreathing: each {R} is another +1/+0 until end of turn', async () => {
  const store = table([card('s1', 'c-shade')]);
  await store.getState().activateAbility(0, 's1', keyOf('c-shade'));
  await store.getState().activateAbility(0, 's1', keyOf('c-shade'));
  await store.getState().activateAbility(0, 's1', keyOf('c-shade'));
  const g = store.getState().game!;
  expect(boostOf(g, it(store, 's1'))).toMatchObject({ power: 3, toughness: 0 });
  expect(tappedLands(store)).toBe(3);
});

test('Level up: one more level counter each time it is paid for', async () => {
  const student = rec(
    'c-student',
    'Student of Warfare',
    'Creature — Human Knight',
    'Level up {W}\nLEVEL 2-6\n3/3\nFirst strike\nLEVEL 7+\n4/4\nDouble strike',
    ['1', '1'],
  );
  await getDb().cards.put(student);
  const store = table([{ iid: 's1', cardId: 'c-student', name: 'Student of Warfare' }]);
  const key = abilitiesOf(student)[0].key;
  await store.getState().activateAbility(0, 's1', key, { free: true });
  await store.getState().activateAbility(0, 's1', key, { free: true });
  expect(it(store, 's1').counters).toEqual({ level: 2 });
  expect(store.getState().game!.feed?.at(-1)?.text).toBe('Nathan: Student of Warfare levels up (level 2)');
});

// ---- Discover from abilities: the whole cost and what it found, one move ----

const DISCOVERERS = [
  rec('c-nursery', 'Hidden Nursery', 'Land — Cave', 'This land enters tapped.\n{T}: Add {G}.\n{4}{G}, {T}, Sacrifice this land: Discover 4. Activate only as a sorcery.'),
  rec('c-sensor', 'Long-Range Sensor', 'Artifact', '{1}, Remove two charge counters from this artifact: Discover 4. Activate only as a sorcery.'),
  rec('c-treasure', 'Buried Treasure', 'Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.\n{5}, Exile this card from your graveyard: Discover 5. Activate only as a sorcery.'),
  rec('c-quintorius', 'Quintorius Kand', 'Legendary Planeswalker — Quintorius', '+1: Create a 3/2 red and white Spirit creature token.\n−3: Discover 4.'),
  rec('c-ellie', 'Ellie and Alan, Paleontologists', 'Legendary Creature — Human Scientist', '{T}, Exile a creature card from your graveyard: Discover X, where X is the mana value of the exiled card. Activate only as a sorcery.', ['2', '5']),
  rec('c-whip', "Swashbuckler's Whip", 'Artifact — Equipment', 'Equipped creature has reach, "{2}, {T}: Tap target artifact or creature," and "{8}, {T}: Discover 10."\nEquip {1}'),
  rec('c-bear', 'Grizzly Bears', 'Creature — Bear', '', ['2', '2']),
  rec('c-giant', 'Hill Giant', 'Creature — Giant', '', ['3', '3']),
  rec('c-bolt', 'Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.'),
];

const named = (iid: string, cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId,
  name: [...RECORDS, ...DISCOVERERS].find((r) => r.id === cardId)!.name,
  ...more,
});

/** Nathan's table as `table` lays it, with a library (top first) and a graveyard. */
async function discoverTable(battlefield: CardInstance[], library: CardInstance[], graveyard: CardInstance[] = []) {
  await getDb().cards.bulkPut(DISCOVERERS);
  const store = table(battlefield);
  const g = store.getState().game!;
  const cards = g.players[0].cards!;
  store.setState({ game: { ...g, players: [{ ...g.players[0], cards: { ...cards, library, graveyard } }, g.players[1]] } });
  return store;
}

/** The cards a discover turned over; the last of them is the one it found (or none was). */
function plan(exiled: CardInstance[], found: boolean, spell = true): CascadePlan {
  const cards = exiled.map(({ iid, cardId, name }) => ({ iid, cardId, name }));
  const last = cards[cards.length - 1];
  return { exiled: cards, found: found ? { ...last, spell, x: false, brings: {} } : null };
}

const mine = (store: Store) => store.getState().game!.players[0].cards!;
const discoverKey = (cardId: string) => abilitiesOf(DISCOVERERS.find((r) => r.id === cardId)).find((a) => a.effect.kind === 'discover')!.key;
const lastFeed = (store: Store) => store.getState().game!.feed?.at(-1)?.text;

test('Hidden Nursery: the other lands pay, it is tapped and sacrificed, and the card it found is cast — one move, one Undo', async () => {
  const forest = named('l1', 'c-forest');
  const bolt = named('l2', 'c-bolt');
  const giant = named('l3', 'c-giant');
  const store = await discoverTable([named('n1', 'c-nursery', { row: 'lands' })], [forest, bolt, giant]);
  const before = store.getState().game;
  await store.getState().activateAbility(0, 'n1', discoverKey('c-nursery'), { discover: { plan: plan([forest, bolt], true), take: 'cast', n: 4 } });
  expect(mine(store).graveyard.map((c) => c.iid)).toEqual(['n1', 'l2']);
  expect(mine(store).library.map((c) => c.iid)).toEqual(['l3', 'l1']);
  expect(tappedLands(store)).toBe(5); // {4}{G} from the others: the Nursery itself paid nothing
  expect(store.getState().game!.reveal).toMatchObject({ from: 'cast', cards: [{ name: 'Lightning Bolt' }] });
  expect(lastFeed(store)).toBe('Nathan: Hidden Nursery (sacrificed) — discover 4: casts Lightning Bolt (Forest to the bottom)');
  store.getState().undo();
  expect(store.getState().game).toBe(before);
});

test('a Discover ability does nothing until its cards have been turned over', async () => {
  const store = await discoverTable([named('n1', 'c-nursery', { row: 'lands' })], [named('l1', 'c-bolt')]);
  const before = store.getState().game;
  await store.getState().activateAbility(0, 'n1', discoverKey('c-nursery'));
  expect(store.getState().game).toBe(before);
});

test('Long-Range Sensor: two charge counters come off; with one left, nothing happens', async () => {
  const store = await discoverTable([named('s1', 'c-sensor', { counters: { charge: 3 } })], [named('l1', 'c-bolt'), named('l2', 'c-bolt')]);
  const key = discoverKey('c-sensor');
  await store.getState().activateAbility(0, 's1', key, { discover: { plan: plan([named('l1', 'c-bolt')], true), take: 'hand', n: 4 } });
  expect(it(store, 's1').counters).toEqual({ charge: 1 });
  expect(mine(store).hand.map((c) => c.iid)).toEqual(['l1']);
  expect(tappedLands(store)).toBe(1);
  expect(lastFeed(store)).toBe('Nathan: Long-Range Sensor (two charge counters off) — discover 4: Lightning Bolt into their hand');
  const before = store.getState().game;
  await store.getState().activateAbility(0, 's1', key, { discover: { plan: plan([named('l2', 'c-bolt')], true), take: 'hand', n: 4 } });
  expect(store.getState().game).toBe(before);
});

test('Quintorius Kand −3: loyalty kept as counters goes down — to the graveyard at none — and loyalty not kept is left alone', async () => {
  const library = ['l1', 'l2', 'l3'].map((iid) => named(iid, 'c-bolt'));
  const store = await discoverTable(
    [
      named('q1', 'c-quintorius', { counters: { loyalty: 5 } }),
      named('q2', 'c-quintorius', { counters: { loyalty: 3 } }),
      named('q3', 'c-quintorius'),
    ],
    library,
  );
  const key = discoverKey('c-quintorius');
  const use = (iid: string, top: CardInstance) =>
    store.getState().activateAbility(0, iid, key, { discover: { plan: plan([top], true), take: 'hand', n: 4 } });
  await use('q1', library[0]);
  expect(it(store, 'q1').counters).toEqual({ loyalty: 2 });
  expect(lastFeed(store)).toBe('Nathan: Quintorius Kand −3 — discover 4: Lightning Bolt into their hand');
  await use('q2', library[1]);
  expect(mine(store).graveyard.map((c) => c.iid)).toEqual(['q2']);
  await use('q3', library[2]);
  expect(it(store, 'q3').counters).toBeUndefined();
  expect(mine(store).hand.map((c) => c.iid)).toEqual(['l1', 'l2', 'l3']);
  expect(tappedLands(store)).toBe(0);
});

test('Buried Treasure is used from the graveyard: {5}, and the card goes to exile', async () => {
  const store = await discoverTable([], [named('l1', 'c-bolt')], [named('t1', 'c-treasure')]);
  await store.getState().activateAbility(0, 't1', discoverKey('c-treasure'), { discover: { plan: plan([named('l1', 'c-bolt')], true), take: 'cast', n: 5 } });
  expect(mine(store).exile.map((c) => c.iid)).toEqual(['t1']);
  expect(mine(store).graveyard.map((c) => c.iid)).toEqual(['l1']);
  expect(tappedLands(store)).toBe(5);
  expect(lastFeed(store)).toBe('Nathan: Buried Treasure (exiled from the graveyard) — discover 5: casts Lightning Bolt');
});

test('Ellie and Alan exile the creature card picked to pay; with none picked, nothing happens', async () => {
  const store = await discoverTable([named('e1', 'c-ellie')], [named('l1', 'c-bolt')], [named('g1', 'c-giant')]);
  const key = discoverKey('c-ellie');
  const asked = { plan: plan([named('l1', 'c-bolt')], true), take: 'hand' as const, n: 4 };
  const before = store.getState().game;
  await store.getState().activateAbility(0, 'e1', key, { discover: asked });
  expect(store.getState().game).toBe(before);
  await store.getState().activateAbility(0, 'e1', key, { discover: { ...asked, pick: 'g1' } });
  expect(mine(store).exile.map((c) => c.iid)).toEqual(['g1']);
  expect(it(store, 'e1').tapped).toBe(true);
  expect(lastFeed(store)).toBe('Nathan: Ellie and Alan, Paleontologists (exiling Hill Giant) — discover 4: Lightning Bolt into their hand');
});

test('Swashbuckler’s Whip: the creature wearing it taps, and the lands pay {8}', async () => {
  const store = await discoverTable(
    [named('b1', 'c-bear'), named('w1', 'c-whip', { on: { seat: 0, kind: 'card', id: 'b1' } })],
    [named('l1', 'c-bolt')],
  );
  const records = Object.fromEntries(DISCOVERERS.map((r) => [r.id, r]));
  const [ability] = abilitiesWorn(store.getState().game!, { seat: 0, kind: 'card', id: 'b1' }, records);
  expect(ability.key).toBe('w1/0.1:discover');
  await store.getState().activateAbility(0, 'b1', ability.key, { discover: { plan: plan([named('l1', 'c-bolt')], true), take: 'cast', n: 10 } });
  expect(it(store, 'b1').tapped).toBe(true);
  expect(tappedLands(store)).toBe(8);
  expect(lastFeed(store)).toBe("Nathan: Grizzly Bears (with Swashbuckler's Whip) — discover 10: casts Lightning Bolt");
});

// ---- a planeswalker's loyalty ----

const WALKERS = [
  { ...rec('c-quint2', 'Quintorius Kand', 'Legendary Planeswalker — Quintorius', '+1: Create a 3/2 red and white Spirit creature token.\n−3: Discover 4.'), loyalty: '4' },
  { ...rec('c-nalaar', 'Chandra Nalaar', 'Legendary Planeswalker — Chandra', '+1: Chandra Nalaar deals 1 damage to target player or planeswalker.\n−X: Chandra Nalaar deals X damage to target creature.'), loyalty: '6' },
];

test('a planeswalker cast from the hand enters with its printed loyalty', async () => {
  await getDb().cards.bulkPut(WALKERS);
  const store = table([]);
  const g = store.getState().game!;
  const cards = g.players[0].cards!;
  store.setState({ game: { ...g, players: [{ ...g.players[0], cards: { ...cards, hand: [{ iid: 'q1', cardId: 'c-quint2', name: 'Quintorius Kand' }] } }, g.players[1]] } });
  await store.getState().playCard(0, 'q1');
  expect(it(store, 'q1').counters).toEqual({ loyalty: 4 });
});

test('+1: the loyalty goes up, the feed says what it does, and the table hears of it — one move, one Undo', async () => {
  await getDb().cards.bulkPut(WALKERS);
  const store = table([{ iid: 'q1', cardId: 'c-quint2', name: 'Quintorius Kand', counters: { loyalty: 4 } }]);
  const before = store.getState().game;
  const plus = abilitiesOf(WALKERS[0])[0];
  await store.getState().activateAbility(0, 'q1', plus.key);
  expect(it(store, 'q1').counters).toEqual({ loyalty: 5 });
  const feed = store.getState().game!.feed!.at(-1)!;
  expect(feed.text).toBe('Nathan: Quintorius Kand +1 — Create a 3/2 red and white Spirit creature token.');
  expect(store.getState().happened?.events).toEqual([
    {
      kind: 'activated',
      thing: { seat: 0, kind: 'card', id: 'q1', cardId: 'c-quint2', name: 'Quintorius Kand', n: 1 },
      text: '+1: Create a 3/2 red and white Spirit creature token.',
      effect: 'Create a 3/2 red and white Spirit creature token.',
      feed: feed.id,
    },
  ]);
  store.getState().undo();
  expect(store.getState().game).toBe(before);
});

test('−X: X loyalty comes off and the X is said as a number; more than it has is refused', async () => {
  await getDb().cards.bulkPut(WALKERS);
  const store = table([{ iid: 'c1', cardId: 'c-nalaar', name: 'Chandra Nalaar', counters: { loyalty: 6 } }]);
  const minusX = abilitiesOf(WALKERS[1])[1];
  await store.getState().activateAbility(0, 'c1', minusX.key, { x: 3 });
  expect(it(store, 'c1').counters).toEqual({ loyalty: 3 });
  expect(store.getState().game!.feed!.at(-1)!.text).toBe('Nathan: Chandra Nalaar −3 — Chandra Nalaar deals 3 damage to target creature.');
  expect(store.getState().happened?.events[0]).toMatchObject({ kind: 'activated', effect: '~ deals 3 damage to target creature.' });
  const before = store.getState().game;
  await store.getState().activateAbility(0, 'c1', minusX.key, { x: 4 });
  expect(store.getState().game).toBe(before);
});

test('loyalty its player keeps by hand is left alone: the ability is still said and heard', async () => {
  await getDb().cards.bulkPut(WALKERS);
  const store = table([{ iid: 'q1', cardId: 'c-quint2', name: 'Quintorius Kand' }]);
  await store.getState().activateAbility(0, 'q1', abilitiesOf(WALKERS[0])[0].key);
  expect(it(store, 'q1').counters).toBeUndefined();
  expect(store.getState().game!.feed!.at(-1)!.text).toBe('Nathan: Quintorius Kand +1 — Create a 3/2 red and white Spirit creature token.');
  expect(store.getState().happened?.events[0]).toMatchObject({ kind: 'activated' });
});

test('a loyalty ability marks the walker as used for this turn; the mark goes with it when it leaves', async () => {
  await getDb().cards.bulkPut(WALKERS);
  const store = table([{ iid: 'q1', cardId: 'c-quint2', name: 'Quintorius Kand', counters: { loyalty: 4 } }]);
  const g = store.getState().game!;
  await store.getState().activateAbility(0, 'q1', abilitiesOf(WALKERS[0])[0].key);
  expect(it(store, 'q1').loyaltyUsed).toEqual({ turn: g.turnNumber, active: g.activePlayerIndex });
  store.getState().moveVirtualCard(0, 'q1', 'battlefield', 'hand');
  expect(store.getState().game!.players[0].cards!.hand.find((c) => c.iid === 'q1')!.loyaltyUsed).toBeUndefined();
});
