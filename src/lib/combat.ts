import * as boardLib from './board';
import * as cardsLib from './cards';
import { commanderKey } from './commanders';
import * as gameLib from './game';
import type { CombatAttack, CombatBlock, CombatState, CombatUnit, GameState } from './types';

/** Combat on the cards: the fight the table is in, kept in GameState.combat
 * and changed only through the reducers below.
 *
 * They are pure, hand back the SAME state when nothing changes, never
 * throw, and do nothing when aimed at the wrong fight, the wrong step or
 * something that is not there — on an online table every one of them is
 * replayed onto states its device never saw. Directions are explicit
 * (set this many, mark it or unmark it), never toggles.
 *
 * They cannot read cards: who is a creature, how big it is and what it
 * does to whom is lib/combatEngine.ts. What that works out — and the
 * table confirms — comes back here as a CombatOutcome. */

/** What Apply carries: the result the table confirmed. Changes, never
 * totals — a proliferate another device landed in between must survive. */
export interface CombatOutcome {
  players: {
    seat: number;
    /** NET change: every point of normal damage counted once, minus life gained. */
    life: number;
    /** Damage ADDED per commander-damage key (the gauge only: the life it
     * cost is inside `life`, and for an infect commander there is none). */
    commander?: Record<string, number>;
    /** Poison counters ADDED. */
    poison?: number;
  }[];
  deaths: {
    seat: number;
    unit: CombatUnit;
    /** Stack copies that die (omitted = 1; a card is always 1). */
    n?: number;
    /** …of which this many were tapped attackers. */
    tapped?: number;
    /** A commander going home (adds its tax) instead of to the graveyard. */
    toCommand?: true;
  }[];
}

/** Captured when the Attack button is pressed: a replay has to start the
 * same fight, in the turn it was meant for, or nothing. */
export interface CombatStamp {
  id: string;
  turn: number;
  active: number;
}

/** Who the declaration taps: the attackers without vigilance, as the store
 * read them off the cards (the reducers cannot). */
export interface AttackTaps {
  /** Instance ids of the attacking cards to tap. */
  cards: string[];
  /** Per stack id: how many more of its copies to tap. */
  stacks: Record<string, number>;
}

/** THE way to read the fight: the combat, or null when there is none,
 * when it has finished ('done'), when it belongs to another turn, or when
 * the attacking player has been defeated. Nothing reads game.combat
 * directly — a finished or stale one stays in the state until the turn
 * passes. */
export function liveCombat(g: GameState): CombatState | null {
  const c = g.combat;
  if (!c || c.step === 'done') return null;
  if (c.turn !== g.turnNumber || c.active !== g.activePlayerIndex) return null;
  if (g.players[c.active]?.eliminated !== false) return null;
  return c;
}

/** Whose move it is in the fight, and so whose zone carries the combat
 * bar: the defender while they choose blockers, otherwise the attacker. */
export function actingSeat(c: CombatState): number {
  return c.step === 'blockers' && c.defender !== undefined ? c.defender : c.active;
}

/** The seat that holds the big board, on every device: the active player
 * — except while a defender chooses blockers, when the board is theirs
 * (on the shared tablet it turns to face them). A defender who was
 * defeated while choosing keeps it until Done is pressed for them. */
export function boardSeat(g: GameState): number {
  const c = liveCombat(g);
  const seat = c ? actingSeat(c) : g.activePlayerIndex;
  return g.players[seat] ? seat : g.activePlayerIndex;
}

export function sameUnit(a: CombatUnit, b: CombatUnit): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** How many copies an attack or a blocker stands for. */
export const copiesOf = (entry: { n?: number }): number => entry.n ?? 1;

const isUnit = (u: unknown): u is CombatUnit => {
  const x = u as CombatUnit | null;
  return !!x && (x.kind === 'card' || x.kind === 'stack') && typeof x.id === 'string';
};
const plain = (u: CombatUnit): CombatUnit => ({ kind: u.kind, id: u.id });
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const attacksOf = (c: CombatState): CombatAttack[] => c.attacks ?? [];
const blockersOf = (a: CombatAttack): CombatBlock[] => a.blockers ?? [];

/** The live fight with this id at this step, or null. */
function fightAt(g: GameState, id: string, step: CombatState['step']): CombatState | null {
  const c = liveCombat(g);
  return c && c.id === id && c.step === step ? c : null;
}

