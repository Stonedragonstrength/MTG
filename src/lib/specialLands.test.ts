import { describe, expect, test } from 'vitest';
import { backView } from './faces';
import { permanentTexts } from './keywords';
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

  test('Tolarian Academy makes nothing with no artifacts, and one for each when there are some', () => {
    const academy = card('academy');
    expect(source([academy], ['U']).find((s) => s.key === academy.iid)).toBeUndefined();
    expect(source([academy, card('signet'), card('signet')], ['U']).find((s) => s.key === academy.iid)).toMatchObject({
      produces: ['U'],
      amount: 2,
    });
  });
});

describe('a double-faced card: only the face that is up', () => {
  const pathway: CardRecord = {
    ...rec('pathway', 'Branchloft Pathway // Boulderloft Pathway', 'Land // Land', '{T}: Add {G}.\n//\n{T}: Add {W}.'),
    back: {
      name: 'Boulderloft Pathway',
      typeLine: 'Land',
      oracleText: '{T}: Add {W}.',
      manaCost: '',
      power: null,
      toughness: null,
      colors: [],
      imageNormal: null,
      imageArtCrop: null,
    },
  };
  const mammoth = rec(
    'mammoth',
    'Kazandu Mammoth // Kazandu Valley',
    'Creature — Elephant // Land',
    'Landfall — Whenever a land you control enters, this creature gets +2/+2 until end of turn.\n//\nKazandu Valley enters tapped.\n{T}: Add {G}.',
  );
  const records = { pathway, mammoth, [backView(pathway).id]: backView(pathway) };

  test('a Pathway makes the color of the face it was played as', () => {
    expect(sourcesFrom([{ iid: 'p', cardId: 'pathway', name: pathway.name }], records, [])[0].produces).toEqual(['G']);
    expect(sourcesFrom([{ iid: 'p', cardId: backView(pathway).id, name: pathway.name }], records, [])[0].produces).toEqual(['W']);
  });

  test('a creature whose back is a land makes no mana while the creature is up', () => {
    expect(sourcesFrom([{ iid: 'm', cardId: 'mammoth', name: mammoth.name }], records, [])).toEqual([]);
  });

  test('the lands line counts a Pathway as its one color', () => {
    const summary = landSummary([], [{ oracleText: pathway.oracleText }]);
    expect(summary.colors.G).toBe(1);
    expect(summary.colors.W).toBe(0);
  });

  test("what a card's back face says is not on the table while its front is up", () => {
    const wolf = rec('wolf', 'Village Messenger // Moonrise Intruder', 'Creature // Creature', 'Haste\n//\nMenace\nCreatures you control have haste.');
    expect(permanentTexts([{ cardId: 'wolf' }], { wolf }, [])).toEqual(['Haste']);
  });
});
