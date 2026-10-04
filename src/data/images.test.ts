import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardRecord } from '../lib/types';
import { getDb, kvGet } from './db';
import { pickLandArtPack, precacheUrls } from './images';

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
  test('gathers basics per type plus multicolor and special lands', async () => {
    const db = getDb();
    const seed: CardRecord[] = [];
    for (let i = 0; i < 45; i++) {
      seed.push(basic(`plains-${i}`, 'Plains', `https://cards.scryfall.io/art_crop/plains-${i}.jpg`));
    }
    seed.push(basic('island-0', 'Island', 'https://cards.scryfall.io/art_crop/island-0.jpg'));
    seed.push(basic('island-noart', 'Island', null));
    seed.push({ ...basic('bear', 'Plains', 'x'), typeLine: 'Creature — Bear', isBasicLand: false });
    seed.push({
      ...basic('shock', 'Temple Garden', 'https://cards.scryfall.io/art_crop/temple-garden.jpg'),
      typeLine: 'Land — Forest Plains',
      isBasicLand: false,
    });
    seed.push({
      ...basic('maze', 'Maze of Ith', 'https://cards.scryfall.io/art_crop/maze.jpg'),
      typeLine: 'Land',
      isBasicLand: false,
    });
    await db.cards.bulkPut(seed);

    const pack = await pickLandArtPack();
    expect(pack.plains).toHaveLength(40);
    expect(pack.island).toEqual(['https://cards.scryfall.io/art_crop/island-0.jpg']);
    expect(pack.swamp).toEqual([]);
    expect(pack.special).toContain('https://cards.scryfall.io/art_crop/temple-garden.jpg');
    expect(pack.special).toContain('https://cards.scryfall.io/art_crop/maze.jpg');
    expect(pack.special).not.toContain('x'); // creatures stay out
    for (const url of pack.plains) expect(url).toContain('art_crop');

    expect(await kvGet('landArtPack')).toEqual(pack);
  });
});

describe('precacheUrls', () => {
  test('stores into the same cache the service worker serves images from', async () => {
    const added: string[] = [];
    const opened: string[] = [];
    vi.stubGlobal('caches', {
      open: async (name: string) => {
        opened.push(name);
        return {
          match: async () => undefined,
          add: async (url: string) => {
            added.push(url);
          },
        };
      },
    });

    await precacheUrls(['https://cards.scryfall.io/art_crop/a.jpg']);

    expect(opened).toEqual(['scryfall-images']);
    expect(added).toEqual(['https://cards.scryfall.io/art_crop/a.jpg']);
    vi.unstubAllGlobals();
  });
});
