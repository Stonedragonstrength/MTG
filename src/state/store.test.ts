import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getDb, kvGet, kvSet } from '../data/db';
import * as tableSync from '../data/onlineTable';
import { createGame } from '../lib/game';
import type { GameConfig, GameState } from '../lib/types';
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
  await db.garage.clear();
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

describe('online table wiring', () => {
  test('every mutation notifies the sync module with the pre-state', async () => {
    const store = createAppStore();
    store.getState().startGame(config);
    const before = store.getState().game!;
    store.getState().adjustLife(0, -4);
    expect(tableSync.onLocalMutation).toHaveBeenCalled();
    const [fn, orig] = (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mock.lastCall!;
    expect(orig).toBe(before);
    expect((fn as (g: GameState) => GameState)(before).players[0].life).toBe(36);
  });

  test('pass-turn carries a guard that rejects a moved table', () => {
    const store = createAppStore();
    store.getState().startGame(config);
    const before = store.getState().game!;
    store.getState().passTurn();
    const call = (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mock.lastCall!;
    const guard = (call[2] as { guard: (b: GameState, o: GameState) => boolean }).guard;
    expect(guard(before, before)).toBe(true);
    const moved = { ...before, turnNumber: before.turnNumber + 1 };
    expect(guard(moved, before)).toBe(false);
  });

  test('a stale build blocks online edits', () => {
    const store = createAppStore();
    store.getState().startGame(config);
    store.setState({
      online: { code: 'KQ7M2X', status: { kind: 'stale-build' }, mySeat: null },
    });
    const life = store.getState().game!.players[0].life;
    store.getState().adjustLife(0, -5);
    expect(store.getState().game!.players[0].life).toBe(life); // unchanged
  });

  test('applyRemote validates, migrates, clears undo, and never echoes to the module', async () => {
    const store = createAppStore();
    await store.getState().init();
    const hooks = (tableSync.bindTable as ReturnType<typeof vi.fn>).mock.lastCall![0];
    store.getState().startGame(config);
    store.getState().adjustLife(0, -1); // build some undo history
    expect(store.getState().canUndo()).toBe(true);
    (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mockClear();

    hooks.applyRemote({ players: 'garbage' }); // malformed: ignored
    expect(store.getState().game!.players[0].life).toBe(39);

    const remote = createGame(config);
    remote.players[1] = { ...remote.players[1], life: 0, eliminated: true };
    hooks.applyRemote(remote);
    expect(store.getState().game!.players[1].eliminated).toBe(true);
    expect(store.getState().canUndo()).toBe(false); // history cleared
    expect(tableSync.onLocalMutation).not.toHaveBeenCalled(); // no echo
    expect(store.getState().log.some((l) => /defeated/i.test(l.text))).toBe(true);
  });

  test('undo notifies the module with the restored snapshot', () => {
    const store = createAppStore();
    store.getState().startGame(config);
    const before = store.getState().game!;
    store.getState().adjustLife(0, -2);
    store.getState().undo();
    expect(tableSync.onLocalUndo).toHaveBeenCalledWith(before);
  });

  test('hosting sets the online slice; ending online ends for everyone', async () => {
    const store = createAppStore();
    const err = await store.getState().hostOnlineGame(config);
    expect(err).toBeNull();
    expect(store.getState().online?.code).toBe('KQ7M2X');
    expect(store.getState().inGame).toBe(true);
    store.getState().endGame();
    expect(tableSync.endTableForEveryone).toHaveBeenCalled();
    expect(store.getState().online).toBeNull();
  });
});

describe('cards mode', () => {
  const deckRecord = (id: string, name: string, typeLine: string) => ({
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText: '',
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    colorIdentity: ['G'],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  });

  async function cardsStore() {
    const { addCard, changeCardCount, createDeck, setCommander } = await import('../lib/deck');
    const cmd = deckRecord('c-cmd', 'Ashaya', 'Legendary Creature — Elemental');
    const forest = deckRecord('c-forest', 'Forest', 'Basic Land — Forest');
    await getDb().cards.bulkPut([cmd, forest]); // playCard resolves type lines
    let deck = setCommander(createDeck('Stompy'), cmd);
    deck = addCard(deck, forest);
    deck = changeCardCount(deck, 'c-forest', 9);
    const store = createAppStore();
    store.getState().startGame({ ...config, mode: 'cards' });
    store.getState().seedSeatFromDeck(0, deck, 42);
    return store;
  }

  test('seeding fills the seat once and announces it', async () => {
    const store = await cardsStore();
    const seat = store.getState().game!.players[0].cards!;
    expect(seat.hand).toHaveLength(7);
    expect(seat.command).toHaveLength(1);
    expect(store.getState().game!.feed?.some((e) => /sits down with Stompy/i.test(e.text))).toBe(
      true,
    );
    const before = store.getState().game;
    store
      .getState()
      .seedSeatFromDeck(
        0,
        { id: 'x', name: 'Nope', commander: null, colors: [], cards: [], updatedAt: 1 },
        1,
      );
    expect(store.getState().game).toBe(before); // second seed refused
  });

  test('drawing announces counts, not names, and plays announce names', async () => {
    const store = await cardsStore();
    store.getState().drawCards(0, 2);
    expect(store.getState().game!.players[0].cards!.hand).toHaveLength(9);
    expect(store.getState().game!.feed?.some((e) => e.text === 'A draws 2')).toBe(true);
    const iid = store.getState().game!.players[0].cards!.hand[0].iid;
    const name = store.getState().game!.players[0].cards!.hand[0].name;
    await store.getState().playCard(0, iid);
    expect(store.getState().game!.feed?.some((e) => e.text === `A plays ${name}`)).toBe(true);
    expect(store.getState().log.some((l) => l.text === `A plays ${name}`)).toBe(true); // feed reaches the log
  });

  test('a basic land routes to the lands shelf on play', async () => {
    const store = await cardsStore();
    const forest = store
      .getState()
      .game!.players[0].cards!.hand.find((c) => c.name === 'Forest');
    if (!forest) return; // seeded hand variance: tolerated, library path covered in lib tests
    await store.getState().playCard(0, forest.iid);
    const bf = store.getState().game!.players[0].cards!.battlefield;
    expect(bf.find((c) => c.iid === forest.iid)?.row).toBe('lands');
  });

  test('pass turn readies the incoming seat, virtual cards included', async () => {
    const store = await cardsStore();
    const iid = store.getState().game!.players[0].cards!.hand[0].iid;
    await store.getState().playCard(0, iid);
    store.getState().tapVirtualCard(0, iid);
    expect(
      store.getState().game!.players[0].cards!.battlefield.find((c) => c.iid === iid)?.tapped,
    ).toBe(true);
    store.getState().passTurn(); // to player 1
    store.getState().passTurn(); // back to player 0: their untap step
    expect(
      store.getState().game!.players[0].cards!.battlefield.find((c) => c.iid === iid)?.tapped,
    ).toBeUndefined();
  });

  test('tap carries a direction guard so replays cannot invert it', async () => {
    const store = await cardsStore();
    const iid = store.getState().game!.players[0].cards!.hand[0].iid;
    await store.getState().playCard(0, iid);
    (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mockClear();
    store.getState().tapVirtualCard(0, iid); // untapped -> wants tapped
    const call = (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mock.lastCall!;
    const guard = (call[2] as { guard: (b: GameState, o: GameState) => boolean }).guard;
    const orig = call[1] as GameState;
    expect(guard(orig, orig)).toBe(true); // base still untapped: replay fine
    const alreadyTapped = store.getState().game!; // tap applied locally
    expect(guard(alreadyTapped, orig)).toBe(false); // base already tapped: drop
  });

  test('mulligan is guarded by its own count so a lost ack cannot double it', async () => {
    const store = await cardsStore();
    (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mockClear();
    store.getState().mulliganSeat(0);
    const call = (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mock.lastCall!;
    const guard = (call[2] as { guard: (b: GameState, o: GameState) => boolean }).guard;
    const orig = call[1] as GameState; // mulligans 0 there
    expect(guard(orig, orig)).toBe(true);
    const counted = store.getState().game!; // mulligans 1 after local apply
    expect(guard(counted, orig)).toBe(false);
  });

  test('remote feed entries merge into the local log exactly once', async () => {
    const store = createAppStore();
    await store.getState().init();
    const hooks = (tableSync.bindTable as ReturnType<typeof vi.fn>).mock.lastCall![0];
    store.getState().startGame({ ...config, mode: 'cards' });
    const remote = structuredClone(store.getState().game!);
    remote.feed = [{ id: 'fx1', t: 1, text: 'B draws 3' }];
    hooks.applyRemote(remote);
    hooks.applyRemote(structuredClone(remote)); // second arrival: no dupe
    expect(store.getState().log.filter((l) => l.text === 'B draws 3')).toHaveLength(1);
  });

  test('the 400KB tripwire refuses a bloated cards mutation', async () => {
    const store = await cardsStore();
    const before = store.getState().game!;
    store.getState().seedSeatFromDeck(1, {
      id: 'x',
      name: 'Huge'.padEnd(500_000, 'x'),
      commander: null,
      colors: [],
      cards: [],
      updatedAt: 1,
    }, 1);
    expect(store.getState().game).toBe(before); // refused, state unchanged
  });
});

describe('garage', () => {
  const bolt = {
    id: 'c-bolt',
    name: 'Lightning Bolt',
    nameLower: 'lightning bolt',
    typeLine: 'Instant',
    oracleText: '',
    manaCost: '{R}',
    power: null,
    toughness: null,
    colors: ['R'],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };

  test('swipes stack and survive into a fresh store', async () => {
    const storeA = createAppStore();
    await storeA.getState().init();
    await storeA.getState().addToGarage(bolt);
    await storeA.getState().addToGarage(bolt);
    expect(storeA.getState().garage[0]).toMatchObject({ name: 'Lightning Bolt', count: 2 });

    const storeB = createAppStore();
    await storeB.getState().init();
    expect(storeB.getState().garage[0]).toMatchObject({ name: 'Lightning Bolt', count: 2 });
  });

  test('setting a count to zero tombstones instead of deleting (sync needs it)', async () => {
    const store = createAppStore();
    await store.getState().init();
    await store.getState().addToGarage(bolt);
    await store.getState().setGarageCount('c-bolt', 0);
    expect(store.getState().garage).toHaveLength(0); // hidden from the UI
    const row = await getDb().garage.get('c-bolt');
    expect(row?.deleted).toBe(true);
    expect(row?.dirty).toBe(1);
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
