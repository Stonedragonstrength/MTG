import { describe, expect, test } from 'vitest';
import { fuzzyScore, normalize, searchNames } from './fuzzy';

const names = [
  { id: '1', name: 'Sol Ring' },
  { id: '2', name: 'Solemn Simulacrum' },
  { id: '3', name: "Teferi's Protection" },
  { id: '4', name: 'Lim-Dûl the Necromancer' },
  { id: '5', name: 'Soldier' },
  { id: '6', name: 'Treasure' },
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
});
