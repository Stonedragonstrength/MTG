import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import type { CardInstance, CardRecord, GameConfig } from '../lib/types';
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

const rec = (id: string, name: string, typeLine: string, oracleText: string): CardRecord => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  typeLine,
  oracleText,
  manaCost: '',
  power: null,
  toughness: null,
  colors: [],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: typeLine.startsWith('Basic'),
});

const LANDS = [
  rec('ld-gate', 'Simic Guildgate', 'Land — Gate', 'This land enters tapped.\n{T}: Add {G} or {U}.'),
  rec('ld-pool', 'Breeding Pool', 'Land — Forest Island', '({T}: Add {G} or {U}.)\nAs Breeding Pool enters, you may pay 2 life. If you don’t, it enters tapped.'),
  rec('ld-glen', 'Hinterland Harbor', 'Land', 'This land enters tapped unless you control a Forest or an Island.\n{T}: Add {G} or {U}.'),
  rec('ld-forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
];

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

function table(hand: CardInstance[], battlefield: CardInstance[] = []) {
  const store = createAppStore();
  store.getState().startGame(config);
  const g = store.getState().game!;
  store.setState({
    game: {
      ...g,
      players: g.players.map((p, i) =>
        i === 0 ? { ...p, cards: { library: [], hand, battlefield, graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'D' } } : p,
      ),
    },
  });
  return store;
}

const placed = (store: ReturnType<typeof table>, iid: string) =>
  store.getState().game!.players[0].cards!.battlefield.find((c) => c.iid === iid)!;

beforeEach(async () => {
  await flushPersistence();
  await getDb().cards.bulkPut(LANDS);
});

test('a guildgate comes in tapped, with nothing to float', async () => {
  const store = table([{ iid: 'g', cardId: 'ld-gate', name: 'Simic Guildgate' }]);
  await store.getState().playCard(0, 'g');
  expect(placed(store, 'g')).toMatchObject({ tapped: true });
  expect(placed(store, 'g').spent).toBeGreaterThan(0);
  expect(store.getState().game!.feed!.at(-1)!.text).toBe('Nathan plays Simic Guildgate (tapped)');
});

test('a shock land: paid for, it comes in untapped for 2 life; otherwise tapped', async () => {
  const store = table([
    { iid: 'a', cardId: 'ld-pool', name: 'Breeding Pool' },
    { iid: 'b', cardId: 'ld-pool', name: 'Breeding Pool' },
  ]);
  await store.getState().playCard(0, 'a', { landEntry: 'life' });
  expect(placed(store, 'a').tapped).toBeUndefined();
  expect(store.getState().game!.players[0].life).toBe(38);
  await store.getState().playCard(0, 'b', { landEntry: 'tapped' });
  expect(placed(store, 'b').tapped).toBe(true);
  expect(store.getState().game!.players[0].life).toBe(38);
});

test('a check land looks at the lands already out', async () => {
  const withForest = table([{ iid: 'h', cardId: 'ld-glen', name: 'Hinterland Harbor' }], [{ iid: 'f', cardId: 'ld-forest', name: 'Forest', row: 'lands' }]);
  await withForest.getState().playCard(0, 'h');
  expect(placed(withForest, 'h').tapped).toBeUndefined();
  const bare = table([{ iid: 'h', cardId: 'ld-glen', name: 'Hinterland Harbor' }]);
  await bare.getState().playCard(0, 'h');
  expect(placed(bare, 'h').tapped).toBe(true);
});

test('a basic land comes in untapped as always', async () => {
  const store = table([{ iid: 'f', cardId: 'ld-forest', name: 'Forest' }]);
  await store.getState().playCard(0, 'f');
  expect(placed(store, 'f').tapped).toBeUndefined();
  expect(store.getState().game!.feed!.at(-1)!.text).toBe('Nathan plays Forest');
});
