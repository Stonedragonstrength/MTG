import { describe, expect, test } from 'vitest';
import type { BoardItem } from './types';
import {
  effectiveManaColors,
  isOneShotSource,
  landSummary,
  manaColors,
  tapManaFromText,
} from './mana';

describe('tapManaFromText', () => {
  test('a basic taps for one of its color', () => {
    expect(tapManaFromText('({T}: Add {G}.)')).toEqual({ produces: ['G'], amount: 1 });
  });

  test('alternatives are one mana, listed symbols are that many', () => {
    expect(tapManaFromText('{T}: Add {G} or {W}.')).toEqual({ produces: ['G', 'W'], amount: 1 });
    expect(tapManaFromText('{T}: Add {R}, {G}, or {W}.')).toEqual({
      produces: ['R', 'G', 'W'],
      amount: 1,
    });
    expect(tapManaFromText('{T}: Add {C}{C}.')).toEqual({ produces: ['C'], amount: 2 }); // Sol Ring
    expect(tapManaFromText('{T}: Add {G}{U}.')).toEqual({ produces: ['G', 'U'], amount: 2 }); // bounce land
  });

  test('any-color wording reads its count', () => {
    expect(tapManaFromText('{T}: Add one mana of any color.')).toEqual({
      produces: ['any'],
      amount: 1,
    });
    expect(tapManaFromText('{T}: Add three mana of any one color.')).toEqual({
      produces: ['any'],
      amount: 3,
    });
  });

  test('mana the ability itself costs comes off the top', () => {
    // Signet: pay 1, get 2 — one net mana
    expect(tapManaFromText('{1}, {T}: Add {G}{W}.')).toEqual({ produces: ['G', 'W'], amount: 1 });
  });

  test('several abilities: best net amount, every color they offer', () => {
    const grotto = '{T}: Add {C}.\n{1}, {T}: Add one mana of any color.';
    expect(tapManaFromText(grotto)).toEqual({ produces: ['C', 'any'], amount: 1 });
  });

  test('"add" without a tap cost is not a mana ability', () => {
    expect(
      tapManaFromText('Whenever a Forest is tapped for mana, its controller adds an additional {G}.'),
    ).toEqual({ produces: [], amount: 0 });
    expect(tapManaFromText('Flying')).toEqual({ produces: [], amount: 0 });
  });
});

function land(name: string, oracleText: string, count = 1): BoardItem {
  return {
    id: name,
    cardId: name,
    name,
    imageNormal: null,
    imageArtCrop: null,
    typeLine: 'Land',
    oracleText,
    basePower: null,
    baseToughness: null,
    count,
    counters: {},
    color: null,
    zone: 'lands',
  };
}

describe('manaColors', () => {
  test('a basic Forest produces G', () => {
    expect(manaColors(land('Forest', '({T}: Add {G}.)'))).toEqual(['G']);
  });

  test('a dual land produces both colors', () => {
    expect(manaColors(land('Temple Garden', '{T}: Add {G} or {W}.'))).toEqual(['G', 'W']);
  });

  test('any-color lands report any', () => {
    expect(
      manaColors(land('Command Tower', '{T}: Add one mana of any color in your commander’s color identity.')),
    ).toEqual(['any']);
  });

  test('colorless sources report C', () => {
    expect(manaColors(land('Wastes', '{T}: Add {C}.'))).toEqual(['C']);
  });

  test('a land that produces nothing reports nothing', () => {
    expect(manaColors(land('Maze of Ith', '{T}: Untarget attacking creature.'))).toEqual([]);
  });

  test('double production counts once per color', () => {
    expect(manaColors(land('Cabal Coffers', '{2}, {T}: Add {B} for each Swamp you control.'))).toEqual(['B']);
  });
});

describe('isOneShotSource', () => {
  test('sacrifice-for-mana cards are one-shot', () => {
    expect(
      isOneShotSource(
        land('Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.'),
      ),
    ).toBe(true);
    expect(
      isOneShotSource(land('Lotus Petal', '{T}, Sacrifice Lotus Petal: Add one mana of any color.')),
    ).toBe(true);
  });

  test('ordinary lands are not', () => {
    expect(isOneShotSource(land('Forest', '({T}: Add {G}.)'))).toBe(false);
    expect(isOneShotSource(land('Command Tower', '{T}: Add one mana of any color.'))).toBe(false);
  });
});

