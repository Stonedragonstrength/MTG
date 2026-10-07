import { describe, expect, test } from 'vitest';
import type { BoardItem, CardInstance, CardRecord } from './types';
import {
  affordable,
  availableMana,
  castCosts,
  entersWithX,
  hasX,
  maxX,
  parseCost,
  parseCosts,
  planAnyFace,
  planPayment,
  priceX,
  sourcesFrom,
  withX,
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

  test('X is counted but costs nothing yet, hybrids accept either color, colorless stays strict', () => {
    expect(parseCost('{X}{R}')).toEqual({ generic: 0, pips: [['R']], x: 1 });
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

describe('X costs', () => {
  const mountains = (n: number) => Array.from({ length: n }, (_, i) => src(`m${i + 1}`, ['R']));

  test('a cost knows how many {X} it holds, and says nothing when it holds none', () => {
    expect(parseCost('{X}{R}').x).toBe(1);
    expect(parseCost('{X}{X}{G}')).toEqual({ generic: 0, pips: [['G']], x: 2 });
    expect(parseCost('{X}')).toEqual({ generic: 0, pips: [], x: 1 });
    expect('x' in parseCost('{2}{G}')).toBe(false); // omitted, never written as 0
    expect('x' in parseCost('')).toBe(false);
  });

  test('each face keeps its own X', () => {
    // Expansion // Explosion
    expect(parseCosts('{U/R}{U/R} // {X}{U}{U}{R}{R}')).toEqual([
      { generic: 0, pips: [['U', 'R'], ['U', 'R']] },
      { generic: 0, pips: [['U'], ['U'], ['R'], ['R']], x: 1 },
    ]);
  });

  test('withX adds the chosen value to generic, once per {X}', () => {
    expect(withX(parseCost('{X}{R}'), 3)).toEqual({ generic: 3, pips: [['R']], x: 1 });
    expect(withX(parseCost('{X}{X}{G}'), 3)).toEqual({ generic: 6, pips: [['G']], x: 2 });
    expect(withX(parseCost('{2}{X}{R}'), 4)).toEqual({ generic: 6, pips: [['R']], x: 1 });
  });

  test('withX leaves a cost alone when there is nothing to add', () => {
    const plain = parseCost('{2}{G}');
    expect(withX(plain, 5)).toBe(plain); // no X in it
    const fireball = parseCost('{X}{R}');
    expect(withX(fireball, 0)).toBe(fireball); // X = 0
    expect(withX(fireball, -2)).toBe(fireball); // nonsense reads as zero
  });

  test('maxX is the largest X the mana on the table still covers', () => {
    expect(maxX(parseCost('{X}{R}'), mountains(4))).toBe(3);
    expect(maxX(parseCost('{2}{X}{R}'), mountains(4))).toBe(1);
    expect(maxX(parseCost('{X}{X}{R}'), mountains(5))).toBe(2); // each point costs two
    expect(maxX(parseCost('{X}{X}{R}'), mountains(4))).toBe(1);
    expect(maxX(parseCost('{X}'), [src('solring', ['C'], { amount: 2 }), ...mountains(1)])).toBe(3);
  });

  test('maxX is zero when even X = 0 cannot be paid, or the cost has no X', () => {
    expect(maxX(parseCost('{X}{R}'), [])).toBe(0);
    expect(maxX(parseCost('{X}{R}'), [src('f1', ['G']), src('f2', ['G'])])).toBe(0); // no red
    expect(maxX(parseCost('{X}{R}'), mountains(1))).toBe(0); // exactly the rest of the cost
    expect(maxX(parseCost('{2}{R}'), mountains(9))).toBe(0);
  });

  test('maxX stops looking at 40', () => {
    expect(maxX(parseCost('{X}'), mountains(100))).toBe(40);
  });

  test('hasX: does any face a cast could pay hold an X', () => {
    expect(hasX(parseCosts('{X}{R}'))).toBe(true);
    expect(hasX(parseCosts('{U/R}{U/R} // {X}{U}{U}{R}{R}'))).toBe(true);
    expect(hasX(parseCosts('{2}{R} // {1}{R}'))).toBe(false);
    expect(hasX([])).toBe(false);
  });

  test('priceX: a value above zero means the face with the X, and only that one', () => {
    const faces = parseCosts('{U/R}{U/R} // {X}{U}{U}{R}{R}');
    expect(priceX(faces, 3)).toEqual([{ generic: 3, pips: [['U'], ['U'], ['R'], ['R']], x: 1 }]);
    // five lands could pay Expansion; Explosion for 3 needs seven, so it is not payable
    const lands = [...mountains(3), src('i1', ['U']), src('i2', ['U'])];
    expect(planAnyFace(priceX(faces, 3), lands)).toBeNull();
    expect(planAnyFace(priceX(faces, 1), lands)).not.toBeNull();
  });

  test('priceX: zero leaves every face open, as for any other card', () => {
    const faces = parseCosts('{U/R}{U/R} // {X}{U}{U}{R}{R}');
    expect(priceX(faces, 0)).toEqual(faces);
    expect(planAnyFace(priceX(faces, 0), mountains(2))).toEqual({ spend: { m1: 1, m2: 1 }, boardTaps: {} });
  });

  test('priceX: a card without X costs what it costs, whatever was asked', () => {
    const faces = parseCosts('{2}{R} // {1}{R}');
    expect(priceX(faces, 4)).toEqual(faces);
  });

  test('castCosts: every face from hand, the front face plus tax from the command zone, none for a land', () => {
    const card = (typeLine: string, manaCost: string) => ({ typeLine, manaCost });
    expect(castCosts(card('Sorcery', '{X}{R}'), 'hand')).toEqual([{ generic: 0, pips: [['R']], x: 1 }]);
    expect(castCosts(card('Instant // Instant', '{1}{R} // {1}{U}'), 'hand')).toHaveLength(2);
    expect(castCosts(card('Basic Land — Forest', ''), 'hand')).toEqual([]); // played, not cast
    // Shatterskull Smashing: the front costs {X}{R}{R}, but from hand the app plays it as the land
    expect(castCosts(card('Sorcery // Land', '{X}{R}{R}'), 'hand')).toEqual([]);
    expect(castCosts(card('Legendary Creature — Hydra', '{X}{G}{U}'), 'command', 4)).toEqual([
      { generic: 4, pips: [['G'], ['U']], x: 1 },
    ]);
    expect(castCosts(card('Legendary Creature — Giant // Sorcery', '{2}{R} // {1}{R}'), 'command')).toEqual([
      { generic: 2, pips: [['R']] },
    ]);
    expect(castCosts(undefined, 'hand')).toEqual([{ generic: 0, pips: [] }]); // unread: free, as before
    expect(castCosts(null, 'command', 2)).toEqual([{ generic: 2, pips: [] }]);
  });

  test('entersWithX reads the one line about X the table acts on', () => {
    expect(entersWithX('Endless One enters with X +1/+1 counters on it.')).toBe(true);
    expect(entersWithX('This creature enters with X +1/+1 counters on it.')).toBe(true);
    // the older wording, still in card databases downloaded a while ago
    expect(entersWithX('Walking Ballista enters the battlefield with X +1/+1 counters on it.')).toBe(true);
    expect(entersWithX('Chalice of the Void enters with X charge counters on it.')).toBe(false);
    expect(entersWithX('This creature enters with two +1/+1 counters on it.')).toBe(false);
    expect(entersWithX('Fireball deals X damage divided evenly, rounded down, among any number of targets.')).toBe(false);
    expect(entersWithX('')).toBe(false);
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

  const SICK = {
    ...RECORDS,
    'c-elves': rec('c-elves', 'Creature — Elf Druid', '{T}: Add {G}.'),
    'c-hasty': rec('c-hasty', 'Creature — Elemental', 'Haste\n{T}: Add {R}.'),
    'c-fervor': rec(
      'c-fervor',
      'Enchantment',
      'Creatures you control have haste. (They can attack and {T} as soon as they come under your control.)',
    ),
  };
  const keys = (sources: ManaSource[]) => sources.map((s) => s.key);

  test('a mana creature that arrived this turn cannot pay yet', () => {
    const fresh: CardInstance[] = [{ iid: 'e1', cardId: 'c-elves', name: 'Llanowar Elves', sick: true }];
    expect(sourcesFrom(fresh, SICK, [])).toEqual([]);
  });

  test('the same creature pays once its controller’s turn has come round', () => {
    const readied: CardInstance[] = [{ iid: 'e1', cardId: 'c-elves', name: 'Llanowar Elves' }];
    expect(sourcesFrom(readied, SICK, [])).toEqual([
      { key: 'e1', kind: 'virtual', produces: ['G'], amount: 1, creature: true },
    ]);
  });

  test('a land or a rock played this turn taps at once', () => {
    const battlefield: CardInstance[] = [
      { iid: 'f1', cardId: 'c-forest', name: 'Forest', row: 'lands', sick: true },
      { iid: 's1', cardId: 'c-sol', name: 'Sol Ring', row: 'front', sick: true },
      { iid: 'e1', cardId: 'c-elves', name: 'Llanowar Elves', row: 'front', sick: true },
    ];
    expect(sourcesFrom(battlefield, SICK, [])).toEqual([
      { key: 'f1', kind: 'virtual', produces: ['G'], amount: 1 },
      { key: 's1', kind: 'virtual', produces: ['C'], amount: 2 },
    ]);
  });

  test('a fresh creature with haste pays, whether the haste is its own or handed to it', () => {
    const own: CardInstance[] = [{ iid: 'h1', cardId: 'c-hasty', name: 'Hasty', sick: true }];
    expect(keys(sourcesFrom(own, SICK, []))).toEqual(['h1']);
    const granted: CardInstance[] = [
      { iid: 'v1', cardId: 'c-fervor', name: 'Fervor' },
      { iid: 'e1', cardId: 'c-elves', name: 'Llanowar Elves', sick: true },
    ];
    expect(keys(sourcesFrom(granted, SICK, []))).toEqual(['e1']);
    // a Fervor tracked as a board card counts just the same
    const fervorStack = { ...item('tok-fervor', SICK['c-fervor'].oracleText, 1), typeLine: 'Enchantment' };
    expect(keys(sourcesFrom([granted[1]], SICK, [fervorStack]))).toEqual(['e1']);
  });

  test('a sick creature tapped by hand floats nothing (crewing is legal; its mana is not)', () => {
    const tapped: CardInstance[] = [
      { iid: 'e1', cardId: 'c-elves', name: 'Llanowar Elves', sick: true, tapped: true },
    ];
    expect(sourcesFrom(tapped, SICK, [])).toEqual([]);
  });

  test('Ashaya’s Forests are still creatures: a fresh one waits a turn', () => {
    const battlefield: CardInstance[] = [
      { iid: 'a1', cardId: 'c-ashaya', name: 'Ashaya' },
      { iid: 'b1', cardId: 'c-bear', name: 'Grizzly Bears', sick: true },
    ];
    expect(keys(sourcesFrom(battlefield, SICK, []))).toEqual(['a1']);
  });

  test('a fresh card whose record is not read yet is skipped as before, never counted as sick', () => {
    const pending: CardInstance[] = [{ iid: 'x1', cardId: 'c-mystery', name: 'Mystery', sick: true }];
    expect(sourcesFrom(pending, SICK, [])).toEqual([]);
  });

  test('a creature stack offers only the copies that are both untapped and ready', () => {
    const stack = (tapped: number, sick: number) => ({
      ...item('tok-elves', '{T}: Add {G}.', 5, tapped),
      ...(sick ? { sick } : {}),
    });
    expect(sourcesFrom([], {}, [stack(0, 0)])).toHaveLength(5);
    expect(sourcesFrom([], {}, [stack(0, 3)])).toHaveLength(2);
    expect(sourcesFrom([], {}, [stack(1, 3)])).toHaveLength(2); // the tapped one may be a sick one
    expect(sourcesFrom([], {}, [stack(4, 3)])).toHaveLength(1);
    expect(sourcesFrom([], {}, [stack(0, 5)])).toHaveLength(0);
  });

  test('a stack with haste, its own or handed to it, offers its fresh copies too', () => {
    const hasty = { ...item('tok-hasty', 'Haste\n{T}: Add {R}.', 3), sick: 3 };
    expect(sourcesFrom([], {}, [hasty])).toHaveLength(3);
    const elves = { ...item('tok-elves', '{T}: Add {G}.', 3), sick: 3 };
    const fervor: CardInstance[] = [{ iid: 'v1', cardId: 'c-fervor', name: 'Fervor' }];
    expect(sourcesFrom(fervor, SICK, [elves])).toHaveLength(3);
    expect(sourcesFrom([], SICK, [elves])).toHaveLength(0);
  });

  test('a stack that is not a creature is never held back', () => {
    const lands = {
      ...item('land-forest', '({T}: Add {G}.)', 3),
      typeLine: 'Basic Land — Forest',
      zone: 'lands' as const,
      sick: 3,
    };
    expect(sourcesFrom([], {}, [lands])).toHaveLength(3);
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