/** How many copies of this unit that seat has on the table: 1 or 0 for a
 * card on its battlefield, the count of a stack on its board. */
function held(g: GameState, seat: number, unit: CombatUnit): number {
  const player = g.players[seat];
  if (!player) return 0;
  if (unit.kind === 'card') return player.cards?.battlefield.some((c) => c.iid === unit.id) ? 1 : 0;
  return player.board.find((it) => it.id === unit.id)?.count ?? 0;
}

/** Empty lists stay off the wire. */
function withAttacks(g: GameState, c: CombatState, attacks: CombatAttack[]): GameState {
  const { attacks: _was, ...rest } = c;
  return { ...g, combat: attacks.length > 0 ? { ...rest, attacks } : rest };
}

function withBlockers(a: CombatAttack, blockers: CombatBlock[]): CombatAttack {
  const { blockers: _was, ...rest } = a;
  return blockers.length > 0 ? { ...rest, blockers } : rest;
}

/** What Apply and Cancel leave behind until the turn passes. */
function finished(g: GameState, c: CombatState): GameState {
  return { ...g, combat: { id: c.id, turn: c.turn, active: c.active, step: 'done' } };
}

/** Opens a fight at the attackers step. Nothing happens unless the table
 * is still in the turn the button was pressed in, holds no live fight,
 * and has not seen this very fight before: the 'done' marker of a
 * finished fight stops its own start from coming back to life when a save
 * whose answer was lost is sent again. A new fight (a new id) may follow
 * a finished one in the same turn. */
export function startCombat(g: GameState, stamp: CombatStamp): GameState {
  if (g.turnNumber !== stamp.turn || g.activePlayerIndex !== stamp.active) return g;
  if (liveCombat(g) || g.combat?.id === stamp.id) return g;
  if (g.players[stamp.active]?.eliminated !== false) return g;
  return { ...g, combat: { id: stamp.id, turn: stamp.turn, active: stamp.active, step: 'attackers' } };
}

/** Attackers step: sets how many copies of `unit` attack `target` — for a
 * card 1 or 0; 0 takes it back. One entry per card (pointed at another
 * player it is re-pointed), one per stack and player (a stack may send
 * some copies at one player and some at another; together never more
 * than it holds). The unit must be on the attacker's side of the table
 * and the target another, living seat. Whether it is a creature, tapped
 * or summoning sick is the screen's question: "attack anyway" must work. */
export function setAttack(
  g: GameState,
  id: string,
  unit: CombatUnit,
  target: number,
  n: number,
): GameState {
  const c = fightAt(g, id, 'attackers');
  if (!c || !isUnit(unit) || !Number.isFinite(n)) return g;
  const attacks = attacksOf(c);
  const ofUnit = (a: CombatAttack) => sameUnit(a.unit, unit);
  let want = Math.max(0, Math.floor(n));
  if (want > 0) {
    if (!Number.isInteger(target) || target === c.active) return g;
    if (g.players[target]?.eliminated !== false) return g;
    const there = held(g, c.active, unit);
    if (there === 0) return g;
    const elsewhere = sum(attacks.filter((a) => ofUnit(a) && a.target !== target).map(copiesOf));
    want = unit.kind === 'card' ? 1 : Math.min(want, there - elsewhere);
  }
  const at = attacks.findIndex((a) => ofUnit(a) && (unit.kind === 'card' || a.target === target));
  if (want <= 0) return at === -1 ? g : withAttacks(g, c, attacks.filter((_, i) => i !== at));
  const entry: CombatAttack = { unit: plain(unit), ...(want > 1 ? { n: want } : {}), target };
  if (at === -1) return withAttacks(g, c, [...attacks, entry]);
  if (attacks[at].target === target && copiesOf(attacks[at]) === want) return g;
  return withAttacks(g, c, attacks.map((a, i) => (i === at ? entry : a)));
}

/** Has this seat anything on the tablet it could block with? A front-row
 * card or a stack with power and toughness: the reducers cannot read card
 * types, and a defender who only has a Sol Ring pressing "No blocks" once
 * is fine. */
function couldBlock(g: GameState, seat: number): boolean {
  const player = g.players[seat];
  if (!player) return false;
  return (
    (player.cards?.battlefield.some((c) => c.row !== 'lands') ?? false) ||
    player.board.some(
      (it) => it.zone !== 'lands' && it.basePower !== null && it.baseToughness !== null,
    )
  );
}

