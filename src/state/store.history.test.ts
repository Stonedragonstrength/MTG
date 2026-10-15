import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getDb, kvSet } from '../data/db';
import * as tableSync from '../data/onlineTable';
import { adjustLife, createGame } from '../lib/game';
import type { Deck, GameConfig, GameState } from '../lib/types';
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

const config = (n = 2): GameConfig => ({
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: ['Nathan', 'Sam', 'Alex'][i],
    avatarUrl: null,
    commanderName: ['Ashaya, Soul of the Wild', 'Vilis, Broker of Blood', 'Tana, the Bloodsower'][i],
  })),
});

beforeEach(async () => {
  await flushPersistence();
  const db = getDb();
  await db.kv.clear();
  await db.games.clear();
  await db.decks.clear();
});

describe('a decided game goes into the history', () => {
  test('the moment the last opponent falls, and an Undo takes it back out', async () => {
    const store = createAppStore();
    store.getState().startGame(config());
    store.getState().adjustLife(1, -40);
    await flushPersistence();
    const [rec] = store.getState().games;
    expect(rec).toMatchObject({ winner: 0, turns: 1, mode: 'tracker', online: false });
    expect(rec.id).toBe(store.getState().game!.story!.id);
    expect(rec.outs).toMatchObject([{ seat: 1, how: 'life' }]);
    expect(await getDb().games.count()).toBe(1);

    store.getState().undo();
    await flushPersistence();
    expect(store.getState().games).toEqual([]);
    // Kept as a tombstone, so the devices that already have it hear it never ended that way.
    expect(await getDb().games.get(rec.id)).toMatchObject({ deleted: true, dirty: 1 });
  });

  test('nothing is recorded while two players are still in', async () => {
    const store = createAppStore();
    store.getState().startGame(config(3));
    store.getState().adjustLife(1, -40);
    await flushPersistence();
    expect(store.getState().games).toEqual([]);
  });

  test('ending a decided game keeps it there', async () => {
    const store = createAppStore();
    store.getState().startGame(config());
    store.getState().adjustLife(0, -40);
    store.getState().endGame();
    await flushPersistence();
    expect(store.getState().games.map((r) => r.winner)).toEqual([1]);
  });

  test('a winner named as the game ends: theirs, and the others conceded', async () => {
    const store = createAppStore();
    store.getState().startGame(config(3));
    store.getState().adjustLife(1, -40);
    store.getState().endGame({ winner: 2 });
    await flushPersistence();
    const [rec] = store.getState().games;
    expect(rec.winner).toBe(2);
    expect(rec.outs.map((o) => [o.seat, o.how])).toEqual([
      [1, 'life'],
      [0, 'conceded'],
    ]);
    expect(store.getState().game).toBeNull();
  });

  test('ending with nobody named records nothing', async () => {
    const store = createAppStore();
    store.getState().startGame(config());
    store.getState().endGame({ winner: null });
    store.getState().startGame(config());
    store.getState().endGame();
    await flushPersistence();
    expect(store.getState().games).toEqual([]);
  });

  test('a state from another device that decides the game is recorded here too', async () => {
    const store = createAppStore();
    await store.getState().init();
    store.getState().startGame(config());
    const { applyRemote } = vi.mocked(tableSync.bindTable).mock.calls.at(-1)![0];
    const g = store.getState().game!;
    applyRemote(adjustLife(g, 0, -40));
    await flushPersistence();
    expect(store.getState().games.map((r) => r.winner)).toEqual([1]);
  });

  test('the history survives into a fresh store, newest first', async () => {
    const a = createAppStore();
    a.getState().startGame(config());
    a.getState().adjustLife(1, -40);
    await flushPersistence();
    await new Promise((r) => setTimeout(r, 5));
    a.getState().startGame(config());
    a.getState().adjustLife(0, -40);
    await flushPersistence();

    const b = createAppStore();
    await b.getState().init();
    expect(b.getState().games.map((r) => r.winner)).toEqual([1, 0]);
  });
});

