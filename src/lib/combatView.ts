import { copiesOf, liveCombat, sameUnit } from './combat';
import { hasKeyword, type CombatResult, type Fighter, type UnitRead } from './combatEngine';
import type { CombatAttack, CombatState, CombatUnit, GameState } from './types';

/** Combat on the cards, the screen's half of the thinking: what a tap on a
 * creature asks the store for in each pick mode, which opponent or attacker
 * a pick goes to, and the words the bar and the phone say.
 *
 * Pure. Nothing here changes the game: a pick comes back as the numbers to
 * hand the store (or null when the tap is ignored), and the reducers in
 * lib/combat.ts clamp whatever a stale screen asks for. */

export const unitKey = (u: CombatUnit): string => `${u.kind}:${u.id}`;

const seatName = (g: GameState, seat: number) => g.config.profiles[seat]?.name ?? '?';
/** The attacks, or none: much of this is read by the zones themselves,
 * outside the combat bar's error boundary — a fight that makes no sense
 * must leave them drawing, not take the table down. */
const attacksOf = (c: CombatState): (CombatAttack | null | undefined)[] =>
  Array.isArray(c.attacks) ? c.attacks : [];
const isAttack = (a: CombatAttack | null | undefined): a is CombatAttack => !!a && !!a.unit;
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
/** "a", "a and b", "a, b and c". */
const inWords = (parts: string[]) =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

// ---- who can be attacked, and who is ----

/** The opponents an attack can be pointed at: every other living player,
 * in turn order after the attacker. In a pod each gets a chip on the bar. */
export function attackTargets(g: GameState, c: CombatState): number[] {
  const seats = g.players.length;
  const out: number[] = [];
  for (let step = 1; step < seats; step++) {
    const seat = (c.active + step) % seats;
    if (g.players[seat].eliminated === false) out.push(seat);
  }
  return out;
}

/** The lit opponent: the one this device chose, while they can still be
 * attacked — otherwise the first. Null when there is nobody to attack. */
export function litTarget(g: GameState, c: CombatState, wanted: number | null | undefined): number | null {
  const targets = attackTargets(g, c);
  if (wanted !== null && wanted !== undefined && targets.includes(wanted)) return wanted;
  return targets[0] ?? null;
}

/** One attack coming at a defender: a tile of the strip. */
export interface Incoming {
  /** Its number on the strip, from 1: what its blockers wear. */
  no: number;
  /** Its place in the combat's list of attacks. */
  index: number;
  attack: CombatAttack;
}

/** The attacks coming at one player, numbered in the order declared. */
export function attacksAt(c: CombatState, seat: number): Incoming[] {
  const out: Incoming[] = [];
  attacksOf(c).forEach((attack, index) => {
    if (isAttack(attack) && attack.target === seat) out.push({ no: out.length + 1, index, attack });
  });
  return out;
}

/** How many attackers are coming at that player: the "⚔ 3" on their header. */
export function attackersAt(c: CombatState, seat: number): number {
  return sum(attacksAt(c, seat).map((a) => copiesOf(a.attack)));
}

/** The lit attacker: the tile this device lit, if it is coming at that
 * defender — otherwise the first. `wanted` is its place in the combat's
 * list. Null when nothing is coming at them. */
export function litAttack(c: CombatState, seat: number, wanted: number | null | undefined): Incoming | null {
  const tiles = attacksAt(c, seat);
  return tiles.find((t) => t.index === wanted) ?? tiles[0] ?? null;
}

// ---- picking attackers ----

/** What the screen asks the store for: `n` copies of `unit` attack `target`. */
export interface AttackPick {
  unit: CombatUnit;
  target: number;
  n: number;
}

/** Where a unit's copies are pointed: per player, in the order picked. */
export function attackingCopies(c: CombatState, unit: CombatUnit): { total: number; at: [target: number, n: number][] } {
  const at = attacksOf(c)
    .filter(isAttack)
    .filter((a) => sameUnit(a.unit, unit))
    .map((a): [number, number] => [a.target, copiesOf(a)]);
  return { total: sum(at.map(([, n]) => n)), at };
}

/** How many more copies a tap may send: the ones that could attack and are
 * not attacking yet. */
export function freeToSend(c: CombatState, read: UnitRead): number {
  return Math.max(0, read.canAttack - attackingCopies(c, read.unit).total);
}