/** The next seat to choose blockers: the first one in turn order after
 * `after`, before the attacker comes round again, that is being attacked,
 * is alive and could block. Undefined when nobody is left. */
function nextDefender(g: GameState, c: CombatState, after: number): number | undefined {
  const seats = g.players.length;
  for (let step = 1; step < seats; step++) {
    const seat = (after + step) % seats;
    if (seat === c.active) return undefined;
    if (g.players[seat].eliminated) continue;
    if (!attacksOf(c).some((a) => a.target === seat)) continue;
    if (couldBlock(g, seat)) return seat;
  }
  return undefined;
}

/** On to the blockers step with this seat choosing, or to damage. */
function toDefender(g: GameState, c: CombatState, seat: number | undefined): GameState {
  const { defender: _was, ...rest } = c;
  return {
    ...g,
    combat: seat === undefined ? { ...rest, step: 'damage' } : { ...rest, step: 'blockers', defender: seat },
  };
}

/** Attackers are declared. With no attack at all the fight simply ends.
 * Otherwise every listed card that attacks and is untapped is tapped with
 * its mana used up (a creature tapped to attack leaves nothing floating),
 * every listed stack gets that many more copies tapped — never more than
 * attack, or than are still standing — and each attack notes in `tapped`
 * what this declaration itself tapped, so a cancel can stand exactly those
 * back up. Then the first defender is up, or damage if nobody can block. */
export function confirmAttackers(g: GameState, id: string, taps: AttackTaps): GameState {
  const c = fightAt(g, id, 'attackers');
  if (!c) return g;
  const attacks = attacksOf(c);
  if (attacks.length === 0) return finished(g, c);
  const cards = new Set(Array.isArray(taps?.cards) ? taps.cards : []);
  const stacks: Record<string, unknown> =
    taps?.stacks && typeof taps.stacks === 'object' ? { ...taps.stacks } : {};
  const asked = (stackId: string) => {
    const n = stacks[stackId];
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  };
  let next = g;
  const marked = attacks.map((a): CombatAttack => {
    const { tapped: _was, ...attack } = a;
    if (a.unit.kind === 'card') {
      if (!cards.has(a.unit.id)) return attack;
      const tapped = cardsLib.tapSpent(next, c.active, a.unit.id);
      if (tapped === next) return attack; // tapped already, or gone
      next = tapped;
      return { ...attack, tapped: 1 };
    }
    const item = next.players[c.active]?.board.find((it) => it.id === a.unit.id);
    if (!item) return attack;
    const standing = item.count - (item.tapped ?? 0);
    const t = Math.max(0, Math.min(copiesOf(a), asked(a.unit.id), standing));
    if (t === 0) return attack;
    stacks[a.unit.id] = asked(a.unit.id) - t; // the rest is for this stack's other targets
    next = boardLib.tapItem(next, c.active, a.unit.id, t);
    return { ...attack, tapped: t };
  });
  const declared: CombatState = { ...c, attacks: marked };
  return toDefender(next, declared, nextDefender(next, declared, c.active));
}

/** Blockers step, and only for the seat whose turn it is to block: sets
 * how many copies of `blocker` (the defender's unit) stand in the way of
 * `attacker`'s attack at this defender; 0 takes it back. A card blocks
 * one attack only — pointed at one it leaves any other. A stack's
 * blocking copies, over all attacks, never exceed its untapped copies.
 * A stack attack of n copies is n separate attackers, each blocker taking
 * its own: its blockers never outnumber it. */
