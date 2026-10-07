import { copiesOf, outcomeDefeats, type CombatOutcome } from './combat';
import { hasKeyword, resolveCombat, type CardRecords, type CombatResult, type Fighter } from './combatEngine';
import { unitKey } from './combatView';
import type { CombatAttack, CombatState, CombatUnit, GameState } from './types';

/** Combat on the cards: the Review sheet's arithmetic. The engine reads
 * the printed card and its +1/+1 counters and nothing else, so before a
 * result lands the table can put it right: more or less damage, a death
 * added or taken away, an attack that a paper card stopped.
 *
 * Pure. The sheet keeps only what the players changed (ReviewEdits);
 * everything it shows, and the outcome Apply carries, is worked out from
 * the fight as it is now plus those changes — so a state arriving from
 * another device under an open sheet moves the numbers, not the edits. */

/** What the players changed in the sheet. Numbers typed into a stepper are
 * kept as what they ADD to the engine's number, so a change made before a
 * "blocked" tick still stands on top of the new sum. */
export interface ReviewEdits {
  /** The "blocked" tick per attack (its place in the combat's list), where
   * it was touched: a paper blocker nobody could mark at the table. */
  blocked: Record<number, boolean>;
  /** Added to a commander's damage on a defender: reviewId(seat, key). */
  commander: Record<string, number>;
  /** Added to the damage from all the other attackers, per defender. */
  other: Record<number, number>;
  /** Added to a defender's poison. */
  poison: Record<number, number>;
  /** Added to a seat's life gained. */
  gain: Record<number, number>;
  /** How many copies of a card or stack die, where it was touched (the
   * number itself, not a difference): reviewId(seat, unit). */
  dies: Record<string, number>;
  /** A dying commander's second tick, where it was touched. */
  home: Record<string, boolean>;
}

export const NO_EDITS: ReviewEdits = {
  blocked: {},
  commander: {},
  other: {},
  poison: {},
  gain: {},
  dies: {},
  home: {},
};

/** The key an edit is kept under: a seat and one of its units, or a
 * defending seat and the commander-damage key hitting it. */
export function reviewId(seat: number, what: CombatUnit | string): string {
  return `${seat}|${typeof what === 'string' ? what : unitKey(what)}`;
}

export interface ReviewDefender {
  seat: number;
  /** One per commander attacking this player: what goes on its gauge. */
  commanders: { key: string; name: string; damage: number; infect: boolean }[];
  /** Life lost to all the other attackers together. */
  other: number;
  /** Poison counters; null when no infect or toxic is coming at them
   * (no stepper). */
  poison: number | null;
  /** The life they lose: `other` plus every commander's damage — except an
   * infect commander's, which is poison. */
  lost: number;
}

export interface ReviewAttack {
  /** Its place in the combat's list of attacks. */
  index: number;
  unit: CombatUnit;
  name: string;
  /** Copies attacking. */
  n: number;
  target: number;
  /** The "blocked" tick: every copy is stopped. */
  blocked: boolean;
  /** The tablet's own blockers stopped it: the tick cannot be taken off. */
  fixed: boolean;
  /** Who was declared in its way, for the row to say. */
  by: string;
}

export interface ReviewUnit {
  /** reviewId(seat, unit). */
  id: string;
  seat: number;
  unit: CombatUnit;
  name: string;
  /** "3/3", or "?" when the app could not read it. */
  size: string;
  /** Copies of it in the fight: no more than these can die here. */
  n: number;
  dies: number;
  /** It is a commander: when it dies it has the second tick. */
  commander: boolean;
  /** …"to the command zone (+2)". */
  home: boolean;
  attacking: boolean;
}