const plainUnit = (u: CombatUnit): CombatUnit => ({ kind: u.kind, id: u.id });

/** A tap on one of the attacker's units while attackers are picked — null
 * when the tap is not a pick (the unit is no creature and keeps its
 * ordinary tap) or is ignored (it cannot attack: tapped, or summoning
 * sick). A card pointed at the lit opponent is taken back, one pointed
 * elsewhere is re-pointed; a stack gets one more copy at the lit opponent
 * and STOPS at its last free copy — it never wraps round to zero. */
export function attackTap(c: CombatState, read: UnitRead, target: number): AttackPick | null {
  if (c.step !== 'attackers' || !read.creature) return null;
  const unit = plainUnit(read.unit);
  const { total, at } = attackingCopies(c, unit);
  if (unit.kind === 'card') {
    if (total > 0) return { unit, target, n: at[0][0] === target ? 0 : 1 };
    return read.canAttack > 0 ? { unit, target, n: 1 } : null;
  }
  if (freeToSend(c, read) <= 0) return null;
  const here = at.find(([t]) => t === target)?.[1] ?? 0;
  return { unit, target, n: here + 1 };
}

/** The stack stepper's minus: one copy back from the lit opponent, or —
 * when none are pointed there — from wherever the last one went. */
export function attackLess(c: CombatState, read: UnitRead, target: number): AttackPick | null {
  if (c.step !== 'attackers') return null;
  const { at } = attackingCopies(c, read.unit);
  const from = at.find(([t, n]) => t === target && n > 0) ?? at[at.length - 1];
  return from ? { unit: plainUnit(read.unit), target: from[0], n: from[1] - 1 } : null;
}

/** "Attack anyway", behind the hold: sends in what a tap refuses — a
 * tapped or summoning-sick creature, one more copy than is free, a card
 * the app does not read as a creature. Null when it is already there
 * (every copy of a stack, or the card at that very opponent). */
export function attackAnyway(c: CombatState, read: UnitRead, target: number): AttackPick | null {
  if (c.step !== 'attackers') return null;
  const unit = plainUnit(read.unit);
  const { total, at } = attackingCopies(c, unit);
  const here = at.find(([t]) => t === target)?.[1] ?? 0;
  if (unit.kind === 'card') return here > 0 ? null : { unit, target, n: 1 };
  return total >= read.count ? null : { unit, target, n: here + 1 };
}

/** Everything it takes to stand a unit down: one pick per player it is
 * pointed at. */
export function attackNone(c: CombatState, unit: CombatUnit): AttackPick[] {
  if (c.step !== 'attackers') return [];
  return attackingCopies(c, unit).at.map(([target]) => ({ unit: plainUnit(unit), target, n: 0 }));
}

/** "All attack": every creature a tap could add that is not attacking yet
 * goes at the lit opponent — all the free copies of a stack — except
 * creatures with defender. What is already pointed somewhere stays there. */
export function allAttack(c: CombatState, reads: UnitRead[], target: number): AttackPick[] {
  if (c.step !== 'attackers') return [];
  const picks: AttackPick[] = [];
  for (const read of reads) {
    if (!read.creature || hasKeyword(read, 'defender')) continue;
    const free = freeToSend(c, read);
    if (free <= 0) continue;
    const here = attackingCopies(c, read.unit).at.find(([t]) => t === target)?.[1] ?? 0;
    picks.push({ unit: plainUnit(read.unit), target, n: here + free });
  }
  return picks;
}

// ---- picking blockers ----

/** What the screen asks the store for: `n` copies of the defender's
 * `blocker` stand in the way of `attacker`. */
export interface BlockPick {
  attacker: CombatUnit;
  blocker: CombatUnit;
  n: number;
}

/** Which of the attackers coming at `defender` a unit's copies stand in
 * front of: per tile number, in the order of the strip. */
export function blockingCopies(
  c: CombatState,
  defender: number,
  unit: CombatUnit,
): { total: number; at: [no: number, n: number][] } {
  const at: [number, number][] = [];
  for (const tile of attacksAt(c, defender)) {
    const n = sum((tile.attack.blockers ?? []).filter((b) => sameUnit(b, unit)).map(copiesOf));
    if (n > 0) at.push([tile.no, n]);
  }
  return { total: sum(at.map(([, n]) => n)), at };
}

