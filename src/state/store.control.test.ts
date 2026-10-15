import { beforeEach, expect, test, vi } from 'vitest';
import type { CardInstance, GameConfig } from '../lib/types';
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

const bear: CardInstance = { iid: 'bear', cardId: 'bears', name: 'Grizzly Bears', tapped: true };

function table() {
  const store = createAppStore();
  store.getState().startGame(config);
  const g = store.getState().game!;
  store.setState({
    game: {
      ...g,
      players: g.players.map((p, i) => ({
        ...p,
        cards: { library: [], hand: [], battlefield: i === 1 ? [bear] : [], graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'D' },
      })),
    },
  });
  return store;
}

const field = (store: ReturnType<typeof table>, s: number) => store.getState().game!.players[s].cards!.battlefield;

beforeEach(async () => {
  await flushPersistence();
});

test('taken for the turn: untapped, with haste, said to the table; back to its owner when the turn passes', () => {
  const store = table();
  store.getState().takeControl(0, 1, 'bear', { untilEndOfTurn: true });
  const taken = field(store, 0)[0];
  expect(taken).toMatchObject({ iid: 'bear', stolen: { owner: 1 } });
  expect(taken.tapped).toBeUndefined();
  expect(taken.boost?.keywords).toEqual(['haste']);
  expect(store.getState().game!.feed!.at(-1)!.text).toBe('Nathan gains control of Sam’s Grizzly Bears until end of turn');
  store.getState().passTurn();
  expect(field(store, 0)).toEqual([]);
  expect(field(store, 1).map((c) => c.iid)).toEqual(['bear']);
});

test('taken for good, it stays over the turn; Give back sends it home', () => {
  const store = table();
  store.getState().takeControl(0, 1, 'bear');
  store.getState().passTurn();
  expect(field(store, 0).map((c) => c.iid)).toEqual(['bear']);
  store.getState().giveBack(0, 'bear');
  expect(field(store, 1).map((c) => c.iid)).toEqual(['bear']);
  expect(store.getState().game!.feed!.at(-1)!.text).toBe('Grizzly Bears goes back to Sam');
});

test('an Undo takes the taking back', () => {
  const store = table();
  const before = store.getState().game;
  store.getState().takeControl(0, 1, 'bear');
  store.getState().undo();
  expect(store.getState().game).toBe(before);
});
