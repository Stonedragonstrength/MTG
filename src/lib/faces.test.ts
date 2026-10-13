import { describe, expect, test } from 'vitest';
import { commanderDied, flipCard, moveCard, setCardCounter, tapCard } from './cards';
import { applyCombat } from './combat';
import { BACK, backId, backView, faceNames, frontId, isBackId, turnsOver } from './faces';
import { createGame } from './game';
import { isSummoningSick } from './keywords';
import { isValidGame, migrateGame } from './migrate';
import { isCreatureCard, shelfOf } from './shelf';
import { planEffect } from './spellEffects';
import { isLandCard } from './turnRules';
import type { CardInstance, CardRecord, GameConfig, GameState } from './types';

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

function rec(id: string, name: string, typeLine: string, more: Partial<CardRecord> = {}): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText: '',
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: `https://img.example/${id}-art.jpg`,
    isToken: false,
    isBasicLand: false,
    ...more,
  };
}

/** Delver, as a download made today stores it. */
const DELVER = rec('c-delver', 'Delver of Secrets // Insectile Aberration', 'Creature — Human Wizard // Creature — Human Insect', {
  oracleText: 'At the beginning of your upkeep, look at the top card of your library.\n//\nFlying',
  manaCost: '{U}',
  power: '1',
  toughness: '1',
  colors: ['U'],
  back: {
    name: 'Insectile Aberration',
    typeLine: 'Creature — Human Insect',
    oracleText: 'Flying',
    manaCost: '',
    power: '3',
    toughness: '2',
    colors: ['U'],
    imageNormal: 'https://img.example/aberration.jpg',
    imageArtCrop: 'https://img.example/aberration-art.jpg',
  },
});

/** The same card as a download made before faces were kept stored it. */
const OLD_DELVER: CardRecord = (() => {
  const { back: _b, ...old } = DELVER;
  return old;
})();

/** A spell with a land on its back, stored the old way. */
const OLD_VALAKUT = rec('c-valakut', 'Valakut Awakening // Valakut Stoneforge', 'Instant // Land', {
  oracleText: 'Put any number of cards from your hand on the bottom of your library.\n//\n{T}: Add {R}.',
  manaCost: '{2}{R}',
});

describe('back ids', () => {
  test('a back id is the front id with the suffix, and each way is said outright', () => {
    expect(backId('abc')).toBe(`abc${BACK}`);
    expect(backId(backId('abc'))).toBe(backId('abc')); // never twice
    expect(frontId(backId('abc'))).toBe('abc');
    expect(frontId('abc')).toBe('abc');
    expect(isBackId('abc')).toBe(false);
    expect(isBackId(backId('abc'))).toBe(true);
  });
});

describe('turnsOver', () => {
  test('a record with back-face data turns over; one marked as having none does not', () => {
    expect(turnsOver(DELVER)).toBe(true);
    expect(turnsOver({ ...OLD_DELVER, back: null })).toBe(false);
  });

  test('an old record is judged by its second type line: a permanent there turns over', () => {
    expect(turnsOver(OLD_DELVER)).toBe(true);
    expect(turnsOver(OLD_VALAKUT)).toBe(true);
    expect(turnsOver(rec('c-bear', 'Grizzly Bears', 'Creature — Bear'))).toBe(false);
  });

  test('split cards, adventures, omens and Rooms do not', () => {
    expect(turnsOver(rec('s', 'Fire // Ice', 'Instant // Instant'))).toBe(false);
    expect(turnsOver(rec('a', 'Bonecrusher Giant // Stomp', 'Creature — Giant // Instant — Adventure'))).toBe(false);
    expect(turnsOver(rec('o', 'Dirgur Island Dragon // Skimming Strike', 'Creature — Dragon // Instant — Omen'))).toBe(false);
    expect(turnsOver(rec('r', 'Dazzling Theater // Prop Room', 'Enchantment — Room // Enchantment — Room'))).toBe(false);
  });

  test('a card that already lies on its back turns (back) over; no record, no', () => {
    expect(turnsOver(backView(DELVER))).toBe(true);
    expect(turnsOver(backView(OLD_DELVER))).toBe(true);
    expect(turnsOver(undefined)).toBe(false);
    expect(turnsOver(null)).toBe(false);
  });
});