/** How many more copies a tap may put in the way: the ones that could
 * block and are not blocking yet. */
export function freeToStand(c: CombatState, defender: number, read: UnitRead): number {
  return Math.max(0, read.canBlock - blockingCopies(c, defender, read.unit).total);
}

/** How many more blockers that attack can take: a card any number (they
 * gang up on it), a stack attack one per attacking copy. */
function roomAt(tile: Incoming): number {
  if (tile.attack.unit.kind === 'card') return Infinity;
  return copiesOf(tile.attack) - sum((tile.attack.blockers ?? []).map(copiesOf));
}

const picksBlocks = (c: CombatState, defender: number) => c.step === 'blockers' && c.defender === defender;

/** A tap on one of the defender's units while they choose blockers — null
 * when the tap is not a pick or is ignored (it is tapped, or the lit
 * attack has a blocker for every copy already). A card in front of the
 * lit attacker is taken back, one in front of another moves; a stack gets
 * one more copy in front of the lit attacker and stops at its last free
 * copy. */
export function blockTap(c: CombatState, defender: number, read: UnitRead, lit: Incoming | null): BlockPick | null {
  if (!picksBlocks(c, defender) || !read.creature || !lit) return null;
  const blocker = plainUnit(read.unit);
  const attacker = plainUnit(lit.attack.unit);
  const { total, at } = blockingCopies(c, defender, blocker);
  const here = at.find(([no]) => no === lit.no)?.[1] ?? 0;
  if (blocker.kind === 'card') {
    if (here > 0) return { attacker, blocker, n: 0 };
    if ((total === 0 && read.canBlock <= 0) || roomAt(lit) <= 0) return null;
    return { attacker, blocker, n: 1 };
  }
  if (freeToStand(c, defender, read) <= 0 || roomAt(lit) <= 0) return null;
  return { attacker, blocker, n: here + 1 };
}

/** The stack stepper's minus: one copy back from in front of the lit
 * attacker, or — when none stand there — from the last attacker it blocks. */
export function blockLess(c: CombatState, defender: number, read: UnitRead, lit: Incoming | null): BlockPick | null {
  if (!picksBlocks(c, defender)) return null;
  const { at } = blockingCopies(c, defender, read.unit);
  const from = at.find(([no, n]) => no === lit?.no && n > 0) ?? at[at.length - 1];
  const tile = from && attacksAt(c, defender).find((t) => t.no === from[0]);
  if (!from || !tile) return null;
  return { attacker: plainUnit(tile.attack.unit), blocker: plainUnit(read.unit), n: from[1] - 1 };
}

/** "Block anyway", behind the hold: puts a card in the way that a tap
 * refuses (it is tapped, or the app does not read it as a creature). A
 * stack has none: its tapped copies are untapped from the same sheet. */
export function blockAnyway(c: CombatState, defender: number, read: UnitRead, lit: Incoming | null): BlockPick | null {
  if (!picksBlocks(c, defender) || !lit || read.unit.kind !== 'card') return null;
  const { at } = blockingCopies(c, defender, read.unit);
  if (at.some(([no]) => no === lit.no) || roomAt(lit) <= 0) return null;
  return { attacker: plainUnit(lit.attack.unit), blocker: plainUnit(read.unit), n: 1 };
}

// ---- what the bar says ----

/** The sentence the bar opens with: whose move it is and what the job is. */
export function barSentence(g: GameState, c: CombatState): string {
  const attacker = seatName(g, c.active);
  if (c.step === 'attackers') return `${attacker}: pick attackers`;
  if (c.step === 'blockers' && c.defender !== undefined) {
    return `${seatName(g, c.defender)}: block ${attackersAt(c, c.defender)} from ${attacker}`;
  }
  return `${attacker}’s attack: the damage`;
}

/** The dead of one seat, as the fight was worked out: copies added up per
 * card or stack, in the order of the fight. */
function deadOf(result: CombatResult, seat: number): { name: string; n: number; commander: boolean }[] {
  const dead = new Map<string, { name: string; n: number; commander: boolean }>();
  const fighters: Fighter[] = result.attacks.flatMap((a) => [a, ...a.blockers]);
  for (const f of fighters) {
    if (f.seat !== seat || f.dies <= 0) continue;
    const key = unitKey(f.unit);
    const entry = dead.get(key) ?? { name: f.name || 'a creature', n: 0, commander: f.commander !== null };
    entry.n += f.dies;
    dead.set(key, entry);
  }
  return [...dead.values()];
}