export interface Review {
  /** The fight as the engine works it out with the "blocked" ticks in. */
  result: CombatResult;
  defenders: ReviewDefender[];
  /** Life gained, for every seat with lifelink in the fight. */
  gains: { seat: number; life: number }[];
  attacks: ReviewAttack[];
  /** EVERY attacker and blocker still on the table, attackers first, each
   * followed by what stood in its way. */
  units: ReviewUnit[];
  /** Exactly what the sheet shows, as Apply carries it. */
  outcome: CombatOutcome;
  /** The seats that outcome would defeat. */
  defeats: number[];
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const whole = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : 0);
const atLeastZero = (n: number) => Math.max(0, n);

/** The combat with the sheet's "blocked" ticks written in. A tick the
 * tablet's own blockers already answer is left alone. */
function withTicks(c: CombatState, ticks: ReviewEdits['blocked']): CombatState {
  if (!Array.isArray(c.attacks)) return c;
  const attacks = c.attacks.map((a, i): CombatAttack => {
    const tick = ticks[i];
    if (!a || typeof tick !== 'boolean' || (a.blocked === true) === tick) return a;
    const { blocked: _was, ...rest } = a;
    return tick ? { ...rest, blocked: true } : rest;
  });
  return { ...c, attacks };
}

const EMPTY: Review = {
  result: {
    outcome: { players: [], deaths: [] },
    attacks: [],
    defenders: [],
    gains: [],
    unread: [],
    check: [],
    infectOnCreatures: false,
    failed: true,
  },
  defenders: [],
  gains: [],
  attacks: [],
  units: [],
  outcome: { players: [], deaths: [] },
  defeats: [],
};