describe('backView', () => {
  test('is the back face laid out like a single-faced card, under the back id and the whole name', () => {
    const view = backView(DELVER);
    expect(view).toMatchObject({
      id: backId('c-delver'),
      name: 'Delver of Secrets // Insectile Aberration',
      nameLower: 'delver of secrets // insectile aberration',
      typeLine: 'Creature — Human Insect',
      oracleText: 'Flying',
      power: '3',
      toughness: '2',
      colors: ['U'],
      imageNormal: 'https://img.example/aberration.jpg',
      imageArtCrop: 'https://img.example/aberration-art.jpg',
    });
    expect('back' in view).toBe(false);
    expect(backView(view)).toBe(view); // a back view is its own back view
    expect(DELVER.typeLine).toContain(' // '); // the record itself is untouched
  });

  test('an old record gives the second half of its type and text, the front picture, no size', () => {
    const view = backView(OLD_DELVER);
    expect(view.id).toBe(backId('c-delver'));
    expect(view.typeLine).toBe('Creature — Human Insect');
    expect(view.oracleText).toBe('Flying');
    expect(view.power).toBeNull();
    expect(view.toughness).toBeNull();
    expect(view.imageNormal).toBe(OLD_DELVER.imageNormal);
  });

  test('a flip card has one picture: the back view keeps it', () => {
    const flip: CardRecord = { ...DELVER, back: { ...DELVER.back!, imageNormal: null, imageArtCrop: null } };
    expect(backView(flip).imageNormal).toBe(DELVER.imageNormal);
    expect(backView(flip).imageArtCrop).toBe(DELVER.imageArtCrop);
  });

  test('the readers that read "the front face" read the back one through it', () => {
    const view = backView(OLD_VALAKUT);
    expect(isLandCard(OLD_VALAKUT.typeLine)).toBe(false);
    expect(isLandCard(view.typeLine)).toBe(true);
    expect(isCreatureCard(backView(DELVER))).toBe(true);
    expect(shelfOf({}, view)).toBe('lands');
    // A creature on the back of a card that arrived this turn is as sick as any.
    expect(isSummoningSick({ sick: true }, backView(DELVER), [])).toBe(true);
  });
});

describe('faceNames', () => {
  test('come off the record, or off the whole name', () => {
    expect(faceNames(DELVER, 'whatever')).toEqual({ front: 'Delver of Secrets', back: 'Insectile Aberration' });
    expect(faceNames(backView(DELVER), 'whatever')).toEqual({ front: 'Delver of Secrets', back: 'Insectile Aberration' });
    expect(faceNames(undefined, 'Delver of Secrets // Insectile Aberration')).toEqual({
      front: 'Delver of Secrets',
      back: 'Insectile Aberration',
    });
    expect(faceNames(undefined, 'Grizzly Bears')).toEqual({ front: 'Grizzly Bears', back: null });
  });
});

// ---- the card on the table ----

const seat = (battlefield: CardInstance[], command: CardInstance[] = []) => ({
  library: [],
  hand: [],
  battlefield,
  graveyard: [],
  exile: [],
  command,
  mulligans: 0,
  deckName: 'Test',
});

const delver: CardInstance = { iid: 'delver', cardId: 'c-delver', name: DELVER.name };

function table(card: CardInstance = delver): GameState {
  const g = createGame(config);
  return {
    ...g,
    players: [
      { ...g.players[0], cards: { ...seat([card]), cmd: { [card.iid]: 0 } } },
      { ...g.players[1], cards: seat([{ iid: 'bear', cardId: 'c-bear', name: 'Grizzly Bears' }]) },
    ],
  };
}

