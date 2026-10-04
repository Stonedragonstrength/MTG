import { describe, expect, test } from 'vitest';
import type { BoardItem } from './types';
import { isOneShotSource, landSummary, manaColors } from './mana';

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

describe('landSummary', () => {
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
