import { describe, expect, test } from 'vitest';
import { anthemsOf, fits, sizeAround } from './anthems';
import { createGame } from './game';
import type { BoardItem, CardInstance, CardRecord, GameState } from './types';

const pick = (text: string) =>
  anthemsOf(text).map((a) => ({
    pt: `${a.power}/${a.toughness}`,
    whose: a.whose,
    other: a.other,
    types: a.types,
    colors: a.colors,
    token: a.token,
  }));

describe('anthemsOf', () => {
  test('Glorious Anthem: every creature its controller has', () => {
    expect(pick('Creatures you control get +1/+1.')).toEqual([
      { pt: '1/1', whose: 'you', other: false, types: [], colors: [], token: null },
    ]);
  });

  test('a lord: other creatures of its type, its mana ability left alone', () => {
    expect(pick('Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.')).toEqual([
      { pt: '1/1', whose: 'you', other: true, types: [['elf']], colors: [], token: null },
    ]);
    expect(pick('Other Elves you control get +1/+1.')[0].types).toEqual([['elf']]);
  });

  test('an old lord: everyone’s creatures of that type, the keyword behind it not in the way', () => {
    expect(pick('Other Merfolk get +1/+1 and have islandwalk.')).toEqual([
      { pt: '1/1', whose: 'all', other: true, types: [['merfolk']], colors: [], token: null },
    ]);
  });

  test('Elesh Norn: hers bigger, everyone else’s smaller', () => {
    expect(pick('Vigilance\nOther creatures you control get +2/+2.\nCreatures your opponents control get -2/-2.')).toEqual([
      { pt: '2/2', whose: 'you', other: true, types: [], colors: [], token: null },
      { pt: '-2/-2', whose: 'opponents', other: false, types: [], colors: [], token: null },
    ]);
  });

  test('colors, tokens, two types at once, and a list of types', () => {
    expect(pick('White creatures get +1/+1.')[0]).toMatchObject({ whose: 'all', colors: ['W'] });
    expect(pick('Creature tokens you control get +1/+1 and have vigilance.')[0]).toMatchObject({ token: true });
    expect(pick('Eldrazi Spawn creatures you control get +2/+1.')[0].types).toEqual([['eldrazi', 'spawn']]);
    expect(pick('Other Demons, Devils, Imps, and Tieflings you control get +1/+1.')[0].types).toEqual([
      ['demon'],
      ['devil'],
      ['imp'],
      ['tiefling'],
    ]);
  });

  test('nothing that does not stand on its own is read', () => {
    for (const text of [
      'Creatures you control get +1/+1 until end of turn.',
      'As long as you control six or more lands, creatures you control get +2/+2.',
      'Creatures you control of the chosen type get +1/+1.',
      '{2}{W}: Creatures you control get +1/+1 until end of turn.',
      'Attacking creatures you control get +1/+0.',
      '−7: You get an emblem with "Creatures you control get +2/+2 and have flying."',
      'Creatures you control get +1/+1 for each valor counter on this creature.',
      'During your turn, creatures you control get +1/+0 and have trample.',
      'Fateful hour — As long as you have 5 or less life, other creatures you control get +1/+4.',
      'Equipped creature gets +2/+2.',
      'This creature gets +1/+1.',
    ])
      expect(anthemsOf(text)).toEqual([]);
  });
});

describe('fits', () => {
  const [lord] = anthemsOf('Other Elf creatures you control get +1/+1.');
  const elf = { typeLine: 'Creature — Elf Druid', colors: ['G'], token: false, text: '' };
  test('its type, or any type for a changeling', () => {
    expect(fits(lord, elf)).toBe(true);
    expect(fits(lord, { ...elf, typeLine: 'Creature — Bear' })).toBe(false);
    expect(fits(lord, { ...elf, typeLine: 'Creature — Shapeshifter', text: 'Changeling (This card is every creature type.)' })).toBe(true);
    expect(fits(lord, { ...elf, typeLine: 'Enchantment — Aura' })).toBe(false);
  });

  test('colors, legendary and flying are asked of the creature', () => {
    expect(fits(anthemsOf('White creatures get +1/+1.')[0], elf)).toBe(false);
    expect(fits(anthemsOf('Other legendary creatures you control get +2/+2.')[0], elf)).toBe(false);
    expect(fits(anthemsOf('Creatures with flying get +1/+0.')[0], { ...elf, text: 'Flying' })).toBe(true);
  });
});

