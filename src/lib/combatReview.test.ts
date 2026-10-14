import { describe, expect, test } from 'vitest';
import { applyCombat } from './combat';
import { resolveCombat, type CardRecords } from './combatEngine';
import {
  NO_EDITS,
  lifeAfter,
  nextDeath,
  nudgeDamage,
  nudgeGain,
  nudgeWalker,
  reviewCombat,
  reviewId,
  setDeaths,
  type ReviewEdits,
} from './combatReview';
import { reviewLines, resultLines } from './combatView';
import { createGame } from './game';
import type {
  BoardItem,
  CardInstance,
  CardRecord,
  CombatAttack,
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
const WALL = rec('Wall of Omens', '0', '4', 'Defender');
const NIGHTHAWK = rec('Vampire Nighthawk', '2', '3', 'Flying\nDeathtouch\nLifelink');
const GOYF = rec('Tarmogoyf', '*', '1+*');
const SKITHIRYX = rec('Skithiryx, the Blight Dragon', '4', '4', 'Flying\nInfect', 'Legendary Creature — Phyrexian Dragon Skeleton');
const CONTAMINATOR = rec('Bloated Contaminator', '4', '4', 'Trample\nToxic 1');
const ATRAXA = rec("Atraxa, Praetors' Voice", '4', '4', 'Flying, vigilance, deathtouch, lifelink', 'Legendary Creature — Phyrexian Angel Horror');
const RHINO = rec('Rhino', '5', '5', 'Trample');

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
  /** Instance ids of this seat's commanders (tracked per card). */
  cmd?: string[];
}

/** A table with those sides at the damage step of seat 0's attack. */
function fight(sides: Side[], attacks: CombatAttack[], cfg = config(sides.length)) {
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
        : {
            cards: {
              library: [],
              hand: [],
              battlefield,
              graveyard: [],
              exile: [],
              command: [],
              mulligans: 0,
              deckName: 'Test',
              ...(side.cmd ? { cmd: Object.fromEntries(side.cmd.map((iid) => [iid, 0])) } : {}),
            },
          }),
    };
  });
  const g: GameState = {
    ...base,
    players,
    combat: { id: 'c1', turn: base.turnNumber, active: 0, step: 'damage', attacks },
  };
  return { g, c: g.combat!, records };
}

const edits = (over: Partial<ReviewEdits>): ReviewEdits => ({ ...NO_EDITS, ...over });

/** Fights of every kind: left alone, the sheet must say exactly what the engine worked out. */
const FIGHTS: [string, ReturnType<typeof fight>][] = [
  [
    'a trade, a chump and an unblocked bear',
    fight(
      [{ cards: { bear: BEAR, giant: GIANT, hawk: NIGHTHAWK } }, { cards: { sbear: BEAR, wall: WALL } }],
      [
        { unit: card('bear'), target: 1 },
        { unit: card('giant'), target: 1, blockers: [card('sbear')], tapped: 1 },
        { unit: card('hawk'), target: 1, blockers: [card('wall')], tapped: 1 },
      ],
    ),
  ],
  [
    'stacks on both sides, some blocked, some tapped by the declaration',
    fight(
      [{ tracker: true, stacks: [tokens('soldiers', 5, { tapped: 4 })] }, { tracker: true, stacks: [tokens('saprolings', 3)] }, { tracker: true }],
      [
        { unit: stack('soldiers'), n: 3, target: 1, blockers: [{ ...stack('saprolings'), n: 2 }], tapped: 3 },
        { unit: stack('soldiers'), target: 2, tapped: 1 },
      ],
    ),
  ],
  [
    'an infect commander, a toxic trampler and a lifelink blocker',
    fight(
      [{ cards: { skith: SKITHIRYX, tox: CONTAMINATOR, bear: BEAR }, cmd: ['skith'] }, { cards: { hawk: NIGHTHAWK } }],
      [
        { unit: card('skith'), target: 1 },
        { unit: card('tox'), target: 1 },
        { unit: card('bear'), target: 1, blockers: [card('hawk')] },
      ],
    ),
  ],
  [
    'a commander that dies, an unread creature and a paper blocker',
    fight(
      [{ cards: { atraxa: ATRAXA, goyf: GOYF, bear: BEAR }, cmd: ['atraxa'] }, { tracker: true, stacks: [tokens('wurms', 1, { basePower: 6, baseToughness: 6 })] }],
      [
        { unit: card('atraxa'), target: 1, blockers: [stack('wurms')] },
        { unit: card('goyf'), target: 1 },
        { unit: card('bear'), target: 1, blocked: true },
      ],
    ),
  ],
  ['nobody attacks', fight([{ cards: { bear: BEAR } }, { cards: {} }], [])],
];

