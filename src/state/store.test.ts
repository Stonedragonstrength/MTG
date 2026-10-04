import { beforeEach, describe, expect, test } from 'vitest';
import { getDb, kvGet, kvSet } from '../data/db';
import { createGame } from '../lib/game';
import type { GameConfig } from '../lib/types';
import { createAppStore, flushPersistence } from './store';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
  ],
};

beforeEach(async () => {
  const db = getDb();
  await db.kv.clear();
  await db.profiles.clear();
});

describe('game persistence', () => {
  test('a game in progress survives into a fresh store instance', async () => {
    const storeA = createAppStore();
    storeA.getState().startGame(config);
    storeA.getState().adjustLife(1, -7);
    await flushPersistence();

    const storeB = createAppStore();
    await storeB.getState().init();
    expect(storeB.getState().game?.players[1].life).toBe(33);
    expect(storeB.getState().game?.players[0].life).toBe(40);
  });

  test('corrupted saved state yields a null game without throwing', async () => {
    await kvSet('activeGame', { players: 'nope' });
    const store = createAppStore();
    await store.getState().init();
    expect(store.getState().game).toBeNull();
    expect(await kvGet('activeGame')).toBeUndefined();
  });

  test('a restored game with an out-of-range active player is discarded', async () => {
    await kvSet('activeGame', { ...createGame(config), activePlayerIndex: 7 });
    const store = createAppStore();
    await store.getState().init();
    expect(store.getState().game).toBeNull();
  });

  test('a restored game whose profiles are missing is discarded', async () => {
    const game = createGame(config);
    await kvSet('activeGame', { ...game, config: { ...game.config, profiles: undefined } });
    const store = createAppStore();
    await store.getState().init();
    expect(store.getState().game).toBeNull();
  });

  test('a restored game with fewer profiles than players is discarded', async () => {
    const game = createGame(config);
    await kvSet('activeGame', {
      ...game,
      config: { ...game.config, profiles: game.config.profiles.slice(0, 1) },
    });
    const store = createAppStore();
    await store.getState().init();
    expect(store.getState().game).toBeNull();
  });

  test('endGame clears the saved game', async () => {
    const storeA = createAppStore();
    storeA.getState().startGame(config);
    storeA.getState().endGame();
    await flushPersistence();

    expect(await kvGet('activeGame')).toBeUndefined();
    const storeB = createAppStore();
    await storeB.getState().init();
    expect(storeB.getState().game).toBeNull();
  });
});

describe('setup status', () => {
  test('setupDone reflects the cardsImportedAt stamp', async () => {
    const storeA = createAppStore();
    await storeA.getState().init();
    expect(storeA.getState().setupDone).toBe(false);

    await kvSet('cardsImportedAt', Date.now());
    const storeB = createAppStore();
    await storeB.getState().init();
    expect(storeB.getState().setupDone).toBe(true);
  });
});

describe('profiles', () => {
  test('saveProfile round-trips through the database', async () => {
    const storeA = createAppStore();
    await storeA.getState().saveProfile({
      id: 'nate',
      name: 'Nate',
      avatarUrl: 'https://img.example/avatar.jpg',
      commanderName: 'Atraxa, Praetors’ Voice',
    });

    const storeB = createAppStore();
    await storeB.getState().init();
    expect(storeB.getState().profiles).toHaveLength(1);
    expect(storeB.getState().profiles[0].name).toBe('Nate');
  });

  test('deleteProfile removes it', async () => {
    const store = createAppStore();
    await store.getState().saveProfile({ id: 'x', name: 'X', avatarUrl: null, commanderName: null });
    await store.getState().deleteProfile('x');
    expect(store.getState().profiles).toHaveLength(0);
    expect(await getDb().profiles.count()).toBe(0);
  });
});

describe('settings', () => {
  test('updateSettings persists and restores into a fresh store', async () => {
    const storeA = createAppStore();
    storeA.getState().updateSettings({ backgroundMode: 'swamp' });
    await flushPersistence();

    const storeB = createAppStore();
    await storeB.getState().init();
    expect(storeB.getState().settings.backgroundMode).toBe('swamp');
  });

  test('settings default to all-lands background', () => {
    const store = createAppStore();
    expect(store.getState().settings.backgroundMode).toBe('all');
  });
});

describe('board actions wire through to game state', () => {
  test('adding and counting items via store actions', async () => {
    const store = createAppStore();
    store.getState().startGame(config);
    store.getState().addItem(0, {
      id: 'item-1',
      cardId: null,
      name: 'Treasure',
      imageNormal: null,
      imageArtCrop: null,
      typeLine: 'Token Artifact — Treasure',
      oracleText: '',
      basePower: null,
      baseToughness: null,
      count: 1,
      counters: {},
      color: null,
      zone: 'board',
    });
    store.getState().changeCount(0, 'item-1', 4);
    expect(store.getState().game?.players[0].board[0].count).toBe(5);
  });
});

describe('save migration', () => {
  test('board items saved before the lands feature restore into the board zone', async () => {
    const game = createGame(config);
    const legacyItem = {
      id: 'old-1',
      cardId: null,
      name: 'Treasure',
      imageNormal: null,
      imageArtCrop: null,
      typeLine: 'Token Artifact — Treasure',
      oracleText: '',
      basePower: null,
      baseToughness: null,
      count: 2,
      counters: {},
      color: null,
      // no zone field — saved by an older version
    };
    await kvSet('activeGame', {
      ...game,
      players: [{ ...game.players[0], board: [legacyItem] }, game.players[1]],
    });
    const store = createAppStore();
    await store.getState().init();
    expect(store.getState().game?.players[0].board[0].zone).toBe('board');
  });
});
