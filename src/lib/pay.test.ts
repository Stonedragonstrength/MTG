import { describe, expect, test } from 'vitest';
import type { BoardItem, CardInstance, CardRecord } from './types';
import {
  affordable,
  availableMana,
  parseCost,
  parseCosts,
  planAnyFace,
  planPayment,
  sourcesFrom,
  type ManaSource,
} from './pay';

function src(
  key: string,
  produces: ManaSource['produces'],
  extra: Partial<ManaSource> = {},
): ManaSource {
  return { key, kind: 'virtual', produces, amount: 1, ...extra };
}

describe('parseCost', () => {
  test('splits generic from colored pips', () => {
    expect(parseCost('{3}{G}{G}')).toEqual({ generic: 3, pips: [['G'], ['G']] });
    expect(parseCost('{R}')).toEqual({ generic: 0, pips: [['R']] });
    expect(parseCost('')).toEqual({ generic: 0, pips: [] });
  });

  test('X counts zero, hybrids accept either color, colorless stays strict', () => {
    expect(parseCost('{X}{R}')).toEqual({ generic: 0, pips: [['R']] });
    expect(parseCost('{G/W}{1}')).toEqual({ generic: 1, pips: [['G', 'W']] });
    expect(parseCost('{C}{C}')).toEqual({ generic: 0, pips: [['C'], ['C']] });
    expect(parseCost('{G/P}')).toEqual({ generic: 0, pips: [['G']] }); // phyrexian ≈ its color
  });
});

describe('two-faced costs', () => {
  test('each face is its own cost — never the two added together', () => {
    // Bonecrusher Giant // Stomp
    expect(parseCosts('{2}{R} // {1}{R}')).toEqual([
      { generic: 2, pips: [['R']] },
      { generic: 1, pips: [['R']] },
    ]);
    expect(parseCosts('{1}{G}')).toEqual([{ generic: 1, pips: [['G']] }]);
    expect(parseCosts('')).toEqual([{ generic: 0, pips: [] }]);
  });

  test('parseCost reads the front face (what a commander or permanent costs)', () => {
    expect(parseCost('{2}{R} // {1}{W}')).toEqual({ generic: 2, pips: [['R']] });
  });

  test('a creature with an adventure is castable at its own cost', () => {
    const mountains = [src('m1', ['R']), src('m2', ['R']), src('m3', ['R'])];
    const plan = planAnyFace(parseCosts('{2}{R} // {1}{R}'), mountains);
    expect(plan).toEqual({ spend: { m1: 1, m2: 1, m3: 1 }, boardTaps: {} }); // three lands, not five
  });

  test('when only the cheaper half is payable, that half is what gets paid', () => {
    const plan = planAnyFace(parseCosts('{2}{R} // {1}{R}'), [src('m1', ['R']), src('m2', ['R'])]);
    expect(plan).toEqual({ spend: { m1: 1, m2: 1 }, boardTaps: {} });
  });

  test('a split card needs only one half’s colors', () => {
    // Fire // Ice on two Mountains: Fire is payable though Ice is not
    expect(planAnyFace(parseCosts('{1}{R} // {1}{U}'), [src('m1', ['R']), src('m2', ['R'])])).not.toBeNull();
    expect(planAnyFace(parseCosts('{1}{R} // {1}{U}'), [src('f1', ['G']), src('f2', ['G'])])).toBeNull();
  });
});

