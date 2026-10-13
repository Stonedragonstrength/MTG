import { describe, expect, it } from 'vitest';
import { bestToken, tokensMadeBy } from './deckTokens';
import type { CardRecord } from './types';

describe('tokensMadeBy', () => {
  it('reads the token a card creates, with its size and color', () => {
    expect(tokensMadeBy(['Create two 1/1 white Soldier creature tokens.'])).toEqual([
      { name: 'Soldier', power: '1', toughness: '1', colors: ['W'] },
    ]);
    expect(
      tokensMadeBy(['When this dies, create a 2/2 black Zombie creature token.']),
    ).toEqual([{ name: 'Zombie', power: '2', toughness: '2', colors: ['B'] }]);
  });

  it('reads tokens that have no size', () => {
    expect(tokensMadeBy(['Create a Treasure token.'])).toEqual([{ name: 'Treasure' }]);
    expect(tokensMadeBy(['{T}: You create a tapped Powerstone token.'])).toEqual([{ name: 'Powerstone' }]);
    expect(tokensMadeBy(['Whenever you gain life, create X Food tokens.'])).toEqual([{ name: 'Food' }]);
  });

  it('copes with two-word names, two colors, artifact creatures and counts in words', () => {
    expect(
      tokensMadeBy(['Create X 1/1 green and white Elf Warrior creature tokens.']),
    ).toEqual([{ name: 'Elf Warrior', power: '1', toughness: '1', colors: ['G', 'W'] }]);
    expect(
      tokensMadeBy(['create two 1/1 colorless Thopter artifact creature tokens with flying']),
    ).toEqual([{ name: 'Thopter', power: '1', toughness: '1', colors: [] }]);
    expect(
      tokensMadeBy(['create a number of 1/1 red Goblin creature tokens equal to …']),
    ).toEqual([{ name: 'Goblin', power: '1', toughness: '1', colors: ['R'] }]);
  });

  it('lists each token once across the whole deck, in the order met', () => {
    expect(
      tokensMadeBy([
        'Create a Treasure token.',
        'Create two 1/1 white Soldier creature tokens.',
        'Whenever … create a Treasure token.',
        'Create a 1/1 white Soldier creature token.',
        'Create a 2/2 white Soldier creature token.',
      ]).map((t) => `${t.name} ${t.power ?? '-'}`),
    ).toEqual(['Treasure -', 'Soldier 1', 'Soldier 2']);
  });

  it('investigate makes a Clue', () => {
    expect(tokensMadeBy(['When this enters, investigate.'])).toEqual([{ name: 'Clue' }]);
  });

  it('leaves out what the text does not name', () => {
    expect(tokensMadeBy(["Create a token that's a copy of target creature."])).toEqual([]);
    expect(tokensMadeBy(['Create a colorless artifact token named Etherium Cell.'])).toEqual([]);
    expect(tokensMadeBy(['Destroy target token.', 'Flying'])).toEqual([]);
  });
});

function token(id: string, name: string, over: Partial<CardRecord> = {}): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine: `Token Creature — ${name}`,
    oracleText: '',
    manaCost: '',
    power: '1',
    toughness: '1',
    colors: ['W'],
    imageNormal: 'x.jpg',
    imageArtCrop: null,
    isToken: true,
    isBasicLand: false,
    ...over,
  };
}

describe('bestToken', () => {
  const soldiers = [
    token('s-rw', 'Soldier', { colors: ['R', 'W'] }),
    token('s-22', 'Soldier', { power: '2', toughness: '2' }),
    token('s-11', 'Soldier'),
    token('card', 'Soldier', { isToken: false }),
  ];

  it('picks the printing whose size and colors match', () => {
    expect(bestToken({ name: 'Soldier', power: '1', toughness: '1', colors: ['W'] }, soldiers)?.id).toBe('s-11');
    expect(bestToken({ name: 'Soldier', power: '2', toughness: '2', colors: ['W'] }, soldiers)?.id).toBe('s-22');
    expect(bestToken({ name: 'Soldier', power: '1', toughness: '1', colors: ['R', 'W'] }, soldiers)?.id).toBe('s-rw');
  });

  it('never hands back a card that is no token, or one of another name', () => {
    expect(bestToken({ name: 'Soldier' }, [token('card', 'Soldier', { isToken: false })])).toBeUndefined();
    expect(bestToken({ name: 'Zombie' }, soldiers)).toBeUndefined();
  });

  it('prefers a token with a picture when nothing else tells them apart', () => {
    const treasures = [
      token('t-none', 'Treasure', { imageNormal: null, power: null, toughness: null, colors: [] }),
      token('t-pic', 'Treasure', { power: null, toughness: null, colors: [] }),
    ];
    expect(bestToken({ name: 'Treasure' }, treasures)?.id).toBe('t-pic');
  });
});
