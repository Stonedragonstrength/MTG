import { describe, expect, test } from 'vitest';
import { landSummary } from './mana';
import { availableMana, sourcesFrom } from './pay';
import type { BoardItem, CardInstance, CardRecord } from './types';

const rec = (id: string, name: string, typeLine: string, oracleText: string): CardRecord => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  typeLine,
  oracleText,
  manaCost: '',
  power: /Creature/.test(typeLine) ? '1' : null,
  toughness: /Creature/.test(typeLine) ? '1' : null,
  colors: [],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: typeLine.startsWith('Basic'),
});

const RECORDS: Record<string, CardRecord> = {
  tower: rec('tower', 'Command Tower', 'Land', "{T}: Add one mana of any color in your commander's color identity."),
  palace: rec('palace', 'Opal Palace', 'Land', "{T}: Add {C}.\n{1}, {T}: Add one mana of any color in your commander's color identity."),
  signet: rec('signet', 'Arcane Signet', 'Artifact', "{T}: Add one mana of any color in your commander's color identity."),
  cradle: rec('cradle', "Gaea's Cradle", 'Legendary Land', '{T}: Add {G} for each creature you control.'),
  coffers: rec('coffers', 'Cabal Coffers', 'Land', '{2}, {T}: Add {B} for each Swamp you control.'),
  academy: rec('academy', 'Tolarian Academy', 'Legendary Land', '{T}: Add {U} for each artifact you control.'),
  swamp: rec('swamp', 'Swamp', 'Basic Land — Swamp', '({T}: Add {B}.)'),
  elf: rec('elf', 'Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.'),
  bear: rec('bear', 'Grizzly Bears', 'Creature — Bear', ''),
};

let n = 0;
const card = (cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({ iid: `i${n++}`, cardId, name: RECORDS[cardId].name, ...more });
const source = (cards: CardInstance[], identity: ('W' | 'U' | 'B' | 'R' | 'G')[] | null, board: BoardItem[] = []) =>
  sourcesFrom(cards, RECORDS, board, identity);

describe("Command Tower and its kind: your commander's colors", () => {
  test('a two-color commander: those two colors, no others', () => {
    const [tower] = source([card('tower')], ['R', 'G']);
    expect(tower.produces).toEqual(['R', 'G']);
  });

  test('Arcane Signet the same; Opal Palace keeps its {C} too', () => {
    expect(source([card('signet')], ['W', 'U', 'B'])[0].produces).toEqual(['W', 'U', 'B']);
    expect(source([card('palace')], ['G'])[0].produces).toEqual(['C', 'G']);
  });

  test('a colorless commander’s Command Tower makes nothing', () => {
    expect(source([card('tower')], [])).toEqual([]);
  });

  test('no commander known: any color, generously', () => {
    expect(source([card('tower')], null)[0].produces).toEqual(['any']);
  });

  test('the lands line counts it toward the commander’s colors, not as "any"', () => {
    const summary = landSummary([], [{ oracleText: RECORDS.tower.oracleText }], ['B', 'G']);
    expect(summary.any).toBe(0);
    expect(summary.colors.B).toBe(1);
    expect(summary.colors.G).toBe(1);
  });
});

describe('lands that count your board', () => {
  test('Gaea’s Cradle: a green mana for each creature (a token stack counts each copy)', () => {
    const tokens: BoardItem = {
      id: 'saps',
      cardId: null,
      name: 'Saproling',
      imageNormal: null,
      imageArtCrop: null,
      typeLine: 'Token Creature — Saproling',
      oracleText: '',
      basePower: 1,
      baseToughness: 1,
      count: 3,
      counters: {},
      color: 'G',
      zone: 'board',
    };
    const cradle = card('cradle');
    const all = source([cradle, card('bear'), card('elf')], ['G'], [tokens]);
    const fromCradle = all.find((s) => s.key === cradle.iid)!;
    expect(fromCradle).toMatchObject({ produces: ['G'], amount: 5 });
  });

  test('Cabal Coffers: a black mana for each Swamp, less the two it costs', () => {
    const coffers = card('coffers');
    const all = source([coffers, card('swamp'), card('swamp'), card('swamp'), card('swamp')], ['B']);
    expect(all.find((s) => s.key === coffers.iid)).toMatchObject({ produces: ['B'], amount: 2 });
    // Four Swamps and the Coffers: 4 from the Swamps, 2 more from the Coffers.
    expect(availableMana(all)).toBe(6);
  });

  test('Tolarian Academy with no artifacts still offers a mana (generous), and counts them when there are some', () => {
    const academy = card('academy');
    expect(source([academy, card('signet'), card('signet')], ['U']).find((s) => s.key === academy.iid)).toMatchObject({
      produces: ['U'],
      amount: 2,
    });
  });
});
