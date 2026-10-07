import { describe, expect, test } from 'vitest';
import { readyItems } from './board';
import { landsPlayed, readyCards } from './cards';
import { isSummoningSick, sickCopies } from './keywords';
import { sourcesFrom } from './pay';
import { canPlayLand } from './turnRules';
import type { BoardItem, CardRecord, GameState, SeatCards } from './types';
import { isValidGame, migrateGame } from './migrate';

/** A pre-cards-mode save, exactly as a 2026-10-05 build persisted it. */
const TRACKER_SAVE = {
  config: {
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    profiles: [
      { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
    ],
  },
  players: [
    {
      profileId: 'p0',
      life: 34,
      commanderDamage: {},
      eliminated: false,
      board: [],
      counters: {},
      commanderDeaths: 1,
    },
    {
      profileId: 'p1',
      life: 40,
      commanderDamage: {},
      eliminated: false,
      board: [],
      counters: {},
      commanderDeaths: 0,
    },
  ],
  activePlayerIndex: 0,
  turnNumber: 5,
  monarchIdx: null,
  initiativeIdx: null,
  turnStartedAt: 123,
} as unknown as GameState;

describe('reveals', () => {
  const GOOD = {
    id: 'r1',
    seat: 1,
    from: 'library',
    cards: [
      { cardId: 'c1', name: 'Forest' },
      { cardId: 'c2', name: 'Sol Ring' },
    ],
    t: 1_700_000_000_000,
  };
  const withReveal = (reveal: unknown) =>
    ({ ...structuredClone(TRACKER_SAVE), reveal }) as unknown as GameState;

  test('a save from before reveals existed loads untouched: no reveal appears', () => {
    const save = structuredClone(TRACKER_SAVE);
    expect(isValidGame(save)).toBe(true);
    const g = migrateGame(save);
    expect('reveal' in g).toBe(false); // omitted, never written as undefined or null
    expect(g.players[0].life).toBe(34);
    expect(g.turnNumber).toBe(5);
  });

  test('a well-formed reveal survives validation and migration', () => {
    const save = withReveal(GOOD);
    expect(isValidGame(save)).toBe(true);
    expect(migrateGame(save).reveal).toEqual(GOOD); // every remote state passes here
  });

  test('a malformed reveal is dropped, and the game around it still loads', () => {
    const broken: unknown[] = [
      null,
      'nope',
      7,
      [],
      {},
      { ...GOOD, id: 12 },
      { ...GOOD, seat: '1' },
      { ...GOOD, seat: -1 },
      { ...GOOD, seat: 2 }, // nobody sits there
      { ...GOOD, seat: 0.5 },
      { ...GOOD, from: 'graveyard' },
      { ...GOOD, t: 'yesterday' },
      { ...GOOD, cards: 'Forest' },
      { ...GOOD, cards: [] }, // a reveal of nothing
      { ...GOOD, cards: [null] },
      { ...GOOD, cards: [{ cardId: 'c1' }] },
      { ...GOOD, cards: [{ cardId: 1, name: 'Forest' }] },
    ];
    for (const reveal of broken) {
      const save = withReveal(reveal);
      // Nothing checked the field before the feature, so such a save was accepted: it still is.
      expect(isValidGame(save)).toBe(true);
      const g = migrateGame(save);
      expect('reveal' in g).toBe(false);
      expect(g.players[0].life).toBe(34); // never fatal: only the reveal is lost
      expect(g.players).toHaveLength(2);
    }
  });
});

describe('cards-mode migration', () => {
  test('an old tracker save loads unchanged: tracker mode, no cards, no feed', () => {
    const g = migrateGame(structuredClone(TRACKER_SAVE));
    expect(g.config.mode).toBe('tracker');
    expect(g.players[0].cards).toBeUndefined();
    expect(g.feed).toBeUndefined();
    expect(g.players[0].life).toBe(34);
  });

  test('a partial cards seat is healed with empty zones', () => {
    const save = structuredClone(TRACKER_SAVE);
    save.players[0].cards = { library: [{ iid: 'a', cardId: 'c', name: 'X' }] } as never;
    const g = migrateGame(save);
    expect(g.players[0].cards?.library).toHaveLength(1);
    expect(g.players[0].cards?.hand).toEqual([]);
    expect(g.players[0].cards?.command).toEqual([]);
    expect(g.players[0].cards?.mulligans).toBe(0);
  });

  test('isValidGame rejects corrupt card zones and feed entries', () => {
    const badZone = structuredClone(TRACKER_SAVE);
    badZone.players[0].cards = { library: [{ iid: 1 }] } as never;
    expect(isValidGame(badZone)).toBe(false);

    const badFeed = structuredClone(TRACKER_SAVE);
    badFeed.feed = [{ id: 'x' }] as never;
    expect(isValidGame(badFeed)).toBe(false);

    const good = structuredClone(TRACKER_SAVE);
    good.players[0].cards = {
      library: [{ iid: 'i1', cardId: 'c1', name: 'Forest' }],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
      mulligans: 0,
      deckName: 'Stompy',
    };
    good.feed = [{ id: 'f1', t: 1, text: 'A draws 1' }];
    expect(isValidGame(good)).toBe(true);
  });

  test('a scried library keeps its mark through validation and migration', () => {
    const save = structuredClone(TRACKER_SAVE);
    save.players[0].cards = {
      library: [{ iid: 'i1', cardId: 'c1', name: 'Forest' }],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
      mulligans: 0,
      deckName: 'Stompy',
      stacked: 'look-1',
    };
    expect(isValidGame(save)).toBe(true);
    expect(migrateGame(save).players[0].cards?.stacked).toBe('look-1'); // every remote state passes here
  });
});

describe('turn-rules migration', () => {
  /** A cards seat and a token stack exactly as a build before turn rules wrote them. */
  const OLD_SEAT: SeatCards = {
    library: [{ iid: 'l1', cardId: 'c-forest', name: 'Forest' }],
    hand: [{ iid: 'h1', cardId: 'c-forest', name: 'Forest' }],
    battlefield: [
      { iid: 'b1', cardId: 'c-elves', name: 'Llanowar Elves', row: 'front' },
      { iid: 'b2', cardId: 'c-forest', name: 'Forest', row: 'lands', tapped: true, spent: 1 },
    ],
    graveyard: [],
    exile: [],
    command: [],
    mulligans: 0,
    deckName: 'Stompy',
    kept: true,
  };
  const OLD_STACK: BoardItem = {
    id: 'tok-1',
    cardId: null,
    name: 'Elf Warrior',
    imageNormal: null,
    imageArtCrop: null,
    typeLine: 'Token Creature — Elf Warrior',
    oracleText: '{T}: Add {G}.',
    basePower: 1,
    baseToughness: 1,
    count: 3,
    counters: {},
    color: null,
    zone: 'board',
    tapped: 1,
  };
  const record = (id: string, typeLine: string, oracleText: string): CardRecord => ({
    id,
    name: id,
    nameLower: id,
    typeLine,
    oracleText,
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  });
  const RECORDS = {
    'c-elves': record('c-elves', 'Creature — Elf Druid', '{T}: Add {G}.'),
    'c-forest': record('c-forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  };
  function oldSave(): GameState {
    const save = structuredClone(TRACKER_SAVE);
    save.players[0].cards = structuredClone(OLD_SEAT);
    save.players[0].board = [structuredClone(OLD_STACK)];
    return save;
  }

  test('a seat saved before turn rules loads as it was: nothing is written into it', () => {
    const save = oldSave();
    expect(isValidGame(save)).toBe(true);
    const g = migrateGame(save);
    const seat = g.players[0].cards!;
    expect('landPlays' in seat).toBe(false);
    expect(seat.battlefield.some((c) => 'sick' in c)).toBe(false);
    expect('sick' in g.players[0].board[0]).toBe(false);
    expect(seat).toEqual(OLD_SEAT);
    expect(g.players[0].board[0]).toEqual(OLD_STACK);
  });

  test('the turn rules read such a seat as one where nothing just arrived and no land was played', () => {
    const g = migrateGame(oldSave());
    const player = g.players[0];
    const seat = player.cards!;
    expect(landsPlayed(g, 0)).toBe(0);
    expect(canPlayLand(g, 0, [])).toEqual({ ok: true }); // seat 0's turn in this save
    expect(readyCards(g, 0)).toBe(g);
    expect(readyItems(g, 0)).toBe(g);
    expect(seat.battlefield.some((c) => isSummoningSick(c, RECORDS[c.cardId as keyof typeof RECORDS], []))).toBe(false);
    expect(sickCopies(player.board[0], [])).toBe(0);
    // the elf that was already there pays, and so do the two untapped tokens
    expect(sourcesFrom(seat.battlefield, RECORDS, player.board).map((s) => s.key)).toEqual([
      'b1',
      'tok-1',
      'tok-1',
    ]);
  });

  test('sick flags and a land stamp from a current build pass validation and migration untouched', () => {
    const save = oldSave();
    const seat = save.players[0].cards!;
    seat.battlefield[0] = { ...seat.battlefield[0], sick: true };
    seat.landPlays = { turn: 5, active: 0, n: 1 };
    save.players[0].board[0] = { ...save.players[0].board[0], sick: 2 };
    expect(isValidGame(save)).toBe(true);
    const g = migrateGame(save); // every remote state passes here
    expect(g.players[0].cards!.battlefield[0].sick).toBe(true);
    expect(g.players[0].cards!.landPlays).toEqual({ turn: 5, active: 0, n: 1 });
    expect(g.players[0].board[0].sick).toBe(2);
    expect(landsPlayed(g, 0)).toBe(1);
  });
});