describe('left alone, Review says what the engine worked out', () => {
  test.each(FIGHTS)('%s', (_name, { g, c, records }) => {
    const engine = resolveCombat(g, c, records);
    const review = reviewCombat(g, c, records, NO_EDITS);
    expect(review.outcome).toEqual(engine.outcome);
    // …and applying it is applying the engine's result
    expect(applyCombat(g, c.id, review.outcome)).toEqual(applyCombat(g, c.id, engine.outcome));
  });
});

describe('what the sheet shows', () => {
  test('per defender: a stepper for each commander hitting them and one for all the others — their sum is the life lost', () => {
    const { g, c, records } = fight(
      [{ cards: { atraxa: ATRAXA, bear: BEAR, giant: GIANT }, cmd: ['atraxa'] }, { cards: {} }, { cards: {} }],
      [
        { unit: card('atraxa'), target: 1 },
        { unit: card('bear'), target: 1 },
        { unit: card('giant'), target: 2 },
      ],
    );
    const review = reviewCombat(g, c, records, NO_EDITS);
    expect(review.defenders).toEqual([
      { seat: 1, commanders: [{ key: 'p0', name: "Atraxa, Praetors' Voice", damage: 4, infect: false }], other: 2, poison: null, lost: 6 },
      { seat: 2, commanders: [], other: 3, poison: null, lost: 3 },
    ]);
    expect(review.outcome.players).toEqual([
      { seat: 1, life: -6, commander: { p0: 4 } },
      { seat: 2, life: -3 },
      { seat: 0, life: 4 }, // Atraxa's lifelink
    ]);
  });

  test('a commander that was stopped still gets its stepper, at nothing: the players may know better', () => {
    const { g, c, records } = fight(
      [{ cards: { atraxa: ATRAXA }, cmd: ['atraxa'] }, { cards: { wall: WALL } }],
      [{ unit: card('atraxa'), target: 1, blockers: [card('wall')] }],
    );
    const review = reviewCombat(g, c, records, NO_EDITS);
    expect(review.defenders[0].commanders).toEqual([{ key: 'p0', name: "Atraxa, Praetors' Voice", damage: 0, infect: false }]);
    const trampled = reviewCombat(g, c, records, edits({ commander: { [reviewId(1, 'p0')]: 2 } }));
    expect(trampled.defenders[0]).toMatchObject({ commanders: [{ damage: 2 }], lost: 2 });
    expect(trampled.outcome.players).toContainEqual({ seat: 1, life: -2, commander: { p0: 2 } });
  });

  test('the steppers add to the engine’s numbers and never go below nothing', () => {
    const { g, c, records } = fight(
      [{ cards: { bear: BEAR } }, { cards: {} }],
      [{ unit: card('bear'), target: 1 }],
    );
    expect(reviewCombat(g, c, records, edits({ other: { 1: 3 } })).outcome.players).toEqual([{ seat: 1, life: -5 }]);
    expect(reviewCombat(g, c, records, edits({ other: { 1: -1 } })).outcome.players).toEqual([{ seat: 1, life: -1 }]);
    const none = reviewCombat(g, c, records, edits({ other: { 1: -9 } }));
    expect(none.defenders[0].other).toBe(0);
    expect(none.outcome.players).toEqual([]); // nothing happens to anyone
  });

  test('poison and life gained have steppers only when infect, toxic or lifelink is in the fight', () => {
    const plain = fight([{ cards: { bear: BEAR } }, { cards: { sbear: BEAR } }], [{ unit: card('bear'), target: 1 }]);
    const none = reviewCombat(plain.g, plain.c, plain.records, NO_EDITS);
    expect(none.defenders[0].poison).toBeNull();
    expect(none.gains).toEqual([]);

    const { g, c, records } = fight(
      [{ cards: { skith: SKITHIRYX, tox: CONTAMINATOR, hawk: NIGHTHAWK }, cmd: ['skith'] }, { cards: { shawk: NIGHTHAWK, wall: WALL } }],
      [
        { unit: card('skith'), target: 1 },
        { unit: card('tox'), target: 1, blockers: [card('wall')] }, // 4 on the wall, nothing over: no toxic
        { unit: card('hawk'), target: 1, blockers: [card('shawk')] },
      ],
    );
    const review = reviewCombat(g, c, records, NO_EDITS);
    // the infect commander: 4 on its gauge and 4 poison, no life
    expect(review.defenders[0]).toEqual({
      seat: 1,
      commanders: [{ key: 'p0', name: 'Skithiryx, the Blight Dragon', damage: 4, infect: true }],
      other: 0,
      poison: 4,
      lost: 0,
    });
    // both nighthawks dealt 2: the attacking player's gain is there too
    expect(review.gains).toEqual([{ seat: 0, life: 2 }, { seat: 1, life: 2 }]);
    const more = reviewCombat(g, c, records, edits({ poison: { 1: 1 }, gain: { 0: 3, 1: -2 }, commander: { [reviewId(1, 'p0')]: 1 } }));
    expect(more.outcome.players).toEqual([
      { seat: 1, life: 0, commander: { p0: 5 }, poison: 5 },
      { seat: 0, life: 5 },
    ]);
  });

  test('a lifelink creature that dealt nothing still gets its player a stepper, at nothing', () => {
    const { g, c, records } = fight(
      [{ cards: { hawk: NIGHTHAWK } }, { cards: {} }],
      [{ unit: card('hawk'), target: 1, blocked: true }],
    );
    const review = reviewCombat(g, c, records, NO_EDITS);
    expect(review.gains).toEqual([{ seat: 0, life: 0 }]);
    expect(review.outcome.players).toEqual([]);
  });

  test('EVERY attacker and blocker is listed with its "dies" tick, pre-set by the engine', () => {
    const { g, c, records } = fight(
      [{ cards: { bear: BEAR, giant: GIANT, goyf: GOYF }, stacks: [tokens('soldiers', 4)] }, { cards: { sbear: BEAR, wall: WALL }, stacks: [tokens('saprolings', 3)] }],
      [
        { unit: card('bear'), target: 1 },
        { unit: card('giant'), target: 1, blockers: [card('sbear')] },
        { unit: card('goyf'), target: 1, blockers: [card('wall')] },
        { unit: stack('soldiers'), n: 3, target: 1, blockers: [{ ...stack('saprolings'), n: 2 }] },
      ],
    );
    const review = reviewCombat(g, c, records, NO_EDITS);
    expect(review.units.map((u) => `${u.seat} ${u.name} ${u.size} ×${u.n}: ${u.dies}${u.attacking ? ' attacker' : ''}`)).toEqual([
      '0 Grizzly Bears 2/2 ×1: 0 attacker',
      '0 Hill Giant 3/3 ×1: 0 attacker',
      '1 Grizzly Bears 2/2 ×1: 1',
      '0 Tarmogoyf ? ×1: 0 attacker', // not read: never killed by the app
      '1 Wall of Omens 0/4 ×1: 0',
      '0 soldiers 1/1 ×3: 2 attacker',
      '1 saprolings 1/1 ×2: 2',
    ]);
  });

  test('a death can be added as well as removed', () => {
    const { g, c, records } = fight(
      [{ cards: { bear: BEAR, giant: GIANT } }, { cards: { sbear: BEAR } }],
      [
        { unit: card('bear'), target: 1 },
        { unit: card('giant'), target: 1, blockers: [card('sbear')] },
      ],
    );
    expect(reviewCombat(g, c, records, NO_EDITS).outcome.deaths).toEqual([{ seat: 1, unit: card('sbear') }]);
    const spared = reviewCombat(g, c, records, edits({ dies: { [reviewId(1, card('sbear'))]: 0 } }));
    expect(spared.outcome.deaths).toEqual([]);
    const giantToo = reviewCombat(g, c, records, edits({ dies: { [reviewId(0, card('giant'))]: 1 } }));
    expect(giantToo.outcome.deaths).toEqual([
      { seat: 0, unit: card('giant') },
      { seat: 1, unit: card('sbear') },
    ]);
  });

  test('a stack’s dead are a number, never more than fought; the tapped attackers among them are worked out again', () => {
    const { g, c, records } = fight(
      [{ tracker: true, stacks: [tokens('soldiers', 6, { tapped: 4 })] }, { tracker: true, stacks: [tokens('saprolings', 3)] }],
      [{ unit: stack('soldiers'), n: 4, target: 1, blockers: [{ ...stack('saprolings'), n: 2 }], tapped: 4 }],
    );
    const engine = reviewCombat(g, c, records, NO_EDITS);
    expect(engine.outcome.deaths).toEqual([
      { seat: 0, unit: stack('soldiers'), n: 2, tapped: 2 },
      { seat: 1, unit: stack('saprolings'), n: 2 },
    ]);
    const wiped = reviewCombat(g, c, records, edits({ dies: { [reviewId(0, stack('soldiers'))]: 9 } }));
    expect(wiped.units[0]).toMatchObject({ n: 4, dies: 4 }); // only four fought
    expect(wiped.outcome.deaths[0]).toEqual({ seat: 0, unit: stack('soldiers'), n: 4, tapped: 4 });
    const one = reviewCombat(g, c, records, edits({ dies: { [reviewId(0, stack('soldiers'))]: 1, [reviewId(1, stack('saprolings'))]: 0 } }));
    expect(one.outcome.deaths).toEqual([{ seat: 0, unit: stack('soldiers'), n: 1, tapped: 1 }]);
    // the survivors that stayed home are not left looking tapped
    const after = applyCombat(g, 'c1', wiped.outcome);
    expect(after.players[0].board[0]).toMatchObject({ count: 2 });
    expect(after.players[0].board[0].tapped ?? 0).toBe(0);
  });

  test('a dying commander goes to the command zone (+2) unless that second tick is taken off', () => {
    const { g, c, records } = fight(
      [{ cards: { atraxa: ATRAXA, bear: BEAR }, cmd: ['atraxa'] }, { tracker: true, stacks: [tokens('wurms', 1, { basePower: 6, baseToughness: 6 })] }],
      [{ unit: card('atraxa'), target: 1, blockers: [stack('wurms')] }, { unit: card('bear'), target: 1 }],
    );
    const review = reviewCombat(g, c, records, NO_EDITS);
    expect(review.units.map((u) => [u.name, u.dies, u.commander, u.home])).toEqual([
      ["Atraxa, Praetors' Voice", 1, true, true],
      ['wurms', 1, false, false],
      ['Grizzly Bears', 0, false, false],
    ]);
    expect(review.outcome.deaths[0]).toEqual({ seat: 0, unit: card('atraxa'), toCommand: true });
    const buried = reviewCombat(g, c, records, edits({ home: { [reviewId(0, card('atraxa'))]: false } }));
    expect(buried.outcome.deaths[0]).toEqual({ seat: 0, unit: card('atraxa') });
    expect(applyCombat(g, 'c1', buried.outcome).players[0].cards!.graveyard.map((x) => x.name)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(applyCombat(g, 'c1', review.outcome).players[0].cards!.command.map((x) => x.name)).toEqual(["Atraxa, Praetors' Voice"]);
  });

  test('ANY attack can be ticked "blocked": its damage comes off that defender’s numbers, and off again', () => {
    // Kim has nothing on the tablet: she never got a blockers step for her paper cards.
    const { g, c, records } = fight(
      [{ cards: { rhino: RHINO, hawk: NIGHTHAWK }, stacks: [tokens('soldiers', 3)] }, { tracker: true }],
      [
        { unit: card('rhino'), target: 1 },
        { unit: card('hawk'), target: 1 },
        { unit: stack('soldiers'), n: 3, target: 1 },
      ],
    );
    const open = reviewCombat(g, c, records, NO_EDITS);
    expect(open.attacks.map((a) => [a.index, a.name, a.n, a.target, a.blocked, a.fixed])).toEqual([
      [0, 'Rhino', 1, 1, false, false],
      [1, 'Vampire Nighthawk', 1, 1, false, false],
      [2, 'soldiers', 3, 1, false, false],
    ]);
    expect(open.outcome.players).toEqual([{ seat: 1, life: -10 }, { seat: 0, life: 2 }]);
    const stopped = reviewCombat(g, c, records, edits({ blocked: { 0: true, 1: true } }));
    expect(stopped.attacks.map((a) => a.blocked)).toEqual([true, true, false]);
    expect(stopped.defenders[0].other).toBe(3); // the soldiers only: no trample past paper, no lifelink
    expect(stopped.outcome.players).toEqual([{ seat: 1, life: -3 }]);
    expect(stopped.gains).toEqual([{ seat: 0, life: 0 }]);
    // an edit made before the tick stays on top of the new numbers
    const plusTwo = reviewCombat(g, c, records, edits({ blocked: { 2: true }, other: { 1: 2 } }));
    expect(plusTwo.defenders[0].other).toBe(9); // 5 + 2 + the two typed in
    expect(reviewCombat(g, c, records, edits({ blocked: { 0: false } })).outcome).toEqual(open.outcome);
  });

  test('an attack the tablet’s blockers already stopped is ticked and stays ticked; a mark made at the table can be taken off', () => {
    const { g, c, records } = fight(
      [{ cards: { bear: BEAR, giant: GIANT }, stacks: [tokens('soldiers', 3)] }, { cards: { wall: WALL }, stacks: [tokens('saprolings', 3)] }],
      [
        { unit: card('bear'), target: 1, blockers: [card('wall')] },
        { unit: card('giant'), target: 1, blocked: true },
        { unit: stack('soldiers'), n: 3, target: 1, blockers: [stack('saprolings')] }, // one of three blocked
      ],
    );
    const review = reviewCombat(g, c, records, NO_EDITS);
    expect(review.attacks.map((a) => [a.name, a.blocked, a.fixed, a.by])).toEqual([
      ['Grizzly Bears', true, true, 'Wall of Omens'],
      ['Hill Giant', true, false, ''],
      ['soldiers', false, false, 'saprolings'],
    ]);
    const through = reviewCombat(g, c, records, edits({ blocked: { 0: false, 1: false, 2: true } }));
    expect(through.attacks.map((a) => a.blocked)).toEqual([true, false, true]); // the wall is really there
    expect(through.defenders[0].other).toBe(3); // the giant gets through, every soldier is stopped
  });

  test('a creature that has left the battlefield is not listed: it cannot die here', () => {
    const { g, c, records } = fight(
      [{ cards: { bear: BEAR } }, { cards: { sbear: BEAR } }],
      [
        { unit: card('bear'), target: 1, blockers: [card('gone')] },
        { unit: card('left'), target: 1 },
      ],
    );
    const review = reviewCombat(g, c, records, NO_EDITS);
    expect(review.units.map((u) => u.name)).toEqual(['Grizzly Bears']);
    expect(review.attacks.map((a) => a.index)).toEqual([0]);
    // a tick aimed at something that is not there changes nothing
    expect(reviewCombat(g, c, records, edits({ dies: { [reviewId(0, card('left'))]: 1 } })).outcome).toEqual(review.outcome);
  });

  test('it says who the result would defeat', () => {
    const { g, c, records } = fight(
      [{ cards: { rhino: RHINO } }, { cards: {} }],
      [{ unit: card('rhino'), target: 1 }],
    );
    const low: GameState = { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, life: 5 } : p)) };
    expect(reviewCombat(low, c, records, NO_EDITS).defeats).toEqual([1]);
    expect(reviewCombat(low, c, records, edits({ other: { 1: -1 } })).defeats).toEqual([]);
    expect(reviewCombat(g, c, records, NO_EDITS).defeats).toEqual([]);
  });

  test('a fight that cannot be worked out is an empty sheet, not a crash', () => {
    const { g, records } = fight([{ cards: { bear: BEAR } }, { cards: {} }], []);
    const broken = { id: 'c1', turn: 1, active: 0, step: 'damage', attacks: 'nonsense' } as unknown as GameState['combat'];
    const review = reviewCombat({ ...g, combat: broken }, broken!, records, NO_EDITS);
    expect(review.outcome).toEqual({ players: [], deaths: [] });
    expect(review.units).toEqual([]);
  });
});