describe('planPayment', () => {
  test('pays pips and generic, spending one unit per source', () => {
    const plan = planPayment(parseCost('{1}{G}'), [src('dual', ['G', 'W']), src('forest', ['G'])]);
    expect(plan).toEqual({ spend: { dual: 1, forest: 1 }, boardTaps: {} });
  });

  test('finds the assignment a greedy pass would miss', () => {
    // {G}{W}: the G must come from the G/U land so the G/W land can make W
    const plan = planPayment(parseCost('{G}{W}'), [src('gw', ['G', 'W']), src('gu', ['G', 'U'])]);
    expect(plan).toEqual({ spend: { gw: 1, gu: 1 }, boardTaps: {} });
  });

  test('any-color sources cover color pips but never {C}', () => {
    expect(affordable(parseCost('{U}'), [src('tower', ['any'])])).toBe(true);
    expect(affordable(parseCost('{C}'), [src('tower', ['any'])])).toBe(false);
    expect(affordable(parseCost('{C}'), [src('wastes', ['C'])])).toBe(true);
  });

  test('too little mana means no plan', () => {
    expect(planPayment(parseCost('{2}{G}'), [src('forest', ['G'])])).toBeNull();
    expect(planPayment(parseCost('{B}'), [src('forest', ['G']), src('plains', ['W'])])).toBeNull();
  });

  test('free costs plan as an empty payment', () => {
    expect(planPayment(parseCost(''), [])).toEqual({ spend: {}, boardTaps: {} });
  });

  test('floating mana is spent before any fresh land is tapped', () => {
    const plan = planPayment(parseCost('{1}{G}'), [
      src('fresh1', ['G']),
      src('fresh2', ['G']),
      src('float1', ['G'], { floating: true }),
    ]);
    expect(plan!.spend.float1).toBe(1);
    expect(Object.keys(plan!.spend)).toHaveLength(2); // the floater plus exactly one fresh land
  });

  test('a two-mana rock pays two generic and keeps the lands back', () => {
    const plan = planPayment(parseCost('{2}'), [
      src('forest1', ['G']),
      src('forest2', ['G']),
      src('solring', ['C'], { amount: 2 }),
    ]);
    expect(plan).toEqual({ spend: { solring: 2 }, boardTaps: {} });
  });

  test('a rock is not cracked open for a single generic when a land will do', () => {
    const plan = planPayment(parseCost('{1}'), [
      src('solring', ['C'], { amount: 2 }),
      src('forest1', ['G']),
    ]);
    expect(plan).toEqual({ spend: { forest1: 1 }, boardTaps: {} });
  });

  test('creatures pay last', () => {
    const plan = planPayment(parseCost('{1}'), [
      src('elf', ['G'], { creature: true }),
      src('forest', ['G']),
    ]);
    expect(plan).toEqual({ spend: { forest: 1 }, boardTaps: {} });
  });

  test('board copies aggregate their taps by item id', () => {
    const plan = planPayment(parseCost('{2}'), [
      src('tok-elves', ['G'], { kind: 'board' }),
      src('tok-elves', ['G'], { kind: 'board' }),
    ]);
    expect(plan).toEqual({ spend: {}, boardTaps: { 'tok-elves': 2 } });
  });
});

