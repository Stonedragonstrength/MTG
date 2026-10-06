import { beforeEach, describe, expect, test } from 'vitest';
import type { CardRecord } from '../lib/types';
import { getDb } from './db';
import { findCommandersFor, findPartnersFor, findSynergiesFor } from './synergy';

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

describe('findCommandersFor', () => {
  beforeEach(async () => {
    const db = getDb();
    await db.cards.bulkPut([
      {
        ...card(
          'magda',
          'Magda, Brazen Outlaw',
          'Legendary Creature — Dwarf Berserker',
          'Whenever a Dwarf you control becomes tapped, create a Treasure token.',
        ),
        colorIdentity: ['R'],
      },
      { ...card('depala', 'Depala, Pilot Exemplar', 'Legendary Creature — Dwarf Pilot', 'Other Dwarves you control get +1/+1.'), colorIdentity: ['R', 'W'] },
      { ...card('offcolor', 'Sygg, River Guide', 'Legendary Creature — Merfolk Wizard', 'Dwarf Dwarf Dwarf you control.'), colorIdentity: ['W', 'U'] },
      { ...card('notlegend', 'Dwarf Fan', 'Creature — Human', 'Dwarves you control get +2/+0.'), colorIdentity: ['R'] },
    ]);
  });

  test('ranks color-feasible commanders by profile overlap', async () => {
    const hits = await findCommandersFor({ 'tribal:Dwarf': 6, treasure: 2 }, ['R'], 5);
    const names = hits.map((h) => h.card.name);
    expect(names[0]).toBe('Magda, Brazen Outlaw'); // R ⊆ R, dwarf+treasure
    expect(names).toContain('Depala, Pilot Exemplar'); // R ⊆ RW
    expect(names).not.toContain('Sygg, River Guide'); // R ⊄ WU
    expect(names).not.toContain('Dwarf Fan'); // not commander-legal
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].shared).toContain('tribal:Dwarf');
  });

  test('an empty profile matches nothing', async () => {
    expect(await findCommandersFor({}, [], 5)).toEqual([]);
  });
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

describe('findPartnersFor', () => {
  const partnerText = 'Partner (You can have two commanders if both have partner.)';

  test('lists every legal second commander, by name, never tokens or the card itself', async () => {
    const thrasios = card('thrasios', 'Thrasios, Triton Hero', 'Legendary Creature — Merfolk', partnerText);
    await getDb().cards.bulkPut([
      thrasios,
      card('tymna', 'Tymna the Weaver', 'Legendary Creature — Human', partnerText),
      card('akiri', 'Akiri, Line-Slinger', 'Legendary Creature — Kor', partnerText),
      { ...card('tok', 'Partner Token', 'Token Legendary Creature', partnerText), isToken: true },
    ]);
    const found = await findPartnersFor(thrasios);
    expect(found.map((c) => c.name)).toEqual(['Akiri, Line-Slinger', 'Tymna the Weaver']);
  });

  test('a commander with no partner ability finds nobody', async () => {
    const magda = (await getDb().cards.get('magda'))!;
    expect(await findPartnersFor(magda)).toEqual([]);
  });
});