describe('taking a game out of the history', () => {
  test('it leaves the list, waits on the removed shelf and comes back', async () => {
    const store = createAppStore();
    store.getState().startGame(config());
    store.getState().adjustLife(1, -40);
    await flushPersistence();
    const id = store.getState().games[0].id;

    await store.getState().removeGame(id);
    expect(store.getState().games).toEqual([]);
    expect((await store.getState().removedGames()).map((r) => r.id)).toEqual([id]);

    await store.getState().restoreGame(id);
    expect(store.getState().games.map((r) => r.id)).toEqual([id]);
    expect(await store.getState().removedGames()).toEqual([]);
  });

  test('a removed game stays out when its decided game is loaded again', async () => {
    const a = createAppStore();
    a.getState().startGame(config());
    a.getState().adjustLife(1, -40);
    await flushPersistence();
    await a.getState().removeGame(a.getState().games[0].id);
    await flushPersistence();

    const b = createAppStore();
    await b.getState().init(); // the decided game is still the saved one
    await flushPersistence();
    expect(b.getState().games).toEqual([]);
    expect(await b.getState().removedGames()).toHaveLength(1);
  });
});

describe('concede', () => {
  test('the player is out, as conceded, and their turn passes on', async () => {
    const store = createAppStore();
    store.getState().startGame(config(3));
    store.getState().concede(0);
    const g = store.getState().game!;
    expect(g.players[0].eliminated).toBe(true);
    expect(g.activePlayerIndex).toBe(1);
    expect(g.story!.outs).toMatchObject([{ seat: 0, how: 'conceded' }]);
  });

  test('the last concession decides the game', async () => {
    const store = createAppStore();
    store.getState().startGame(config());
    store.getState().concede(0);
    await flushPersistence();
    expect(store.getState().game!.activePlayerIndex).toBe(0); // the game is over: nothing to pass to
    expect(store.getState().games.map((r) => r.winner)).toEqual([1]);
  });

  test('a player already out cannot concede again', () => {
    const store = createAppStore();
    store.getState().startGame(config(3));
    store.getState().concede(1);
    const g = store.getState().game;
    store.getState().concede(1);
    expect(store.getState().game).toBe(g);
  });
});

describe('rematch', () => {
  const deck: Deck = {
    id: 'd1',
    name: 'Stompy',
    commander: null,
    colors: ['G'],
    cards: [{ cardId: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', manaCost: '', imageNormal: null, count: 40 }],
    updatedAt: 1,
  };

  test('the same players in the same seats, a new game, the old one kept in the history', async () => {
    const store = createAppStore();
    store.getState().startGame(config(3));
    store.getState().adjustLife(1, -40);
    store.getState().adjustLife(2, -40);
    await flushPersistence();
    const first = store.getState().game!;
    store.getState().rematch();
    await flushPersistence();
    const next = store.getState().game!;
    expect(next.config.profiles.map((p) => p.name)).toEqual(['Nathan', 'Sam', 'Alex']);
    expect(next.players.map((p) => p.life)).toEqual([40, 40, 40]);
    expect(next.story!.id).not.toBe(first.story!.id);
    expect(store.getState().games.map((r) => r.id)).toEqual([first.story!.id]);
  });

  test('a seat that played a saved deck is dealt it again', async () => {
    const store = createAppStore();
    store.setState({ decks: [deck] });
    const cfg: GameConfig = {
      ...config(),
      mode: 'cards',
      profiles: config().profiles.map((p, i) => (i === 0 ? { ...p, deckId: 'd1' } : p)),
    };
    store.getState().startGame(cfg);
    store.getState().seedSeatFromDeck(0, deck);
    store.getState().adjustLife(1, -40);
    store.getState().rematch();
    const g = store.getState().game!;
    expect(g.players[0].cards).toBeDefined();
    expect(g.players[0].cards!.library.length + g.players[0].cards!.hand.length).toBe(40);
    expect(g.players[1].cards).toBeUndefined();
  });

  test('no rematch at an online table', () => {
    const store = createAppStore();
    store.getState().startGame(config());
    store.setState({ online: { code: 'X', status: { kind: 'live', peers: 2 }, mySeat: 0 } });
    const g = store.getState().game;
    store.getState().rematch();
    expect(store.getState().game).toBe(g);
  });
});

describe('the story rides inside every move', () => {
  test('a new game has one, and a move adds to it', () => {
    const store = createAppStore();
    store.getState().startGame(config());
    expect(store.getState().game!.story!.startedAt).toEqual(expect.any(Number));
    store.getState().adjustLife(1, -5);
    expect(store.getState().game!.story!.open).toMatchObject([{ seat: 1, net: -5 }]);
  });

  test('a saved game from before stories loads, and its next move begins one', async () => {
    const old: GameState = createGame(config());
    await kvSet('activeGame', old);
    const store = createAppStore();
    await store.getState().init();
    expect(store.getState().game!.story).toBeUndefined();
    store.getState().adjustLife(0, -3);
    expect(store.getState().game!.story!.startedAt).toBeUndefined();
    expect(store.getState().game!.story!.turns).toHaveLength(1);
  });
});