describe('sourcesFrom', () => {
  function rec(id: string, typeLine: string, oracleText: string): CardRecord {
    return {
      id,
      name: id,
      nameLower: id,
      typeLine,
      oracleText,
      manaCost: '',
      power: null,
      toughness: null,
      colors: [],
      imageNormal: null,
      imageArtCrop: null,
      isToken: false,
      isBasicLand: typeLine.startsWith('Basic Land'),
    };
  }

  const RECORDS = {
    'c-forest': rec('c-forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
    'c-sol': rec('c-sol', 'Artifact', '{T}: Add {C}{C}.'),
    'c-bear': rec('c-bear', 'Creature — Bear', ''),
    'c-petal': rec('c-petal', 'Artifact', '{T}, Sacrifice Lotus Petal: Add one mana of any color.'),
    'c-ashaya': rec(
      'c-ashaya',
      'Legendary Creature — Elemental',
      'Ashaya, Soul of the Wild’s power and toughness are each equal to the number of lands you control.\nNontoken creatures you control are Forest lands in addition to their other types. (They’re still affected by summoning sickness.)',
    ),
    'c-rite': rec(
      'c-rite',
      'Enchantment',
      'Creatures you control have "{T}: Add one mana of any color."',
    ),
  };

  function item(id: string, oracleText: string, count: number, tapped = 0): BoardItem {
    return {
      id,
      cardId: id,
      name: id,
      imageNormal: null,
      imageArtCrop: null,
      typeLine: 'Creature',
      oracleText,
      basePower: null,
      baseToughness: null,
      count,
      counters: {},
      color: null,
      zone: 'board',
      ...(tapped ? { tapped } : {}),
    };
  }

  test('untapped mana cards are fresh sources; unresolved records are skipped', () => {
    const battlefield: CardInstance[] = [
      { iid: 'v1', cardId: 'c-forest', name: 'Forest', row: 'lands' },
      { iid: 'v3', cardId: 'c-mystery', name: 'Mystery', row: 'lands' }, // record pending
    ];
    expect(sourcesFrom(battlefield, RECORDS, [])).toEqual([
      { key: 'v1', kind: 'virtual', produces: ['G'], amount: 1 },
    ]);
  });

  test('a land you tapped yourself floats its mana until something spends it', () => {
    const battlefield: CardInstance[] = [
      { iid: 'v1', cardId: 'c-forest', name: 'Forest', row: 'lands', tapped: true },
      { iid: 'v2', cardId: 'c-forest', name: 'Forest', row: 'lands', tapped: true, spent: 1 },
      { iid: 'v3', cardId: 'c-sol', name: 'Sol Ring', row: 'front', tapped: true, spent: 1 },
    ];
    expect(sourcesFrom(battlefield, RECORDS, [])).toEqual([
      { key: 'v1', kind: 'virtual', produces: ['G'], amount: 1, floating: true },
      { key: 'v3', kind: 'virtual', produces: ['C'], amount: 1, floating: true }, // one of two left
    ]);
  });

  test('sacrifice-for-mana cards stay manual', () => {
    const battlefield: CardInstance[] = [{ iid: 'p1', cardId: 'c-petal', name: 'Lotus Petal' }];
    expect(sourcesFrom(battlefield, RECORDS, [])).toEqual([]);
  });

  test('Ashaya turns your creatures into Forests', () => {
    const battlefield: CardInstance[] = [
      { iid: 'a1', cardId: 'c-ashaya', name: 'Ashaya' },
      { iid: 'b1', cardId: 'c-bear', name: 'Grizzly Bears' },
    ];
    const sources = sourcesFrom(battlefield, RECORDS, []);
    expect(sources).toEqual([
      { key: 'a1', kind: 'virtual', produces: ['G'], amount: 1, creature: true },
      { key: 'b1', kind: 'virtual', produces: ['G'], amount: 1, creature: true },
    ]);
  });

  test('Cryptolith Rite gives every creature, tokens included, any color', () => {
    const battlefield: CardInstance[] = [
      { iid: 'r1', cardId: 'c-rite', name: 'Cryptolith Rite' },
      { iid: 'b1', cardId: 'c-bear', name: 'Grizzly Bears' },
    ];
    const sources = sourcesFrom(battlefield, RECORDS, [item('tok-sap', '', 2)]);
    expect(sources).toEqual([
      { key: 'b1', kind: 'virtual', produces: ['any'], amount: 1, creature: true },
      { key: 'tok-sap', kind: 'board', produces: ['any'], amount: 1, creature: true },
      { key: 'tok-sap', kind: 'board', produces: ['any'], amount: 1, creature: true },
    ]);
  });

  const LANDS = {
    ...RECORDS,
    'c-swamp': rec('c-swamp', 'Basic Land — Swamp', '({T}: Add {B}.)'),
    'c-plains': rec('c-plains', 'Basic Land — Plains', '({T}: Add {W}.)'),
    'c-tower': rec(
      'c-tower',
      'Legendary Land',
      '{T}: Add {C}.\n{T}, Sacrifice a creature: Add {B}{B}.',
    ),
    'c-urborg': rec(
      'c-urborg',
      'Legendary Land',
      'Each land is a Swamp in addition to its other land types.',
    ),
    'c-lantern': rec(
      'c-lantern',
      'Artifact',
      'Lands you control have "{T}: Add one mana of any color."',
    ),
  };

  test('a land with a sacrifice ability keeps its plain tap for mana', () => {
    const sources = sourcesFrom([{ iid: 't1', cardId: 'c-tower', name: 'Phyrexian Tower' }], LANDS, []);
    expect(sources).toEqual([{ key: 't1', kind: 'virtual', produces: ['C'], amount: 1 }]);
  });

  test('Urborg taps for black itself and teaches every land to', () => {
    const sources = sourcesFrom(
      [
        { iid: 'u1', cardId: 'c-urborg', name: 'Urborg, Tomb of Yawgmoth' },
        { iid: 'p1', cardId: 'c-plains', name: 'Plains' },
        { iid: 'b1', cardId: 'c-bear', name: 'Grizzly Bears' }, // not a land: untouched
      ],
      LANDS,
      [],
    );
    expect(sources).toEqual([
      { key: 'u1', kind: 'virtual', produces: ['B'], amount: 1 },
      { key: 'p1', kind: 'virtual', produces: ['W', 'B'], amount: 1 },
    ]);
  });

  test('Chromatic Lantern lets every land tap for any color', () => {
    const sources = sourcesFrom(
      [
        { iid: 'l1', cardId: 'c-lantern', name: 'Chromatic Lantern' },
        { iid: 'f1', cardId: 'c-forest', name: 'Forest' },
        { iid: 'f2', cardId: 'c-forest', name: 'Forest' },
      ],
      LANDS,
      [],
    );
    expect(affordable(parseCost('{U}{U}'), sources)).toBe(true);
  });

  test('board dorks contribute untapped copies; treasures stay manual', () => {
    const elves = item('tok-elves', '{T}: Add {G}.', 3, 1); // 2 ready
    const treasure = item('tok-tr', '{T}, Sacrifice this artifact: Add one mana of any color.', 4);
    const sources = sourcesFrom([], {}, [elves, treasure]);
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.key === 'tok-elves' && s.kind === 'board')).toBe(true);
  });
});

describe('availableMana', () => {
  test('totals every unit the seat could spend right now', () => {
    expect(
      availableMana([
        src('forest', ['G']),
        src('solring', ['C'], { amount: 2 }),
        src('float', ['G'], { floating: true }),
      ]),
    ).toBe(4);
  });
});
