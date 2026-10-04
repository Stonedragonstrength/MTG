import { beforeEach, describe, expect, test } from 'vitest';
import type { CardRecord } from '../lib/types';
import { getDb } from './db';
import { findSynergiesFor } from './synergy';

function card(id: string, name: string, typeLine: string, oracleText: string): CardRecord {
  return {
    id,
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

beforeEach(async () => {
  const db = getDb();
  await db.cards.clear();
  await db.cards.bulkPut([
    card(
      'magda',
      'Magda, Brazen Outlaw',
      'Legendary Creature — Dwarf Berserker',
      'Whenever a Dwarf you control becomes tapped, create a Treasure token.',
    ),
    card(
      'revel',
      'Revel in Riches',
      'Enchantment',
      'Whenever a creature an opponent controls dies, create a Treasure token.',
    ),
    card('dwarf', 'Hammerhand Dwarf', 'Creature — Dwarf', ''),
    card('counter', 'Counterspell', 'Instant', 'Counter target spell.'),
    card('forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  ]);
});

describe('findSynergiesFor', () => {
  test('returns theme-sharing cards ranked, excluding the card itself and chaff', async () => {
    const results = await findSynergiesFor('magda', 10);
    const names = results.map((r) => r.card.name);
    expect(names).toContain('Revel in Riches');
    expect(names).toContain('Hammerhand Dwarf');
    expect(names).not.toContain('Counterspell');
    expect(names).not.toContain('Forest');
    expect(names).not.toContain('Magda, Brazen Outlaw');
    expect(results[0].shared.length).toBeGreaterThan(0);
  });

  test('unknown card yields no results', async () => {
    expect(await findSynergiesFor('nope', 10)).toEqual([]);
  });
});