describe('what a press on the board changes', () => {
  /** The bears trade, the giant and three soldiers get through: Sam loses 6. */
  const brawl = () =>
    fight(
      [{ cards: { bear: BEAR, giant: GIANT }, stacks: [tokens('soldiers', 3)] }, { cards: { sbear: BEAR } }],
      [
        { unit: card('bear'), target: 1, blockers: [card('sbear')] },
        { unit: card('giant'), target: 1 },
        { unit: stack('soldiers'), target: 1, n: 3 },
      ],
    );
  const unitOf = (t: ReturnType<typeof fight>, e: ReviewEdits, seat: number, unit: CombatUnit) =>
    reviewCombat(t.g, t.c, t.records, e).units.find((u) => u.id === reviewId(seat, unit))!;

  test('a tap on a card is dies / lives, and what it shows already changes nothing', () => {
    const t = brawl();
    const bear = unitOf(t, NO_EDITS, 0, card('bear'));
    expect(bear.dies).toBe(1);
    const saved = nextDeath(NO_EDITS, bear);
    expect(unitOf(t, saved, 0, card('bear')).dies).toBe(0);
    const again = nextDeath(saved, unitOf(t, saved, 0, card('bear')));
    expect(unitOf(t, again, 0, card('bear')).dies).toBe(1);
    expect(setDeaths(NO_EDITS, bear, 1)).toBe(NO_EDITS); // the same edits: nothing to redraw
    // the giant was not hurt: a tap kills it all the same — the table knows why
    expect(unitOf(t, nextDeath(NO_EDITS, unitOf(t, NO_EDITS, 0, card('giant'))), 0, card('giant')).dies).toBe(1);
  });

  test('a tap on a stack is one more dead, and past the last copy none; the number never leaves what fought', () => {
    const t = brawl();
    let e = NO_EDITS;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      e = nextDeath(e, unitOf(t, e, 0, stack('soldiers')));
      seen.push(unitOf(t, e, 0, stack('soldiers')).dies);
    }
    expect(seen).toEqual([1, 2, 3, 0, 1]);
    const soldiers = unitOf(t, NO_EDITS, 0, stack('soldiers'));
    expect(unitOf(t, setDeaths(NO_EDITS, soldiers, 9), 0, stack('soldiers')).dies).toBe(3);
    expect(setDeaths(NO_EDITS, soldiers, -4)).toBe(NO_EDITS);
  });

  test('the buttons beside a life total move the damage: more goes on, less empties it and stops at nothing', () => {
    const t = brawl();
    const lost = (e: ReviewEdits) => reviewCombat(t.g, t.c, t.records, e).defenders[0].lost;
    const nudge = (e: ReviewEdits, by: number) => nudgeDamage(reviewCombat(t.g, t.c, t.records, e), e, 1, by);
    expect(lost(NO_EDITS)).toBe(6);
    const more = nudge(NO_EDITS, 2);
    expect(lost(more)).toBe(8);
    const none = nudge(more, -20);
    expect(lost(none)).toBe(0);
    expect(nudge(none, -1)).toBe(none); // nothing left to take away
    expect(nudge(NO_EDITS, 0)).toBe(NO_EDITS);
    expect(nudgeDamage(reviewCombat(t.g, t.c, t.records), NO_EDITS, 0, 1)).toBe(NO_EDITS); // nobody attacked Nathan
    // what Apply carries is what the total shows
    expect(reviewCombat(t.g, t.c, t.records, more).outcome.players).toEqual([{ seat: 1, life: -8 }]);
    expect(lifeAfter(t.g, reviewCombat(t.g, t.c, t.records, more), 1)).toBe(32);
    expect(lifeAfter(t.g, reviewCombat(t.g, t.c, t.records, more), 0)).toBeNull();
  });

  test('with only a commander coming at them the damage moved is commander damage; beside others it is theirs', () => {
    const alone = fight(
      [{ cards: { atraxa: ATRAXA }, cmd: ['atraxa'] }, { cards: {} }],
      [{ unit: card('atraxa'), target: 1 }],
      config(2, ["Atraxa, Praetors' Voice"]),
    );
    const r = reviewCombat(alone.g, alone.c, alone.records);
    const pumped = reviewCombat(alone.g, alone.c, alone.records, nudgeDamage(r, NO_EDITS, 1, 2));
    expect(pumped.defenders[0]).toMatchObject({ commanders: [{ damage: 6 }], other: 0, lost: 6 });
    expect(pumped.outcome.players[0]).toMatchObject({ seat: 1, life: -6, commander: { p0: 6 } });
    // taking it all away empties the commander's number too
    const none = reviewCombat(alone.g, alone.c, alone.records, nudgeDamage(r, NO_EDITS, 1, -9));
    expect(none.defenders[0]).toMatchObject({ commanders: [{ damage: 0 }], other: 0, lost: 0 });

    const beside = fight(
      [{ cards: { atraxa: ATRAXA, bear: BEAR }, cmd: ['atraxa'] }, { cards: {} }],
      [
        { unit: card('atraxa'), target: 1 },
        { unit: card('bear'), target: 1 },
      ],
      config(2, ["Atraxa, Praetors' Voice"]),
    );
    const both = reviewCombat(beside.g, beside.c, beside.records);
    const more = reviewCombat(beside.g, beside.c, beside.records, nudgeDamage(both, NO_EDITS, 1, 1));
    expect(more.defenders[0]).toMatchObject({ commanders: [{ damage: 4 }], other: 3, lost: 7 });
    // less: the others' damage first, then the commander's
    const less = reviewCombat(beside.g, beside.c, beside.records, nudgeDamage(both, NO_EDITS, 1, -3));
    expect(less.defenders[0]).toMatchObject({ commanders: [{ damage: 3 }], other: 0, lost: 3 });
  });

  test('a seat that only gains (lifelink) has that moved instead, never below none', () => {
    const t = fight([{ cards: { hawk: NIGHTHAWK } }, { cards: {} }], [{ unit: card('hawk'), target: 1 }]);
    const r = reviewCombat(t.g, t.c, t.records);
    expect(lifeAfter(t.g, r, 0)).toBe(42);
    const more = nudgeGain(r, NO_EDITS, 0, 1);
    expect(lifeAfter(t.g, reviewCombat(t.g, t.c, t.records, more), 0)).toBe(43);
    const none = nudgeGain(r, NO_EDITS, 0, -5);
    expect(lifeAfter(t.g, reviewCombat(t.g, t.c, t.records, none), 0)).toBe(40);
    expect(nudgeGain(reviewCombat(t.g, t.c, t.records, none), none, 0, -1)).toBe(none);
    expect(nudgeGain(r, NO_EDITS, 1, 1)).toBe(NO_EDITS); // Sam gains nothing here: no number to move
  });

  test('the bar tells the result as it was put right; left alone, exactly as the engine worked it out', () => {
    for (const [, t] of FIGHTS) {
      expect(reviewLines(t.g, reviewCombat(t.g, t.c, t.records))).toEqual(
        resultLines(t.g, resolveCombat(t.g, t.c, t.records)),
      );
    }
    const t = brawl();
    const bear = unitOf(t, NO_EDITS, 0, card('bear'));
    const changed = nudgeDamage(reviewCombat(t.g, t.c, t.records), nextDeath(NO_EDITS, bear), 1, 1);
    expect(reviewLines(t.g, reviewCombat(t.g, t.c, t.records, changed))).toEqual(['Sam −7 · Grizzly Bears dies']);
    expect(reviewLines(t.g, reviewCombat(t.g, t.c, t.records))).toEqual([
      'Sam −6 · Grizzly Bears dies',
      'Nathan: Grizzly Bears dies',
    ]);
  });
});