function creature(name: string, oracleText: string, count = 1): BoardItem {
  return { ...land(name, oracleText, count), typeLine: 'Creature', zone: 'board' };
}

describe('effectiveManaColors', () => {
  test('an explicit manaMode wins over oracle text', () => {
    expect(effectiveManaColors({ ...creature('Soldier', ''), manaMode: 'G' })).toEqual(['G']);
    expect(effectiveManaColors({ ...creature('Soldier', ''), manaMode: 'any' })).toEqual(['any']);
  });

  test('manaMode none silences a real mana dork', () => {
    expect(
      effectiveManaColors({ ...creature('Llanowar Elves', '{T}: Add {G}.'), manaMode: 'none' }),
    ).toEqual([]);
  });

  test('without a manaMode, oracle text decides', () => {
    expect(effectiveManaColors(creature('Llanowar Elves', '{T}: Add {G}.'))).toEqual(['G']);
    expect(effectiveManaColors(creature('Soldier', ''))).toEqual([]);
  });
});

describe('landSummary', () => {
  test('board-zone mana sources count toward colors but not the land total', () => {
    const items = [
      land('Forest', '({T}: Add {G}.)', 2),
      { ...creature('Ashaya-fied Bear', '', 3), manaMode: 'G' as const },
      creature('Llanowar Elves', '{T}: Add {G}.', 1),
      { ...creature('Quiet Elves', '{T}: Add {G}.', 2), manaMode: 'none' as const },
      creature('Soldier', '', 4),
    ];
    const summary = landSummary(items);
    expect(summary.total).toBe(2);
    expect(summary.colors.G).toBe(6);
    expect(summary.any).toBe(0);
  });

  test('a board creature set to any-color counts as an any source', () => {
    const rite = { ...creature('Soldier', '', 2), manaMode: 'any' as const };
    expect(landSummary([rite]).any).toBe(2);
    expect(landSummary([rite]).total).toBe(0);
  });

  test('totals stacks and tallies color capability', () => {
    const items = [
      land('Forest', '({T}: Add {G}.)', 4),
      land('Command Tower', '{T}: Add one mana of any color.', 2),
      land('Temple Garden', '{T}: Add {G} or {W}.', 1),
    ];
    const summary = landSummary(items);
    expect(summary.total).toBe(7);
    expect(summary.colors.G).toBe(5);
    expect(summary.colors.W).toBe(1);
    expect(summary.colors.U).toBe(0);
    expect(summary.any).toBe(2);
  });

  test('only counts items in the lands zone', () => {
    const soldier = { ...land('Soldier', '', 3), zone: 'board' as const };
    expect(landSummary([soldier])).toEqual({
      total: 0,
      colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      any: 0,
    });
  });
});

describe('landSummary with virtual lands', () => {
  test('resolved virtual lands count toward the total and the pips', () => {
    const summary = landSummary(
      [],
      [
        { oracleText: '({T}: Add {G}.)' },
        { oracleText: '({T}: Add {G}.)' },
        { oracleText: '{T}: Add one mana of any color.' },
      ],
    );
    expect(summary.total).toBe(3);
    expect(summary.colors.G).toBe(2);
    expect(summary.any).toBe(1);
  });

  test('an unresolved virtual land counts toward the total but shows no pip', () => {
    const summary = landSummary([], [{ oracleText: null }]);
    expect(summary.total).toBe(1);
    expect(summary.colors).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(summary.any).toBe(0);
  });

  test('virtual lands combine with tracker stacks and board dorks', () => {
    const summary = landSummary(
      [land('Forest', '({T}: Add {G}.)', 2), creature('Llanowar Elves', '{T}: Add {G}.')],
      [{ oracleText: '({T}: Add {G}.)' }],
    );
    expect(summary.total).toBe(3); // the elf feeds a pip, not the land count
    expect(summary.colors.G).toBe(4);
  });
});
