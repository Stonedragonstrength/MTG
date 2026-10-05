import { describe, expect, test } from 'vitest';
import { matchScannedTitle, parseDeckList } from './decklist';

describe('parseDeckList', () => {
  test('reads counts in the common formats', () => {
    const lines = parseDeckList('24 Forest\n2x Lightning Bolt\nSol Ring');
    expect(lines).toEqual([
      { count: 24, name: 'Forest', commander: false },
      { count: 2, name: 'Lightning Bolt', commander: false },
      { count: 1, name: 'Sol Ring', commander: false },
    ]);
  });

  test('strips set codes, collector numbers, and foil markers', () => {
    const lines = parseDeckList('1 Sol Ring (C21) 263\n1 Arcane Signet [CMR] *F*');
    expect(lines.map((l) => l.name)).toEqual(['Sol Ring', 'Arcane Signet']);
  });

  test('flags commanders via *CMDR* and the Commander section header', () => {
    const flagged = parseDeckList('1 Lathril, Blade of the Elves *CMDR*\n1 Forest');
    expect(flagged[0]).toMatchObject({ name: 'Lathril, Blade of the Elves', commander: true });
    expect(flagged[1].commander).toBe(false);

    const sectioned = parseDeckList('Commander\n1 Magda, Brazen Outlaw\n\nDeck\n5 Mountain');
    expect(sectioned[0]).toMatchObject({ name: 'Magda, Brazen Outlaw', commander: true });
    expect(sectioned[1]).toMatchObject({ name: 'Mountain', count: 5, commander: false });
  });

  test('skips blanks, comments, and bare section headers', () => {
    const lines = parseDeckList('// my deck\n\nDeck\n1 Forest\nSideboard\n1 Negate');
    expect(lines.map((l) => l.name)).toEqual(['Forest', 'Negate']);
  });
});

describe('matchScannedTitle', () => {
  const names = [
    { id: 'bolt', name: 'Lightning Bolt' },
    { id: 'greaves', name: 'Lightning Greaves' },
    { id: 'sol', name: 'Sol Ring' },
  ];

  test('forgives OCR noise', () => {
    const hits = matchScannedTitle('Lightnmg Bolt', names);
    expect(hits[0]?.name).toBe('Lightning Bolt');
  });

  test('returns nothing for garbage or tiny fragments', () => {
    expect(matchScannedTitle('~~\\//~~', names)).toEqual([]);
    expect(matchScannedTitle('Li', names)).toEqual([]);
  });
});
