import { describe, expect, test } from 'vitest';
import { BACK } from './faces';
import { conditionHolds } from './lands';
import { availableMana, sourcesFrom } from './pay';
import type { BoardItem, CardInstance, CardRecord } from './types';

const rec = (id: string, name: string, typeLine: string, manaCost: string, oracleText: string): CardRecord => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  typeLine,
  oracleText,
  manaCost,
  power: /Creature/.test(typeLine) ? '1' : null,
  toughness: /Creature/.test(typeLine) ? '1' : null,
  colors: [],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: typeLine.startsWith('Basic'),
});

const RECORDS: Record<string, CardRecord> = {
  tower: rec('tower', "Urza's Tower", "Land — Urza's Tower", '', "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead."),
  mine: rec('mine', "Urza's Mine", "Land — Urza's Mine", '', "{T}: Add {C}. If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead."),
  plant: rec('plant', "Urza's Power Plant", "Land — Urza's Power-Plant", '', "{T}: Add {C}. If you control an Urza's Mine and an Urza's Tower, add {C}{C} instead."),
  nykthos: rec(
    'nykthos',
    'Nykthos, Shrine to Nyx',
    'Legendary Land',
    '',
    '{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color. (Your devotion to a color is the number of mana symbols of that color in the mana costs of permanents you control.)',
  ),
  lotus: rec(
    'lotus',
    'Nyx Lotus',
    'Legendary Artifact',
    '{4}',
    'Nyx Lotus enters tapped.\n{T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color. (Your devotion to a color is the number of mana symbols of that color in the mana costs of permanents you control.)',
  ),
  acolyte: rec(
    'acolyte',
    "Karametra's Acolyte",
    'Creature — Human Druid',
    '{3}{G}',
    '{T}: Add an amount of {G} equal to your devotion to green. (Each {G} in the mana costs of permanents you control counts toward your devotion to green.)',
  ),
  verge: rec('verge', 'Bleachbone Verge', 'Land', '', '{T}: Add {B}.\n{T}: Add {W}. Activate only if you control a Plains or a Swamp.'),
  falseGod: rec('falseGod', 'Temple of the False God', 'Land', '', '{T}: Add {C}{C}. Activate only if you control five or more lands.'),
  opal: rec('opal', 'Mox Opal', 'Legendary Artifact', '{0}', 'Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.'),
  gathering: rec(
    'gathering',
    'Gathering Place',
    'Land',
    '',
    '{T}: Add {C}.\n{T}: Add {G} or {W}. Activate only if this land entered this turn or if you control a basic land.',
  ),
  leafkin: rec('leafkin', 'Leafkin Druid', 'Creature — Elemental Druid', '{1}{G}', '{T}: Add {G}. If you control four or more creatures, add {G}{G} instead.'),
  forest: rec('forest', 'Forest', 'Basic Land — Forest', '', '({T}: Add {G}.)'),
  wastes: rec('wastes', 'Wastes', 'Basic Land', '', '({T}: Add {C}.)'),
  plains: rec('plains', 'Plains', 'Basic Land — Plains', '', '({T}: Add {W}.)'),
  land: rec('land', 'Mystic Sanctuary', 'Land — Island', '', '({T}: Add {U}.)'),
  thorn: rec('thorn', 'Ancient Thorn', 'Creature — Elemental', '{1}{G}{G}', ''),
  hybrid: rec('hybrid', 'Kitchen Finks', 'Creature — Ouphe', '{1}{G/W}{G/W}', ''),
  phyrexian: rec('phyrexian', 'Birthing Pod', 'Artifact', '{3}{G/P}', ''),
  signet: rec('signet', 'Mind Stone', 'Artifact', '{2}', '{T}: Add {C}.'),
  werewolf: rec('werewolf', 'Village Ironsmith // Ironfang', 'Creature — Human Werewolf // Creature — Werewolf', '{1}{R}', ''),
};

