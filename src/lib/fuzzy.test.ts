import { describe, expect, test } from 'vitest';
import { fuzzyScore, normalize, searchNames } from './fuzzy';

const names = [
  { id: '1', name: 'Sol Ring' },
  { id: '2', name: 'Solemn Simulacrum' },
  { id: '3', name: "Teferi's Protection" },
  { id: '4', name: 'Lim-Dûl the Necromancer' },
  { id: '5', name: 'Soldier' },
  { id: '6', name: 'Treasure' },
  { id: '7', name: 'Wall of Bone' },
  { id: '8', name: 'Bone Saw' },
];

describe('normalize', () => {
  test('lowercases, strips diacritics and punctuation', () => {
    expect(normalize('Lim-Dûl')).toBe('lim dul');
    expect(normalize("Teferi's")).toBe('teferi s');
  });
});

describe('fuzzyScore', () => {
  test('exact match outranks prefix match', () => {
    expect(fuzzyScore('soldier', 'Soldier')).toBeGreaterThan(fuzzyScore('sol', 'Soldier'));
  });

  test('no match scores 0', () => {
    expect(fuzzyScore('zzz', 'Sol Ring')).toBe(0);
  });
});

describe('searchNames', () => {
  test('"sol r" ranks Sol Ring above Solemn Simulacrum', () => {
    const results = searchNames('sol r', names);
    expect(results[0].name).toBe('Sol Ring');
    expect(results.map((r) => r.name)).toContain('Solemn Simulacrum');
  });

  test('apostrophes do not block matching', () => {
    const results = searchNames('teferi protection', names);
    expect(results[0].name).toBe("Teferi's Protection");
  });

  test('diacritics and hyphens do not block matching', () => {
    const results = searchNames('lim dul', names);
    expect(results[0].name).toBe('Lim-Dûl the Necromancer');
  });

  test('empty or whitespace query returns nothing', () => {
    expect(searchNames('', names)).toEqual([]);
    expect(searchNames('   ', names)).toEqual([]);
  });

  test('respects limit', () => {
    const results = searchNames('s', names, 2);
    expect(results).toHaveLength(2);
  });

  test('exact name ranks first', () => {
    const results = searchNames('soldier', names);
    expect(results[0].name).toBe('Soldier');
  });

  test('words out of order still match: "bone wall" finds Wall of Bone', () => {
    const results = searchNames('bone wall', names);
    expect(results.map((r) => r.name)).toContain('Wall of Bone');
  });

  test('in-order matches outrank out-of-order ones', () => {
    const results = searchNames('bone s', names);
    expect(results[0].name).toBe('Bone Saw');
  });

  test('searching one index never answers for another', () => {
    const a = [{ id: 'a1', name: 'Sol Ring' }];
    const b = [{ id: 'b1', name: 'Solemn Simulacrum' }];
    expect(searchNames('sol', a).map((r) => r.id)).toEqual(['a1']);
    expect(searchNames('sol', b).map((r) => r.id)).toEqual(['b1']);
    expect(searchNames('sol', a).map((r) => r.id)).toEqual(['a1']);
  });

  test('an index that changed since the last search is read afresh', () => {
    const index = [{ id: '1', name: 'Sol Ring' }];
    expect(searchNames('sol', index)).toHaveLength(1);
    index.push({ id: '2', name: 'Solemn Simulacrum' });
    expect(searchNames('sol', index).map((r) => r.id)).toEqual(['1', '2']);
    index[1] = { id: '3', name: 'Forest' }; // same length, different card
    expect(searchNames('sol', index).map((r) => r.id)).toEqual(['1']);
    expect(searchNames('for', index).map((r) => r.id)).toEqual(['3']);
  });

  test('a match equals its score from fuzzyScore, so ranking is unchanged', () => {
    for (const q of ['s', 'sol', 'bone wall', 'lim dul', 'wl bn', 'soldier']) {
      const ranked = [...names]
        .map((entry) => ({ entry, score: fuzzyScore(q, entry.name) }))
        .filter((r) => r.score > 0)
        .sort((x, y) => y.score - x.score || x.entry.name.localeCompare(y.entry.name))
        .map((r) => r.entry);
      expect(searchNames(q, names, 100)).toEqual(ranked);
    }
  });
});
