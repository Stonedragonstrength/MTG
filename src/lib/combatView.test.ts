import { describe, expect, test } from 'vitest';
import { adjustLife, createGame } from './game';
import { readUnit, readUnits, resolveCombat, type CardRecords, type UnitRead } from './combatEngine';
import {
  allAttack,
  attackAnyway,
  attackLess,
  attackNone,
  attackTap,
  attackTargets,
  attackersAt,
  attackingCopies,
  attacksAt,
  barSentence,
  blockAnyway,
  blockLess,
  blockTap,
  blockingCopies,
  freeToSend,
  freeToStand,
  handLine,
  litAttack,
  litTarget,
  resultFlags,
  resultLines,
  unitKey,
} from './combatView';
import type {
  BoardItem,
  CardInstance,
  CardRecord,
  CombatAttack,
  CombatState,
  CombatUnit,
  GameConfig,
  GameState,
} from './types';

const NAMES = ['Nathan', 'Sam', 'Alex', 'Kim'];

function config(seats: number, commanders: (string | null)[] = []): GameConfig {
  return {
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    mode: 'cards',
    profiles: NAMES.slice(0, seats).map((name, i) => ({
      id: `p${i}`,
      name,
      avatarUrl: null,
      commanderName: commanders[i] ?? null,
    })),
  };
}