function review(g: GameState, combat: CombatState, records: CardRecords, edits: ReviewEdits): Review {
  const c = withTicks(combat, edits.blocked ?? {});
  const result = resolveCombat(g, c, records);
  const declared = Array.isArray(c.attacks) ? c.attacks : [];

  // The attacks: which are stopped, and by what.
  const attacks: ReviewAttack[] = result.attacks
    .filter((row) => row.present)
    .map((row) => {
      const blockers = declared[row.index]?.blockers ?? [];
      const inTheWay = sum(blockers.map(copiesOf));
      const fixed = row.unit.kind === 'card' ? inTheWay > 0 : inTheWay >= row.n;
      const names = row.blockers.map((b, k) => {
        const copies = copiesOf(blockers[k] ?? {});
        return `${b.name || 'a creature'}${copies > 1 ? ` ×${copies}` : ''}`;
      });
      return {
        index: row.index,
        unit: row.unit,
        name: row.name,
        n: row.n,
        target: row.target,
        blocked: fixed || row.paper,
        fixed,
        by: names.join(', '),
      };
    });

  // Every attacker and blocker, once: a stack that fights in two places
  // dies as one stack.
  const byId = new Map<string, ReviewUnit & { engine: number; tappedIn: number }>();
  const meet = (f: Fighter, attacking: boolean, tapped: number) => {
    if (!f.present || f.n <= 0) return;
    const id = reviewId(f.seat, f.unit);
    let unit = byId.get(id);
    if (!unit) {
      unit = {
        id,
        seat: f.seat,
        unit: f.unit,
        name: f.name,
        size: f.unread ? '?' : `${f.power}/${f.toughness}`,
        n: 0,
        dies: 0,
        commander: f.commander !== null,
        home: false,
        attacking,
        engine: 0,
        tappedIn: 0,
      };
      byId.set(id, unit);
    }
    unit.n += f.n;
    unit.engine += f.dies;
    unit.tappedIn += tapped;
  };
  for (const row of result.attacks) {
    meet(row, true, atLeastZero(whole(declared[row.index]?.tapped)));
    for (const blocker of row.blockers) meet(blocker, false, 0);
  }
  const deaths: CombatOutcome['deaths'] = [];
  const units: ReviewUnit[] = [...byId.values()].map(({ engine, tappedIn, ...unit }) => {
    const asked = edits.dies?.[unit.id];
    const dies = Math.min(unit.n, atLeastZero(typeof asked === 'number' ? whole(asked) : engine));
    const home = unit.commander && edits.home?.[unit.id] !== false;
    if (dies > 0) {
      const worked = result.outcome.deaths.find((d) => reviewId(d.seat, d.unit) === unit.id);
      // A stack's dead: left as the engine had them, its own count of tapped
      // attackers stands; changed, as many were tapped as the declaration tapped.
      const tapped = dies === engine ? (worked?.tapped ?? 0) : Math.min(dies, tappedIn);
      const isStack = unit.unit.kind === 'stack';
      deaths.push({
        seat: unit.seat,
        unit: unit.unit,
        ...(isStack ? { n: dies } : {}),
        ...(isStack && tapped > 0 ? { tapped } : {}),
        ...(home ? { toCommand: true as const } : {}),
      });
    }
    return { ...unit, dies, home };
  });

  // What each defender takes.
  const present = result.attacks.filter((row) => row.present);
  const defenders: ReviewDefender[] = result.defenders.map((d) => {
    const coming = present.filter((row) => row.target === d.seat);
    const commanders: ReviewDefender['commanders'] = [];
    for (const row of coming) {
      const key = row.commander;
      if (key === null || commanders.some((cmd) => cmd.key === key)) continue;
      const worked = d.commanders.find((cmd) => cmd.key === key)?.damage ?? 0;
      commanders.push({
        key,
        name: row.name,
        damage: atLeastZero(worked + whole(edits.commander?.[reviewId(d.seat, key)])),
        infect: hasKeyword(row, 'infect'),
      });
    }
    const other = atLeastZero(d.other + whole(edits.other?.[d.seat]));
    const poisonous = d.poison > 0 || coming.some((row) => hasKeyword(row, 'infect') || row.toxic > 0);
    const poison = poisonous ? atLeastZero(d.poison + whole(edits.poison?.[d.seat])) : null;
    const lost = other + sum(commanders.filter((cmd) => !cmd.infect).map((cmd) => cmd.damage));
    return { seat: d.seat, commanders, other, poison, lost };
  });

  // Life gained: a stepper for every seat with lifelink in the fight.
  const gainSeats = result.gains.map((x) => x.seat);
  for (const row of present) {
    for (const f of [row, ...row.blockers]) {
      if (f.present && hasKeyword(f, 'lifelink') && !gainSeats.includes(f.seat)) gainSeats.push(f.seat);
    }
  }
  const gains = gainSeats.map((seat) => ({
    seat,
    life: atLeastZero((result.gains.find((x) => x.seat === seat)?.life ?? 0) + whole(edits.gain?.[seat])),
  }));

  // One entry per player the fight changes, as the engine writes them.
  const players: CombatOutcome['players'] = [];
  for (const seat of new Set([...defenders.map((d) => d.seat), ...gains.map((x) => x.seat)])) {
    const d = defenders.find((x) => x.seat === seat);
    const life = (gains.find((x) => x.seat === seat)?.life ?? 0) - (d?.lost ?? 0);
    const gauges = (d?.commanders ?? []).filter((cmd) => cmd.damage > 0);
    const poison = d?.poison ?? 0;
    if (life === 0 && gauges.length === 0 && poison === 0) continue;
    players.push({
      seat,
      life,
      ...(gauges.length > 0 ? { commander: Object.fromEntries(gauges.map((cmd) => [cmd.key, cmd.damage])) } : {}),
      ...(poison > 0 ? { poison } : {}),
    });
  }

  const outcome: CombatOutcome = { players, deaths };
  return { result, defenders, gains, attacks, units, outcome, defeats: outcomeDefeats(g, outcome) };
}

/** Everything the Review sheet shows for the fight as it is now, with the
 * players' changes in — and the outcome Apply carries, built from exactly
 * that. With no changes it is the engine's own result. It never throws: a
 * fight that cannot be worked out is an empty sheet. */
export function reviewCombat(
  g: GameState,
  combat: CombatState,
  records: CardRecords,
  edits: ReviewEdits = NO_EDITS,
): Review {
  try {
    return review(g, combat, records ?? {}, edits ?? NO_EDITS);
  } catch {
    return EMPTY;
  }
}
