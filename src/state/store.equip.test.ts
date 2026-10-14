import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
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

beforeEach(async () => {
  await flushPersistence();
  const db = getDb();
  await db.kv.clear();
  await db.cards.clear();
  await db.cards.bulkPut([
    rec('c-forest', 'Forest', 'Basic Land — Forest', { oracleText: '({T}: Add {G}.)' }),
    rec('c-plains', 'Plains', 'Basic Land — Plains', { oracleText: '({T}: Add {W}.)' }),
    rec('c-bear', 'Grizzly Bears', 'Creature — Bear', { power: '2', toughness: '2' }),
    rec('c-giant', 'Hill Giant', 'Creature — Giant', { power: '3', toughness: '3' }),
    rec('c-king', 'Kenrith, the Returned King', 'Legendary Creature — Human Noble', { power: '5', toughness: '5' }),
    rec('c-splitter', 'Bonesplitter', 'Artifact — Equipment', { oracleText: 'Equipped creature gets +2/+0.\nEquip {1}' }),
    rec('c-maul', 'Maul of the Skyclaves', 'Artifact — Equipment', { oracleText: 'Equipped creature gets +2/+2.\nEquip {2}{W}{W}' }),
    rec('c-blade', 'Blackblade Reforged', 'Legendary Artifact — Equipment', {
      oracleText: 'Equipped creature gets +1/+1 for each land you control.\nEquip legendary creature {3}\nEquip {7}',
    }),
    rec('c-scythe', 'Demonmail Hauberk', 'Artifact — Equipment', { oracleText: 'Equipped creature gets +4/+2.\nEquip—Sacrifice a creature.' }),
  ]);
});

const card = (iid: string, cardId: string, name: string, more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId,
  name,
  ...more,
});

/** Nathan: three Forests and a Plains, a bear, a giant and a legendary king,
 * and four Equipment lying unattached. */
function table() {
  const store = createAppStore();
  store.getState().startGame(config);
  const g = store.getState().game!;
  const game: GameState = {
    ...g,
    players: [
      {
        ...g.players[0],
        cards: {
          library: [],
          hand: [],
          battlefield: [
            card('f1', 'c-forest', 'Forest', { row: 'lands' }),
            card('f2', 'c-forest', 'Forest', { row: 'lands' }),
            card('f3', 'c-forest', 'Forest', { row: 'lands' }),
            card('p1', 'c-plains', 'Plains', { row: 'lands' }),
            card('bear', 'c-bear', 'Grizzly Bears'),
            card('giant', 'c-giant', 'Hill Giant'),
            card('king', 'c-king', 'Kenrith, the Returned King'),
            card('splitter', 'c-splitter', 'Bonesplitter'),
            card('maul', 'c-maul', 'Maul of the Skyclaves'),
            card('blade', 'c-blade', 'Blackblade Reforged'),
            card('hauberk', 'c-scythe', 'Demonmail Hauberk'),
          ],
          graveyard: [],
          exile: [],
          command: [],
          mulligans: 0,
          deckName: 'Test',
        },
      },
      g.players[1],
    ],
  };
  store.setState({ game });
  return store;
}

type Store = ReturnType<typeof createAppStore>;
const field = (store: Store) => store.getState().game!.players[0].cards!.battlefield;
/** iid → what its tap has spent. */
const tappedOf = (store: Store) =>
  Object.fromEntries(field(store).filter((c) => c.tapped).map((c) => [c.iid, c.spent ?? '—']));
const onOf = (store: Store, iid: string) => field(store).find((c) => c.iid === iid)?.on?.id ?? null;
const host = (id: string) => ({ seat: 0, kind: 'card' as const, id });

test('equipping pays the equip cost: the Equipment goes on and a land is tapped for it', async () => {
  const store = table();
  await store.getState().equipCard(0, 'splitter', host('bear'));
  expect(onOf(store, 'splitter')).toBe('bear');
  expect(tappedOf(store)).toEqual({ f1: 1 });
  expect(store.getState().game!.feed?.at(-1)?.text).toBe('Nathan puts Bonesplitter on Grizzly Bears');
});

test('the Equipment and its mana are one move: one Undo takes both back', async () => {
  const store = table();
  const before = store.getState().game;
  await store.getState().equipCard(0, 'splitter', host('bear'));
  store.getState().undo();
  expect(store.getState().game).toBe(before);
});

test('colors are paid as the card asks: {2}{W}{W} cannot be paid with one Plains, so nothing is tapped', async () => {
  const store = table();
  await store.getState().equipCard(0, 'maul', host('bear'));
  // The screen is the gate; told to go ahead, the card goes on and the lands stay.
  expect(onOf(store, 'maul')).toBe('bear');
  expect(tappedOf(store)).toEqual({});
});

test('moving it to another creature costs the equip cost again', async () => {
  const store = table();
  await store.getState().equipCard(0, 'splitter', host('bear'));
  await store.getState().equipCard(0, 'splitter', host('giant'));
  expect(onOf(store, 'splitter')).toBe('giant');
  expect(Object.keys(tappedOf(store))).toHaveLength(2);
});

test('putting it on the creature it is already on is nothing: no mana, no line', async () => {
  const store = table();
  await store.getState().equipCard(0, 'splitter', host('bear'));
  const after = store.getState().game;
  await store.getState().equipCard(0, 'splitter', host('bear'));
  expect(store.getState().game).toBe(after);
});

test('"without paying" puts it on and taps nothing', async () => {
  const store = table();
  await store.getState().equipCard(0, 'splitter', host('bear'), { free: true });
  expect(onOf(store, 'splitter')).toBe('bear');
  expect(tappedOf(store)).toEqual({});
});

test('a creature that may use the cheaper equip ability pays that one', async () => {
  const store = table();
  await store.getState().equipCard(0, 'blade', host('king')); // legendary: {3}
  expect(onOf(store, 'blade')).toBe('king');
  expect(Object.keys(tappedOf(store))).toHaveLength(3);
});

test('a cost the table cannot read (not mana) is not asked: it goes on as it always did', async () => {
  const store = table();
  await store.getState().equipCard(0, 'hauberk', host('bear'));
  expect(onOf(store, 'hauberk')).toBe('bear');
  expect(tappedOf(store)).toEqual({});
});

test('taking it off stays free', async () => {
  const store = table();
  await store.getState().equipCard(0, 'splitter', host('bear'));
  store.getState().attachVirtualCard(0, 'splitter', null);
  expect(onOf(store, 'splitter')).toBeNull();
  expect(tappedOf(store)).toEqual({ f1: 1 });
});
