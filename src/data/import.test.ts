import { beforeEach, describe, expect, test } from 'vitest';
import type { CardRecord } from '../lib/types';
import { getDb, kvSet } from './db';
import { resolveDeckList } from './import';

function card(id: string, name: string, typeLine: string, extra: Partial<CardRecord> = {}): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText: '',
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    colorIdentity: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
    ...extra,
  };
}

beforeEach(async () => {
  const db = getDb();
  await db.cards.clear();
  const cards = [
    card('sol', 'Sol Ring', 'Artifact'),
    card('forest', 'Forest', 'Basic Land — Forest'),
    card('lathril', 'Lathril, Blade of the Elves', 'Legendary Creature — Elf Noble'),
    card('eltoken', 'Elemental', 'Token Creature — Elemental', { isToken: true }),
  ];
  await db.cards.bulkPut(cards);
  await kvSet('nameIndex', cards.map((c) => ({ id: c.id, name: c.name })));
});

describe('resolveDeckList', () => {
  test('resolves exact and fuzzy names with counts, reports misses', async () => {
    const result = await resolveDeckList('30 Forest\n1 Sol Rng\n1 Totally Fake Card');
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]).toMatchObject({ count: 30 });
    expect(result.hits[0].card.name).toBe('Forest');
    expect(result.hits[1].card.name).toBe('Sol Ring'); // fuzzy save
    expect(result.misses).toEqual(['1 Totally Fake Card']);
  });

  test('never resolves to a token', async () => {
    const result = await resolveDeckList('1 Elemental');
    expect(result.hits).toHaveLength(0);
    expect(result.misses).toEqual(['1 Elemental']);
  });

  test('carries the commander flag through', async () => {
    const result = await resolveDeckList('1 Lathril, Blade of the Elves *CMDR*\n30 Forest');
    expect(result.hits[0].commander).toBe(true);
    expect(result.hits[0].card.name).toBe('Lathril, Blade of the Elves');
    expect(result.hits[1].commander).toBe(false);
  });
});
