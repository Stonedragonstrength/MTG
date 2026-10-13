import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import * as tableSync from '../data/onlineTable';
import { flipCard, landsPlayed } from '../lib/cards';
import { backId } from '../lib/faces';
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
    { id: 'p1', name: 'Samantha', avatarUrl: null, commanderName: null },
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
    isBasicLand: false,
    ...more,
  };
}

const face = (name: string, typeLine: string, oracleText = '', pt: string | null = null) => ({
  name,
  typeLine,
  oracleText,
  manaCost: '',
  power: pt,
  toughness: pt,
  colors: [],
  imageNormal: null,
  imageArtCrop: null,
});

const DELVER = 'Delver of Secrets // Insectile Aberration';
const VALAKUT = 'Valakut Awakening // Valakut Stoneforge';

beforeEach(async () => {
  await flushPersistence();
  const db = getDb();
  await db.kv.clear();
  await db.cards.clear();
  await db.cards.bulkPut([
    rec('c-delver', DELVER, 'Creature — Human Wizard // Creature — Human Insect', {
      power: '1',
      toughness: '1',
      back: face('Insectile Aberration', 'Creature — Human Insect', 'Flying', '3'),
    }),
    rec('c-valakut', VALAKUT, 'Instant // Land', {
      manaCost: '{2}{R}',
      oracleText: 'Put any number of cards from your hand on the bottom of your library.\n//\n{T}: Add {R}.',
      back: face('Valakut Stoneforge', 'Land', '{T}: Add {R}.'),
    }),
    rec('c-bear', 'Grizzly Bears', 'Creature — Bear', { power: '2', toughness: '2' }),
  ]);
  vi.mocked(tableSync.onLocalMutation).mockClear();
});

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

/** Nathan: Delver and a card no database knows on the table, Valakut Awakening in hand. */
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
          [
            { iid: 'delver', cardId: 'c-delver', name: DELVER, tapped: true },
            { iid: 'ghost', cardId: 'c-unknown', name: 'Huntmaster of the Fells // Ravager of the Fells' },
            { iid: 'blank', cardId: 'c-blank', name: 'Mystery Card' },
          ],
          [{ iid: 'h-valakut', cardId: 'c-valakut', name: VALAKUT }],
        ),
      },
      { ...g.players[1], cards: seat([]) },
    ],
  };
  store.setState({ game });
  return store;
}

type Store = ReturnType<typeof createAppStore>;
const feedOf = (store: Store) => (store.getState().game!.feed ?? []).map((e) => e.text);
const card = (store: Store, iid: string) =>
  store.getState().game!.players[0].cards!.battlefield.find((c) => c.iid === iid)!;

test('Transform turns the card onto its back, names both faces, and is one Undo', async () => {
  const store = table();
  const before = store.getState().game;
  await store.getState().transformCard(0, 'delver');
  expect(card(store, 'delver')).toEqual({ iid: 'delver', cardId: backId('c-delver'), name: DELVER, tapped: true });
  expect(feedOf(store)).toEqual(['Nathan: Delver of Secrets becomes Insectile Aberration']);
  store.getState().undo();
  expect(store.getState().game).toBe(before);
});

test('a second Transform turns it back, and says so', async () => {
  const store = table();
  await store.getState().transformCard(0, 'delver');
  await store.getState().transformCard(0, 'delver');
  expect(card(store, 'delver').cardId).toBe('c-delver');
  expect(feedOf(store).at(-1)).toBe('Nathan: Insectile Aberration turns back into Delver of Secrets');
});

test('a card no database knows turns all the same: its faces are read off its name', async () => {
  const store = table();
  await store.getState().transformCard(0, 'ghost');
  expect(card(store, 'ghost').cardId).toBe(backId('c-unknown'));
  expect(feedOf(store)).toEqual(['Nathan: Huntmaster of the Fells becomes Ravager of the Fells']);
  await store.getState().transformCard(0, 'blank');
  expect(feedOf(store).at(-1)).toBe('Nathan: Mystery Card is turned over');
});

test('a card that is not on the battlefield is left alone', async () => {
  const store = table();
  const before = store.getState().game;
  await store.getState().transformCard(0, 'h-valakut');
  await store.getState().transformCard(0, 'nobody');
  expect(store.getState().game).toBe(before);
});

test('a replay can confirm a turn but never turn the card back', async () => {
  const store = table();
  await store.getState().transformCard(0, 'delver');
  const [fn, , opts] = vi.mocked(tableSync.onLocalMutation).mock.calls.at(-1)! as unknown as [
    (g: GameState) => GameState,
    unknown,
    { guard: (g: GameState) => boolean },
  ];
  const turned = store.getState().game!;
  // The table already holds the card on its back (someone else turned it):
  // the op is not replayed, and replayed anyway it would change nothing.
  expect(opts.guard(turned)).toBe(false);
  expect(fn(turned)).toBe(turned);
  // Onto a table where it still lies front up, it lands.
  const fresh = flipCard(turned, 0, 'delver', false);
  expect(opts.guard(fresh)).toBe(true);
  expect(fn(fresh).players[0].cards!.battlefield[0].cardId).toBe(backId('c-delver'));
  // The card has left meanwhile: nothing to turn.
  const gone = { ...fresh, players: [{ ...fresh.players[0], cards: seat([]) }, fresh.players[1]] };
  expect(opts.guard(gone)).toBe(false);
});

test('"Play as land" lands the card back face up, on the lands shelf, as the turn’s land — in one move', async () => {
  const store = table();
  const before = store.getState().game;
  await store.getState().playCard(0, 'h-valakut', { asLand: true });
  const g = store.getState().game!;
  expect(card(store, 'h-valakut')).toEqual({
    iid: 'h-valakut',
    cardId: backId('c-valakut'),
    name: VALAKUT,
    row: 'lands',
    sick: true,
  });
  expect(landsPlayed(g, 0)).toBe(1);
  store.getState().undo();
  expect(store.getState().game).toBe(before);
});

test('cast the ordinary way, the same card is its front: a spell, to the graveyard', async () => {
  const store = table();
  await store.getState().playCard(0, 'h-valakut');
  expect(store.getState().game!.players[0].cards!.graveyard).toEqual([
    { iid: 'h-valakut', cardId: 'c-valakut', name: VALAKUT },
  ]);
});

test('a card on its back that leaves the battlefield is its front again', async () => {
  const store = table();
  await store.getState().transformCard(0, 'delver');
  store.getState().sacrificeCard(0, 'delver');
  expect(store.getState().game!.players[0].cards!.graveyard).toEqual([
    { iid: 'delver', cardId: 'c-delver', name: DELVER },
  ]);
});