function rec(name: string, power: string | null, toughness: string | null, oracleText = '', typeLine = 'Creature — Test'): CardRecord {
  return {
    id: `c-${name}`,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '',
    power,
    toughness,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const BEAR = rec('Grizzly Bears', '2', '2');
const GIANT = rec('Hill Giant', '3', '3');
const WURM = rec('Craw Wurm', '6', '4');
const WALL = rec('Wall of Omens', '0', '4', 'Defender\nWhen this creature enters, draw a card.');
const ANGEL = rec('Serra Angel', '4', '4', 'Flying, vigilance');
const NIGHTHAWK = rec('Vampire Nighthawk', '2', '3', 'Flying\nDeathtouch\nLifelink');
const GOYF = rec('Tarmogoyf', '*', '1+*');
const SOL_RING = rec('Sol Ring', null, null, '{T}: Add {C}{C}.', 'Artifact');
const SKITHIRYX = rec('Skithiryx, the Blight Dragon', '4', '4', 'Flying\nInfect', 'Legendary Creature — Phyrexian Dragon Skeleton');
const ATRAXA = rec("Atraxa, Praetors' Voice", '4', '4', 'Flying, vigilance, deathtouch, lifelink', 'Legendary Creature — Phyrexian Angel Horror');

const card = (id: string): CombatUnit => ({ kind: 'card', id });
const stack = (id: string): CombatUnit => ({ kind: 'stack', id });

function tokens(id: string, count: number, more: Partial<BoardItem> = {}): BoardItem {
  return {
    id,
    cardId: null,
    name: id,
    imageNormal: null,
    imageArtCrop: null,
    typeLine: 'Token Creature',
    oracleText: '',
    basePower: 1,
    baseToughness: 1,
    count,
    counters: {},
    color: null,
    zone: 'board',
    ...more,
  };
}

interface Side {
  cards?: Record<string, CardRecord>;
  wear?: Record<string, Partial<CardInstance>>;
  stacks?: BoardItem[];
  tracker?: true;
}

/** A table with those sides, seat 0's turn, and the records this device has read. */
function table(sides: Side[], cfg = config(sides.length)): { g: GameState; records: CardRecords } {
  const base = createGame(cfg);
  const records: CardRecords = {};
  const players = base.players.map((p, i) => {
    const side = sides[i];
    const battlefield: CardInstance[] = Object.entries(side.cards ?? {}).map(([iid, r]) => {
      records[r.id] = r;
      return { iid, cardId: r.id, name: r.name, row: 'front' as const, ...side.wear?.[iid] };
    });
    return {
      ...p,
      board: side.stacks ?? [],
      ...(side.tracker
        ? {}
        : { cards: { library: [], hand: [], battlefield, graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'Test' } }),
    };
  });
  return { g: { ...base, players }, records };
}

/** Nathan (a bear, a giant, a wall, a tapped wurm, an angel that just arrived, a Sol Ring and five
 * soldiers of which one is tapped) against Sam (a bear, a tapped giant, three saprolings) and Alex. */
function pod() {
  return table([
    {
      cards: { bear: BEAR, giant: GIANT, wall: WALL, wurm: WURM, angel: ANGEL, ring: SOL_RING },
      wear: { wurm: { tapped: true }, angel: { sick: true } },
      stacks: [tokens('soldiers', 5, { tapped: 1 })],
    },
    { cards: { sbear: BEAR, sgiant: GIANT }, wear: { sgiant: { tapped: true } }, stacks: [tokens('saprolings', 3)] },
    { cards: { knight: BEAR } },
  ]);
}

const withCombat = (g: GameState, step: CombatState['step'], attacks: CombatAttack[] = [], defender?: number): GameState => ({
  ...g,
  combat: {
    id: 'c1',
    turn: g.turnNumber,
    active: g.activePlayerIndex,
    step,
    ...(attacks.length > 0 ? { attacks } : {}),
    ...(defender !== undefined ? { defender } : {}),
  },
});

const read = (t: { g: GameState; records: CardRecords }, seat: number, unit: CombatUnit): UnitRead =>
  readUnit(t.g, seat, unit, t.records)!;

describe('who can be attacked, and who is', () => {
  test('attackTargets: every other living player, in turn order after the attacker', () => {
    const { g } = pod();
    const picking = withCombat(g, 'attackers');
    expect(attackTargets(picking, picking.combat!)).toEqual([1, 2]);
    const samOut = adjustLife(picking, 1, -40);
    expect(attackTargets(samOut, samOut.combat!)).toEqual([2]);
    // seat 1 attacking: the order starts after them and wraps
    const { g: four } = table([{}, {}, {}, {}]);
    const from1 = withCombat({ ...four, activePlayerIndex: 1 }, 'attackers');
    expect(attackTargets(from1, from1.combat!)).toEqual([2, 3, 0]);
  });

  test('litTarget: the opponent this device chose while they can still be attacked, otherwise the first', () => {
    const { g } = pod();
    const picking = withCombat(g, 'attackers');
    expect(litTarget(picking, picking.combat!, null)).toBe(1);
    expect(litTarget(picking, picking.combat!, 2)).toBe(2);
    expect(litTarget(picking, picking.combat!, 0)).toBe(1); // the attacker is nobody's target
    expect(litTarget(picking, picking.combat!, 9)).toBe(1);
    const alexOut = adjustLife(picking, 2, -40);
    expect(litTarget(alexOut, alexOut.combat!, 2)).toBe(1); // the chosen one was defeated
    const alone = adjustLife(alexOut, 1, -40);
    expect(litTarget(alone, alone.combat!, null)).toBeNull();
  });

  test('attacksAt / attackersAt: the attacks coming at one player, numbered in the order declared', () => {
    const { g } = pod();
    const c = withCombat(g, 'blockers', [
      { unit: card('bear'), target: 1 },
      { unit: card('giant'), target: 2 },
      { unit: stack('soldiers'), n: 3, target: 1 },
      { unit: stack('soldiers'), target: 2 },
    ], 1).combat!;
    expect(attacksAt(c, 1).map((a) => [a.no, a.index, unitKey(a.attack.unit)])).toEqual([
      [1, 0, 'card:bear'],
      [2, 2, 'stack:soldiers'],
    ]);
    expect(attacksAt(c, 2).map((a) => [a.no, a.index])).toEqual([[1, 1], [2, 3]]);
    expect(attacksAt(c, 0)).toEqual([]);
    expect(attackersAt(c, 1)).toBe(4); // one bear and three soldiers
    expect(attackersAt(c, 2)).toBe(2);
    expect(attackersAt(c, 3)).toBe(0);
  });

  test('litAttack: the tile this device lit if it is coming at that defender, otherwise the first', () => {
    const { g } = pod();
    const c = withCombat(g, 'blockers', [
      { unit: card('bear'), target: 1 },
      { unit: card('giant'), target: 2 },
      { unit: stack('soldiers'), n: 3, target: 1 },
    ], 1).combat!;
    expect(litAttack(c, 1, null)?.index).toBe(0);
    expect(litAttack(c, 1, 2)?.no).toBe(2);
    expect(litAttack(c, 1, 1)?.index).toBe(0); // that one is coming at Alex
    expect(litAttack(c, 2, 2)?.index).toBe(1); // a light left over from the defender before
    expect(litAttack(c, 3, null)).toBeNull();
  });
});

describe('picking attackers', () => {
  const picking = (attacks: CombatAttack[] = []) => {
    const t = pod();
    const g = withCombat(t.g, 'attackers', attacks);
    return { t: { g, records: t.records }, c: g.combat! };
  };

  test('a tap points a creature at the lit opponent', () => {
    const { t, c } = picking();
    expect(attackTap(c, read(t, 0, card('bear')), 1)).toEqual({ unit: card('bear'), target: 1, n: 1 });
    expect(attackTap(c, read(t, 0, card('bear')), 2)).toEqual({ unit: card('bear'), target: 2, n: 1 });
  });

  test('a tap on a creature already pointed there takes it back; pointed elsewhere it is re-pointed', () => {
    const { t, c } = picking([{ unit: card('bear'), target: 1 }]);
    expect(attackTap(c, read(t, 0, card('bear')), 1)).toEqual({ unit: card('bear'), target: 1, n: 0 });
    expect(attackTap(c, read(t, 0, card('bear')), 2)).toEqual({ unit: card('bear'), target: 2, n: 1 });
  });

  test('a creature that cannot attack ignores the tap: tapped, or summoning sick', () => {
    const { t, c } = picking();
    expect(attackTap(c, read(t, 0, card('wurm')), 1)).toBeNull();
    expect(attackTap(c, read(t, 0, card('angel')), 1)).toBeNull();
    expect(freeToSend(c, read(t, 0, card('wurm')))).toBe(0);
    expect(freeToSend(c, read(t, 0, card('bear')))).toBe(1);
  });

  test('…but one sent in anyway from the hold can be taken back and re-pointed with a tap', () => {
    const { t, c } = picking([{ unit: card('wurm'), target: 1 }]);
    expect(attackTap(c, read(t, 0, card('wurm')), 1)).toEqual({ unit: card('wurm'), target: 1, n: 0 });
    expect(attackTap(c, read(t, 0, card('wurm')), 2)).toEqual({ unit: card('wurm'), target: 2, n: 1 });
  });

  test('only creatures change meaning: a mana rock in the front row is never picked by a tap', () => {
    const { t, c } = picking();
    expect(attackTap(c, read(t, 0, card('ring')), 1)).toBeNull();
    expect(read(t, 0, card('ring')).creature).toBe(false);
  });

  test('a tap on a stack adds one copy at the lit opponent and STOPS at the last free copy — it never wraps', () => {
    const soldiers = stack('soldiers'); // five, one tapped: four may attack
    let { t, c } = picking();
    expect(freeToSend(c, read(t, 0, soldiers))).toBe(4);
    expect(attackTap(c, read(t, 0, soldiers), 1)).toEqual({ unit: soldiers, target: 1, n: 1 });
    ({ t, c } = picking([{ unit: soldiers, n: 3, target: 1 }]));
    expect(attackTap(c, read(t, 0, soldiers), 1)).toEqual({ unit: soldiers, target: 1, n: 4 });
    expect(attackTap(c, read(t, 0, soldiers), 2)).toEqual({ unit: soldiers, target: 2, n: 1 }); // some at each
    ({ t, c } = picking([{ unit: soldiers, n: 3, target: 1 }, { unit: soldiers, target: 2 }]));
    expect(freeToSend(c, read(t, 0, soldiers))).toBe(0);
    expect(attackTap(c, read(t, 0, soldiers), 1)).toBeNull(); // the last free copy is in: nothing more
    expect(attackTap(c, read(t, 0, soldiers), 2)).toBeNull();
    expect(attackingCopies(c, soldiers)).toEqual({ total: 4, at: [[1, 3], [2, 1]] });
  });

  test('the stepper’s minus takes one back from the lit opponent, or from wherever the last one went', () => {
    const soldiers = stack('soldiers');
    const { t, c } = picking([{ unit: soldiers, n: 3, target: 1 }, { unit: soldiers, target: 2 }]);
    expect(attackLess(c, read(t, 0, soldiers), 1)).toEqual({ unit: soldiers, target: 1, n: 2 });
    expect(attackLess(c, read(t, 0, soldiers), 2)).toEqual({ unit: soldiers, target: 2, n: 0 });
    const onlySam = picking([{ unit: soldiers, n: 2, target: 1 }]);
    expect(attackLess(onlySam.c, read(onlySam.t, 0, soldiers), 2)).toEqual({ unit: soldiers, target: 1, n: 1 });
    const none = picking();
    expect(attackLess(none.c, read(none.t, 0, soldiers), 1)).toBeNull();
  });

  test('"attack anyway" sends in what a tap refuses: a tapped creature, one more copy than is free, a card that is no creature', () => {
    const soldiers = stack('soldiers');
    const { t, c } = picking([{ unit: soldiers, n: 4, target: 1 }]);
    expect(attackAnyway(c, read(t, 0, card('wurm')), 1)).toEqual({ unit: card('wurm'), target: 1, n: 1 });
    expect(attackAnyway(c, read(t, 0, card('ring')), 2)).toEqual({ unit: card('ring'), target: 2, n: 1 });
    expect(attackAnyway(c, read(t, 0, soldiers), 1)).toEqual({ unit: soldiers, target: 1, n: 5 }); // the tapped one too
    const all = picking([{ unit: soldiers, n: 5, target: 1 }, { unit: card('wurm'), target: 1 }]);
    expect(attackAnyway(all.c, read(all.t, 0, soldiers), 1)).toBeNull(); // every copy is in
    expect(attackAnyway(all.c, read(all.t, 0, card('wurm')), 1)).toBeNull(); // already there
    expect(attackAnyway(all.c, read(all.t, 0, card('wurm')), 2)).toEqual({ unit: card('wurm'), target: 2, n: 1 });
  });

  test('attackNone: everything it would take to stand a unit down', () => {
    const soldiers = stack('soldiers');
    const { c } = picking([{ unit: soldiers, n: 3, target: 1 }, { unit: card('bear'), target: 2 }, { unit: soldiers, target: 2 }]);
    expect(attackNone(c, soldiers)).toEqual([
      { unit: soldiers, target: 1, n: 0 },
      { unit: soldiers, target: 2, n: 0 },
    ]);
    expect(attackNone(c, card('bear'))).toEqual([{ unit: card('bear'), target: 2, n: 0 }]);
    expect(attackNone(c, card('giant'))).toEqual([]);
  });

  test('"All attack" adds every creature a tap could add that is not attacking yet — never one with defender', () => {
    const { t, c } = picking([{ unit: card('giant'), target: 2 }, { unit: stack('soldiers'), target: 2 }]);
    const picks = allAttack(c, readUnits(t.g, 0, t.records), 1);
    expect(picks).toEqual([
      { unit: card('bear'), target: 1, n: 1 },
      // the giant already attacks Alex: left where it is. The wall has defender, the wurm is tapped,
      // the angel is summoning sick, the ring is no creature.
      { unit: stack('soldiers'), target: 1, n: 3 }, // the three free copies; the one at Alex stays there
    ]);
    const again = picking([
      { unit: card('giant'), target: 2 },
      { unit: card('bear'), target: 1 },
      { unit: stack('soldiers'), target: 2 },
      { unit: stack('soldiers'), n: 3, target: 1 },
    ]);
    expect(allAttack(again.c, readUnits(again.t.g, 0, again.t.records), 1)).toEqual([]);
  });

  test('nothing is picked outside the attackers step', () => {
    const t = pod();
    const g = withCombat(t.g, 'blockers', [{ unit: card('giant'), target: 1 }], 1);
    expect(attackTap(g.combat!, read({ g, records: t.records }, 0, card('bear')), 1)).toBeNull();
    expect(attackAnyway(g.combat!, read({ g, records: t.records }, 0, card('bear')), 1)).toBeNull();
    expect(allAttack(g.combat!, readUnits(g, 0, t.records), 1)).toEqual([]);
  });
});

describe('picking blockers', () => {
  /** Nathan's bear, giant and three soldiers come at Sam; Sam is choosing. */
  const blocking = (more: (attacks: CombatAttack[]) => CombatAttack[] = (a) => a) => {
    const t = pod();
    const attacks: CombatAttack[] = more([
      { unit: card('bear'), target: 1 },
      { unit: card('giant'), target: 1 },
      { unit: stack('soldiers'), n: 3, target: 1 },
    ]);
    const g = withCombat(t.g, 'blockers', attacks, 1);
    return { t: { g, records: t.records }, c: g.combat! };
  };
  const tile = (c: CombatState, no: number) => attacksAt(c, 1)[no - 1];

  test('a tap points one of your creatures at the lit attacker', () => {
    const { t, c } = blocking();
    expect(blockTap(c, 1, read(t, 1, card('sbear')), tile(c, 2))).toEqual({
      attacker: card('giant'),
      blocker: card('sbear'),
      n: 1,
    });
  });

  test('a tap on one already there takes it back; one pointed elsewhere moves', () => {
    const { t, c } = blocking((a) => [{ ...a[0], blockers: [card('sbear')] }, a[1], a[2]]);
    expect(blockTap(c, 1, read(t, 1, card('sbear')), tile(c, 1))).toEqual({ attacker: card('bear'), blocker: card('sbear'), n: 0 });
    expect(blockTap(c, 1, read(t, 1, card('sbear')), tile(c, 2))).toEqual({ attacker: card('giant'), blocker: card('sbear'), n: 1 });
    expect(blockingCopies(c, 1, card('sbear'))).toEqual({ total: 1, at: [[1, 1]] });
  });

  test('a tapped creature cannot block: the tap is ignored, "block anyway" is behind the hold', () => {
    const { t, c } = blocking();
    expect(blockTap(c, 1, read(t, 1, card('sgiant')), tile(c, 1))).toBeNull();
    expect(freeToStand(c, 1, read(t, 1, card('sgiant')))).toBe(0);
    expect(blockAnyway(c, 1, read(t, 1, card('sgiant')), tile(c, 1))).toEqual({
      attacker: card('bear'),
      blocker: card('sgiant'),
      n: 1,
    });
  });

  test('a stack: each tap puts one more copy in front of the lit attacker and stops at the last free copy', () => {
    const saps = stack('saprolings');
    let { t, c } = blocking();
    expect(freeToStand(c, 1, read(t, 1, saps))).toBe(3);
    expect(blockTap(c, 1, read(t, 1, saps), tile(c, 2))).toEqual({ attacker: card('giant'), blocker: saps, n: 1 });
    ({ t, c } = blocking((a) => [a[0], { ...a[1], blockers: [{ ...saps, n: 2 }] }, a[2]]));
    expect(blockTap(c, 1, read(t, 1, saps), tile(c, 2))).toEqual({ attacker: card('giant'), blocker: saps, n: 3 }); // a gang
    expect(blockTap(c, 1, read(t, 1, saps), tile(c, 1))).toEqual({ attacker: card('bear'), blocker: saps, n: 1 });
    ({ t, c } = blocking((a) => [{ ...a[0], blockers: [saps] }, { ...a[1], blockers: [{ ...saps, n: 2 }] }, a[2]]));
    expect(freeToStand(c, 1, read(t, 1, saps))).toBe(0);
    expect(blockTap(c, 1, read(t, 1, saps), tile(c, 1))).toBeNull();
    expect(blockingCopies(c, 1, saps)).toEqual({ total: 3, at: [[1, 1], [2, 2]] });
  });

  test('each blocking copy takes its own attacking copy of a stack attack: never more blockers than attackers', () => {
    const saps = stack('saprolings');
    const { t, c } = blocking((a) => [a[0], a[1], { ...a[2], n: 2, blockers: [{ ...saps, n: 2 }] }]);
    expect(blockTap(c, 1, read(t, 1, saps), tile(c, 3))).toBeNull(); // both attacking copies are taken
    expect(blockTap(c, 1, read(t, 1, card('sbear')), tile(c, 3))).toBeNull();
    expect(blockTap(c, 1, read(t, 1, saps), tile(c, 1))).toEqual({ attacker: card('bear'), blocker: saps, n: 1 }); // elsewhere is fine
  });

  test('the stepper’s minus takes one back from the lit attacker, or from wherever the last one stands', () => {
    const saps = stack('saprolings');
    const { t, c } = blocking((a) => [{ ...a[0], blockers: [saps] }, { ...a[1], blockers: [{ ...saps, n: 2 }] }, a[2]]);
    expect(blockLess(c, 1, read(t, 1, saps), tile(c, 2))).toEqual({ attacker: card('giant'), blocker: saps, n: 1 });
    expect(blockLess(c, 1, read(t, 1, saps), tile(c, 3))).toEqual({ attacker: card('giant'), blocker: saps, n: 1 });
    expect(blockLess(c, 1, read(t, 1, card('sbear')), tile(c, 1))).toBeNull();
  });

  test('only the seat whose turn it is to block picks, and only in the blockers step', () => {
    const { t, c } = blocking();
    expect(blockTap(c, 2, read(t, 2, card('knight')), tile(c, 1))).toBeNull();
    const done = { ...c, step: 'damage' as const };
    expect(blockTap(done, 1, read(t, 1, card('sbear')), tile(c, 1))).toBeNull();
    expect(blockAnyway(done, 1, read(t, 1, card('sbear')), tile(c, 1))).toBeNull();
    expect(blockTap(c, 1, read(t, 1, card('sbear')), null)).toBeNull(); // nothing is lit: nothing is coming
  });
});

describe('what the bar says', () => {
  test('it opens with a sentence naming the seat and the job', () => {
    const { g } = pod();
    const picking = withCombat(g, 'attackers');
    expect(barSentence(picking, picking.combat!)).toBe('Nathan: pick attackers');
    const attacks: CombatAttack[] = [
      { unit: card('bear'), target: 1 },
      { unit: stack('soldiers'), n: 2, target: 1 },
      { unit: card('giant'), target: 2 },
    ];
    const blocking = withCombat(g, 'blockers', attacks, 1);
    expect(barSentence(blocking, blocking.combat!)).toBe('Sam: block 3 from Nathan');
    const alex = withCombat(g, 'blockers', attacks, 2);
    expect(barSentence(alex, alex.combat!)).toBe('Alex: block 1 from Nathan');
    const damage = withCombat(g, 'damage', attacks);
    expect(barSentence(damage, damage.combat!)).toBe('Nathan’s attack: the damage');
  });

  /** The fight at the damage step, resolved. */
  const resolved = (t: { g: GameState; records: CardRecords }, attacks: CombatAttack[]) => {
    const g = withCombat(t.g, 'damage', attacks);
    return { g, result: resolveCombat(g, g.combat!, t.records) };
  };

  test('one line per defender: what they lose, and their dead by name', () => {
    const t = pod();
    const { g, result } = resolved(t, [
      { unit: card('giant'), target: 1, blockers: [card('sbear')] }, // kills Sam's bear
      { unit: card('bear'), target: 1 },
      { unit: stack('soldiers'), n: 2, target: 2 },
    ]);
    expect(resultLines(g, result)).toEqual(['Sam −2 · Grizzly Bears dies', 'Alex −2']);
  });

  test('a commander is always named, with what it dealt; lifelink and poison are said too', () => {
    const t = table(
      [
        { cards: { atraxa: ATRAXA, skith: SKITHIRYX, hawk: NIGHTHAWK } },
        { cards: { wall: WALL } },
      ],
      config(2, ["Atraxa, Praetors' Voice", null]),
    );
    const { g, result } = resolved(t, [
      { unit: card('atraxa'), target: 1 },
      { unit: card('hawk'), target: 1, blockers: [card('wall')] },
    ]);
    // Atraxa: 4 to Sam, 4 gained. The nighthawk deals 2 to the wall (deathtouch) and gains 2.
    expect(resultLines(g, result)).toEqual([
      'Sam −4 (4 from Atraxa, Praetors\' Voice) · Wall of Omens dies',
      'Nathan +6 life',
    ]);
    const infect = resolved(t, [{ unit: card('skith'), target: 1 }]);
    expect(resultLines(infect.g, infect.result)).toEqual(['Sam −0 · 4 poison']);
  });

  test('the attacker’s own dead get a line of their own; a fight that changes nothing says so', () => {
    const t = pod();
    const trade = resolved(t, [{ unit: card('bear'), target: 1, blockers: [card('sbear')] }]);
    expect(resultLines(trade.g, trade.result)).toEqual(['Sam −0 · Grizzly Bears dies', 'Nathan: Grizzly Bears dies']);
    const walled = resolved(t, [{ unit: card('wall'), target: 2 }]);
    expect(resultLines(walled.g, walled.result)).toEqual(['Alex −0']);
  });

  test('more than three dead on a line are counted, not named — but a commander still is', () => {
    const t = table(
      [
        { cards: { atraxa: ATRAXA }, stacks: [tokens('soldiers', 6)] },
        { tracker: true, stacks: [tokens('saprolings', 6), tokens('wurms', 1, { basePower: 6, baseToughness: 6 })] },
      ],
      config(2, ["Atraxa, Praetors' Voice", null]),
    );
    const { g, result } = resolved(t, [
      { unit: stack('soldiers'), n: 5, target: 1, blockers: [{ ...stack('saprolings'), n: 5 }] },
      { unit: card('atraxa'), target: 1, blockers: [stack('wurms')] }, // 6 damage kills her; deathtouch kills the wurm
    ]);
    expect(resultLines(g, result)).toEqual([
      'Sam −0 · 6 creatures die',
      'Nathan +4 life · Atraxa, Praetors\' Voice and 5 creatures die',
    ]);
    const few = resolved(t, [{ unit: stack('soldiers'), n: 2, target: 1, blockers: [{ ...stack('saprolings'), n: 2 }] }]);
    expect(resultLines(few.g, few.result)).toEqual(['Sam −0 · saprolings ×2 die', 'Nathan: soldiers ×2 die']);
  });

  test('what the engine flagged is said out loud', () => {
    const t = table([
      { cards: { goyf: GOYF, skith: SKITHIRYX }, stacks: [tokens('soldiers', 1)] },
      { cards: { wall: WALL, sbear: BEAR } },
    ]);
    const { result } = resolved(t, [
      { unit: card('goyf'), target: 1 },
      { unit: card('skith'), target: 1, blockers: [card('sbear')] },
      { unit: stack('soldiers'), n: 3, target: 1 }, // the stack holds one
    ]);
    expect(resultFlags(result)).toEqual([
      '1 creature not read (Tarmogoyf)',
      'check the soldiers stack',
      'infect was blocked: its damage to creatures counts as ordinary damage',
    ]);
    const clean = resolved(t, [{ unit: stack('soldiers'), target: 1 }]);
    expect(resultFlags(clean.result)).toEqual([]);
    expect(resultFlags({ ...clean.result, failed: true })).toEqual(['this fight could not be worked out — set it in Review']);
  });
});

describe('a fight that makes no sense', () => {
  test('what the zones read off it comes back empty instead of throwing: they are outside the bar’s error boundary', () => {
    const t = pod();
    for (const attacks of ['nonsense', [null, 7, { target: 1 }], { length: 3 }]) {
      const g = { ...t.g, combat: { id: 'c1', turn: 1, active: 0, step: 'blockers', defender: 1, attacks } } as unknown as GameState;
      const c = g.combat!;
      expect(attacksAt(c, 1)).toEqual([]);
      expect(attackersAt(c, 1)).toBe(0);
      expect(litAttack(c, 1, 0)).toBeNull();
      expect(attackingCopies(c, card('bear'))).toEqual({ total: 0, at: [] });
      expect(blockingCopies(c, 1, card('sbear'))).toEqual({ total: 0, at: [] });
      expect(blockTap(c, 1, read(t, 1, card('sbear')), null)).toBeNull();
      expect(barSentence(g, c)).toBe('Sam: block 0 from Nathan');
      expect(handLine(g, 1)).toBeNull();
      expect(handLine(g, 0)).toBe('Your attack is open on the table');
    }
  });
});

describe('the phone hand view’s line', () => {
  const attacks: CombatAttack[] = [
    { unit: card('bear'), target: 1 },
    { unit: stack('soldiers'), n: 2, target: 1 },
  ];

  test('nothing while no fight involves this seat', () => {
    const { g } = pod();
    expect(handLine(g, 0)).toBeNull();
    expect(handLine(withCombat(g, 'blockers', attacks, 1), 2)).toBeNull(); // Alex is not attacked
  });

  test('the attacker is told their attack is open; a defender who attacks them, with how many', () => {
    const { g } = pod();
    expect(handLine(withCombat(g, 'attackers', attacks), 0)).toBe('Your attack is open on the table');
    expect(handLine(withCombat(g, 'blockers', attacks, 1), 1)).toBe('Nathan attacks you with 3 — block on the table');
    expect(handLine(withCombat(g, 'damage', attacks), 1)).toBe('Nathan attacks you with 3 — the damage is on the table');
    expect(handLine(withCombat(g, 'done'), 0)).toBeNull();
  });
});
