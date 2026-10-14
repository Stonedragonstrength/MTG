import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import { abilitiesOf } from '../lib/abilities';
import { boostOf } from '../lib/boost';
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
