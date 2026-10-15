import { describe, expect, test } from 'vitest';
import { isLandLine, shuffledDeck } from './sample';
import type { Deck, DeckCard } from './types';

const card = (name: string, typeLine: string, count = 1): DeckCard => ({
  cardId: name,
  name,
  typeLine,
  manaCost: '',
  imageNormal: null,
  count,
});

const deck: Deck = {
  id: 'd',
  name: 'Stompy',
  commander: card('Ashaya, Soul of the Wild', 'Legendary Creature — Elemental'),
  colors: ['G'],
  cards: [card('Forest', 'Basic Land — Forest', 30), card('Llanowar Elves', 'Creature — Elf Druid'), card('Cultivate', 'Sorcery', 2)],
  updatedAt: 1,
};

describe('shuffledDeck', () => {
  test('every copy once, the commander left out', () => {
    const lib = shuffledDeck(deck);
    expect(lib).toHaveLength(33);
    expect(lib.filter((c) => c.name === 'Forest')).toHaveLength(30);
    expect(lib.filter((c) => c.name === 'Cultivate')).toHaveLength(2);
    expect(lib.some((c) => c.name.startsWith('Ashaya'))).toBe(false);
  });

  test('the order comes from the random source', () => {
    let n = 0;
    const seq = () => [0.9, 0.1, 0.5, 0.3][n++ % 4];
    const a = shuffledDeck(deck, seq).map((c) => c.name);
    n = 0;
    const b = shuffledDeck(deck, seq).map((c) => c.name);
    expect(a).toEqual(b);
  });
});

describe('isLandLine', () => {
  test('reads the front face', () => {
    expect(isLandLine('Basic Land — Forest')).toBe(true);
    expect(isLandLine('Artifact Land')).toBe(true);
    expect(isLandLine('Sorcery // Land')).toBe(false);
    expect(isLandLine('Land // Land')).toBe(true);
    expect(isLandLine('Creature — Elf')).toBe(false);
  });
});
