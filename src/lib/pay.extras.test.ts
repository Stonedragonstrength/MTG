import { describe, expect, test } from 'vitest';
import { asksAtCast, extraCosts, extraTimes, extrasWords, parseCosts, priceExtras } from './pay';

const card = (typeLine: string, oracleText: string, manaCost = '{3}{U}{U}') => ({ typeLine, oracleText, manaCost });

describe('extraCosts', () => {
  test('reads a kicker off the card', () => {
    const [kicker] = extraCosts(card('Creature — Elemental', 'Kicker {U} (You may pay an additional {U} as you cast this spell.)\nFlying'));
    expect(kicker).toMatchObject({ kind: 'kicker', label: 'Kicker {U}', many: false });
    expect(kicker.cost).toEqual({ generic: 0, pips: [['U']] });
  });

  test('multikicker, replicate and squad may be paid many times; buyback and entwine once', () => {
    const kinds = (text: string) => extraCosts(card('Instant', text)).map((e) => `${e.kind}:${e.many}`);
    expect(kinds('Multikicker {1}{G}')).toEqual(['multikicker:true']);
    expect(kinds('Replicate {1}{R}')).toEqual(['replicate:true']);
    expect(kinds('Squad {2}')).toEqual(['squad:true']);
    expect(kinds('Escalate {1}')).toEqual(['escalate:true']);
    expect(kinds('Buyback {3}')).toEqual(['buyback:false']);
    expect(kinds('Choose one —\n• A\n• B\nEntwine {2}')).toEqual(['entwine:false']);
  });

  test('"and/or" is two kickers, each with its own cost', () => {
    const both = extraCosts(card('Creature — Kavu', 'Kicker {1}{G} and/or {2}{U}'));
    expect(both.map((e) => e.label)).toEqual(['Kicker {1}{G}', 'Kicker {2}{U}']);
    expect(both[1].cost).toEqual({ generic: 2, pips: [['U']] });
  });

  test('what the table cannot price is left out: a kicker with X, one that is not mana, one only mentioned', () => {
    expect(extraCosts(card('Creature — Treefolk', 'Kicker {X}'))).toEqual([]);
    expect(extraCosts(card('Sorcery', 'Kicker—Sacrifice a land.'))).toEqual([]);
    expect(extraCosts(card('Enchantment', 'Whenever you cast a spell, if it was kicked, draw a card.'))).toEqual([]);
    expect(extraCosts(card('Instant', 'Counter target spell with kicker {2}.'))).toEqual([]);
  });

  test('only the front face, never a land, never an unread card', () => {
    expect(extraCosts(card('Creature — Human // Creature — Vampire', 'Flying\n//\nKicker {2}'))).toEqual([]);
    expect(extraCosts(card('Land', 'Kicker {2}'))).toEqual([]);
    expect(extraCosts(null)).toEqual([]);
    expect(extraCosts(undefined)).toEqual([]);
  });
});

describe('extraTimes', () => {
  const extras = extraCosts(card('Instant', 'Kicker {U}\nMultikicker {1}'));

  test('once for a kicker, as often as asked for a multikicker, never less than nothing', () => {
    expect(extraTimes(extras, [1, 3])).toEqual([1, 3]);
    expect(extraTimes(extras, [5, 2.9])).toEqual([1, 2]);
    expect(extraTimes(extras, [-1, -4])).toEqual([0, 0]);
  });

  test('nothing asked, or nonsense, is nothing paid', () => {
    expect(extraTimes(extras, undefined)).toEqual([0, 0]);
    expect(extraTimes(extras, ['1', Number.NaN])).toEqual([0, 0]);
    expect(extraTimes(extras, [1])).toEqual([1, 0]);
  });
});

describe('priceExtras', () => {
  const extras = extraCosts(card('Creature — Elemental', 'Kicker {U}\nMultikicker {1}{G}'));
  const [base] = parseCosts('{3}{U}{U}');

  test('unpaid, the cost is the very same', () => {
    const costs = [base];
    expect(priceExtras(costs, extras, [0, 0])).toBe(costs);
  });

  test('a paid kicker goes on top; a multikicker once per time', () => {
    expect(priceExtras([base], extras, [1, 0])).toEqual([{ generic: 3, pips: [['U'], ['U'], ['U']] }]);
    expect(priceExtras([base], extras, [1, 2])).toEqual([
      { generic: 5, pips: [['U'], ['U'], ['U'], ['G'], ['G']] },
    ]);
  });

  test('an X in the cost is kept for the caster to name', () => {
    const [withX] = parseCosts('{X}{G}');
    expect(priceExtras([withX], extras, [1, 0])[0].x).toBe(1);
  });
});

describe('extrasWords', () => {
  const words = (text: string, times: number[]) => extrasWords(extraCosts(card('Instant', text)), times);

  test('says what was paid, and how often', () => {
    expect(words('Kicker {U}', [1])).toBe(', kicked');
    expect(words('Kicker {U}', [0])).toBe('');
    expect(words('Multikicker {1}', [2])).toBe(', kicked twice');
    expect(words('Multikicker {1}', [4])).toBe(', kicked 4 times');
    expect(words('Buyback {3}', [1])).toBe(', with buyback');
    expect(words('Replicate {R}', [3])).toBe(', replicated 3 times');
  });

  test('two kickers both paid are said once; one of them is just "kicked"', () => {
    expect(words('Kicker {1}{G} and/or {2}{U}', [1, 1])).toBe(', kicked twice');
    expect(words('Kicker {1}{G} and/or {2}{U}', [0, 1])).toBe(', kicked');
  });
});

describe('asksAtCast', () => {
  test('a card with X, or with an extra cost, has something to ask first', () => {
    expect(asksAtCast(card('Creature — Hydra', '', '{X}{G}'), 'hand')).toBe(true);
    expect(asksAtCast(card('Creature — Elemental', 'Kicker {U}'), 'hand')).toBe(true);
    expect(asksAtCast(card('Creature — Bear', '', '{1}{G}'), 'hand')).toBe(false);
    expect(asksAtCast(null, 'hand')).toBe(false);
  });

  test('from the command zone only X is asked', () => {
    expect(asksAtCast(card('Legendary Creature — Elemental', 'Kicker {U}'), 'command')).toBe(false);
    expect(asksAtCast(card('Legendary Creature — Hydra', '', '{X}{G}'), 'command', 2)).toBe(true);
  });
});