describe('a planeswalker in the review', () => {
  const JACE = rec('Jace Beleren', null, null, '+2: Each player draws a card.', 'Legendary Planeswalker — Jace');
  const atJace = () =>
    fight(
      [{ cards: { giant: GIANT } }, { cards: { jace: JACE }, wear: { jace: { counters: { loyalty: 5 } } } }],
      [{ unit: card('giant'), target: 1, walker: 'jace' }],
    );

  test('what it takes is shown with its loyalty, put right like any number, and carried by Apply', () => {
    const f = atJace();
    const review = reviewCombat(f.g, f.c, f.records);
    expect(review.walkers).toEqual([{ id: reviewId(1, 'jace'), seat: 1, iid: 'jace', name: 'Jace Beleren', damage: 3, loyalty: 5 }]);
    expect(review.defenders).toEqual([]);
    expect(review.outcome).toEqual({ players: [], deaths: [], walkers: [{ seat: 1, iid: 'jace', n: 3 }] });
    expect(lifeAfter(f.g, review, 1)).toBeNull(); // Sam's life is not in it
    const more = nudgeWalker(review, NO_EDITS, reviewId(1, 'jace'), 2);
    const after = reviewCombat(f.g, f.c, f.records, more);
    expect(after.walkers[0].damage).toBe(5);
    expect(reviewLines(f.g, after)).toEqual(['Sam’s Jace Beleren −5 loyalty (to the graveyard)']);
    const applied = applyCombat(f.g, 'c1', after.outcome);
    expect(applied.players[1].cards!.graveyard.map((c) => c.iid)).toEqual(['jace']);
    // Never below none.
    expect(nudgeWalker(review, NO_EDITS, reviewId(1, 'jace'), -9).walker).toEqual({ [reviewId(1, 'jace')]: -3 });
  });
});
