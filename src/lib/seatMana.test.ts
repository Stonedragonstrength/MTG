import { describe, expect, test } from 'vitest';
import type { CardRecords } from './combatEngine';
import { createGame } from './game';
import { availableMana } from './pay';
import { seatSources } from './seatMana';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState } from './types';

const rec = (id: string, name: string, typeLine: string, manaCost: string, oracleText: string, size: [string, string] | null = null): CardRecord => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  typeLine,
  oracleText,
  manaCost,
  power: size?.[0] ?? null,
  toughness: size?.[1] ?? null,
  colors: [],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: typeLine.startsWith('Basic'),
});

const RECORDS: CardRecords = {
  marwyn: rec(
    'marwyn',
    'Marwyn, the Nurturer',
    'Legendary Creature — Elf Druid',
    '{2}{G}',
    "Whenever another creature you control enters, put a +1/+1 counter on Marwyn.\n{T}: Add an amount of {G} equal to Marwyn's power.",
    ['1', '1'],
  ),
  anthem: rec('anthem', 'Glorious Anthem', 'Enchantment', '{1}{W}{W}', 'Creatures you control get +1/+1.'),
  selvala: rec(
    'selvala',
    'Selvala, Heart of the Wilds',
    'Legendary Creature — Elf Scout',
    '{1}{G}{G}',
    '{G}, {T}: Add X mana in any combination of colors, where X is the greatest power among creatures you control.',
    ['2', '3'],
  ),
  colossus: rec('colossus', 'Craterhoof Behemoth', 'Creature — Beast', '{5}{G}{G}{G}', 'Haste', ['5', '5']),
  priest: rec('priest', 'Priest of Titania', 'Creature — Elf Druid', '{1}{G}', '{T}: Add {G} for each Elf on the battlefield.', ['1', '1']),
  llanowar: rec('llanowar', 'Llanowar Elves', 'Creature — Elf Druid', '{G}', '{T}: Add {G}.', ['1', '1']),
  axebane: rec(
    'axebane',
    'Axebane Guardian',
    'Creature — Human Druid',
    '{2}{G}',
    'Defender\n{T}: Add X mana in any combination of colors, where X is the number of creatures you control with defender.',
    ['0', '3'],
  ),
  wall: rec('wall', 'Wall of Roots', 'Creature — Plant Wall', '{1}{G}', 'Defender', ['0', '5']),
  fanatic: rec(
    'fanatic',
    'Fanatic of Rhonas',
    'Creature — Snake Druid',
    '{3}{G}',
    '{T}: Add {G}.\nFerocious — {T}: Add {G}{G}{G}{G}. Activate only if you control a creature with power 4 or greater.',
    ['1', '4'],
  ),
};

function config(seats: number): GameConfig {
  return {
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    mode: 'cards',
    profiles: ['Nathan', 'Sam'].slice(0, seats).map((name, i) => ({ id: `p${i}`, name, avatarUrl: null, commanderName: null })),
  };
}

/** Two seats; each side's cards by instance id → record id (and what they wear). */
function table(mine: Record<string, string>, theirs: Record<string, string> = {}, wear: Record<string, Partial<CardInstance>> = {}, board: BoardItem[] = []): GameState {
  const base = createGame(config(2));
  const side = (cards: Record<string, string>): CardInstance[] =>
    Object.entries(cards).map(([iid, id]) => ({ iid, cardId: id, name: RECORDS[id]!.name, row: 'front' as const, ...wear[iid] }));
  return {
    ...base,
    players: base.players.map((p, i) => ({
      ...p,
      board: i === 0 ? board : [],
      cards: {
        library: [],
        hand: [],
        battlefield: side(i === 0 ? mine : theirs),
        graveyard: [],
        exile: [],
        command: [],
        mulligans: 0,
        deckName: 'Test',
      },
    })),
  };
}

const source = (g: GameState, iid: string) => seatSources(g, 0, RECORDS).find((s) => s.key === iid);

describe('mana from a creature’s size, read the way a fight reads it', () => {
  test('Marwyn makes her power: +1/+1 counters and an anthem count', () => {
    expect(source(table({ m: 'marwyn' }), 'm')).toMatchObject({ produces: ['G'], amount: 1 });
    expect(source(table({ m: 'marwyn', a: 'anthem' }, {}, { m: { counters: { p1p1: 3 } } }), 'm')).toMatchObject({ produces: ['G'], amount: 5 });
  });

  test('Selvala: the greatest power among your creatures, less the {G} it costs', () => {
    expect(source(table({ s: 'selvala', c: 'colossus' }), 's')).toMatchObject({ produces: ['any'], amount: 4 });
    // Someone else's big creature is not yours.
    expect(source(table({ s: 'selvala' }, { c: 'colossus' }), 's')).toMatchObject({ amount: 1 });
  });

  test('a ferocious mana ability waits for a creature with power 4 or greater', () => {
    expect(source(table({ f: 'fanatic' }), 'f')).toMatchObject({ amount: 1 });
    expect(source(table({ f: 'fanatic', c: 'colossus' }), 'f')).toMatchObject({ amount: 4 });
  });

  test('Axebane Guardian counts creatures with defender, itself among them', () => {
    expect(source(table({ x: 'axebane', w: 'wall', l: 'llanowar' }), 'x')).toMatchObject({ produces: ['any'], amount: 2 });
  });
});

describe('mana that counts the whole table', () => {
  test('Priest of Titania counts every Elf on the battlefield, the other seats’ too', () => {
    const g = table({ p: 'priest', l: 'llanowar' }, { e: 'llanowar', m: 'marwyn' });
    expect(source(g, 'p')).toMatchObject({ produces: ['G'], amount: 4 });
  });

  test('a token stack counts copy by copy', () => {
    const elves: BoardItem = {
      id: 'elves',
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
    const g = table({ p: 'priest' }, {}, {}, [elves]);
    expect(source(g, 'p')).toMatchObject({ amount: 4 });
    expect(availableMana(seatSources(g, 0, RECORDS))).toBe(4);
  });
});
