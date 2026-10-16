import { describe, expect, test } from 'vitest';
import { counterTargets, readCounter, stackNow, withStack, type Casting } from './counterspells';
import { createGame } from './game';
import { migrateGame } from './migrate';
import { spellPrompts } from './spellEffects';
import { actsOf, readTriggers } from './triggers';
import type { CardInstance, CardRecord, GameConfig, GameState, StackSpell } from './types';

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

function rec(id: string, name: string, typeLine: string, oracleText = '', manaCost = ''): CardRecord {
  return { id, name, nameLower: name.toLowerCase(), typeLine, oracleText, manaCost, power: null, toughness: null, colors: [], imageNormal: null, imageArtCrop: null, isToken: false, isBasicLand: false };
}

const RECORDS: Record<string, CardRecord> = {
  bolt: { ...rec('bolt', 'Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.', '{R}'), colors: ['R'] },
  bears: { ...rec('bears', 'Grizzly Bears', 'Creature — Bear', '', '{1}{G}'), colors: ['G'] },
  rhino: { ...rec('rhino', 'Thrun Stand-in', 'Creature — Rhino', "This spell can't be countered.\nTrample", '{2}{G}{G}'), colors: ['G'] },
  counter: { ...rec('counter', 'Counterspell', 'Instant', 'Counter target spell.', '{U}{U}'), colors: ['U'] },
};

const seat = (battlefield: CardInstance[], graveyard: CardInstance[] = []) => ({
  library: [],
  hand: [],
  battlefield,
  graveyard,
  exile: [],
  command: [],
  mulligans: 0,
  deckName: 'Test',
});

function table(mine: { battlefield?: CardInstance[]; graveyard?: CardInstance[] }, theirs: { battlefield?: CardInstance[]; graveyard?: CardInstance[] }): GameState {
  const g = createGame(config, 0);
  return {
    ...g,
    players: [
      { ...g.players[0], cards: seat(mine.battlefield ?? [], mine.graveyard ?? []) },
      { ...g.players[1], cards: seat(theirs.battlefield ?? [], theirs.graveyard ?? []) },
    ],
  };
}

const card = (iid: string, cardId: string): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name });
const spell = (g: GameState, id: string, seatIdx: number, iid: string, cardId: string, to: StackSpell['to']): StackSpell => ({
  id,
  seat: seatIdx,
  iid,
  cardId,
  name: RECORDS[cardId].name,
  to,
  turn: g.turnNumber,
  active: g.activePlayerIndex,
});

describe('readCounter', () => {
  test('what it answers, what saves the spell, where the spell goes', () => {
    expect(readCounter('Counter target spell.')).toEqual({ what: 'spell', unless: null, to: 'graveyard' });
    expect(readCounter('Counter target spell unless its controller pays {3}.')).toEqual({ what: 'spell', unless: '{3}', to: 'graveyard' });
    expect(readCounter('Counter target noncreature spell.')?.what).toBe('noncreature spell');
    expect(readCounter('Counter target creature spell.')?.what).toBe('creature spell');
    expect(readCounter('Counter target spell. If that spell is countered this way, exile it instead of putting it into its owner’s graveyard. Scry 2.')?.to).toBe('exile');
    expect(readCounter("Counter target spell. If that spell is countered this way, put it into its owner's hand instead of into that player's graveyard.\nDraw a card.")?.to).toBe('hand');
    expect(readCounter("Counter target spell. If that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard.")?.to).toBe('library');
    expect(readCounter('Counter target spell, activated ability, or triggered ability.')?.what).toBe('spell');
  });
  test('Mystic Snake: its enters trigger offers the same button', () => {
    const snake = rec('snake', 'Mystic Snake', 'Creature — Snake', 'Flash\nWhen this creature enters, counter target spell.', '{1}{G}{U}{U}');
    const [trigger] = readTriggers(snake);
    expect(actsOf(trigger)).toMatchObject([{ kind: 'prompt', auto: false, prompt: { kind: 'counter', what: 'spell' } }]);
  });
  test('a payment the table cannot price, and an ability alone, are not read', () => {
    expect(readCounter('Counter target spell unless its controller pays {1} for each card in your graveyard.')).toBeNull();
    expect(readCounter('Counter target activated or triggered ability.')).toBeNull();
  });
  test('it is a button under the spell, in a modal spell an option of its own', () => {
    expect(spellPrompts(RECORDS.counter)).toMatchObject([{ kind: 'counter', what: 'spell', label: 'Counter a spell…', pick: null }]);
    const charm = rec('charm', 'Izzet Charm', 'Instant', 'Choose one —\n• Counter target noncreature spell unless its controller pays {2}.\n• Izzet Charm deals 2 damage to target creature.\n• Draw two cards, then discard two cards.');
    expect(spellPrompts(charm)[0]).toMatchObject({ kind: 'counter', what: 'noncreature spell', unless: '{2}', mode: 0, label: 'Counter a noncreature spell unless they pay {2}…' });
  });
});