export function setBlock(
  g: GameState,
  id: string,
  defender: number,
  attacker: CombatUnit,
  blocker: CombatUnit,
  n: number,
): GameState {
  const c = fightAt(g, id, 'blockers');
  if (!c || c.defender !== defender) return g;
  if (!isUnit(attacker) || !isUnit(blocker) || !Number.isFinite(n)) return g;
  const attacks = attacksOf(c);
  const at = attacks.findIndex((a) => sameUnit(a.unit, attacker) && a.target === defender);
  if (at === -1) return g;
  const isBlocker = (b: CombatBlock) => sameUnit(b, blocker);
  let want = Math.max(0, Math.floor(n));
  if (want > 0) {
    if (held(g, defender, blocker) === 0) return g;
    if (blocker.kind === 'card') {
      want = 1;
    } else {
      const item = g.players[defender].board.find((it) => it.id === blocker.id)!;
      const busy = sum(
        attacks.flatMap((a, i) => (i === at ? [] : blockersOf(a).filter(isBlocker).map(copiesOf))),
      );
      want = Math.min(want, item.count - (item.tapped ?? 0) - busy);
    }
    if (attacks[at].unit.kind === 'stack') {
      const others = sum(blockersOf(attacks[at]).filter((b) => !isBlocker(b)).map(copiesOf));
      want = Math.min(want, copiesOf(attacks[at]) - others);
    }
  }
  const next = attacks.map((a, i) => {
    const mine = blockersOf(a);
    const k = mine.findIndex(isBlocker);
    if (i !== at) {
      // A card stands in one place: taking up a block here ends its block there.
      if (blocker.kind !== 'card' || want <= 0 || k === -1) return a;
      return withBlockers(a, mine.filter((_, j) => j !== k));
    }
    if (want <= 0) return k === -1 ? a : withBlockers(a, mine.filter((_, j) => j !== k));
    const entry: CombatBlock = { ...plain(blocker), ...(want > 1 ? { n: want } : {}) };
    if (k === -1) return withBlockers(a, [...mine, entry]);
    if (copiesOf(mine[k]) === want) return a;
    return withBlockers(a, mine.map((b, j) => (j === k ? entry : b)));
  });
  if (next.every((a, i) => a === attacks[i])) return g;
  return withAttacks(g, c, next);
}

/** The paper-blocker mark: this attack is stopped by something that is not
 * on the tablet. Same step and same seat as setBlock. The direction is
 * explicit; the mark is left out when it is off. */
export function setBlocked(
  g: GameState,
  id: string,
  defender: number,
  attacker: CombatUnit,
  blocked: boolean,
): GameState {
  const c = fightAt(g, id, 'blockers');
  if (!c || c.defender !== defender || !isUnit(attacker) || typeof blocked !== 'boolean') return g;
  const attacks = attacksOf(c);
  const at = attacks.findIndex((a) => sameUnit(a.unit, attacker) && a.target === defender);
  if (at === -1 || (attacks[at].blocked ?? false) === blocked) return g;
  return withAttacks(
    g,
    c,
    attacks.map((a, i) => {
      if (i !== at) return a;
      const { blocked: _was, ...rest } = a;
      return blocked ? { ...rest, blocked: true } : rest;
    }),
  );
}

/** This seat has finished blocking. It NAMES the seat: nothing happens
 * unless that seat is the one choosing now, so two devices pressing Done
 * for the same player cannot skip the next one (a relative "next" would).
 * Who is next is worked out here, from the table the op lands on; with
 * nobody left the fight goes to damage. */
export function finishBlocks(g: GameState, id: string, seat: number): GameState {
  const c = fightAt(g, id, 'blockers');
  if (!c || c.defender !== seat) return g;
  return toDefender(g, c, nextDefender(g, c, seat));
}

/** Calls the fight off at any live step: no damage happens. It stands
 * back up exactly what the declaration tapped (each attack's `tapped`
 * note) — a card that is no longer tapped or no longer there is left
 * alone — and leaves the 'done' marker. */
export function cancelCombat(g: GameState, id: string): GameState {
  const c = liveCombat(g);
  if (!c || c.id !== id) return g;
  let next = g;
  for (const a of attacksOf(c)) {
    const tapped = a.tapped ?? 0;
    if (tapped <= 0) continue;
    if (a.unit.kind === 'card') next = cardsLib.tapCard(next, c.active, a.unit.id, false);
    else if (held(next, c.active, a.unit) > 0) next = boardLib.tapItem(next, c.active, a.unit.id, -tapped);
  }
  return finished(next, c);
}

const listOf = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);

/** Damage step: writes the confirmed outcome and leaves the 'done' marker.
 * Each player's life, commander damage and poison land in ONE update
 * (settlePlayer). A dead card goes to its graveyard, or home through
 * commanderDied when `toCommand` is set; dead stack copies leave through
 * killCopies, and a commander kept as a tile that goes home also raises
 * the seat's commanderDeaths by one. Whatever has left since is skipped. */
