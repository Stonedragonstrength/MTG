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

  test('a hosted table the player backed out of is closed, never entered', async () => {
    vi.mocked(tableSync.endTableForEveryone).mockClear();
    const store = createAppStore();
    const err = await store.getState().hostOnlineGame(config, () => false);
    expect(err).toBeNull();
    expect(tableSync.endTableForEveryone).toHaveBeenCalled(); // no orphan table left open
    expect(store.getState().online).toBeNull();
    expect(store.getState().game).toBeNull();
    expect(store.getState().inGame).toBe(false);
  });

  test('joining lands the table on this device but waits at home for the seat question', async () => {
    const remote = createGame(config);
    vi.mocked(tableSync.joinTable).mockResolvedValueOnce({ state: remote });
    const store = createAppStore();
    const err = await store.getState().joinOnlineGame('kq7m2x');
    expect(err).toBeNull();
    expect(store.getState().online?.code).toBe('KQ7M2X');
    expect(store.getState().game).not.toBeNull();
    // The join sheet still has questions to ask; entering now would destroy it.
    expect(store.getState().inGame).toBe(false);
    store.getState().enterGame();
    expect(store.getState().inGame).toBe(true);
  });

  test('a join the player backed out of changes nothing and leaves the table', async () => {
    vi.mocked(tableSync.joinTable).mockResolvedValueOnce({ state: createGame(config) });
    vi.mocked(tableSync.leaveTable).mockClear();
    const store = createAppStore();
    store.getState().startGame(config); // a local game is saved on this device
    store.getState().adjustLife(0, -9);
    store.getState().exitToHome();
    const mine = store.getState().game;
    const err = await store.getState().joinOnlineGame('KQ7M2X', () => false);
    expect(err).toBeNull();
    expect(tableSync.leaveTable).toHaveBeenCalled();
    expect(store.getState().game).toBe(mine); // the saved game was not replaced
    expect(store.getState().online).toBeNull();
    expect(store.getState().inGame).toBe(false);
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

  test('playCard rescues a drifted printing by name before routing', async () => {
    const store = await cardsStore();
    // The deck was saved against a printing the card DB no longer holds:
    const g = store.getState().game!;
    const seat = g.players[0].cards!;
    const drifted = { iid: 'drift1', cardId: 'c-gone', name: 'Forest' };
    store.setState({
      game: {
        ...g,
        players: g.players.map((p, i) =>
          i === 0 ? { ...p, cards: { ...seat, hand: [drifted, ...seat.hand.slice(1)] } } : p,
        ),
      },
    });
    await store.getState().playCard(0, 'drift1');
    const bf = store.getState().game!.players[0].cards!.battlefield;
    expect(bf.find((c) => c.iid === 'drift1')?.row).toBe('lands'); // name fallback found the Forest
  });

  test('a directed tap request onto a card already there is a clean no-op', async () => {
    const store = await cardsStore();
    const iid = store.getState().game!.players[0].cards!.hand[0].iid;
    await store.getState().playCard(0, iid);
    store.getState().tapVirtualCard(0, iid); // toggle: untapped -> tapped
    const calls = (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mock.calls.length;
    store.getState().tapVirtualCard(0, iid, true); // "use one" against a stale render
    expect(
      store.getState().game!.players[0].cards!.battlefield.find((c) => c.iid === iid)?.tapped,
    ).toBe(true); // still tapped — NOT toggled back
    expect((tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls); // nothing pushed
  });

  test('keeping the hand is terminal: kept is marked and a replayed keep changes nothing', async () => {
    const store = await cardsStore();
    store.getState().mulliganSeat(0);
    const iid = store.getState().game!.players[0].cards!.hand[0].iid;
    store.getState().keepHand(0, [iid]);
    const seat = store.getState().game!.players[0].cards!;
    expect(seat.kept).toBe(true);
    expect(seat.hand).toHaveLength(6);
    store.getState().keepHand(0, [seat.hand[0].iid]); // double-keep attempt
    expect(store.getState().game!.players[0].cards!.hand).toHaveLength(6); // refused
  });

  test('a commander stranded in the graveyard returns to command with its tax', async () => {
    const store = await cardsStore();
    store.getState().castCommander(0); // resolves its cost off the card DB first
    await vi.waitFor(() =>
      expect(store.getState().game!.players[0].cards!.battlefield).toHaveLength(1),
    );
    const iid = store.getState().game!.players[0].cards!.battlefield[0].iid;
    store.getState().moveVirtualCard(0, iid, 'battlefield', 'graveyard'); // board wipe gesture
    store.getState().commanderReturned(0, iid, 'graveyard');
    const after = store.getState().game!;
    expect(after.players[0].cards!.command.some((c) => c.iid === iid)).toBe(true);
    expect(after.players[0].commanderDeaths).toBe(1);
    expect(after.feed?.some((e) => /returns to the command zone/i.test(e.text))).toBe(true);
  });

  test('casting auto-taps the lands that pay the cost', async () => {
    const store = await cardsStore(); // first: its bulkPut would stomp the enriched records
    const forest = {
      ...deckRecord('c-forest', 'Forest', 'Basic Land — Forest'),
      oracleText: '({T}: Add {G}.)',
    };
    const bear = {
      ...deckRecord('c-bear', 'Grizzly Bears', 'Creature — Bear'),
      manaCost: '{1}{G}',
    };
    await getDb().cards.bulkPut([forest, bear]);
    const g = store.getState().game!;
    const seat = g.players[0].cards!;
    store.setState({
      game: {
        ...g,
        players: g.players.map((p, i) =>
          i === 0
            ? {
                ...p,
                cards: {
                  ...seat,
                  hand: [{ iid: 'h-bear', cardId: 'c-bear', name: 'Grizzly Bears' }],
                  battlefield: [
                    { iid: 'f1', cardId: 'c-forest', name: 'Forest', row: 'lands' },
                    { iid: 'f2', cardId: 'c-forest', name: 'Forest', row: 'lands' },
                    { iid: 'f3', cardId: 'c-forest', name: 'Forest', row: 'lands' },
                  ],
                },
              }
            : p,
        ),
      },
    });
    await store.getState().playCard(0, 'h-bear');
    const bf = store.getState().game!.players[0].cards!.battlefield;
    expect(bf.find((c) => c.iid === 'h-bear')?.row).toBe('front');
    expect(bf.filter((c) => c.tapped).length).toBe(2); // {1}{G} = two forests tapped
  });

  test('mana from lands you tapped yourself pays for the cast — no extra land taps', async () => {
    const store = await cardsStore();
    await getDb().cards.bulkPut([
      { ...deckRecord('c-forest', 'Forest', 'Basic Land — Forest'), oracleText: '({T}: Add {G}.)' },
      { ...deckRecord('c-bear', 'Grizzly Bears', 'Creature — Bear'), manaCost: '{1}{G}' },
    ]);
    const g = store.getState().game!;
    store.setState({
      game: {
        ...g,
        players: g.players.map((p, i) =>
          i === 0
            ? {
                ...p,
                cards: {
                  ...p.cards!,
                  hand: [{ iid: 'h-bear', cardId: 'c-bear', name: 'Grizzly Bears' }],
                  battlefield: [
                    { iid: 'f1', cardId: 'c-forest', name: 'Forest', row: 'lands' as const },
                    { iid: 'f2', cardId: 'c-forest', name: 'Forest', row: 'lands' as const },
                    { iid: 'f3', cardId: 'c-forest', name: 'Forest', row: 'lands' as const },
                  ],
                },
              }
            : p,
        ),
      },
    });
    store.getState().tapVirtualCard(0, 'f1', true); // the natural way: tap lands first
    store.getState().tapVirtualCard(0, 'f2', true);
    await store.getState().playCard(0, 'h-bear');
    const bf = store.getState().game!.players[0].cards!.battlefield;
    expect(bf.find((c) => c.iid === 'f3')?.tapped).toBeUndefined(); // third land left alone
    expect(bf.find((c) => c.iid === 'f1')?.spent).toBe(1);
    expect(bf.find((c) => c.iid === 'f2')?.spent).toBe(1);
  });

  /** Seat 0 with the given hand and battlefield; records for a Forest and two bears. */
  async function tableWith(
    hand: { iid: string; cardId: string; name: string }[],
    lands: number,
  ) {
    const store = await cardsStore();
    await getDb().cards.bulkPut([
      { ...deckRecord('c-forest', 'Forest', 'Basic Land — Forest'), oracleText: '({T}: Add {G}.)' },
      { ...deckRecord('c-bear', 'Grizzly Bears', 'Creature — Bear'), manaCost: '{1}{G}' },
      { ...deckRecord('c-cub', 'Bear Cub', 'Creature — Bear'), manaCost: '{1}{G}' },
      {
        ...deckRecord('c-giant', 'Bonecrusher Giant // Stomp', 'Creature — Giant // Instant — Adventure'),
        manaCost: '{2}{G} // {1}{G}',
      },
    ]);
    const g = store.getState().game!;
    store.setState({
      game: {
        ...g,
        players: g.players.map((p, i) =>
          i === 0
            ? {
                ...p,
                cards: {
                  ...p.cards!,
                  hand,
                  battlefield: Array.from({ length: lands }, (_, k) => ({
                    iid: `f${k + 1}`,
                    cardId: 'c-forest',
                    name: 'Forest',
                    row: 'lands' as const,
                  })),
                },
              }
            : p,
        ),
      },
    });
    return store;
  }
  const lands = (store: ReturnType<typeof createAppStore>) =>
    store.getState().game!.players[0].cards!.battlefield.filter((c) => c.row === 'lands');

  test('a creature with an adventure pays its own cost, not both halves', async () => {
    const store = await tableWith([{ iid: 'h1', cardId: 'c-giant', name: 'Bonecrusher Giant' }], 6);
    await store.getState().playCard(0, 'h1');
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(3); // {2}{G}, not five
  });

  test('when only the cheaper half of a two-part card is payable, that half is paid', async () => {
    const store = await tableWith([{ iid: 'h1', cardId: 'c-giant', name: 'Bonecrusher Giant' }], 2);
    await store.getState().playCard(0, 'h1');
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(2); // the {1}{G} half
  });

  test('two casts fired together never pay with the same lands', async () => {
    const store = await tableWith(
      [
        { iid: 'h-bear', cardId: 'c-bear', name: 'Grizzly Bears' },
        { iid: 'h-cub', cardId: 'c-cub', name: 'Bear Cub' },
      ],
      4,
    );
    await Promise.all([store.getState().playCard(0, 'h-bear'), store.getState().playCard(0, 'h-cub')]);
    const after = lands(store);
    expect(after.every((c) => c.tapped)).toBe(true); // four mana of spells on four lands
    expect(after.every((c) => c.spent === 1)).toBe(true); // none charged twice
  });

  test('a cast replayed into a later turn moves the card but leaves that turn’s lands alone', async () => {
    const store = await tableWith([{ iid: 'h-bear', cardId: 'c-bear', name: 'Grizzly Bears' }], 2);
    const before = store.getState().game!;
    (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mockClear();
    await store.getState().playCard(0, 'h-bear');
    const op = (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mock.lastCall![0] as (
      g: GameState,
    ) => GameState;
    // The table moved on before this cast arrived: a full round later, lands readied.
    const rebased = op({ ...before, turnNumber: before.turnNumber + 2 });
    const seat = rebased.players[0].cards!;
    expect(seat.battlefield.some((c) => c.iid === 'h-bear')).toBe(true); // the card still arrives
    expect(seat.battlefield.some((c) => c.tapped)).toBe(false); // but this turn's mana is untouched
  });

  test('a cast nothing can pay still resolves, tapping nothing (trust model)', async () => {
    const store = await cardsStore();
    const bolt = {
      ...deckRecord('c-bolt', 'Lightning Bolt', 'Instant'),
      manaCost: '{R}',
    };
    const forest = {
      ...deckRecord('c-forest', 'Forest', 'Basic Land — Forest'),
      oracleText: '({T}: Add {G}.)',
    };
    await getDb().cards.bulkPut([bolt, forest]);
    const g = store.getState().game!;
    const seat = g.players[0].cards!;
    store.setState({
      game: {
        ...g,
        players: g.players.map((p, i) =>
          i === 0
            ? {
                ...p,
                cards: {
                  ...seat,
                  hand: [{ iid: 'h-bolt', cardId: 'c-bolt', name: 'Lightning Bolt' }],
                  battlefield: [{ iid: 'f1', cardId: 'c-forest', name: 'Forest', row: 'lands' }],
                },
              }
            : p,
        ),
      },
    });
    await store.getState().playCard(0, 'h-bolt'); // forest makes G, bolt wants R
    const after = store.getState().game!.players[0].cards!;
    expect(after.graveyard.some((c) => c.iid === 'h-bolt')).toBe(true); // instant resolved
    expect(after.battlefield.some((c) => c.tapped)).toBe(false); // no half-payments
  });

  test('casting the commander taps its mana too', async () => {
    const store = await cardsStore();
    const cmdCost = {
      ...deckRecord('c-cmd', 'Ashaya', 'Legendary Creature — Elemental'),
      manaCost: '{3}{G}{G}',
    };
    const forest = {
      ...deckRecord('c-forest', 'Forest', 'Basic Land — Forest'),
      oracleText: '({T}: Add {G}.)',
    };
    await getDb().cards.bulkPut([cmdCost, forest]);
    const g = store.getState().game!;
    const seat = g.players[0].cards!;
    store.setState({
      game: {
        ...g,
        players: g.players.map((p, i) =>
          i === 0
            ? {
                ...p,
                cards: {
                  ...seat,
                  battlefield: Array.from({ length: 6 }, (_, k) => ({
                    iid: `f${k}`,
                    cardId: 'c-forest',
                    name: 'Forest',
                    row: 'lands' as const,
                  })),
                },
              }
            : p,
        ),
      },
    });
    store.getState().castCommander(0);
    await vi.waitFor(() => {
      const bf = store.getState().game!.players[0].cards!.battlefield;
      expect(bf.some((c) => c.name === 'Ashaya')).toBe(true);
      expect(bf.filter((c) => c.tapped).length).toBe(5); // {3}{G}{G}
    });
  });

  test('partners cast one at a time and each pays only its own tax', async () => {
    const { addCard, changeCardCount, createDeck, setCommander, setPartner } = await import(
      '../lib/deck'
    );
    let deck = setPartner(
      setCommander(createDeck('Pair'), deckRecord('c-thrasios', 'Thrasios', 'Legendary Creature')),
      deckRecord('c-tymna', 'Tymna', 'Legendary Creature'),
    );
    deck = addCard(deck, deckRecord('c-forest', 'Forest', 'Basic Land — Forest'));
    deck = changeCardCount(deck, 'c-forest', 9);
    const store = createAppStore();
    store.getState().startGame({ ...config, mode: 'cards' });
    store.getState().seedSeatFromDeck(0, deck, 42);
    const seat = () => store.getState().game!.players[0].cards!;
    const [thrasios, tymna] = seat().command;
    const onField = (iid: string) => seat().battlefield.some((c) => c.iid === iid);

    store.getState().castCommander(0, tymna.iid); // the SECOND commander, by choice
    await vi.waitFor(() => expect(onField(tymna.iid)).toBe(true));
    expect(seat().command.map((c) => c.iid)).toEqual([thrasios.iid]); // its partner stays home

    store.getState().commanderDiedAction(0, tymna.iid);
    store.getState().castCommander(0, thrasios.iid);
    await vi.waitFor(() => expect(onField(thrasios.iid)).toBe(true));
    store.getState().castCommander(0, tymna.iid);
    await vi.waitFor(() => expect(onField(tymna.iid)).toBe(true));

    const feed = store.getState().game!.feed!.map((e) => e.text);
    expect(feed).toContain('A casts Thrasios'); // never died: no tax
    expect(feed).toContain('A casts Tymna (tax +2)'); // its own death, its own tax
  });

  test('looking at the top of the library is announced; the result says how many went where, never which', async () => {
    const store = await cardsStore();
    const lib = store.getState().game!.players[0].cards!.library;
    const [a, b, c] = lib.slice(0, 3).map((x) => x.iid);
    store.getState().lookNotice(0, 3);
    store.getState().arrangeTop(0, [a, b, c], { top: [c], bottom: [a], graveyard: [], hand: [b] });
    const seat = store.getState().game!.players[0].cards!;
    expect(seat.library[0].iid).toBe(c);
    expect(seat.library.at(-1)!.iid).toBe(a);
    expect(seat.hand.at(-1)!.iid).toBe(b);
    const feed = store.getState().game!.feed!.map((e) => e.text);
    expect(feed).toContain('A looks at the top 3 of their library');
    expect(feed).toContain('A puts 1 back on top, 1 on the bottom, 1 in hand');
    expect(feed.join(' ')).not.toMatch(/Forest|Ashaya/); // no card names: the library is hidden
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

  // ---- turn rules: one land per turn, summoning sickness, X costs ----

  const FOREST = { iid: 'h-forest', cardId: 'c-forest', name: 'Forest' };
  const FOREST_2 = { iid: 'h-forest2', cardId: 'c-forest', name: 'Forest' };
  const BEAR = { iid: 'h-bear', cardId: 'c-bear', name: 'Grizzly Bears' };
  const seat0 = (store: ReturnType<typeof createAppStore>) => store.getState().game!.players[0].cards!;
  const onField = (store: ReturnType<typeof createAppStore>, iid: string) =>
    seat0(store).battlefield.find((c) => c.iid === iid);
  const feedOf = (store: ReturnType<typeof createAppStore>) =>
    store.getState().game!.feed!.map((e) => e.text);
  /** The lands seat 0 has played from hand in the turn the game is in. */
  const landsThisTurn = async (store: ReturnType<typeof createAppStore>) =>
    (await import('../lib/cards')).landsPlayed(store.getState().game!, 0);

  test('a land played from hand is counted for the turn, and so is a second one', async () => {
    const store = await tableWith([FOREST, FOREST_2], 0);
    expect('landPlays' in seat0(store)).toBe(false);
    await store.getState().playCard(0, 'h-forest');
    expect(await landsThisTurn(store)).toBe(1);
    // The store does not refuse the second land: the table dims it, and "Play anyway" must still count.
    await store.getState().playCard(0, 'h-forest2');
    expect(await landsThisTurn(store)).toBe(2);
    expect(seat0(store).landPlays).toEqual({ turn: 1, active: 0, n: 2 });
    expect(seat0(store).battlefield.filter((c) => c.row === 'lands')).toHaveLength(2);
  });

  test('a spell or a creature is not a land play', async () => {
    const store = await tableWith([BEAR], 2);
    await store.getState().playCard(0, 'h-bear');
    expect(await landsThisTurn(store)).toBe(0);
    expect('landPlays' in seat0(store)).toBe(false);
  });

  // Cards with a land on the BACK face only: Growing Rites of Itlimoc turns into one
  // later, Valakut Awakening can be played as either.
  const RITES = { iid: 'h-rites', cardId: 'c-itlimoc', name: 'Growing Rites of Itlimoc' };
  const AWAKENING = { iid: 'h-awak', cardId: 'c-awakening', name: 'Valakut Awakening' };
  async function tableWithLandBacks(hand: { iid: string; cardId: string; name: string }[]) {
    const store = await tableWith(hand, 3);
    await getDb().cards.bulkPut([
      {
        ...deckRecord('c-itlimoc', 'Growing Rites of Itlimoc', 'Legendary Enchantment // Legendary Land'),
        manaCost: '{2}{G}',
      },
      { ...deckRecord('c-awakening', 'Valakut Awakening', 'Instant // Land'), manaCost: '{2}{G}' },
    ]);
    return store;
  }

  test('casting a spell whose back face is a land pays for it and uses no land drop', async () => {
    const store = await tableWithLandBacks([RITES, FOREST]);
    await store.getState().playCard(0, 'h-rites');
    expect(onField(store, 'h-rites')?.row).toBe('front');
    expect(await landsThisTurn(store)).toBe(0);
    expect('landPlays' in seat0(store)).toBe(false);
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(3); // {2}{G} was paid
    await store.getState().playCard(0, 'h-forest'); // the real land is still this turn's drop
    expect(await landsThisTurn(store)).toBe(1);
  });

  test('an instant with a land on the back is cast: paid for, and off to the graveyard', async () => {
    const store = await tableWithLandBacks([AWAKENING]);
    await store.getState().playCard(0, 'h-awak');
    expect(seat0(store).graveyard.some((c) => c.iid === 'h-awak')).toBe(true);
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(3);
    expect(await landsThisTurn(store)).toBe(0);
    expect(feedOf(store)).toContain('A casts Valakut Awakening');
  });

  test('played as its land instead, it costs nothing and is the turn’s land drop', async () => {
    const store = await tableWithLandBacks([AWAKENING]);
    await store.getState().playCard(0, 'h-awak', { asLand: true });
    expect(onField(store, 'h-awak')?.row).toBe('lands');
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(0);
    expect(await landsThisTurn(store)).toBe(1);
    expect(feedOf(store)).toContain('A plays Valakut Awakening');
  });

  test('a land that reaches the battlefield any other way was not played', async () => {
    const store = await tableWith([FOREST], 0);
    const fromLibrary = seat0(store).library[0].iid;
    store.getState().moveVirtualCard(0, fromLibrary, 'library', 'battlefield', { row: 'lands' }); // a search
    store.getState().moveVirtualCard(0, 'h-forest', 'hand', 'graveyard'); // discarded…
    store.getState().moveVirtualCard(0, 'h-forest', 'graveyard', 'battlefield', { row: 'lands' }); // …and brought back
    expect(seat0(store).battlefield).toHaveLength(2);
    expect(await landsThisTurn(store)).toBe(0);
  });

  test('undo takes a land and its count back together', async () => {
    const store = await tableWith([FOREST], 0);
    await store.getState().playCard(0, 'h-forest');
    store.getState().undo();
    expect(seat0(store).hand.some((c) => c.iid === 'h-forest')).toBe(true);
    expect(await landsThisTurn(store)).toBe(0);
  });

  test('the land count starts over when the turn comes round again', async () => {
    const store = await tableWith([FOREST, FOREST_2], 0);
    await store.getState().playCard(0, 'h-forest');
    store.getState().passTurn(); // to player 1
    expect(await landsThisTurn(store)).toBe(0); // not seat 0's turn: nothing counts
    store.getState().passTurn(); // back to player 0, a new turn
    expect(await landsThisTurn(store)).toBe(0);
    await store.getState().playCard(0, 'h-forest2');
    expect(seat0(store).landPlays).toEqual({ turn: 2, active: 0, n: 1 });
  });

  const soldiers = (id: string) => ({
    id,
    cardId: null,
    name: 'Soldier',
    imageNormal: null,
    imageArtCrop: null,
    typeLine: 'Token Creature — Soldier',
    oracleText: '',
    basePower: 1,
    baseToughness: 1,
    count: 2,
    counters: {},
    color: null,
    zone: 'board' as const,
  });

  test('passing the turn readies the incoming seat only: what arrived there is no longer new', async () => {
    const store = await tableWith([BEAR], 2);
    const { addCard, createDeck } = await import('../lib/deck');
    const theirs = addCard(createDeck('Theirs'), deckRecord('c-bear', 'Grizzly Bears', 'Creature — Bear'));
    store.getState().seedSeatFromDeck(1, theirs, 7);
    const theirBear = store.getState().game!.players[1].cards!.hand[0].iid;
    await store.getState().playCard(0, 'h-bear');
    store.getState().moveVirtualCard(1, theirBear, 'hand', 'battlefield', { row: 'front' }); // flashed in
    store.getState().addItem(0, soldiers('tok-0'));
    store.getState().addItem(1, soldiers('tok-1'));
    const sick = () => {
      const [a, b] = store.getState().game!.players;
      return {
        mine: a.cards!.battlefield.find((c) => c.iid === 'h-bear')!.sick ?? false,
        myTokens: a.board[0].sick ?? 0,
        theirs: b.cards!.battlefield[0].sick ?? false,
        theirTokens: b.board[0].sick ?? 0,
      };
    };
    expect(sick()).toEqual({ mine: true, myTokens: 2, theirs: true, theirTokens: 2 });

    store.getState().passTurn(); // player 1's turn begins
    expect(sick()).toEqual({ mine: true, myTokens: 2, theirs: false, theirTokens: 0 });

    store.getState().passTurn(); // and now player 0's
    expect(sick()).toEqual({ mine: false, myTokens: 0, theirs: false, theirTokens: 0 });
  });

  test('the untap button readies mana, not creatures: sickness waits for the turn', async () => {
    const store = await tableWith([BEAR], 2);
    await store.getState().playCard(0, 'h-bear');
    store.getState().addItem(0, soldiers('tok-0'));
    store.getState().untapAll(0);
    expect(onField(store, 'h-bear')?.sick).toBe(true);
    expect(store.getState().game!.players[0].board[0].sick).toBe(2);
    expect(lands(store).some((c) => c.tapped)).toBe(false); // it did untap
  });

  test('a mana creature cannot help pay the turn it is played, and can from its next turn on', async () => {
    const elves = { iid: 'h-elves', cardId: 'c-elves', name: 'Llanowar Elves' };
    const store = await tableWith([elves, BEAR, { iid: 'h-cub', cardId: 'c-cub', name: 'Bear Cub' }], 2);
    await getDb().cards.bulkPut([
      {
        ...deckRecord('c-elves', 'Llanowar Elves', 'Creature — Elf Druid'),
        manaCost: '{G}',
        oracleText: '{T}: Add {G}.',
      },
    ]);
    await store.getState().playCard(0, 'h-elves'); // one Forest
    await store.getState().playCard(0, 'h-bear'); // {1}{G}: one Forest left, and the elf only just arrived
    expect(onField(store, 'h-bear')).toBeDefined(); // the card still lands (trust model)…
    expect(onField(store, 'h-elves')?.tapped).toBeUndefined(); // …but the elf paid nothing
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(1); // and no half-payment

    store.getState().passTurn();
    store.getState().passTurn(); // seat 0 again: everything untapped, the elf is ready
    await store.getState().playCard(0, 'h-cub'); // {1}{G}
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(2);
    expect(onField(store, 'h-elves')?.tapped).toBeUndefined(); // lands first; the elf was on offer, not needed
    expect(onField(store, 'h-elves')?.sick).toBeUndefined();
  });

  /** Card records for the X tests, on top of what tableWith stores. */
  async function xRecords() {
    await getDb().cards.bulkPut([
      {
        ...deckRecord('c-hydra', 'Hungering Hydra', 'Creature — Hydra'),
        manaCost: '{X}{G}',
        oracleText:
          'Hungering Hydra enters with X +1/+1 counters on it.\nHungering Hydra can’t be blocked by more than one creature.',
      },
      {
        ...deckRecord('c-blaze', 'Blaze', 'Sorcery'),
        manaCost: '{X}{G}', // green here: the table in these tests only has Forests
        oracleText: 'Blaze deals X damage to any target.',
      },
      {
        ...deckRecord('c-thing', 'Verdeloth', 'Creature — Treefolk'),
        manaCost: '{X}{G}',
        oracleText: 'When Verdeloth enters, create X 1/1 green Saproling creature tokens.',
      },
    ]);
  }
  const HYDRA = { iid: 'h-hydra', cardId: 'c-hydra', name: 'Hungering Hydra' };

  test('a card played for X pays X on top, arrives with its X counters and says so', async () => {
    const store = await tableWith([HYDRA], 5);
    await xRecords();
    await store.getState().playCard(0, 'h-hydra', { x: 3 });
    expect(onField(store, 'h-hydra')?.counters).toEqual({ p1p1: 3 });
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(4); // {X}{G} with X = 3
    expect(feedOf(store)).toContain('A plays Hungering Hydra (X=3)');
  });

  test('an X spell is paid the same way and says its X too', async () => {
    const store = await tableWith([{ iid: 'h-blaze', cardId: 'c-blaze', name: 'Blaze' }], 5);
    await xRecords();
    await store.getState().playCard(0, 'h-blaze', { x: 2 });
    expect(seat0(store).graveyard.some((c) => c.iid === 'h-blaze')).toBe(true);
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(3);
    expect(feedOf(store)).toContain('A casts Blaze (X=2)');
  });

  test('a card with X played without a value is cast for zero', async () => {
    const store = await tableWith([HYDRA], 5);
    await xRecords();
    await store.getState().playCard(0, 'h-hydra');
    expect(onField(store, 'h-hydra')).toBeDefined();
    expect('counters' in onField(store, 'h-hydra')!).toBe(false);
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(1); // just the {G}
    expect(feedOf(store)).toContain('A plays Hungering Hydra (X=0)');
  });

  test('a card without X pays its own cost whatever is passed, and its line says nothing about X', async () => {
    const store = await tableWith([BEAR], 5);
    await store.getState().playCard(0, 'h-bear', { x: 3 });
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(2); // {1}{G}
    expect('counters' in onField(store, 'h-bear')!).toBe(false);
    expect(feedOf(store)).toContain('A plays Grizzly Bears');
  });

  test('only a card that enters with X counters gets them: nothing else about X is automated', async () => {
    const store = await tableWith([{ iid: 'h-thing', cardId: 'c-thing', name: 'Verdeloth' }], 5);
    await xRecords();
    await store.getState().playCard(0, 'h-thing', { x: 2 });
    expect('counters' in onField(store, 'h-thing')!).toBe(false);
    expect(store.getState().game!.players[0].board).toHaveLength(0); // no tokens made either
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(3);
  });

  test('an X the seat cannot pay still resolves as asked, tapping nothing (cast anyway)', async () => {
    const store = await tableWith([HYDRA], 3);
    await xRecords();
    await store.getState().playCard(0, 'h-hydra', { x: 9 });
    expect(onField(store, 'h-hydra')?.counters).toEqual({ p1p1: 9 });
    expect(lands(store).some((c) => c.tapped)).toBe(false); // no half-payments
    expect(feedOf(store)).toContain('A plays Hungering Hydra (X=9)');
  });

  test('a nonsense X is read as a whole number, never below zero', async () => {
    const store = await tableWith([HYDRA, { ...HYDRA, iid: 'h-hydra2' }], 6);
    await xRecords();
    await store.getState().playCard(0, 'h-hydra', { x: 2.9 });
    expect(onField(store, 'h-hydra')?.counters).toEqual({ p1p1: 2 });
    await store.getState().playCard(0, 'h-hydra2', { x: -4 });
    expect('counters' in onField(store, 'h-hydra2')!).toBe(false);
    expect(feedOf(store)).toContain('A plays Hungering Hydra (X=0)');
  });

  /** Seat 0's commander costs {X}{G} and enters with X counters; `forests` lands, `returns` trips home. */
  async function xCommander(forests: number, returns = 0) {
    const store = await cardsStore();
    await getDb().cards.bulkPut([
      {
        ...deckRecord('c-cmd', 'Ashaya', 'Legendary Creature — Elemental'),
        manaCost: '{X}{G}',
        oracleText: 'Ashaya enters with X +1/+1 counters on it.',
      },
      { ...deckRecord('c-forest', 'Forest', 'Basic Land — Forest'), oracleText: '({T}: Add {G}.)' },
    ]);
    const g = store.getState().game!;
    const seat = g.players[0].cards!;
    store.setState({
      game: {
        ...g,
        players: g.players.map((p, i) =>
          i === 0
            ? {
                ...p,
                cards: {
                  ...seat,
                  cmd: { [seat.command[0].iid]: returns },
                  battlefield: Array.from({ length: forests }, (_, k) => ({
                    iid: `f${k + 1}`,
                    cardId: 'c-forest',
                    name: 'Forest',
                    row: 'lands' as const,
                  })),
                },
              }
            : p,
        ),
      },
    });
    return store;
  }
  const commanderOnField = (store: ReturnType<typeof createAppStore>) =>
    seat0(store).battlefield.find((c) => c.name === 'Ashaya');

  test('a commander cast for X pays X, arrives with its counters and says so', async () => {
    const store = await xCommander(6);
    store.getState().castCommander(0, undefined, { x: 3 });
    await vi.waitFor(() => expect(commanderOnField(store)).toBeDefined());
    expect(commanderOnField(store)?.counters).toEqual({ p1p1: 3 });
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(4);
    expect(feedOf(store)).toContain('A casts Ashaya (X=3)');
  });

  test('commander tax rides on top of X, and the line names both', async () => {
    const store = await xCommander(6, 1); // it has gone home once: +2
    const iid = seat0(store).command[0].iid;
    store.getState().castCommander(0, iid, { x: 3 });
    await vi.waitFor(() => expect(commanderOnField(store)).toBeDefined());
    expect(lands(store).filter((c) => c.tapped)).toHaveLength(6); // {G} + 3 + 2
    expect(feedOf(store)).toContain('A casts Ashaya (tax +2) (X=3)');
  });

  test('a land replayed onto a table that moved is still counted with its card, and is off entirely once the card is gone', async () => {
    const store = await tableWith([FOREST], 0);
    const before = store.getState().game!;
    (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mockClear();
    await store.getState().playCard(0, 'h-forest');
    const { op, guard, orig } = lastSynced();
    const { landsPlayed } = await import('../lib/cards');

    // A life total changed meanwhile: the land and its count arrive together.
    const moved = { ...before, players: before.players.map((p, i) => (i === 1 ? { ...p, life: 31 } : p)) };
    expect(guard(moved, orig)).toBe(true);
    const replayed = op(moved);
    expect(replayed.players[0].cards!.battlefield.some((c) => c.iid === 'h-forest')).toBe(true);
    expect(landsPlayed(replayed, 0)).toBe(1);
    expect(replayed.players[1].life).toBe(31);

    // Another land of this turn already landed there: this one counts on top.
    const { countLandPlay } = await import('../lib/cards');
    expect(landsPlayed(op(countLandPlay(moved, 0)), 0)).toBe(2);

    // The card was discarded on another device first: nothing moves, nothing is counted.
    const { moveCard } = await import('../lib/cards');
    const gone = moveCard(before, 0, 'h-forest', 'hand', 'graveyard');
    expect(guard(gone, orig)).toBe(false);
    expect(op(gone)).toBe(gone);
  });

  test('a land replayed into a later turn arrives without using up that turn’s land', async () => {
    const store = await tableWith([FOREST], 0);
    const before = store.getState().game!;
    (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mockClear();
    await store.getState().playCard(0, 'h-forest');
    const { op } = lastSynced();
    const { landsPlayed } = await import('../lib/cards');
    // The table went all the way round before this play arrived.
    const nextTurn = op({ ...before, turnNumber: before.turnNumber + 1 });
    expect(nextTurn.players[0].cards!.battlefield.some((c) => c.iid === 'h-forest')).toBe(true);
    expect(landsPlayed(nextTurn, 0)).toBe(0);
    expect('landPlays' in nextTurn.players[0].cards!).toBe(false);
  });

  test('an X cast replayed into a later turn still arrives with its counters, but taps nothing there', async () => {
    const store = await tableWith([HYDRA], 5);
    await xRecords();
    const before = store.getState().game!;
    (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mockClear();
    await store.getState().playCard(0, 'h-hydra', { x: 3 });
    const { op, guard, orig } = lastSynced();
    expect(guard(orig, orig)).toBe(true);

    const sameTurn = op({ ...before, players: before.players.map((p, i) => (i === 1 ? { ...p, life: 31 } : p)) });
    const hydra = (g: GameState) => g.players[0].cards!.battlefield.find((c) => c.iid === 'h-hydra')!;
    expect(hydra(sameTurn).counters).toEqual({ p1p1: 3 });
    expect(sameTurn.players[0].cards!.battlefield.filter((c) => c.tapped)).toHaveLength(4);

    const later = op({ ...before, turnNumber: before.turnNumber + 2 });
    expect(hydra(later).counters).toEqual({ p1p1: 3 }); // X belongs to the cast, not to the turn
    expect(later.players[0].cards!.battlefield.some((c) => c.tapped)).toBe(false);
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

  /** The op and the replay guard the last action handed to the sync module. */
  const lastSynced = () => {
    const [op, orig, opts] = (tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mock.lastCall!;
    return {
      op: op as (g: GameState) => GameState,
      orig: orig as GameState,
      guard: (opts as { guard: (b: GameState, o: GameState) => boolean }).guard,
    };
  };
  /** Another device at the same table, holding the state `g`. */
  const deviceAt = (g: GameState) => {
    const other = createAppStore();
    other.setState({ game: g });
    return other;
  };
  const libraryOf = (g: GameState) => g.players[0].cards!.library.map((c) => c.iid);
  /** `g` with only these cards in seat 0's library, top first. */
  const withLibrary = (g: GameState, iids: string[]): GameState => ({
    ...g,
    players: g.players.map((p, i) => {
      if (i !== 0) return p;
      const library = iids.map((iid) => p.cards!.library.find((c) => c.iid === iid)!);
      return { ...p, cards: { ...p.cards!, library } };
    }),
  });

  test('a draw or mill made before a scry was heard of is skipped, and the scried card stays put', async () => {
    for (const take of ['drawCards', 'millCards'] as const) {
      const store = await cardsStore(); // this device still shows x on top
      const unheard = store.getState().game!;
      const [x] = libraryOf(unheard);
      const scryer = deviceAt(unheard);
      scryer.getState().arrangeTop(0, [x], { top: [], bottom: [x], graveyard: [], hand: [] });
      const table = scryer.getState().game!; // what the table holds once the scry lands
      expect(libraryOf(table).at(-1)).toBe(x);

      store.getState()[take](0, 1); // a tap on the pile, aimed at x
      const { guard, orig } = lastSynced();
      expect(guard(orig, orig)).toBe(true); // nothing arranged since: it stands
      expect(guard(table, orig)).toBe(false); // the scry got there first: x is not dug back out
    }
  });

  test('after a scry, a draw of cards that are still on top stands, whatever order they are in', async () => {
    const store = await cardsStore();
    const unheard = store.getState().game!;
    const [x, y] = libraryOf(unheard);
    const scryer = deviceAt(unheard);
    scryer.getState().arrangeTop(0, [x, y], { top: [y, x], bottom: [], graveyard: [], hand: [] }); // swapped
    const table = scryer.getState().game!;

    store.getState().drawCards(0, 2); // x and y: the same two cards either way
    const both = lastSynced();
    expect(both.guard(table, both.orig)).toBe(true);

    deviceAt(unheard).getState().drawCards(0, 1); // x alone, which now sits under y
    const one = lastSynced();
    expect(one.guard(table, one.orig)).toBe(false);
  });

  test('every scry marks the library anew: a draw made between two of them is skipped by the second', async () => {
    const store = await cardsStore();
    const [x, y] = libraryOf(store.getState().game!);
    store.getState().arrangeTop(0, [x, y], { top: [y, x], bottom: [], graveyard: [], hand: [] }); // heard of here
    const scryer = deviceAt(store.getState().game!);
    scryer.getState().arrangeTop(0, [y], { top: [], bottom: [y], graveyard: [], hand: [] }); // not yet
    const table = scryer.getState().game!;

    store.getState().drawCards(0, 1); // y, which the second scry sent away
    const { guard, orig } = lastSynced();
    expect(guard(orig, orig)).toBe(true);
    expect(guard(table, orig)).toBe(false);
  });

  test('a draw that raced a shuffle still keeps the card it drew, on a scried library too', async () => {
    const store = await cardsStore();
    const [x, y, z] = libraryOf(store.getState().game!);
    store.getState().drawCards(0, 1); // x, off a library nobody has arranged
    const plain = lastSynced();
    expect(plain.guard(withLibrary(plain.orig, [z, y, x]), plain.orig)).toBe(true); // "drew first" stands

    store.getState().arrangeTop(0, [y], { top: [y], bottom: [], graveyard: [], hand: [] }); // a scry heard of here
    store.getState().drawCards(0, 1); // y
    const scried = lastSynced();
    expect(scried.guard(withLibrary(scried.orig, [z, y]), scried.orig)).toBe(true); // a shuffle is not a scry
    expect(scried.guard(withLibrary(scried.orig, [z]), scried.orig)).toBe(false); // y itself is gone: off
  });

  test('a scry replayed onto a moved table leaves the same mark, so the draw made after it replays too', async () => {
    const store = await cardsStore();
    const before = store.getState().game!;
    const [x, y] = libraryOf(before);
    store.getState().arrangeTop(0, [x, y], { top: [y], bottom: [x], graveyard: [], hand: [] });
    const scry = lastSynced();
    const mark = store.getState().game!.players[0].cards!.stacked;
    expect(mark).toBeTruthy();
    store.getState().drawCards(0, 1); // y, off the top it just arranged
    const drew = lastSynced();

    // A life total changed meanwhile: a rebase replays both onto that table, in order.
    const moved = { ...before, players: before.players.map((p, i) => (i === 1 ? { ...p, life: 31 } : p)) };
    expect(scry.guard(moved, scry.orig)).toBe(true);
    const replayed = scry.op(moved);
    expect(replayed.players[0].cards!.stacked).toBe(mark);
    expect(drew.guard(replayed, drew.orig)).toBe(true);
    expect(drew.op(replayed).players[0].cards!.hand.at(-1)!.iid).toBe(y);
  });

  test('a draw that follows a scry made here still stands when a shuffle elsewhere calls that scry off', async () => {
    const store = await cardsStore();
    const before = store.getState().game!;
    const [x, y, z] = libraryOf(before);
    store.getState().arrangeTop(0, [x], { top: [x], bottom: [], graveyard: [], hand: [] }); // this one lands
    const landed = store.getState().game!;
    store.getState().arrangeTop(0, [x], { top: [], bottom: [x], graveyard: [], hand: [] }); // this one will not
    const scry = lastSynced();
    store.getState().drawCards(0, 1); // y, the new top
    const drew = lastSynced();

    const shuffled = withLibrary(landed, [z, y, x]); // another device shuffled first
    expect(scry.guard(shuffled, scry.orig)).toBe(false); // x is not on top any more: the scry is off
    expect(drew.guard(shuffled, drew.orig)).toBe(true); // nobody else arranged anything: y was drawn first
    expect(drew.guard(withLibrary(before, [z, y, x]), drew.orig)).toBe(true); // the same had neither scry landed
  });

  test('a draw that follows a scry made here is still skipped when someone else’s scry got there first', async () => {
    const store = await cardsStore();
    const before = store.getState().game!;
    const [x, y] = libraryOf(before);
    const scryer = deviceAt(before);
    scryer.getState().arrangeTop(0, [x, y], { top: [], bottom: [x, y], graveyard: [], hand: [] }); // unheard of here
    const table = scryer.getState().game!;

    store.getState().arrangeTop(0, [x], { top: [], bottom: [x], graveyard: [], hand: [] });
    const scry = lastSynced();
    store.getState().drawCards(0, 1); // y, which the other scry sent to the bottom
    const drew = lastSynced();
    expect(scry.guard(table, scry.orig)).toBe(false);
    expect(drew.guard(table, drew.orig)).toBe(false);
  });

  test('exiling from the top moves exactly those cards and is announced by count', async () => {
    const store = await cardsStore();
    const [x, y, z] = libraryOf(store.getState().game!);
    store.getState().exileCards(0, 2);
    const seat = store.getState().game!.players[0].cards!;
    expect(seat.exile.map((c) => c.iid)).toEqual([x, y]);
    expect(seat.library[0].iid).toBe(z);
    expect(seat.graveyard).toEqual([]);
    expect(store.getState().game!.feed!.map((e) => e.text)).toContain('A exiles the top 2');
  });

  test('asking to exile more than the library holds exiles what is there', async () => {
    const store = await cardsStore();
    const held = libraryOf(store.getState().game!); // ten cards, seven in hand: three left
    expect(held).toHaveLength(3);
    store.getState().exileCards(0, 9);
    const seat = store.getState().game!.players[0].cards!;
    expect(seat.exile.map((c) => c.iid)).toEqual(held);
    expect(seat.library).toEqual([]);
    expect(store.getState().game!.feed!.map((e) => e.text)).toContain('A exiles the top 3');
    const emptied = store.getState().game;
    store.getState().exileCards(0, 1); // nothing left: nothing happens, nothing is announced
    expect(store.getState().game).toBe(emptied);
  });

  test('an exile from the top made before a scry was heard of is skipped, like a mill', async () => {
    const store = await cardsStore(); // this device still shows x on top
    const unheard = store.getState().game!;
    const [x] = libraryOf(unheard);
    const scryer = deviceAt(unheard);
    scryer.getState().arrangeTop(0, [x], { top: [], bottom: [x], graveyard: [], hand: [] });
    const table = scryer.getState().game!;

    store.getState().exileCards(0, 1); // aimed at x
    const { guard, orig } = lastSynced();
    expect(guard(orig, orig)).toBe(true); // nothing arranged since: it stands
    expect(guard(table, orig)).toBe(false); // the scry got there first: x is not dug back out
  });

  test('an exile that raced a shuffle still takes the card it was aimed at', async () => {
    const store = await cardsStore();
    const [x, y, z] = libraryOf(store.getState().game!);
    store.getState().exileCards(0, 1); // x, off a library nobody has arranged
    const { guard, orig, op } = lastSynced();
    const shuffledFirst = withLibrary(orig, [z, y, x]);
    expect(guard(shuffledFirst, orig)).toBe(true); // "exiled first" stands
    expect(op(shuffledFirst).players[0].cards!.exile.map((c) => c.iid)).toEqual([x]);
    expect(guard(withLibrary(orig, [z, y]), orig)).toBe(false); // x itself is gone: off
  });

  test('a look that exiles says how many were exiled, never which', async () => {
    const store = await cardsStore();
    const [a, b, c] = libraryOf(store.getState().game!);
    store
      .getState()
      .arrangeTop(0, [a, b, c], { top: [a], bottom: [], graveyard: [], hand: [], exile: [c, b] });
    const seat = store.getState().game!.players[0].cards!;
    expect(seat.exile.map((x) => x.iid)).toEqual([c, b]);
    expect(seat.library[0].iid).toBe(a);
    const feed = store.getState().game!.feed!.map((e) => e.text);
    expect(feed).toContain('A puts 1 back on top, 2 exiled');
    expect(feed.join(' ')).not.toMatch(/Forest|Ashaya/); // still no card names
  });

  test('a look that sends its only card to exile is still a move the table hears about', async () => {
    const store = await cardsStore();
    const [a] = libraryOf(store.getState().game!);
    store.getState().arrangeTop(0, [a], { top: [], bottom: [], graveyard: [], hand: [], exile: [a] });
    expect(store.getState().game!.players[0].cards!.exile.map((x) => x.iid)).toEqual([a]);
    expect(store.getState().game!.feed!.map((e) => e.text)).toContain('A puts 1 exiled');
  });

  /** Seat 0 holding a Lightning Bolt, with Sol Ring then Llanowar Elves on top of its library. */
  async function knownCards() {
    const store = await cardsStore();
    const g = store.getState().game!;
    store.setState({
      game: {
        ...g,
        players: g.players.map((p, i) =>
          i === 0
            ? {
                ...p,
                cards: {
                  ...p.cards!,
                  hand: [{ iid: 'h-bolt', cardId: 'c-bolt', name: 'Lightning Bolt' }, ...p.cards!.hand],
                  library: [
                    { iid: 'l-sol', cardId: 'c-sol', name: 'Sol Ring' },
                    { iid: 'l-elf', cardId: 'c-elf', name: 'Llanowar Elves' },
                    ...p.cards!.library,
                  ],
                },
              }
            : p,
        ),
      },
    });
    return store;
  }

  test('a reveal names the card to the whole table and leaves it where it is', async () => {
    const store = await knownCards();
    const before = store.getState().game!.players[0].cards!;
    store.getState().revealCards(0, ['h-bolt'], 'hand');
    const g = store.getState().game!;
    expect(g.reveal).toMatchObject({
      seat: 0,
      from: 'hand',
      cards: [{ cardId: 'c-bolt', name: 'Lightning Bolt' }],
    });
    expect(g.reveal!.id).toMatch(/\S/);
    expect(Math.abs(Date.now() - g.reveal!.t)).toBeLessThan(5000); // stamped when it was made
    expect(g.players[0].cards).toBe(before); // nothing moved
    // Unlike a look, a reveal is public: the line names the card.
    expect(g.feed!.map((e) => e.text)).toContain('A reveals Lightning Bolt from their hand');
    expect(store.getState().log.map((l) => l.text)).toContain('A reveals Lightning Bolt from their hand');
  });

  test('a second reveal replaces the first on the table, and the feed keeps both', async () => {
    const store = await knownCards();
    store.getState().revealCards(0, ['h-bolt'], 'hand');
    const first = store.getState().game!.reveal!;
    store.getState().revealCards(0, ['l-sol', 'l-elf'], 'library');
    const g = store.getState().game!;
    expect(g.reveal!.id).not.toBe(first.id);
    expect(g.reveal).toMatchObject({
      seat: 0,
      from: 'library',
      cards: [
        { cardId: 'c-sol', name: 'Sol Ring' },
        { cardId: 'c-elf', name: 'Llanowar Elves' },
      ],
    });
    const feed = g.feed!.map((e) => e.text);
    expect(feed).toContain('A reveals Lightning Bolt from their hand');
    expect(feed).toContain('A reveals Sol Ring, Llanowar Elves from the top of their library');
    expect(libraryOf(g).slice(0, 2)).toEqual(['l-sol', 'l-elf']); // revealed, not moved
  });

  test('only cards that are really there can be revealed', async () => {
    const store = await knownCards();
    const before = store.getState().game;
    store.getState().revealCards(0, ['nope'], 'hand');
    store.getState().revealCards(0, ['h-bolt'], 'library'); // it is in the hand, not the library
    store.getState().revealCards(0, ['h-bolt', 'nope'], 'hand'); // one of the two is not there
    store.getState().revealCards(0, [], 'hand');
    store.getState().revealCards(1, ['h-bolt'], 'hand'); // a seat without cards
    expect(store.getState().game).toBe(before);
  });

  test('a build behind the table cannot reveal: the reveal could not announce itself', async () => {
    const store = await knownCards();
    store.setState({ online: { code: 'KQ7M2X', status: { kind: 'stale-build' }, mySeat: 0 } });
    const before = store.getState().game;
    store.getState().revealCards(0, ['h-bolt'], 'hand');
    expect(store.getState().game).toBe(before);
  });

  test('undoing a reveal takes it back off the table', async () => {
    const store = await knownCards();
    store.getState().revealCards(0, ['h-bolt'], 'hand');
    expect(store.getState().game!.reveal).toBeDefined();
    store.getState().undo();
    expect(store.getState().game!.reveal).toBeUndefined();
  });

  test('a reveal from the hand is replayed only while the card is still in that hand', async () => {
    const { moveCard } = await import('../lib/cards');
    const store = await knownCards();
    store.getState().revealCards(0, ['h-bolt'], 'hand');
    const id = store.getState().game!.reveal!.id;
    const { guard, orig, op } = lastSynced();
    expect(guard(orig, orig)).toBe(true);
    // A life total changed meanwhile: the reveal still makes sense, and it is the SAME reveal.
    const moved = { ...orig, players: orig.players.map((p, i) => (i === 1 ? { ...p, life: 31 } : p)) };
    expect(guard(moved, orig)).toBe(true);
    expect(op(moved).reveal!.id).toBe(id); // minted when it was made: no device shows it twice
    // The card was discarded from another device first: there is nothing in hand to show.
    const discarded = moveCard(orig, 0, 'h-bolt', 'hand', 'graveyard');
    expect(guard(discarded, orig)).toBe(false);
    expect(op(discarded)).toBe(discarded); // the op itself declines too
  });

  test('a reveal from the top of the library is replayed only while those cards are still its top', async () => {
    const store = await knownCards();
    const rest = libraryOf(store.getState().game!).slice(2);
    store.getState().revealCards(0, ['l-sol', 'l-elf'], 'library');
    const { guard, orig, op } = lastSynced();
    expect(guard(orig, orig)).toBe(true);
    expect(guard(withLibrary(orig, ['l-elf', 'l-sol', ...rest]), orig)).toBe(true); // the top two, in any order
    const buried = withLibrary(orig, [rest[0], 'l-sol', 'l-elf', ...rest.slice(1)]);
    expect(guard(buried, orig)).toBe(false); // a shuffle got there first: "the top" would be a lie
    expect(op(buried)).toBe(buried);
    expect(guard(withLibrary(orig, ['l-elf', ...rest]), orig)).toBe(false); // one of them was drawn meanwhile
  });

  test('a reveal that could not reach the table for two minutes is dropped: by then it is not news', async () => {
    const { REVEAL_FRESH_MS } = await import('../lib/cards');
    const lastMaxAge = () =>
      ((tableSync.onLocalMutation as ReturnType<typeof vi.fn>).mock.lastCall![2] as { maxAgeMs: number })
        .maxAgeMs;
    const store = await knownCards();
    store.getState().revealCards(0, ['h-bolt'], 'hand');
    // No device would show it after that long, and replayed late it would
    // only push a newer reveal off the table.
    expect(lastMaxAge()).toBe(REVEAL_FRESH_MS);
    expect(REVEAL_FRESH_MS).toBe(2 * 60_000);
    store.getState().exileCards(0, 1); // cards that MOVED keep the long life of a draw or a mill
    expect(lastMaxAge()).toBe(24 * 3600_000);
  });

  test('one card revealed from deeper in a look is held to the block it was seen in', async () => {
    const store = await knownCards();
    const rest = libraryOf(store.getState().game!).slice(2);
    store.getState().revealCards(0, ['l-elf'], 'library'); // the second card down
    expect(store.getState().game!.reveal!.cards).toEqual([{ cardId: 'c-elf', name: 'Llanowar Elves' }]);
    const { guard, orig } = lastSynced();
    expect(guard(orig, orig)).toBe(true);
    expect(guard(withLibrary(orig, ['l-elf', 'l-sol', ...rest]), orig)).toBe(true); // still within the top two
    const sunk = withLibrary(orig, ['l-sol', rest[0], 'l-elf', ...rest.slice(1)]);
    expect(guard(sunk, orig)).toBe(false); // it sits below what was looked at now
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

  test('a removal keeps its count on the tombstone, and restore revives it whole', async () => {
    const store = createAppStore();
    await store.getState().init();
    await store.getState().addToGarage(bolt, 3);
    await store.getState().setGarageCount('c-bolt', 0);
    const row = await getDb().garage.get('c-bolt');
    expect(row?.deleted).toBe(true);
    expect(row?.count).toBe(3); // what was lost stays remembered

    const removed = await store.getState().removedGarage();
    expect(removed[0]).toMatchObject({ cardId: 'c-bolt', name: 'Lightning Bolt', count: 3 });

    await store.getState().restoreGarage('c-bolt');
    expect(store.getState().garage[0]).toMatchObject({ name: 'Lightning Bolt', count: 3 });
    expect(await store.getState().removedGarage()).toHaveLength(0);
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