// ---- on the table ----

const rec = (id: string, name: string, typeLine: string, oracleText = '', colors: string[] = []): CardRecord => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  typeLine,
  oracleText,
  manaCost: '',
  power: '2',
  toughness: '2',
  colors,
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
});

const RECORDS: Record<string, CardRecord> = {
  anthem: rec('anthem', 'Glorious Anthem', 'Enchantment', 'Creatures you control get +1/+1.', ['W']),
  norn: rec('norn', 'Elesh Norn, Grand Cenobite', 'Legendary Creature — Phyrexian Praetor', 'Vigilance\nOther creatures you control get +2/+2.\nCreatures your opponents control get -2/-2.', ['W']),
  druid: rec('druid', 'Elvish Archdruid', 'Creature — Elf Druid', 'Other Elf creatures you control get +1/+1.', ['G']),
  bears: rec('bears', 'Grizzly Bears', 'Creature — Bear', '', ['G']),
};

const card = (iid: string, cardId: string): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name });
const elves: BoardItem = {
  id: 'tok',
  cardId: null,
  name: 'Elf Warrior',
  imageNormal: null,
  imageArtCrop: null,
  typeLine: 'Token Creature — Elf Warrior',
  oracleText: '',
  basePower: 1,
  baseToughness: 1,
  count: 3,
  counters: {},
  color: 'G',
  zone: 'board',
};

function table(): GameState {
  const g = createGame({
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    profiles: [
      { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
    ],
  });
  const seat = (battlefield: CardInstance[]) => ({
    library: [],
    hand: [],
    battlefield,
    graveyard: [],
    exile: [],
    command: [],
    mulligans: 0,
    deckName: 'D',
  });
  g.players[0] = { ...g.players[0], board: [elves], cards: seat([card('a', 'anthem'), card('d', 'druid'), card('b0', 'bears')]) };
  g.players[1] = { ...g.players[1], cards: seat([card('n', 'norn'), card('b1', 'bears')]) };
  return g;
}

describe('sizeAround', () => {
  test('every anthem on the table, from every seat, that the creature fits', () => {
    const g = table();
    // Glorious Anthem +1/+1, Elesh Norn's -2/-2 from across the table.
    expect(sizeAround(g, { seat: 0, kind: 'card', id: 'b0' }, RECORDS)).toEqual({ power: -1, toughness: -1 });
    // Norn's +2/+2 for the other creatures of her controller.
    expect(sizeAround(g, { seat: 1, kind: 'card', id: 'b1' }, RECORDS)).toEqual({ power: 2, toughness: 2 });
    // "Other": Norn does not pump herself.
    expect(sizeAround(g, { seat: 1, kind: 'card', id: 'n' }, RECORDS)).toEqual({ power: 0, toughness: 0 });
  });

  test('a lord is left out of its own bonus; a token stack of its type gets it on every copy', () => {
    const g = table();
    // The Archdruid: Glorious Anthem +1, its own lord line not, Norn -2.
    expect(sizeAround(g, { seat: 0, kind: 'card', id: 'd' }, RECORDS)).toEqual({ power: -1, toughness: -1 });
    // Elf Warrior tokens: Anthem +1, Archdruid +1, Norn -2.
    expect(sizeAround(g, { seat: 0, kind: 'stack', id: 'tok' }, RECORDS)).toEqual({ power: 0, toughness: 0 });
  });

  test('an anthem not read on this device adds nothing', () => {
    const g = table();
    expect(sizeAround(g, { seat: 1, kind: 'card', id: 'b1' }, { bears: RECORDS.bears })).toEqual({ power: 0, toughness: 0 });
  });
});
