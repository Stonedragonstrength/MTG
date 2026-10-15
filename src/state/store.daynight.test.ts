import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import { backId, isBackId } from '../lib/faces';
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

const CATHAR: CardRecord = {
  id: 'dn-cathar',
  name: 'Brutal Cathar // Moonrage Brute',
  nameLower: 'brutal cathar // moonrage brute',
  typeLine: 'Creature — Human Soldier Werewolf // Creature — Werewolf',
  oracleText: 'Daybound\n//\nFirst strike\nNightbound',
  manaCost: '{2}{W}',
  power: '3',
  toughness: '3',
  colors: ['W'],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
  back: {
    name: 'Moonrage Brute',
    typeLine: 'Creature — Werewolf',
    oracleText: 'First strike\nNightbound',
    manaCost: '',
    power: '3',
    toughness: '3',
    colors: ['W'],
    imageNormal: null,
    imageArtCrop: null,
  },
};

const cathar: CardInstance = { iid: 'c1', cardId: 'dn-cathar', name: CATHAR.name };

function table(over: Partial<GameState> = {}) {
  const store = createAppStore();
  store.getState().startGame(config);
  const g = store.getState().game!;
  store.setState({
    game: {
      ...g,
      ...over,
      players: g.players.map((p, i) =>
        i === 0
          ? { ...p, cards: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'D' } }
          : p,
      ),
    },
  });
  return store;
}

const settle = () => new Promise((r) => setTimeout(r, 80));

beforeEach(async () => {
  await flushPersistence();
  await getDb().cards.bulkPut([CATHAR]);
});

describe('day and night', () => {
  test('a turn in which its player cast nothing turns day into night', () => {
    const store = table({ dayNight: 'day' });
    store.getState().passTurn();
    expect(store.getState().game!.dayNight).toBe('night');
  });

  test('two spells in a night turn it into day; one does not', () => {
    const store = table({ dayNight: 'night' });
    const g = store.getState().game!;
    store.setState({ game: { ...g, casts: { turn: g.turnNumber, active: g.activePlayerIndex, n: 1 } } });
    store.getState().passTurn();
    expect(store.getState().game!.dayNight).toBe('night');
    const h = store.getState().game!;
    store.setState({ game: { ...h, casts: { turn: h.turnNumber, active: h.activePlayerIndex, n: 2 } } });
    store.getState().passTurn();
    expect(store.getState().game!.dayNight).toBe('day');
  });

  test('a daybound card arriving makes it day', async () => {
    const store = table();
    store.getState().moveVirtualCard(0, 'c1', 'hand', 'battlefield'); // nothing there yet: a no-op
    const g = store.getState().game!;
    store.setState({
      game: { ...g, players: g.players.map((p, i) => (i === 0 ? { ...p, cards: { ...p.cards!, hand: [cathar] } } : p)) },
    });
    store.getState().moveVirtualCard(0, 'c1', 'hand', 'battlefield');
    await settle();
    expect(store.getState().game!.dayNight).toBe('day');
    expect(isBackId(store.getState().game!.players[0].cards!.battlefield[0].cardId)).toBe(false);
  });

  test('when night falls the daybound card turns over, and back again by day', async () => {
    const store = table({ dayNight: 'day' });
    const g = store.getState().game!;
    store.setState({
      game: { ...g, players: g.players.map((p, i) => (i === 0 ? { ...p, cards: { ...p.cards!, battlefield: [cathar] } } : p)) },
    });
    store.getState().passTurn(); // nothing cast: night
    await settle();
    const night = store.getState().game!;
    expect(night.dayNight).toBe('night');
    expect(night.players[0].cards!.battlefield[0].cardId).toBe(backId('dn-cathar'));
    expect(night.feed?.at(-1)?.text).toBe('It is night: Brutal Cathar becomes Moonrage Brute');

    store.setState({ game: { ...night, casts: { turn: night.turnNumber, active: night.activePlayerIndex, n: 2 } } });
    store.getState().passTurn();
    await settle();
    expect(store.getState().game!.players[0].cards!.battlefield[0].cardId).toBe('dn-cathar');
  });

  test('spells the active player casts are counted inside the move', async () => {
    const store = table();
    const g = store.getState().game!;
    store.setState({
      game: { ...g, players: g.players.map((p, i) => (i === 0 ? { ...p, cards: { ...p.cards!, hand: [cathar] } } : p)) },
    });
    await store.getState().playCard(0, 'c1');
    await settle();
    expect(store.getState().game!.casts).toMatchObject({ n: 1 });
  });
});