describe('the spells cast this turn', () => {
  const casting = (iid: string, cardId: string, seatIdx: number): Casting => ({ id: `s-${iid}`, seat: seatIdx, iid, cardId, name: RECORDS[cardId].name });

  test('each where its cast put it; a cast that did not land is no spell', () => {
    const before = table({}, {});
    const after = table({}, { battlefield: [card('b1', 'bears')], graveyard: [card('l1', 'bolt')] });
    const shown = { ...after, reveal: { id: 'r1', seat: 1, from: 'cast' as const, cards: [{ cardId: 'bolt', name: 'Lightning Bolt' }], t: 0 } };
    const g = withStack(before, shown, [casting('b1', 'bears', 1), casting('l1', 'bolt', 1), casting('x1', 'counter', 0)]);
    expect(stackNow(g).map((s) => [s.name, s.to, s.reveal ?? null])).toEqual([
      ['Grizzly Bears', 'battlefield', null],
      ['Lightning Bolt', 'graveyard', 'r1'],
    ]);
  });

  test('another turn’s are not on it', () => {
    const g = table({}, { graveyard: [card('l1', 'bolt')] });
    const old = { ...g, stack: [{ ...spell(g, 's1', 1, 'l1', 'bolt', 'graveyard'), turn: g.turnNumber - 1 }] };
    expect(stackNow(old)).toEqual([]);
  });

  test('a counterspell may answer them newest first: not itself, not one countered or gone, not one that can’t be countered', () => {
    const base = table({ graveyard: [card('c1', 'counter')] }, { battlefield: [card('b1', 'bears'), card('t1', 'rhino')], graveyard: [card('l1', 'bolt')] });
    const g: GameState = {
      ...base,
      stack: [
        spell(base, 's1', 1, 'b1', 'bears', 'battlefield'),
        spell(base, 's2', 1, 't1', 'rhino', 'battlefield'),
        { ...spell(base, 's3', 1, 'l9', 'bolt', 'graveyard') }, // its card has moved on
        spell(base, 's4', 1, 'l1', 'bolt', 'graveyard'),
        spell(base, 's5', 0, 'c1', 'counter', 'graveyard'),
      ],
    };
    expect(counterTargets(g, RECORDS, 'spell', { iid: 'c1' }).map((t) => [t.spell.name, t.not ?? null])).toEqual([
      ['Lightning Bolt', null],
      ['Thrun Stand-in', "can't be countered"],
      ['Grizzly Bears', null],
    ]);
    expect(counterTargets(g, RECORDS, 'noncreature spell', { iid: 'c1' }).map((t) => [t.spell.name, t.not ?? null])).toEqual([
      ['Lightning Bolt', null],
      ['Thrun Stand-in', "can't be countered"],
      ['Grizzly Bears', 'not a noncreature spell'],
    ]);
    const countered = { ...g, stack: g.stack!.map((s) => (s.id === 's4' ? { ...s, countered: 'Negate' } : s)) };
    expect(counterTargets(countered, RECORDS, 'spell', { iid: 'c1' }).map((t) => t.spell.name)).toEqual(['Thrun Stand-in', 'Grizzly Bears']);
  });

  test('a save keeps the spells it can read and drops the rest', () => {
    const g = table({}, {});
    const good = spell(g, 's1', 1, 'l1', 'bolt', 'graveyard');
    expect(migrateGame({ ...g, stack: [good, { id: 7 } as unknown as StackSpell] }).stack).toEqual([good]);
    expect('stack' in migrateGame({ ...g, stack: 'nonsense' as unknown as StackSpell[] })).toBe(false);
  });
});
