import { describe, expect, test } from 'vitest';
import { parseCost, planPayment, type ManaSource } from './pay';
import {
  chosenSources,
  groupSources,
  payWith,
  pickedFromPlan,
  sourcesUsing,
  tally,
  tallyWords,
  usingOf,
} from './payWith';

function src(
  key: string,
  produces: ManaSource['produces'],
  extra: Partial<ManaSource> = {},
): ManaSource {
  return { key, kind: 'virtual', produces, amount: 1, ...extra };
}

// Five Forests, three Islands, a Sol Ring, a Breeding Pool, a Command Tower.
const FORESTS = ['f1', 'f2', 'f3', 'f4', 'f5'].map((k) => src(k, ['G']));
const ISLANDS = ['i1', 'i2', 'i3'].map((k) => src(k, ['U']));
const RING = src('ring', ['C'], { amount: 2 });
const POOL = src('pool', ['G', 'U']);
const TOWER = src('tower', ['any']);
const TABLE = [...FORESTS, ...ISLANDS, RING, POOL, TOWER];
/** Which card a source is: its key without the copy number. */
const card = (s: ManaSource) => s.key.replace(/\d+$/, '');
const CULTIVATE = parseCost('{2}{G}');

describe('what the player sees as one thing', () => {
  test('copies of a card stand together; different cards do not', () => {
    const groups = groupSources(TABLE, card);
    expect(groups.map((g) => [card(g.members[0]), g.members.length, g.each])).toEqual([
      ['f', 5, 1],
      ['i', 3, 1],
      ['ring', 1, 2],
      ['pool', 1, 1],
      ['tower', 1, 1],
    ]);
  });

  test('a Forest tapped by hand is mana in the pool, apart from the fresh ones', () => {
    const groups = groupSources([src('f1', ['G'], { floating: true }), src('f2', ['G']), src('f3', ['G'])], card);
    expect(groups.map((g) => [g.floating, g.members.length])).toEqual([
      [true, 1],
      [false, 2],
    ]);
  });

  test('the copies of a stack are one group, and are told to the store by how many', () => {
    const elves = [0, 1, 2].map(() => src('stack-elves', ['G'], { kind: 'board', creature: true }));
    const groups = groupSources(elves, (s) => s.key);
    expect(groups).toHaveLength(1);
    expect(usingOf(groups, { [groups[0].id]: 2 })).toEqual({ 'stack-elves': 2 });
  });
});

describe('what is lit', () => {
  const groups = groupSources(TABLE, card);
  const id = (name: string) => groups.find((g) => card(g.members[0]) === name)!.id;

  test("the table's own pick is lit to begin with", () => {
    const picked = pickedFromPlan(groups, planPayment(CULTIVATE, TABLE));
    expect(tally(CULTIVATE, chosenSources(groups, picked))).toMatchObject({ paid: 3, of: 3, idle: 0 });
    // Sol Ring's two cover the generic; a Forest pays the green.
    expect(picked).toEqual({ [id('f')]: 1, [id('ring')]: 1 });
  });

  test('nothing is lit for a cost the table cannot pay', () => {
    expect(pickedFromPlan(groups, null)).toEqual({});
  });

  test('a count beyond what is there lights only what is there', () => {
    expect(chosenSources(groups, { [id('i')]: 9 }).map((s) => s.key)).toEqual(['i1', 'i2', 'i3']);
    expect(usingOf(groups, { [id('i')]: 2, [id('ring')]: 1 })).toEqual({ i1: 1, i2: 1, ring: 1 });
  });

  test('the store finds the same sources again, as far as they are still there', () => {
    const using = { i1: 1, i2: 1, ring: 1 };
    expect(sourcesUsing(TABLE, using).map((s) => s.key)).toEqual(['i1', 'i2', 'ring']);
    // i2 was tapped by somebody else meanwhile.
    const later = TABLE.filter((s) => s.key !== 'i2');
    expect(sourcesUsing(later, using).map((s) => s.key)).toEqual(['i1', 'ring']);
  });
});

