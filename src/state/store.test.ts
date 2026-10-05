import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getDb, kvGet, kvSet } from '../data/db';
import { createGame } from '../lib/game';
import type { GameConfig } from '../lib/types';
import { createAppStore, flushPersistence } from './store';

vi.mock('../lib/sound', () => ({
  playLifeTick: vi.fn(),
  playTurnChime: vi.fn(),
  playDefeat: vi.fn(),
}));

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
  await flushPersistence(); // let any prior test's queued save land first
  const db = getDb();
  await db.kv.clear();
  await db.profiles.clear();
  await db.decks.clear();
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

describe('decks', () => {
  test('saveDeck round-trips through the database, newest first', async () => {
    const { createDeck } = await import('../lib/deck');
    const storeA = createAppStore();
    await storeA.getState().init();
    const older = { ...createDeck('Old Faithful'), updatedAt: 1000 };
    const newer = { ...createDeck('Fresh Brew'), updatedAt: 2000 };
    await storeA.getState().saveDeck(older);
    await storeA.getState().saveDeck(newer);

    const storeB = createAppStore();
    await storeB.getState().init();
    expect(storeB.getState().decks.map((d) => d.name)).toEqual(['Fresh Brew', 'Old Faithful']);
  });

  test('deleteDeck removes it from state and the database', async () => {
    const { createDeck } = await import('../lib/deck');
    const storeA = createAppStore();
    await storeA.getState().init();
    const deck = createDeck('Doomed');
    await storeA.getState().saveDeck(deck);
    await storeA.getState().deleteDeck(deck.id);
    expect(storeA.getState().decks).toHaveLength(0);

    const storeB = createAppStore();
    await storeB.getState().init();
    expect(storeB.getState().decks).toHaveLength(0);
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
    storeA.getState().updateSettings({
      ...storeA.getState().settings,
      backgroundMode: 'swamp',
    });
    await flushPersistence();

    const storeB = createAppStore();
    await storeB.getState().init();
    expect(storeB.getState().settings.backgroundMode).toBe('swamp');
  });

  test('settings default to all-lands background with sane visual knobs', () => {
    const store = createAppStore();
    const settings = store.getState().settings;
    expect(settings.backgroundMode).toBe('all');
    expect(settings.backgroundIntensity).toBe(35);
    expect(settings.cycleSeconds).toBe(0);
    expect(settings.fadeSeconds).toBe(2);
    expect(settings.soundOn).toBe(false);
    expect(settings.turnTimerOn).toBe(true);
    expect(settings.autoFocusOn).toBe(false);
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

  test('passing the turn untaps the incoming player’s lands', () => {
    const store = createAppStore();
    store.getState().startGame(config);
    store.getState().addItem(1, {
      id: 'land-1',
      cardId: null,
      name: 'Forest',
      imageNormal: null,
      imageArtCrop: null,
      typeLine: 'Basic Land — Forest',
      oracleText: '({T}: Add {G}.)',
      basePower: null,
      baseToughness: null,
      count: 4,
      counters: {},
      color: null,
      zone: 'lands',
      tapped: 0,
    });
    store.getState().tapItem(1, 'land-1', 3);
    expect(store.getState().game?.players[1].board[0].tapped).toBe(3);

    store.getState().passTurn(); // seat 1 becomes active → untap step
    expect(store.getState().game?.players[1].board[0].tapped).toBe(0);
  });

  test('starting a game enters it; restoring a save waits for pick-up', async () => {
    const store = createAppStore();
    expect(store.getState().inGame).toBe(false);
    store.getState().startGame(config);
    expect(store.getState().inGame).toBe(true);
    await flushPersistence();

    const storeB = createAppStore();
    await storeB.getState().init();
    expect(storeB.getState().game).not.toBeNull();
    expect(storeB.getState().inGame).toBe(false); // home screen offers Pick up
    storeB.getState().enterGame();
    expect(storeB.getState().inGame).toBe(true);
    storeB.getState().endGame();
    expect(storeB.getState().inGame).toBe(false);
  });

  test('player counters, commander deaths, and badges wire through', () => {
    const store = createAppStore();
    store.getState().startGame(config);
    store.getState().setPlayerCounter(0, 'poison', 3);
    store.getState().setCommanderDeaths(1, 2);
    store.getState().claimMonarch(1);
    store.getState().claimInitiative(0);
    const game = store.getState().game!;
    expect(game.players[0].counters.poison).toBe(3);
    expect(game.players[1].commanderDeaths).toBe(2);
    expect(game.monarchIdx).toBe(1);
    expect(game.initiativeIdx).toBe(0);
  });
});

describe('undo', () => {
  test('undo walks back through recent changes', () => {
    const store = createAppStore();
    store.getState().startGame(config);
    store.getState().adjustLife(0, -5);
    store.getState().adjustLife(0, -3);
    expect(store.getState().game?.players[0].life).toBe(32);

    store.getState().undo();
    expect(store.getState().game?.players[0].life).toBe(35);
    store.getState().undo();
    expect(store.getState().game?.players[0].life).toBe(40);
  });

  test('undo past the beginning is a safe no-op', () => {
    const store = createAppStore();
    store.getState().startGame(config);
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().game?.players[0].life).toBe(40);
  });

  test('canUndo reflects history', () => {
    const store = createAppStore();
    store.getState().startGame(config);
    expect(store.getState().canUndo()).toBe(false);
    store.getState().adjustLife(0, 1);
    expect(store.getState().canUndo()).toBe(true);
  });
});

describe('game log', () => {
  test('life changes, items, and turns land in the log with player names', () => {
    const store = createAppStore();
    store.getState().startGame(config);
    store.getState().adjustLife(1, -7);
    store.getState().passTurn();
    const texts = store.getState().log.map((e) => e.text);
    expect(texts.some((t) => t.includes('B') && t.includes('33'))).toBe(true);
    expect(texts.some((t) => t.toLowerCase().includes('turn'))).toBe(true);
  });

  test('endGame clears log and history', () => {
    const store = createAppStore();
    store.getState().startGame(config);
    store.getState().adjustLife(0, -1);
    store.getState().endGame();
    expect(store.getState().log).toEqual([]);
    expect(store.getState().canUndo()).toBe(false);
  });
});

describe('sound hooks', () => {
  test('life ticks play only when sound is on', async () => {
    const sound = await import('../lib/sound');
    const store = createAppStore();
    store.getState().startGame(config);

    store.getState().adjustLife(0, -1);
    expect(sound.playLifeTick).not.toHaveBeenCalled();

    store.getState().updateSettings({ ...store.getState().settings, soundOn: true });
    store.getState().adjustLife(0, -1);
    expect(sound.playLifeTick).toHaveBeenCalled();
  });
});

describe('save migration', () => {
  test('a save without counters, deaths, or monarch fields gains defaults', async () => {
    const game = createGame(config);
    const legacy = {
      ...game,
      players: game.players.map((p) => {
        const copy: Record<string, unknown> = { ...p };
        delete copy.counters;
        delete copy.commanderDeaths;
        return copy;
      }),
    } as Record<string, unknown>;
    delete legacy.monarchIdx;
    delete legacy.initiativeIdx;
    delete legacy.turnStartedAt;
    await kvSet('activeGame', legacy);

    const store = createAppStore();
    await store.getState().init();
    const restored = store.getState().game;
    expect(restored).not.toBeNull();
    expect(restored?.players[0].counters).toEqual({});
    expect(restored?.players[0].commanderDeaths).toBe(0);
    expect(restored?.monarchIdx).toBeNull();
    expect(typeof restored?.turnStartedAt).toBe('number');
  });

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