/** "Wall of Omens dies" — named when three or fewer die, counted beyond
 * that, and a commander is named either way. Empty when nobody does. */
function deathWords(dead: { name: string; n: number; commander: boolean }[]): string {
  const total = sum(dead.map((d) => d.n));
  if (total === 0) return '';
  const named = total <= 3 ? dead : dead.filter((d) => d.commander);
  const words = named.map((d) => (d.n > 1 ? `${d.name} ×${d.n}` : d.name));
  const uncounted = total - sum(named.map((d) => d.n));
  if (uncounted > 0) words.push(plural(uncounted, 'creature'));
  return `${inWords(words)} ${total === 1 ? 'dies' : 'die'}`;
}

/** The result as the bar tells it: one line per attacked player — what
 * they lose (and how much of it from which commander), what they gain,
 * their poison, their dead — then a line for anyone else the fight touched
 * (the attacker's lifelink, the attacker's dead). Worded from the engine's
 * result, never from the feed's lines. */
export function resultLines(g: GameState, result: CombatResult): string[] {
  const lines: string[] = [];
  const gainOf = (seat: number) => result.gains.find((x) => x.seat === seat)?.life ?? 0;
  const defending = new Set(result.defenders.map((d) => d.seat));
  for (const d of result.defenders) {
    const lost = d.other + sum(d.commanders.map((cmd) => cmd.life));
    const from = d.commanders
      .filter((cmd) => cmd.damage > 0)
      .map((cmd) => {
        const name = result.attacks.find((a) => a.commander === cmd.key && a.target === d.seat)?.name;
        return `${cmd.damage} from ${name || 'a commander'}`;
      });
    const parts = [`${seatName(g, d.seat)} −${lost}${from.length > 0 ? ` (${from.join(', ')})` : ''}`];
    if (gainOf(d.seat) > 0) parts.push(`+${gainOf(d.seat)} life`);
    if (d.poison > 0) parts.push(`${d.poison} poison`);
    const deaths = deathWords(deadOf(result, d.seat));
    if (deaths) parts.push(deaths);
    lines.push(parts.join(' · '));
  }
  const others = new Set<number>();
  for (const x of result.gains) if (!defending.has(x.seat)) others.add(x.seat);
  for (const a of result.attacks) if (!defending.has(a.seat) && a.dies > 0) others.add(a.seat);
  for (const seat of others) {
    const gain = gainOf(seat);
    const deaths = deathWords(deadOf(result, seat));
    if (gain <= 0 && !deaths) continue;
    const name = seatName(g, seat);
    lines.push(gain > 0 ? [`${name} +${gain} life`, ...(deaths ? [deaths] : [])].join(' · ') : `${name}: ${deaths}`);
  }
  return lines;
}

/** What the engine could not do by itself, said out loud. */
export function resultFlags(result: CombatResult): string[] {
  if (result.failed) return ['this fight could not be worked out — set it in Review'];
  const flags: string[] = [];
  if (result.unread.length > 0) {
    const names = result.unread.slice(0, 3).map((u) => u.name || 'a creature');
    const more = result.unread.length > 3 ? ', …' : '';
    flags.push(`${plural(result.unread.length, 'creature')} not read (${names.join(', ')}${more})`);
  }
  for (const u of result.check) flags.push(`check the ${u.name || 'token'} stack`);
  if (result.infectOnCreatures) {
    flags.push('infect was blocked: its damage to creatures counts as ordinary damage');
  }
  return flags;
}

// ---- the phone hand view ----

/** The one line the phone's hand view shows while a fight involves that
 * seat (there is no picking there: the fight is on the table). */
export function handLine(g: GameState, seat: number): string | null {
  const c = liveCombat(g);
  if (!c) return null;
  if (c.active === seat) return 'Your attack is open on the table';
  const n = attackersAt(c, seat);
  if (n === 0) return null;
  const what = c.step === 'damage' ? 'the damage is on the table' : 'block on the table';
  return `${seatName(g, c.active)} attacks you with ${n} — ${what}`;
}
