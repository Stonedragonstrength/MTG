import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { backId, turnsOver } from '../lib/faces';
import type { CardRecord } from '../lib/types';
import { getDb } from './db';
import { getCardById, slimCard } from './scryfall';

const img = (name: string) => ({
  normal: `https://cards.scryfall.io/normal/${name}.jpg`,
  art_crop: `https://cards.scryfall.io/art_crop/${name}.jpg`,
});

/** Delver the way Scryfall sends a transforming card. */
const delverRaw = (id: string) => ({
  id,
  name: 'Delver of Secrets // Insectile Aberration',
  layout: 'transform',
  type_line: 'Creature — Human Wizard // Creature — Human Insect',
  card_faces: [
    {
      name: 'Delver of Secrets',
      type_line: 'Creature — Human Wizard',
      oracle_text: 'At the beginning of your upkeep, look at the top card of your library.',
      mana_cost: '{U}',
      power: '1',
      toughness: '1',
      colors: ['U'],
      image_uris: img('delver'),
    },
    {
      name: 'Insectile Aberration',
      type_line: 'Creature — Human Insect',
      oracle_text: 'Flying',
      mana_cost: '',
      power: '3',
      toughness: '2',
      colors: ['U'],
      image_uris: img('aberration'),
    },
  ],
});

const flipRaw = {
  id: 'flip-1',
  name: 'Akki Lavarunner // Tok-Tok, Volcano Born',
  layout: 'flip',
  type_line: 'Creature — Goblin Warrior // Legendary Creature — Goblin Shaman',
  mana_cost: '{3}{R}',
  colors: ['R'],
  image_uris: img('akki'),
  card_faces: [
    { name: 'Akki Lavarunner', type_line: 'Creature — Goblin Warrior', oracle_text: 'Haste', power: '1', toughness: '1' },
    {
      name: 'Tok-Tok, Volcano Born',
      type_line: 'Legendary Creature — Goblin Shaman',
      oracle_text: 'Protection from red',
      power: '2',
      toughness: '2',
    },
  ],
};

const splitRaw = {
  id: 'split-1',
  name: 'Fire // Ice',
  layout: 'split',
  type_line: 'Instant // Instant',
  mana_cost: '{1}{R} // {1}{U}',
  colors: ['R', 'U'],
  image_uris: img('fire-ice'),
  card_faces: [
    { name: 'Fire', type_line: 'Instant', oracle_text: 'Fire deals 2 damage.', mana_cost: '{1}{R}' },
    { name: 'Ice', type_line: 'Instant', oracle_text: 'Tap target permanent.', mana_cost: '{1}{U}' },
  ],
};

const bearsRaw = {
  id: 'bears-1',
  name: 'Grizzly Bears',
  layout: 'normal',
  type_line: 'Creature — Bear',
  oracle_text: '',
  image_uris: img('bears'),
};

describe('slimCard keeps the other face', () => {
  test('of a transforming card: name, type, text, size, color and both pictures', () => {
    const card = slimCard(delverRaw('dfc-1'))!;
    expect(card.back).toEqual({
      name: 'Insectile Aberration',
      typeLine: 'Creature — Human Insect',
      oracleText: 'Flying',
      manaCost: '',
      power: '3',
      toughness: '2',
      colors: ['U'],
      imageNormal: 'https://cards.scryfall.io/normal/aberration.jpg',
      imageArtCrop: 'https://cards.scryfall.io/art_crop/aberration.jpg',
    });
    // The front is read as it always was.
    expect(card.imageNormal).toBe('https://cards.scryfall.io/normal/delver.jpg');
    expect(card.power).toBe('1');
    expect(turnsOver(card)).toBe(true);
  });

  test.each(['modal_dfc', 'double_faced_token'])('of a %s card too', (layout) => {
    expect(slimCard({ ...delverRaw('x'), layout })!.back?.name).toBe('Insectile Aberration');
  });

  test('a flip card has one picture and one color for both faces', () => {
    const card = slimCard(flipRaw)!;
    expect(card.back).toMatchObject({
      name: 'Tok-Tok, Volcano Born',
      typeLine: 'Legendary Creature — Goblin Shaman',
      power: '2',
      colors: ['R'],
      imageNormal: null,
      imageArtCrop: null,
    });
  });

  test('a split card is marked as having none; a single-faced card says nothing at all', () => {
    const split = slimCard(splitRaw)!;
    expect(split.back).toBeNull();
    expect(turnsOver(split)).toBe(false);
    expect('back' in slimCard(bearsRaw)!).toBe(false);
  });
});

/** A record as a download made before faces were kept left it. */
function oldRecord(id: string): CardRecord {
  const { back: _b, ...old } = slimCard(delverRaw(id))!;
  return old;
}

describe('getCardById reads a back id as the back face', () => {
  const fetchMock = vi.fn();

  beforeEach(async () => {
    await getDb().cards.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a card stored with its back: that face, under the back id, and no network', async () => {
    await getDb().cards.put(slimCard(delverRaw('dfc-1'))!);
    const view = await getCardById(backId('dfc-1'));
    expect(view).toMatchObject({
      id: backId('dfc-1'),
      name: 'Delver of Secrets // Insectile Aberration',
      typeLine: 'Creature — Human Insect',
      oracleText: 'Flying',
      power: '3',
      toughness: '2',
      imageNormal: 'https://cards.scryfall.io/normal/aberration.jpg',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // The front id still reads the card as it is stored.
    expect((await getCardById('dfc-1'))?.typeLine).toBe('Creature — Human Wizard // Creature — Human Insect');
  });

  test('an id nobody stored finds nothing, front or back', async () => {
    expect(await getCardById(backId('nobody'))).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an old record is read from Scryfall once and stored: the back picture and size are there for good', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await getDb().cards.put(oldRecord(id));
    fetchMock.mockResolvedValue(new Response(JSON.stringify(delverRaw(id)), { status: 200 }));

    const view = await getCardById(backId(id));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`https://api.scryfall.com/cards/${id}`);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Accept: 'application/json' });
    expect(view).toMatchObject({ power: '3', toughness: '2', imageNormal: 'https://cards.scryfall.io/normal/aberration.jpg' });
    expect((await getDb().cards.get(id))?.back?.name).toBe('Insectile Aberration');

    await getCardById(backId(id));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('when Scryfall cannot be reached, the old record answers: second halves, front picture, no size', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    await getDb().cards.put(oldRecord(id));
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const view = await getCardById(backId(id));
    expect(view).toMatchObject({
      id: backId(id),
      typeLine: 'Creature — Human Insect',
      oracleText: 'Flying',
      power: null,
      toughness: null,
      imageNormal: 'https://cards.scryfall.io/normal/delver.jpg',
    });
    expect((await getDb().cards.get(id))?.back).toBeUndefined();
    // One try a session: the next read does not ask again.
    await getCardById(backId(id));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a bad answer is as good as none', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    await getDb().cards.put(oldRecord(id));
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));
    expect((await getCardById(backId(id)))?.power).toBeNull();
    expect((await getDb().cards.get(id))?.back).toBeUndefined();
  });

  test('offline, nothing is asked', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    await getDb().cards.put(oldRecord(id));
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      expect((await getCardById(backId(id)))?.typeLine).toBe('Creature — Human Insect');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      onLine.mockRestore();
    }
  });

  test('an id that is not Scryfall’s is never asked for (and so no test reaches the network)', async () => {
    await getDb().cards.put(oldRecord('c-delver'));
    expect((await getCardById(backId('c-delver')))?.typeLine).toBe('Creature — Human Insect');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
