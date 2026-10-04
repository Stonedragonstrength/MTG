import { beforeEach, describe, expect, test } from 'vitest';
import type { CardRecord } from '../lib/types';
import { getDb, kvGet } from './db';
import { pickLandArtPack } from './images';

function basic(id: string, type: string, art: string | null): CardRecord {
  return {
    id,
    name: type,
    nameLower: type.toLowerCase(),
    typeLine: `Basic Land — ${type}`,
    oracleText: '',
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: `https://cards.scryfall.io/normal/${id}.jpg`,
    imageArtCrop: art,
    isToken: false,
    isBasicLand: true,
  };
}

beforeEach(async () => {
  const db = getDb();
  await db.cards.clear();
  await db.kv.clear();
});

describe('pickLandArtPack', () => {
  test('returns up to 10 art crops per land type and persists the pack', async () => {
    const db = getDb();
    const seed: CardRecord[] = [];
    for (let i = 0; i < 14; i++) {
      seed.push(basic(`plains-${i}`, 'Plains', `https://cards.scryfall.io/art_crop/plains-${i}.jpg`));
    }
    seed.push(basic('island-0', 'Island', 'https://cards.scryfall.io/art_crop/island-0.jpg'));
    seed.push(basic('island-noart', 'Island', null));
    seed.push({ ...basic('bear', 'Plains', 'x'), typeLine: 'Creature — Bear', isBasicLand: false });
    await db.cards.bulkPut(seed);

    const pack = await pickLandArtPack();
    expect(pack.plains).toHaveLength(10);
    expect(pack.island).toEqual(['https://cards.scryfall.io/art_crop/island-0.jpg']);
    expect(pack.swamp).toEqual([]);
    for (const url of pack.plains) expect(url).toContain('art_crop');

    expect(await kvGet('landArtPack')).toEqual(pack);
  });
});