export function applyCombat(g: GameState, id: string, outcome: CombatOutcome): GameState {
  const c = fightAt(g, id, 'damage');
  if (!c) return g;
  let next = g;
  for (const p of listOf(outcome?.players)) {
    if (!p || !Number.isInteger(p.seat)) continue;
    next = gameLib.settlePlayer(next, p.seat, { life: p.life, commander: p.commander, poison: p.poison });
  }
  for (const d of listOf(outcome?.deaths)) {
    if (!d || !Number.isInteger(d.seat) || !isUnit(d.unit)) continue;
    if (d.unit.kind === 'card') {
      next = d.toCommand
        ? cardsLib.commanderDied(next, d.seat, d.unit.id)
        : cardsLib.moveCard(next, d.seat, d.unit.id, 'battlefield', 'graveyard');
      continue;
    }
    const after = boardLib.killCopies(next, d.seat, d.unit.id, d.n ?? 1, d.tapped ?? 0);
    next =
      after !== next && d.toCommand
        ? gameLib.setCommanderDeaths(after, d.seat, after.players[d.seat].commanderDeaths + 1)
        : after;
  }
  return finished(next, c);
}

/** The turn passes: whatever fight there was, finished or not, is gone. */
export function dropCombat(g: GameState): GameState {
  if (!('combat' in g)) return g;
  const { combat: _gone, ...rest } = g;
  return rest;
}

// ---- what a replay may land on ----
// A guard gets the table as it is now (`base`) and the state the op was
// made on (`orig`). "Same id and expected step" is not enough: Undo brings
// an id back, so a napping phone's Done could land on a different attack.

/** The very combat record this device saw — a finished one included. */
export function sameRecord(base: GameState, orig: GameState): boolean {
  return (base.combat?.id ?? null) === (orig.combat?.id ?? null) && base.combat?.step === orig.combat?.step;
}

/** The same live fight on both sides, or none on both. */
export function sameLiveCombat(base: GameState, orig: GameState): boolean {
  return (liveCombat(base)?.id ?? null) === (liveCombat(orig)?.id ?? null);
}

/** A fight is live on both sides, the same one, at the same step. */
export function sameStep(base: GameState, orig: GameState): boolean {
  const b = liveCombat(base);
  const o = liveCombat(orig);
  return !!b && !!o && b.id === o.id && b.step === o.step;
}

const unitKey = (u: CombatUnit) => `${u.kind}:${u.id}`;
const attackKey = (a: CombatAttack) => `${unitKey(a.unit)}>${a.target}x${copiesOf(a)}`;

/** sameStep, and the same declaration: the same units at the same players
 * in the same numbers (the order they were picked in does not matter). */
export function sameAttacks(base: GameState, orig: GameState): boolean {
  if (!sameStep(base, orig)) return false;
  const keys = (g: GameState) => attacksOf(liveCombat(g)!).map(attackKey).sort().join('|');
  return keys(base) === keys(orig);
}

/** The same seat is up to block (or nobody, on both sides). */
export function sameDefender(base: GameState, orig: GameState): boolean {
  return (liveCombat(base)?.defender ?? null) === (liveCombat(orig)?.defender ?? null);
}

/** The same live fight with the same blocks: on every attack the same
 * blockers in the same order (the order decides who is hit first) and the
 * same paper mark. */
export function sameBlocks(base: GameState, orig: GameState): boolean {
  const b = liveCombat(base);
  const o = liveCombat(orig);
  if (!b || !o || b.id !== o.id) return false;
  const keys = (c: CombatState) =>
    attacksOf(c)
      .map(
        (a) =>
          `${attackKey(a)}[${blockersOf(a)
            .map((k) => `${unitKey(k)}x${copiesOf(k)}`)
            .join(',')}]${a.blocked ? '!' : ''}`,
      )
      .sort()
      .join('|');
  return keys(b) === keys(o);
}

// ---- the table's record of what was done ----

const seatName = (g: GameState, seat: number) => g.config.profiles[seat]?.name ?? '?';
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
/** "a", "a and b", "a, b and c". */
const inWords = (parts: string[]) =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** "Nathan attacks Sam with 3 creatures"; with several players attacked,
 * "Nathan attacks Sam (3) and Alex (2)". */
export function attackLine(g: GameState, c: CombatState): string {
  const perTarget = new Map<number, number>();
  for (const a of attacksOf(c)) perTarget.set(a.target, (perTarget.get(a.target) ?? 0) + copiesOf(a));
  const targets = [...perTarget];
  const who = seatName(g, c.active);
  if (targets.length === 1) {
    return `${who} attacks ${seatName(g, targets[0][0])} with ${plural(targets[0][1], 'creature')}`;
  }
  return `${who} attacks ${inWords(targets.map(([seat, n]) => `${seatName(g, seat)} (${n})`))}`;
}

