import { describe, expect, test } from 'vitest';
import type { CardRecord } from './types';
import { cardThemes, deckThemeProfile, profileScore, synergyScore } from './themes';

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

describe('deckThemeProfile', () => {
  test('tallies themes across the deck weighted by copy count', () => {
    const profile = deckThemeProfile([
      { card: card('Dwarf A', 'Creature — Dwarf', 'Whenever a Dwarf you control attacks, it gets +1/+0.'), count: 3 },
      { card: card('Revel', 'Enchantment', 'create a Treasure token.'), count: 1 },
      { card: card('Bears', 'Creature — Bear', ''), count: 4 },
    ]);
    expect(profile['tribal:Dwarf']).toBe(3);
    expect(profile['treasure']).toBe(1);
    expect(profile['tokens']).toBe(1);
    expect(Object.keys(profile)).not.toContain('tribal:Bear');
  });
});

describe('profileScore', () => {
  test('weights matches by how much the deck cares, tribes double', () => {
    const profile = { 'tribal:Dwarf': 5, treasure: 2 };
    const magda = treasureCommander; // dwarf tribal + treasure text
    const generic = card('Gilded Lotus', 'Artifact', '{T}: Add three mana of any one color.');
    const magdaScore = profileScore(profile, magda);
    expect(magdaScore.score).toBe(5 * 2 + 2); // tribe doubled + treasure
    expect(magdaScore.shared).toContain('tribal:Dwarf');
    expect(profileScore(profile, generic).score).toBe(0);
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
