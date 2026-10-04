import { describe, expect, test } from 'vitest';
import type { CardRecord } from './types';
import { cardThemes, synergyScore } from './themes';

function card(name: string, typeLine: string, oracleText: string): CardRecord {
  return {
    id: name,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const treasureCommander = card(
  'Magda, Brazen Outlaw',
  'Legendary Creature — Dwarf Berserker',
  'Whenever a Dwarf you control becomes tapped, create a Treasure token. Sacrifice five Treasures: Search your library for an artifact or Dragon card.',
);

describe('cardThemes', () => {
  test('reads mechanics out of rules text', () => {
    const themes = cardThemes(treasureCommander);
    expect(themes).toContain('treasure');
    expect(themes).toContain('tokens');
    expect(themes).toContain('sacrifice');
    expect(themes).toContain('artifacts');
  });

  test('reads tribes out of the type line', () => {
    expect(cardThemes(treasureCommander)).toContain('tribal:Dwarf');
  });

  test('a vanilla creature has no themes', () => {
    expect(cardThemes(card('Grizzly Bears', 'Creature — Bear', ''))).toEqual([]);
  });
});

describe('synergyScore', () => {
  const themes = cardThemes(treasureCommander);

  test('cards sharing themes score higher', () => {
    const payoff = card(
      'Revel in Riches',
      'Enchantment',
      'Whenever a creature an opponent controls dies, create a Treasure token. At the beginning of your upkeep, if you control ten or more Treasures, you win the game.',
    );
    const unrelated = card('Counterspell', 'Instant', 'Counter target spell.');
    expect(synergyScore(themes, payoff)).toBeGreaterThan(synergyScore(themes, unrelated));
    expect(synergyScore(themes, unrelated)).toBe(0);
  });

  test('tribe matches in the type line score', () => {
    const dwarf = card('Dwarven Mine', 'Land — Mountain', '');
    const dwarfCreature = card('Hammerhand Dwarf', 'Creature — Dwarf', '');
    expect(synergyScore(themes, dwarfCreature)).toBeGreaterThan(0);
    expect(synergyScore(themes, dwarf)).toBe(0);
  });
});
