import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getDb } from './db';
import { getCardById, importBulkData, loadNameIndex, slimCard } from './scryfall';

const creatureRaw = {
  id: 'aaa-111',
  name: 'Grizzly Bears',
  layout: 'normal',
  type_line: 'Creature — Bear',
  oracle_text: '',
  mana_cost: '{1}{G}',
  power: '2',
  toughness: '2',
  colors: ['G'],
  image_uris: {
    normal: 'https://cards.scryfall.io/normal/bears.jpg',
    art_crop: 'https://cards.scryfall.io/art_crop/bears.jpg',
  },
};

const dfcRaw = {
  id: 'bbb-222',
  name: 'Delver of Secrets // Insectile Aberration',
  layout: 'transform',
  card_faces: [
    {
      name: 'Delver of Secrets',
      type_line: 'Creature — Human Wizard',
      oracle_text: 'At the beginning of your upkeep, look at the top card of your library.',
      mana_cost: '{U}',
      power: '1',
      toughness: '1',
      colors: ['U'],
      image_uris: {
        normal: 'https://cards.scryfall.io/normal/delver.jpg',
        art_crop: 'https://cards.scryfall.io/art_crop/delver.jpg',
      },
    },
    {
      name: 'Insectile Aberration',
      type_line: 'Creature — Human Insect',
      oracle_text: 'Flying',
      power: '3',
      toughness: '2',
    },
  ],
};

const artSeriesRaw = { id: 'ccc-333', name: 'Plains Art Card', layout: 'art_series' };

const tokenRaw = {
  id: 'ddd-444',
  name: 'Treasure',
  layout: 'token',
  type_line: 'Token Artifact — Treasure',
  oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
  image_uris: { normal: 'https://cards.scryfall.io/normal/treasure.jpg' },
};

const forestRaw = {
  id: 'eee-555',
  name: 'Forest',
  layout: 'normal',
  type_line: 'Basic Land — Forest',
  oracle_text: '({T}: Add {G}.)',
  image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/forest.jpg' },
};

describe('slimCard', () => {
  test('maps a normal creature', () => {
    const card = slimCard(creatureRaw)!;
    expect(card).toMatchObject({
      id: 'aaa-111',
      name: 'Grizzly Bears',
      nameLower: 'grizzly bears',
      typeLine: 'Creature — Bear',
      power: '2',
      toughness: '2',
      imageNormal: 'https://cards.scryfall.io/normal/bears.jpg',
      imageArtCrop: 'https://cards.scryfall.io/art_crop/bears.jpg',
      isToken: false,
      isBasicLand: false,
    });
  });

  test('double-faced card joins face texts and uses face-0 images', () => {
    const card = slimCard(dfcRaw)!;
    expect(card.oracleText).toContain('top card of your library');
    expect(card.oracleText).toContain('\n//\n');
    expect(card.oracleText).toContain('Flying');
    expect(card.imageNormal).toBe('https://cards.scryfall.io/normal/delver.jpg');
    expect(card.typeLine).toBe('Creature — Human Wizard');
    expect(card.power).toBe('1');
  });

  test('art_series entries are skipped', () => {
    expect(slimCard(artSeriesRaw)).toBeNull();
  });

  test('entries without a name are skipped', () => {
    expect(slimCard({ id: 'x', layout: 'normal' })).toBeNull();
  });

  test('token layout sets isToken', () => {
    expect(slimCard(tokenRaw)!.isToken).toBe(true);
  });

  test('basic land sets isBasicLand', () => {
    expect(slimCard(forestRaw)!.isBasicLand).toBe(true);
  });
});

describe('importBulkData', () => {
  beforeEach(async () => {
    const db = getDb();
    await db.cards.clear();
    await db.kv.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubScryfall(payload: unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('bulk-data')) {
          return new Response(
            JSON.stringify({
              data: [{ type: 'oracle_cards', download_uri: 'https://data.example/oracle.json' }],
            }),
          );
        }
        return new Response(JSON.stringify(payload));
      }),
    );
  }

  test('imports mapped cards, reports progress to 100, stamps kv', async () => {
    stubScryfall([creatureRaw, dfcRaw, artSeriesRaw, tokenRaw, forestRaw]);
    const progress: number[] = [];
    const count = await importBulkData((pct) => progress.push(pct));

    expect(count).toBe(4); // art_series skipped
    expect(await getDb().cards.count()).toBe(4);
    expect(progress[progress.length - 1]).toBe(100);
    expect(await getDb().kv.get('cardsImportedAt')).toBeDefined();
  });

  test('getCardById and loadNameIndex read back imported data', async () => {
    stubScryfall([creatureRaw, tokenRaw]);
    await importBulkData(() => {});

    const card = await getCardById('aaa-111');
    expect(card?.name).toBe('Grizzly Bears');

    const index = await loadNameIndex();
    expect(index).toHaveLength(2);
    expect(index.map((e) => e.name).sort()).toEqual(['Grizzly Bears', 'Treasure']);
  });

  test('a failed download throws with the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    await expect(importBulkData(() => {})).rejects.toThrow(/503/);
  });
});
