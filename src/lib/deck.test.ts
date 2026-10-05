import { describe, expect, test } from 'vitest';
import type { CardRecord } from './types';
import {
  addCard,
  changeCardCount,
  createDeck,
  deckSize,
  groupCards,
  manaCurve,
  manaValue,
  setCommander,
} from './deck';

function card(name: string, typeLine: string, manaCost = '{1}'): CardRecord {
  return {
    id: `id-${name}`,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText: '',
    manaCost,
    power: null,
    toughness: null,
    colors: [],
    colorIdentity: ['G'],
    imageNormal: `https://img.example/${name}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

describe('deck building', () => {
  test('adding a card twice stacks its count', () => {
    let deck = createDeck('Stompy');
    deck = addCard(deck, card('Forest', 'Basic Land — Forest'));
    deck = addCard(deck, card('Forest', 'Basic Land — Forest'));
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].count).toBe(2);
  });

  test('count changes clamp at zero and drop the card', () => {
    let deck = createDeck('Stompy');
    deck = addCard(deck, card('Llanowar Elves', 'Creature — Elf Druid'));
    deck = changeCardCount(deck, 'id-Llanowar Elves', -1);
    expect(deck.cards).toHaveLength(0);
  });

  test('deck size counts copies plus the commander', () => {
    let deck = createDeck('Stompy');
    deck = setCommander(deck, card('Ashaya, Soul of the Wild', 'Legendary Creature — Elemental'));
    deck = addCard(deck, card('Forest', 'Basic Land — Forest'));
    deck = changeCardCount(deck, 'id-Forest', 4);
    expect(deckSize(deck)).toBe(6);
  });

  test('the commander sets the deck colors from identity', () => {
    let deck = createDeck('Stompy');
    deck = setCommander(deck, card('Ashaya, Soul of the Wild', 'Legendary Creature — Elemental'));
    expect(deck.colors).toEqual(['G']);
    expect(deck.commander?.name).toBe('Ashaya, Soul of the Wild');
  });
});

describe('groupCards', () => {
  test('buckets by type with creatures first and lands last', () => {
    let deck = createDeck('Mixed');
    deck = addCard(deck, card('Forest', 'Basic Land — Forest'));
    deck = addCard(deck, card('Llanowar Elves', 'Creature — Elf Druid'));
    deck = addCard(deck, card('Cultivate', 'Sorcery'));
    const groups = groupCards(deck.cards);
    expect(groups.map((g) => g.label)).toEqual(['Creatures', 'Sorceries', 'Lands']);
  });

  test('artifact creatures are creatures; artifact lands are lands', () => {
    const groups = groupCards([
      addCard(createDeck('x'), card('Ornithopter', 'Artifact Creature — Thopter')).cards[0],
      addCard(createDeck('x'), card('Darksteel Citadel', 'Artifact Land')).cards[0],
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Creatures', 'Lands']);
  });
});

describe('mana math', () => {
  test('manaValue sums generic and colored symbols', () => {
    expect(manaValue('{2}{G}{G}')).toBe(4);
    expect(manaValue('{G/W}{G/W}')).toBe(2);
    expect(manaValue('{X}{R}')).toBe(1);
    expect(manaValue('')).toBe(0);
  });

  test('manaCurve buckets nonland cards by mana value, weighted by count', () => {
    let deck = createDeck('Curve');
    deck = addCard(deck, card('Llanowar Elves', 'Creature — Elf Druid', '{G}'));
    deck = addCard(deck, card('Llanowar Elves', 'Creature — Elf Druid', '{G}'));
    deck = addCard(deck, card('Craterhoof Behemoth', 'Creature — Beast', '{5}{G}{G}{G}'));
    deck = addCard(deck, card('Forest', 'Basic Land — Forest', ''));
    const curve = manaCurve(deck.cards);
    expect(curve[1]).toBe(2);
    expect(curve[7]).toBe(1); // 8-drop lands in the 7+ bucket
    expect(curve.reduce((a, b) => a + b, 0)).toBe(3);
  });
});
