import { describe, expect, test } from 'vitest';
import type { GameState } from './types';
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
