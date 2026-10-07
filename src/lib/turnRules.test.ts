import { describe, expect, test } from 'vitest';
import { buildSeatCards, countLandPlay, seedSeat } from './cards';
import { addCard, changeCardCount, createDeck } from './deck';
import { createGame } from './game';
import { canPlayLand, hasLandBack, isLandCard, landAllowance } from './turnRules';
import type { CardRecord, GameConfig, GameState } from './types';

// Rules text as Scryfall prints it.
const EXPLORATION = 'You may play an additional land on each of your turns.';
const ORACLE_OF_MUL_DAYA =
  'You may play an additional land on each of your turns.\nPlay with the top card of your library revealed.\nYou may play lands from the top of your library.';
const DRYAD =
  'You may play an additional land on each of your turns.\nLands you control are every basic land type in addition to their other types.';
const AZUSA = 'You may play two additional lands on each of your turns.';
const RITES_OF_FLOURISHING =
  "At the beginning of each player's draw step, that player draws an additional card.\nEach player may play an additional land on each of their turns.";
const STORM_CAULDRON =
  "Each player may play an additional land during each of their turns.\nWhenever a land is tapped for mana, return it to its owner's hand.";
const FASTBOND =
  "You may play any number of lands on each of your turns.\nWhenever you play a land, if it wasn't the first land you played this turn, Fastbond deals 1 damage to you.";

describe('landAllowance', () => {
  test('one land a turn, whatever else the seat controls', () => {
    expect(landAllowance([])).toBe(1);
    expect(landAllowance(['Flying, vigilance', '({T}: Add {G}.)', '{T}: Add {C}{C}.'])).toBe(1);
  });

  test('an additional land is one more', () => {
    expect(landAllowance([EXPLORATION])).toBe(2);
    expect(landAllowance([ORACLE_OF_MUL_DAYA])).toBe(2);
    expect(landAllowance([DRYAD])).toBe(2);
  });

  test('number words: an, one, two, three', () => {
    expect(landAllowance([AZUSA])).toBe(3);
    expect(landAllowance(['You may play one additional land on each of your turns.'])).toBe(2);
    expect(landAllowance(['You may play three additional lands on each of your turns.'])).toBe(4);
  });

  test('"each player may" counts for the seat that controls it', () => {
    expect(landAllowance([RITES_OF_FLOURISHING])).toBe(2);
    expect(landAllowance([STORM_CAULDRON])).toBe(2); // "during each of their turns"
  });

  test('several permanents add up', () => {
    expect(landAllowance([EXPLORATION, AZUSA])).toBe(4);
    expect(landAllowance([EXPLORATION, EXPLORATION, RITES_OF_FLOURISHING])).toBe(4);
  });

  test('a land for this turn only is a spell’s doing, not a standing rule', () => {
    expect(landAllowance(['You may play an additional land this turn.\nDraw a card.'])).toBe(1); // Explore
    expect(landAllowance(['You may play up to three additional lands this turn.'])).toBe(1); // Summer Bloom
  });

  test('playing lands from somewhere else is not playing more of them', () => {
    expect(landAllowance(['You may play lands from the top of your library.'])).toBe(1);
  });

  test('"any number of lands" lifts the limit', () => {
    expect(landAllowance([FASTBOND])).toBe(Infinity);
  });

  test('another seat’s permanent counts only where it speaks to each player', () => {
    expect(landAllowance([], [RITES_OF_FLOURISHING])).toBe(2);
    expect(landAllowance([], [EXPLORATION, AZUSA, FASTBOND])).toBe(1); // theirs, not yours
    expect(landAllowance([EXPLORATION], [RITES_OF_FLOURISHING, STORM_CAULDRON])).toBe(4);
  });
});

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: [
    { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
  ],
};

const forest: CardRecord = {
  id: 'c-forest',
  name: 'Forest',
  nameLower: 'forest',
  typeLine: 'Basic Land — Forest',
  oracleText: '({T}: Add {G}.)',
  manaCost: '',
  power: null,
  toughness: null,
  colors: [],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: true,
};