describe('the count at the bottom', () => {
  const say = (chosen: ManaSource[]) => {
    const t = tally(CULTIVATE, chosen);
    return `${t.paid} of ${t.of} · ${tallyWords(CULTIVATE, t)}`;
  };

  test('paid exactly: the color is covered', () => {
    expect(say([FORESTS[0], ISLANDS[0], ISLANDS[1]])).toBe('3 of 3 · green is covered');
  });

  test('short: how much is still to go', () => {
    expect(say([FORESTS[0], ISLANDS[0]])).toBe('2 of 3 · 1 more to go');
    expect(say([])).toBe('0 of 3 · 3 more to go · still needs green');
  });

  test('enough mana but the wrong color: it says which color', () => {
    expect(say([ISLANDS[0], ISLANDS[1], ISLANDS[2]])).toBe('2 of 3 · 1 more to go · still needs green');
  });

  test('one source too many is said, not hidden', () => {
    const t = tally(CULTIVATE, [FORESTS[0], FORESTS[1], ISLANDS[0], ISLANDS[1]]);
    expect(t).toMatchObject({ paid: 3, of: 3, idle: 1 });
    expect(tallyWords(CULTIVATE, t)).toBe('1 more than it needs');
  });

  test('a Sol Ring that pays one leaves its other mana in the pool', () => {
    const cost = parseCost('{1}{G}');
    const t = tally(cost, [RING, FORESTS[0]]);
    expect(t).toMatchObject({ paid: 2, of: 2, idle: 0, spare: 1 });
    expect(tallyWords(cost, t)).toBe('1 left over stays in your pool');
  });

  test('an any-color land covers a color; a hybrid pip names both', () => {
    expect(say([TOWER, ISLANDS[0], ISLANDS[1]])).toBe('3 of 3 · green is covered');
    const hybrid = parseCost('{G/W}{U}');
    const t = tally(hybrid, [src('m', ['R']), src('m2', ['R'])]);
    expect(tallyWords(hybrid, t)).toBe('2 more to go · still needs green or white and blue');
  });

  test('a cost with no colored pips says nothing more once it is paid', () => {
    const cost = parseCost('{2}');
    expect(tallyWords(cost, tally(cost, [ISLANDS[0], ISLANDS[1]]))).toBe('');
  });

  test('copies of a stack count like cards', () => {
    const elves = [0, 1, 2, 3].map(() => src('elves', ['G'], { kind: 'board', creature: true }));
    expect(tally(CULTIVATE, elves)).toMatchObject({ paid: 3, of: 3, idle: 1 });
  });
});

describe('what the payment does to what is lit', () => {
  test('paid exactly: every lit source is drawn on', () => {
    expect(payWith([CULTIVATE], [FORESTS[0], ISLANDS[0], ISLANDS[1]])).toEqual({
      spend: { f1: 1, i1: 1, i2: 1 },
      tap: [],
      boardTaps: {},
    });
  });

  test('one too many: it is tapped as well, and its mana floats', () => {
    const out = payWith([CULTIVATE], [FORESTS[0], FORESTS[1], ISLANDS[0], ISLANDS[1]]);
    expect(Object.keys(out.spend)).toHaveLength(3);
    expect(out.tap).toHaveLength(1);
  });

  test('short (a cost reducer on the board): what is lit is spent whole', () => {
    expect(payWith([CULTIVATE], [RING])).toEqual({ spend: { ring: 2 }, tap: [], boardTaps: {} });
    expect(payWith([CULTIVATE], [ISLANDS[0], ISLANDS[1]])).toEqual({
      spend: { i1: 1, i2: 1 },
      tap: [],
      boardTaps: {},
    });
  });

  test('copies of a stack are tapped by how many are lit', () => {
    const elves = [0, 1].map(() => src('elves', ['G'], { kind: 'board', creature: true }));
    expect(payWith([CULTIVATE], [...elves, ISLANDS[0]])).toEqual({
      spend: { i1: 1 },
      tap: [],
      boardTaps: { elves: 2 },
    });
  });

  test('a split card is paid as the half the lit sources pay exactly', () => {
    // Fire {1}{R} // Ice {1}{U}
    const faces = [parseCost('{1}{R}'), parseCost('{1}{U}')];
    expect(payWith(faces, [ISLANDS[0], ISLANDS[1]])).toEqual({ spend: { i1: 1, i2: 1 }, tap: [], boardTaps: {} });
  });

  test('mana already in the pool that the cost has no use for is left alone', () => {
    const floating = src('f9', ['G'], { floating: true });
    const out = payWith([parseCost('{U}')], [ISLANDS[0], floating]);
    expect(out).toEqual({ spend: { i1: 1 }, tap: [], boardTaps: {} });
  });
});
