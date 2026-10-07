import { describe, expect, test } from 'vitest';
import { ownedCoverage, rankBuildable } from './buildable';
import type { CardRecord } from './types';

function commander(id: string, name: string, identity: string[]): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine: 'Legendary Creature',
    oracleText: '',
    manaCost: '',
    power: null,
    toughness: null,
    colors: identity,
    colorIdentity: identity,
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const rows = [
  { cardId: 'elves', count: 2, identity: ['G'] },
  { cardId: 'bolt', count: 4, identity: ['R'] },
  { cardId: 'sol', count: 1, identity: [] }, // colorless fits anywhere
  { cardId: 'gruul', count: 1, identity: ['R', 'G'] },
  { cardId: 'mystery', count: 9 }, // identity not known yet: never guessed at
];

describe('ownedCoverage', () => {
  test('counts the copies you own that fit inside a commander’s colors', () => {
    expect(ownedCoverage(['G'], rows)).toBe(3); // elves x2 + sol ring
    expect(ownedCoverage(['R', 'G'], rows)).toBe(8); // + bolts x4 + the gold card
    expect(ownedCoverage([], rows)).toBe(1); // a colorless commander: colorless cards only
  });
});

describe('rankBuildable', () => {
  const stompy = commander('c-stompy', 'Stompy Lord', ['G']);
  const burn = commander('c-burn', 'Burn Lord', ['R']);
  const both = commander('c-both', 'Gruul Lord', ['R', 'G']);

  test('orders by how well the collection’s themes fit, and reports what you own for each', () => {
    const ranked = rankBuildable(
      [
        { card: burn, score: 10, shared: ['burn'] },
        { card: stompy, score: 20, shared: ['ramp'] },
      ],
      rows,
    );
    expect(ranked.map((b) => b.card.name)).toEqual(['Stompy Lord', 'Burn Lord']);
    expect(ranked[0]).toMatchObject({ coverage: 3, owned: false, shared: ['ramp'] });
    expect(ranked[1].coverage).toBe(5); // bolts x4 + sol ring
  });

  test('a commander you actually own is lifted above a slightly better stranger', () => {
    const ranked = rankBuildable(
      [
        { card: stompy, score: 20, shared: [] },
        { card: both, score: 15, shared: [] }, // 15 x 1.5 owned boost beats 20
      ],
      [...rows, { cardId: 'c-both', count: 1, identity: ['R', 'G'] }],
    );
    expect(ranked.map((b) => [b.card.name, b.owned])).toEqual([
      ['Gruul Lord', true],
      ['Stompy Lord', false],
    ]);
  });

  test('keeps only the best few', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      card: commander(`c${i}`, `Lord ${i}`, ['G']),
      score: i,
      shared: [],
    }));
    expect(rankBuildable(many, rows, 10)).toHaveLength(10);
    expect(rankBuildable(many, rows, 10)[0].card.name).toBe('Lord 29');
  });
});