let n = 0;
const card = (cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({ iid: `i${n++}`, cardId, name: RECORDS[cardId]?.name ?? cardId, ...more });
const of = (cards: CardInstance[], c: CardInstance, board: BoardItem[] = []) =>
  sourcesFrom(cards, RECORDS, board).find((s) => s.key === c.iid);

describe('the Tron lands', () => {
  test('all three out: the Tower makes three, the Mine and the Power-Plant two each — seven in all', () => {
    const [tower, mine, plant] = [card('tower'), card('mine'), card('plant')];
    const all = [tower, mine, plant];
    expect(of(all, tower)).toMatchObject({ produces: ['C'], amount: 3 });
    expect(of(all, mine)).toMatchObject({ produces: ['C'], amount: 2 });
    expect(of(all, plant)).toMatchObject({ produces: ['C'], amount: 2 });
    expect(availableMana(sourcesFrom(all, RECORDS, []))).toBe(7);
  });

  test('one missing: each makes one', () => {
    const [tower, mine] = [card('tower'), card('mine')];
    expect(of([tower, mine], tower)).toMatchObject({ amount: 1 });
    expect(of([tower, mine], mine)).toMatchObject({ amount: 1 });
  });

  test('a Tower tapped by hand floats all three', () => {
    const tower = card('tower', { tapped: true });
    expect(of([tower, card('mine'), card('plant')], tower)).toMatchObject({ amount: 3, floating: true });
  });
});

describe('devotion', () => {
  test('Nykthos: your devotion to the color, less the {2} it costs; {C} as before', () => {
    const nykthos = card('nykthos');
    // {1}{G}{G} + {1}{G/W}{G/W} + {3}{G/P}: green 5, white 2.
    const field = [nykthos, card('thorn'), card('hybrid'), card('phyrexian')];
    expect(of(field, nykthos)).toMatchObject({ produces: ['C', 'G'], amount: 3 });
  });

  test('Nykthos with devotion of 2 or less: just its {C}', () => {
    const nykthos = card('nykthos');
    expect(of([nykthos, card('hybrid')], nykthos)).toMatchObject({ produces: ['C'], amount: 1 });
  });

  test('Nyx Lotus makes nothing with no devotion, and the whole devotion with some', () => {
    const lotus = card('lotus');
    expect(of([lotus, card('signet')], lotus)).toBeUndefined();
    expect(of([lotus, card('thorn'), card('leafkin')], lotus)).toMatchObject({ produces: ['G'], amount: 3 });
  });

  test("Karametra's Acolyte counts its own {G}", () => {
    const acolyte = card('acolyte');
    expect(of([acolyte], acolyte)).toMatchObject({ produces: ['G'], amount: 1 });
    expect(of([acolyte, card('thorn')], acolyte)).toMatchObject({ produces: ['G'], amount: 3 });
  });

  test('a card turned to its back has no mana cost: it adds no devotion', () => {
    const red = rec('red', 'Red Acolyte', 'Creature', '{R}', '{T}: Add an amount of {R} equal to your devotion to red.');
    const records = { ...RECORDS, red, ['werewolf' + BACK]: { ...RECORDS.werewolf, id: 'werewolf' + BACK } };
    const acolyte = { iid: 'r', cardId: 'red', name: 'Red Acolyte' };
    const field = (werewolf: string) => [acolyte, { iid: 'w', cardId: werewolf, name: 'Village Ironsmith' }];
    expect(sourcesFrom(field('werewolf'), records, []).find((s) => s.key === 'r')).toMatchObject({ amount: 2 });
    expect(sourcesFrom(field('werewolf' + BACK), records, []).find((s) => s.key === 'r')).toMatchObject({ amount: 1 });
  });
});

describe('"Activate only if…"', () => {
  test('a Verge makes its second color only beside a Plains or a Swamp', () => {
    const verge = card('verge');
    expect(of([verge], verge)!.produces).toEqual(['B']);
    expect(of([verge, card('plains')], verge)!.produces).toEqual(['B', 'W']);
  });

  test('Temple of the False God needs five lands, itself among them', () => {
    const temple = card('falseGod');
    expect(of([temple, card('forest'), card('forest'), card('forest')], temple)).toBeUndefined();
    expect(of([temple, card('forest'), card('forest'), card('forest'), card('wastes')], temple)).toMatchObject({ amount: 2 });
  });

  test('Mox Opal counts itself toward metalcraft', () => {
    const opal = card('opal');
    expect(of([opal, card('signet')], opal)).toBeUndefined();
    expect(of([opal, card('signet'), card('signet')], opal)).toMatchObject({ produces: ['any'] });
  });

  test('Gathering Place: its colors the turn it arrives, or with a basic land out', () => {
    const fresh = card('gathering', { sick: true });
    const old = card('gathering');
    expect(of([fresh], fresh)!.produces).toEqual(['C', 'G', 'W']);
    expect(of([old, card('land')], old)!.produces).toEqual(['C']);
    expect(of([old, card('forest')], old)!.produces).toEqual(['C', 'G', 'W']);
  });
});

describe('counters and land types', () => {
  const records: Record<string, CardRecord> = {
    ...RECORDS,
    chalice: rec('chalice', 'Everflowing Chalice', 'Artifact', '{0}', 'Multikicker {2}\nThis artifact enters with a charge counter on it for each time it was kicked.\n{T}: Add {C} for each charge counter on this artifact.'),
    sage: rec('sage', 'Gyre Sage', 'Creature — Elf Druid', '{1}{G}', 'Evolve\n{T}: Add {G} for each +1/+1 counter on this creature.'),
    geoscope: rec('geoscope', 'Prismatic Geoscope', 'Artifact', '{5}', 'Domain — {T}: Add X mana in any combination of colors, where X is the number of basic land types among lands you control.'),
    dual: rec('dual', 'Breeding Pool', 'Land — Forest Island', '', '({T}: Add {G} or {U}.)'),
  };
  const at = (cards: CardInstance[], c: CardInstance) => sourcesFrom(cards, records, []).find((s) => s.key === c.iid);

  test('Everflowing Chalice makes one for each charge counter; none, nothing', () => {
    const two = card('chalice', { counters: { charge: 2 } });
    expect(at([two], two)).toMatchObject({ produces: ['C'], amount: 2 });
    const none = card('chalice');
    expect(at([none], none)).toBeUndefined();
  });

  test('Gyre Sage makes one for each +1/+1 counter', () => {
    const sage = card('sage', { counters: { p1p1: 3 } });
    expect(at([sage], sage)).toMatchObject({ produces: ['G'], amount: 3 });
  });

  test('Prismatic Geoscope counts basic land types, a dual giving two', () => {
    const geoscope = card('geoscope');
    expect(at([geoscope, card('dual'), card('plains'), card('forest')], geoscope)).toMatchObject({ produces: ['any'], amount: 3 });
  });
});

test('Leafkin Druid counts a token stack copy by copy', () => {
  const druid = card('leafkin');
  const saprolings: BoardItem = {
    id: 'saps',
    cardId: null,
    name: 'Saproling',
    imageNormal: null,
    imageArtCrop: null,
    typeLine: 'Token Creature — Saproling',
    oracleText: '',
    basePower: 1,
    baseToughness: 1,
    count: 2,
    counters: {},
    color: 'G',
    zone: 'board',
  };
  expect(of([druid, card('thorn')], druid, [saprolings])).toMatchObject({ produces: ['G'], amount: 2 });
  expect(of([druid, card('thorn')], druid, [{ ...saprolings, count: 1 }])).toMatchObject({ amount: 1 });
});

describe('conditionHolds', () => {
  const mine = ["Land — Urza's Mine", 'Basic Land — Forest', 'Artifact'];

  test('"and" wants both, "or if" either', () => {
    expect(conditionHolds("you control an Urza's Mine and a Forest", { mine })).toBe(true);
    expect(conditionHolds("you control an Urza's Mine and an Urza's Tower", { mine })).toBe(false);
    expect(conditionHolds('this land entered this turn or if you control a basic land', { mine })).toBe(true);
    expect(conditionHolds('this land entered this turn or if you control a basic land', { mine: [], fresh: false })).toBe(false);
  });

  test('counters on the card itself', () => {
    expect(conditionHolds('this artifact has two or more oil counters on it', { mine, counters: { oil: 2 } })).toBe(true);
    expect(conditionHolds('this creature has a +1/+1 counter on it', { mine, counters: {} })).toBe(false);
    expect(conditionHolds('there are three or more brick counters on this artifact', { mine, counters: { brick: 3 } })).toBe(true);
  });

  test('what the reader was not told cannot be judged', () => {
    expect(conditionHolds('you have two or more opponents', { mine })).toBeNull();
    expect(conditionHolds('this land entered this turn', { mine })).toBeNull();
    expect(conditionHolds('you control a creature with power 4 or greater', { mine })).toBeNull();
  });
});