const onTable = (g: GameState) => g.players[0].cards!.battlefield[0];

describe('flipCard', () => {
  test('turns the card onto its back and onto its front again, and nothing else about it', () => {
    let g = setCardCounter(tapCard(table(), 0, 'delver', true), 0, 'delver', 'p1p1', 2);
    g = flipCard(g, 0, 'delver', true);
    expect(onTable(g)).toEqual({ ...delver, cardId: backId('c-delver'), tapped: true, counters: { p1p1: 2 } });
    g = flipCard(g, 0, 'delver', false);
    expect(onTable(g)).toEqual({ ...delver, tapped: true, counters: { p1p1: 2 } });
  });

  test('says its direction: asking for what is already so is the same game', () => {
    const g = table();
    expect(flipCard(g, 0, 'delver', false)).toBe(g);
    const turned = flipCard(g, 0, 'delver', true);
    expect(flipCard(turned, 0, 'delver', true)).toBe(turned);
  });

  test('only a card on the battlefield turns', () => {
    const g = table();
    expect(flipCard(g, 0, 'nobody', true)).toBe(g);
    expect(flipCard(g, 5, 'delver', true)).toBe(g);
    const inHand = moveCard(g, 0, 'delver', 'battlefield', 'hand');
    expect(flipCard(inHand, 0, 'delver', true)).toBe(inHand);
  });
});

describe('a card that leaves the battlefield is its front face again', () => {
  const turned = () => flipCard(table(), 0, 'delver', true);

  test.each(['graveyard', 'exile', 'hand', 'library', 'command'] as const)('moved to the %s', (to) => {
    const g = moveCard(turned(), 0, 'delver', 'battlefield', to);
    expect(g.players[0].cards![to]).toEqual([delver]);
  });

  test('a commander that dies', () => {
    const g = commanderDied(turned(), 0, 'delver');
    expect(g.players[0].cards!.command).toEqual([delver]);
  });

  test('a move along the battlefield is no exit: it stays as it lies', () => {
    const g = moveCard(turned(), 0, 'delver', 'battlefield', 'battlefield', { row: 'side' });
    expect(onTable(g).cardId).toBe(backId('c-delver'));
  });

  test('and it comes back front face up', () => {
    let g = moveCard(turned(), 0, 'delver', 'battlefield', 'exile');
    g = moveCard(g, 0, 'delver', 'exile', 'battlefield');
    expect(onTable(g).cardId).toBe('c-delver');
  });

  test('killed in a fight', () => {
    const base = turned();
    const g: GameState = {
      ...base,
      combat: {
        id: 'k1',
        turn: base.turnNumber,
        active: base.activePlayerIndex,
        step: 'damage',
        attacks: [{ unit: { kind: 'card', id: 'delver' }, target: 1 }],
      },
    };
    const after = applyCombat(g, 'k1', { deaths: [{ seat: 0, unit: { kind: 'card', id: 'delver' } }], players: [] });
    expect(after.players[0].cards!.graveyard).toEqual([delver]);
  });

  test('destroyed, exiled or bounced by a spell', () => {
    for (const [how, zone] of [['destroy', 'graveyard'], ['exile', 'exile'], ['bounce', 'hand']] as const) {
      const g = turned();
      const plan = planEffect(g, 1, 'Spell', { kind: 'remove', how, on: { seat: 0, kind: 'card', id: 'delver' } }, {});
      expect(plan).not.toBeNull();
      expect(plan!.apply(g).players[0].cards![zone]).toEqual([delver]);
    }
  });
});

describe('the game state needs no new field', () => {
  test('a card id with the suffix is a valid game, and migration leaves it alone', () => {
    const g = flipCard(table(), 0, 'delver', true);
    const wire = JSON.parse(JSON.stringify(g)) as GameState;
    expect(isValidGame(wire)).toBe(true);
    expect(migrateGame(wire).players[0].cards!.battlefield[0].cardId).toBe(backId('c-delver'));
  });
});