/** Two seats with cards, seat 0 to move, turn `turn`. */
function table(turn = 2): GameState {
  const deck = changeCardCount(addCard(createDeck('Lands'), forest), 'c-forest', 19);
  let g = createGame(config);
  g = seedSeat(g, 0, buildSeatCards(deck, 1));
  g = seedSeat(g, 1, buildSeatCards(deck, 2));
  return { ...g, turnNumber: turn };
}

describe('canPlayLand', () => {
  test('your turn, no land played yet: go ahead', () => {
    expect(canPlayLand(table(), 0, [])).toEqual({ ok: true });
  });

  test('not on someone else’s turn', () => {
    expect(canPlayLand(table(), 1, [])).toEqual({ ok: false, why: "It isn't your turn." });
    // however many drops their permanents would give them on their own turn
    expect(canPlayLand(table(), 1, [AZUSA])).toEqual({ ok: false, why: "It isn't your turn." });
  });

  test('one land a turn', () => {
    const played = countLandPlay(table(), 0);
    expect(canPlayLand(played, 0, [])).toEqual({
      ok: false,
      why: 'You have already played a land this turn.',
    });
  });

  test('a permanent that grants another drop opens it', () => {
    const once = countLandPlay(table(), 0);
    expect(canPlayLand(once, 0, [EXPLORATION])).toEqual({ ok: true });
    const twice = countLandPlay(once, 0);
    expect(canPlayLand(twice, 0, [EXPLORATION]).ok).toBe(false);
    expect(canPlayLand(twice, 0, [AZUSA])).toEqual({ ok: true });
  });

  test('so does another seat’s Rites of Flourishing — and not their Exploration', () => {
    const once = countLandPlay(table(), 0);
    expect(canPlayLand(once, 0, [], [RITES_OF_FLOURISHING])).toEqual({ ok: true });
    expect(canPlayLand(once, 0, [], [EXPLORATION]).ok).toBe(false);
  });

  test('last turn’s land does not count against this one', () => {
    const lastTurn = countLandPlay(table(2), 0);
    const mine: GameState = { ...lastTurn, turnNumber: 3 };
    expect(canPlayLand(mine, 0, [])).toEqual({ ok: true });
    const theirs: GameState = { ...lastTurn, activePlayerIndex: 1 };
    expect(canPlayLand(theirs, 1, [])).toEqual({ ok: true }); // seat 0's land is not seat 1's
  });

  test('a seat dealt before lands were counted simply has played none', () => {
    const g = table();
    expect('landPlays' in g.players[0].cards!).toBe(false);
    expect(canPlayLand(g, 0, [])).toEqual({ ok: true });
  });
});

describe('which cards a tap plays as a land', () => {
  test('a land, whatever else it also is', () => {
    expect(isLandCard('Basic Land — Forest')).toBe(true);
    expect(isLandCard('Land')).toBe(true);
    expect(isLandCard('Artifact Land')).toBe(true);
    expect(isLandCard('Land Creature — Forest Dryad')).toBe(true); // Dryad Arbor
    expect(isLandCard('Land // Land')).toBe(true); // Branchloft Pathway
  });

  test('not a spell whose BACK face is a land: that one is cast', () => {
    expect(isLandCard('Legendary Enchantment // Legendary Land')).toBe(false); // Growing Rites of Itlimoc
    expect(isLandCard('Legendary Creature — God // Legendary Land')).toBe(false); // the Ojer gods
    expect(isLandCard('Instant // Land')).toBe(false); // Valakut Awakening
    expect(isLandCard('Creature — Bear')).toBe(false);
    expect(isLandCard('')).toBe(false); // unread
  });

  test('such a card has a land on the back, for the hold to offer', () => {
    expect(hasLandBack('Instant // Land')).toBe(true);
    expect(hasLandBack('Legendary Enchantment // Legendary Land')).toBe(true);
    expect(hasLandBack('Land // Land')).toBe(false); // a tap already plays it as one
    expect(hasLandBack('Basic Land — Forest')).toBe(false);
    expect(hasLandBack('Creature — Giant // Instant — Adventure')).toBe(false);
    expect(hasLandBack('')).toBe(false);
  });
});