/** How many of the attackers coming at that seat something stands in the
 * way of, a paper blocker included: what the feed counts and what the
 * defender's Done button says. */
export function attackersStopped(c: CombatState, seat: number): number {
  let stopped = 0;
  for (const a of attacksOf(c)) {
    if (a.target !== seat) continue;
    const inTheWay = sum(blockersOf(a).map(copiesOf));
    if (a.unit.kind === 'card') stopped += inTheWay > 0 || a.blocked ? 1 : 0;
    else stopped += a.blocked ? copiesOf(a) : Math.min(copiesOf(a), inTheWay);
  }
  return stopped;
}

/** "Sam blocks 2 attackers" / "Sam doesn't block". */
export function blockLine(g: GameState, c: CombatState, seat: number): string {
  const stopped = attackersStopped(c, seat);
  const who = seatName(g, seat);
  return stopped === 0 ? `${who} doesn't block` : `${who} blocks ${plural(stopped, 'attacker')}`;
}

/** "Combat: Sam takes 5 (3 commander) · Wall of Omens dies". The dead are
 * named when there are three or fewer; beyond that they are counted, but a
 * commander is always named. Read off `g` as it is BEFORE the outcome is
 * applied (the dead are still on the table to be named). */
export function outcomeLine(g: GameState, outcome: CombatOutcome): string {
  const parts: string[] = [];
  for (const p of listOf(outcome?.players)) {
    if (!p || !Number.isInteger(p.seat)) continue;
    const life = typeof p.life === 'number' && Number.isFinite(p.life) ? p.life : 0;
    const gauge = sum(Object.values(p.commander ?? {}).filter((n) => typeof n === 'number' && n > 0));
    const said: string[] = [];
    if (life < 0) said.push(`takes ${-life}${gauge > 0 ? ` (${gauge} commander)` : ''}`);
    else if (life > 0) said.push(`gains ${life}`);
    else if (gauge > 0) said.push(`takes ${gauge} commander damage`);
    if (typeof p.poison === 'number' && p.poison > 0) said.push(`gets ${p.poison} poison`);
    if (said.length > 0) parts.push(`${seatName(g, p.seat)} ${said.join(' and ')}`);
  }
  const dead = listOf(outcome?.deaths)
    .filter((d) => !!d && Number.isInteger(d.seat) && isUnit(d.unit))
    .map((d) => {
      const player = g.players[d.seat];
      const isCard = d.unit.kind === 'card';
      const name = isCard
        ? player?.cards?.battlefield.find((c) => c.iid === d.unit.id)?.name
        : player?.board.find((it) => it.id === d.unit.id)?.name;
      return {
        name: name ?? 'a creature',
        n: isCard ? 1 : Math.max(1, Math.floor(d.n ?? 1)),
        commander: !!d.toCommand || commanderKey(g, d.seat, d.unit) !== null,
      };
    });
  const total = sum(dead.map((d) => d.n));
  if (total > 0) {
    const named = total <= 3 ? dead : dead.filter((d) => d.commander);
    const words = named.map((d) => (d.n > 1 ? `${d.name} ×${d.n}` : d.name));
    const uncounted = total - sum(named.map((d) => d.n));
    if (uncounted > 0) words.push(plural(uncounted, 'creature'));
    parts.push(`${inWords(words)} ${total === 1 ? 'dies' : 'die'}`);
  }
  return `Combat: ${parts.length > 0 ? parts.join(' · ') : 'no damage'}`;
}

/** The seats this outcome would defeat, worked out without changing
 * anything — so the screen can ask for a second look before it lands. */
export function outcomeDefeats(g: GameState, outcome: CombatOutcome): number[] {
  const out: number[] = [];
  for (const p of listOf(outcome?.players)) {
    if (!p || !Number.isInteger(p.seat) || !g.players[p.seat] || g.players[p.seat].eliminated) continue;
    const after = gameLib.settlePlayer(g, p.seat, { life: p.life, commander: p.commander, poison: p.poison });
    if (after.players[p.seat].eliminated && !out.includes(p.seat)) out.push(p.seat);
  }
  return out;
}
