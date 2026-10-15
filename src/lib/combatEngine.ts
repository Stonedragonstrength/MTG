import { levelNow } from './abilities';
import { sizeAround } from './anthems';
import { keywordsNow, keywordsWorn, restrictionsWorn, sizeWorn, type Size } from './attach';
import { boostOf } from './boost';
import { computedPT } from './board';
import { copiesOf, type CombatOutcome } from './combat';
import { commanderKey } from './commanders';
import {
  combatGrants,
  isSummoningSick,
  joinRestrictions,
  keywordsOf,
  NO_RESTRICTIONS,
  permanentTexts,
  restrictionsOf,
  sickCopies,
  toxicOf,
  type Grants,
} from './keywords';
import type {
  BoardItem,
  CardInstance,
  CardRecord,
  CombatAttack,
  CombatBlock,
  CombatState,
  CombatUnit,
  GameState,
} from './types';

/** Combat on the cards, the reading half: who is a creature, how big it
 * is, what it can do, and what a declared fight does to everyone in it.
 *
 * Pure, and it never throws: anything it cannot read becomes "unread",
 * not an error. It reads the printed card, the +1/+1 counters on it, what
 * its Auras and Equipment add in plain numbers ("gets +2/+0"), and the
 * standing anthems and lords on the table (lib/anthems.ts) — no tricks
 * beyond those. The
 * players put the result right in Review before it is applied; this
 * module's job is to be right about what it does read and to say out loud
 * what it could not. */

/** Card records by card id, as this device has them. A key that is not
 * there has not been answered yet; null (or undefined under a key that is
 * there) is a definite miss — this device's database does not hold it. */
export type CardRecords = Record<string, CardRecord | null | undefined>;

/** The keywords a fight (or the marks on a tile) cares about, in the order
 * they are listed in. `haste` is not one: whether a creature may attack is
 * freeToAttack's question. */
export const COMBAT_KEYWORDS = [
  'flying',
  'reach',
  'menace',
  'first strike',
  'double strike',
  'deathtouch',
  'lifelink',
  'trample',
  'vigilance',
  'indestructible',
  'infect',
  'wither',
  'toxic',
  'defender',
] as const;
export type CombatKeyword = (typeof COMBAT_KEYWORDS)[number];

/** One seat's permanents, gathered once so many of its units can be read. */
export interface SeatRead {
  seat: number;
  /** The rules text of everything it controls that this device has read:
   * what summoning sickness asks about haste (generously). */
  texts: string[];
  /** What its permanents hand to its creatures in a fight (strictly). */
  grants: Grants;
}

/** One card or stack as combat reads it. */
export interface UnitRead {
  unit: CombatUnit;
  seat: number;
  name: string;
  /** May a plain tap pick it? A front-row card whose front face is a
   * creature — or whose record is not read yet (taken on trust: what the
   * app cannot read never blocks a play) — or a stack with power and
   * toughness that is not on the lands shelf. Anything else can still be
   * sent in from the hold ("attack anyway"), and then fights as it reads. */
  creature: boolean;
  /** Its size cannot be trusted: the record is missing or late on this
   * device, the printed power or toughness is not a plain number (*, 1+*,
   * X), or it is 0/0 — each without +1/+1 counters to say otherwise. An
   * unread unit may attack and block, deals nothing by itself and is never
   * killed automatically. */
  unread: boolean;
  /** Printed front-face size, plus +1/+1 counters, plus what is attached
   * to it adds (lib/attach.ts sizeWorn); a star reads as 0. Power is never
   * below 0; a toughness below 1 is never killed automatically. */
  power: number;
  toughness: number;
  /** The combat keywords printed on it… */
  printed: CombatKeyword[];
  /** …and those another permanent hands to it (and it has not already). */
  granted: CombatKeyword[];
  /** Its total toxic value: printed and handed out, added up. */
  toxic: number;
  /** The commander-damage key its damage goes under; null for plain damage. */
  commander: string | null;
  /** Copies there now (1 for a card). */
  count: number;
  /** How many copies a tap may send to attack: a creature, untapped and
   * not summoning sick — for a stack min(count − tapped, count − sick),
   * since which copies are which is not tracked. 0 or 1 for a card. */
  canAttack: number;
  /** How many copies a tap may put in the way: a creature, untapped. */
  canBlock: number;
  /** Nothing may block it ("can't be blocked", by its text or what it wears). */
  unblockable: boolean;
}

const unitKey = (u: CombatUnit) => `${u.kind}:${u.id}`;

export function readSeat(game: GameState, seat: number, records: CardRecords): SeatRead {
  const player = game.players[seat];
  const battlefield = player?.cards?.battlefield ?? [];
  const board = player?.board ?? [];
  return {
    seat,
    texts: permanentTexts(battlefield, records, board),
    grants: combatGrants([
      ...battlefield.map((c) => ({
        key: unitKey({ kind: 'card', id: c.iid }),
        text: records[c.cardId]?.oracleText ?? '',
      })),
      ...board.map((it) => ({
        key: unitKey({ kind: 'stack', id: it.id }),
        text: it.oracleText ?? '',
        copies: it.count,
      })),
    ]),
  };
}

/** A printed power or toughness that is a plain number, or null. */
function plainNumber(value: string | null | undefined): number | null {
  return typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : null;
}

function keywordsFor(
  text: string,
  key: string,
  grants: Grants,
  worn: ReadonlySet<string> = new Set(),
): Pick<UnitRead, 'printed' | 'granted' | 'toxic'> {
  const own = keywordsOf(text);
  const handed = grants.to(key);
  return {
    printed: COMBAT_KEYWORDS.filter((k) => own.has(k)),
    // Handed out by another permanent, or given by an Equipment or Aura it wears.
    granted: COMBAT_KEYWORDS.filter((k) => (handed.has(k) || worn.has(k)) && !own.has(k)),
    toxic: toxicOf(text) + grants.amount(key, 'toxic'),
  };
}

function readCard(game: GameState, read: SeatRead, card: CardInstance, records: CardRecords): UnitRead {
  const unit: CombatUnit = { kind: 'card', id: card.iid };
  const record = records[card.cardId] ?? null;
  const frontRow = card.row !== 'lands';
  const creature = frontRow && (record ? /\bCreature\b/.test(record.typeLine.split(' // ')[0]) : true);
  // +1/+1 counters, less -1/-1 counters (Persist).
  const p1p1 = Math.max(0, card.counters?.['p1p1'] ?? 0);
  const plus = p1p1 - Math.max(0, card.counters?.['m1m1'] ?? 0);
  // A leveler is the size of the level it has reached, with that level's keywords.
  const level = levelNow(record, card.counters?.level ?? 0);
  const power = level ? level.power : plainNumber(record?.power);
  const toughness = level ? level.toughness : plainNumber(record?.toughness);
  const unsized = power === null || toughness === null || (power === 0 && toughness === 0);
  const worn = sizeWorn(game, { seat: read.seat, kind: 'card', id: card.iid }, records);
  // The anthems and lords on the table (lib/anthems.ts).
  const around = sizeAround(game, { seat: read.seat, kind: 'card', id: card.iid }, records);
  // What it wears, and what "until end of turn" effects did to it this turn.
  const wornKeywords = keywordsNow(game, { seat: read.seat, kind: 'card', id: card.iid }, records);
  if (level) for (const keyword of keywordsOf(level.text)) wornKeywords.add(keyword);
  const boost = boostOf(game, card);
  // "This creature can't block", Pacifism on it, Whispersilk Cloak.
  const forbids = joinRestrictions(
    restrictionsOf(record?.oracleText ?? '', record?.name ?? ''),
    restrictionsWorn(game, { seat: read.seat, kind: 'card', id: card.iid }, records),
  );
  return {
    unit,
    seat: read.seat,
    name: record?.name ?? card.name,
    creature,
    unread: !record || (unsized && p1p1 === 0),
    power: Math.max(0, (power ?? 0) + plus + worn.power + around.power + (boost?.power ?? 0)),
    toughness: (toughness ?? 0) + plus + worn.toughness + around.toughness + (boost?.toughness ?? 0),
    ...keywordsFor(record?.oracleText ?? '', unitKey(unit), read.grants, wornKeywords),
    commander: commanderKey(game, read.seat, unit),
    count: 1,
    canAttack:
      creature && !card.tapped && !forbids.cantAttack && !isSummoningSick(card, record, read.texts, wornKeywords) ? 1 : 0,
    canBlock: creature && !card.tapped && !forbids.cantBlock ? 1 : 0,
    unblockable: forbids.unblockable,
  };
}

const NO_SIZE: Size = { power: 0, toughness: 0 };

function readStack(game: GameState, read: SeatRead, item: BoardItem, records: CardRecords): UnitRead {
  const unit: CombatUnit = { kind: 'stack', id: item.id };
  const sized = computedPT({ ...item, counters: item.counters ?? {} }) !== null;
  const creature = sized && item.zone !== 'lands';
  const plus = Math.max(0, item.counters?.['p1p1'] ?? 0);
  const unsized = !sized || (item.basePower === 0 && item.baseToughness === 0);
  const count = Math.max(0, item.count);
  const standing = Math.max(0, count - (item.tapped ?? 0));
  // One Equipment is on one token: a stack of several does not all wear it.
  const worn = count === 1 ? sizeWorn(game, { seat: read.seat, kind: 'stack', id: item.id }, records) : NO_SIZE;
  // A boost is on every copy (Overrun pumps them all); what is worn, on one
  // only; an anthem, on every copy too.
  const boost = boostOf(game, item);
  const around = sizeAround(game, { seat: read.seat, kind: 'stack', id: item.id }, records);
  const wornKeywords = new Set([
    ...(count === 1 ? keywordsWorn(game, { seat: read.seat, kind: 'stack', id: item.id }, records) : []),
    ...(boost?.keywords ?? []),
  ]);
  const forbids = joinRestrictions(
    restrictionsOf(item.oracleText ?? '', item.name),
    count === 1 ? restrictionsWorn(game, { seat: read.seat, kind: 'stack', id: item.id }, records) : NO_RESTRICTIONS,
  );
  return {
    unit,
    seat: read.seat,
    name: item.name,
    creature,
    unread: unsized && plus === 0,
    power: Math.max(0, (item.basePower ?? 0) + plus + worn.power + around.power + (boost?.power ?? 0)),
    toughness: (item.baseToughness ?? 0) + plus + worn.toughness + around.toughness + (boost?.toughness ?? 0),
    ...keywordsFor(item.oracleText ?? '', unitKey(unit), read.grants, wornKeywords),
    commander: commanderKey(game, read.seat, unit),
    count,
    canAttack:
      creature && !forbids.cantAttack
        ? Math.max(0, Math.min(standing, count - sickCopies(item, read.texts, wornKeywords)))
        : 0,
    canBlock: creature && !forbids.cantBlock ? standing : 0,
    unblockable: forbids.unblockable,
  };
}

/** Reads one card or stack of a seat; null when it is not on that seat's
 * side of the table (any more). Pass a SeatRead when reading several
 * units of one seat, to gather its permanents only once. */
export function readUnit(
  game: GameState,
  seat: number,
  unit: CombatUnit,
  records: CardRecords,
  read: SeatRead = readSeat(game, seat, records),
): UnitRead | null {
  const player = game.players[seat];
  if (!player || !unit) return null;
  if (unit.kind === 'card') {
    const card = player.cards?.battlefield.find((c) => c.iid === unit.id);
    return card ? readCard(game, read, card, records) : null;
  }
  if (unit.kind === 'stack') {
    const item = player.board.find((it) => it.id === unit.id);
    return item ? readStack(game, read, item, records) : null;
  }
  return null;
}

/** Everything a seat could send into a fight, read once: its front-row
 * cards in play order, then its stacks — never the lands shelf. Each says
 * for itself whether it is a creature (see UnitRead.creature). */
export function readUnits(
  game: GameState,
  seat: number,
  records: CardRecords,
  read: SeatRead = readSeat(game, seat, records),
): UnitRead[] {
  const player = game.players[seat];
  if (!player) return [];
  return [
    ...(player.cards?.battlefield ?? [])
      .filter((c) => c.row !== 'lands')
      .map((c) => readCard(game, read, c, records)),
    ...player.board.filter((it) => it.zone !== 'lands').map((it) => readStack(game, read, it, records)),
  ];
}

/** Has it this keyword, printed or handed to it? */
export function hasKeyword(
  read: Pick<UnitRead, 'printed' | 'granted'> | null,
  keyword: CombatKeyword,
): boolean {
  return !!read && (read.printed.includes(keyword) || read.granted.includes(keyword));
}

// ---- the small readers a screen needs for picking ----

/** May a plain tap pick this unit in a pick mode? See UnitRead.creature. */
export function isCreature(game: GameState, seat: number, unit: CombatUnit, records: CardRecords): boolean {
  return readUnit(game, seat, unit, records)?.creature ?? false;
}

/** How many copies of it a tap may send to attack (0 or 1 for a card). */
export function freeToAttack(game: GameState, seat: number, unit: CombatUnit, records: CardRecords): number {
  return readUnit(game, seat, unit, records)?.canAttack ?? 0;
}

/** How many copies of it a tap may put in the way (0 or 1 for a card). */
export function freeToBlock(game: GameState, seat: number, unit: CombatUnit, records: CardRecords): number {
  return readUnit(game, seat, unit, records)?.canBlock ?? 0;
}

/** Has it defender? "All attack" skips those; a tap may still pick one. */
export function hasDefender(game: GameState, seat: number, unit: CombatUnit, records: CardRecords): boolean {
  return hasKeyword(readUnit(game, seat, unit, records), 'defender');
}

/** Has this device had an answer — a record or a definite miss — for
 * every card on the battlefield of every seat in this fight? Until then
 * a result must not be applied: a late record changes sizes, and a late
 * Whip of Erebos or Avacyn changes who gains and who dies, so it is every
 * card of the attacker and of each attacked seat, not only the fighters. */
export function cardsRead(game: GameState, combat: CombatState, records: CardRecords): boolean {
  const seats = new Set<number>([combat.active, ...(combat.attacks ?? []).map((a) => a?.target)]);
  for (const seat of seats) {
    for (const c of game.players[seat]?.cards?.battlefield ?? []) {
      if (!(c.cardId in records)) return false;
    }
  }
  return true;
}

// ---- the damage ----

/** A card or stack named for the screen. */
export interface UnitRef {
  seat: number;
  unit: CombatUnit;
  name: string;
}

/** One side of a fight as it was read and as it came out. */
export interface Fighter extends UnitRef {
  /** Copies fighting (1 for a card) — after a stack that shrank was clamped. */
  n: number;
  /** false: it has left the battlefield. Skipped: it deals nothing, takes
   * nothing and cannot die. */
  present: boolean;
  power: number;
  toughness: number;
  unread: boolean;
  printed: CombatKeyword[];
  granted: CombatKeyword[];
  toxic: number;
  commander: string | null;
  /** How many of these copies die. */
  dies: number;
  /** A stack that holds fewer copies than the combat says are fighting:
   * the screen says "check". */
  check?: true;
}

export interface AttackResult extends Fighter {
  /** Its place in the combat's list of attacks. */
  index: number;
  target: number;
  /** How many of these attackers something stands in the way of — by the
   * declared list (a blocker that left still counts) or the paper mark. */
  blocked: number;
  /** Stopped by something that is not on the tablet. */
  paper: boolean;
  /** One per declared blocker, in the order declared. */
  blockers: Fighter[];
  /** Damage these attackers dealt to the defending player, infect included. */
  toPlayer: number;
  /** The planeswalker it attacks instead of the player (its instance id), or null. */
  walker: string | null;
  /** Damage these attackers dealt to that planeswalker. */
  toWalker: number;
}

/** What one attacked planeswalker was dealt: that much loyalty comes off. */
export interface WalkerResult {
  seat: number;
  iid: string;
  name: string;
  damage: number;
}

/** What one attacked player was dealt, split by where it came from. */
export interface DefenderResult {
  seat: number;
  /** Each commander that hit them: `damage` moves that gauge, `life` is
   * how much of it is life lost (none for an infect commander). */
  commanders: { key: string; damage: number; life: number }[];
  /** Life lost to all the other attackers together. */
  other: number;
  /** Poison counters, from infect and toxic. */
  poison: number;
}

export interface CombatResult {
  /** What Apply would carry if the table changes nothing. */
  outcome: CombatOutcome;
  /** Every attack in the order declared, with its blockers. */
  attacks: AttackResult[];
  /** One per attacked seat, in the order they were first attacked — the
   * player, not their planeswalkers. */
  defenders: DefenderResult[];
  /** One per attacked planeswalker still on the battlefield, in the order first attacked. */
  walkers: WalkerResult[];
  /** Life gained from lifelink per seat, attackers' and blockers' alike. */
  gains: { seat: number; life: number }[];
  /** The fighters the app could not read: named, never killed. */
  unread: UnitRef[];
  /** Stacks that shrank under the fight and were clamped. */
  check: UnitRef[];
  /** An infect or wither creature dealt damage to a copy in a stack that
   * lives: the app treats that as ordinary damage (it keeps −1/−1
   * counters on cards, not on one copy of a stack). */
  infectOnCreatures: boolean;
  /** The fight could not be worked out at all; the outcome is empty. */
  failed?: true;
}

/** One creature in the damage steps: a card, one copy of a stack, or the
 * unblocked copies of a stack taken together (they never take damage). */
interface Body {
  fighter: Fighter;
  attack: number; // index of the attack it belongs to
  side: 'attacker' | 'blocker';
  copies: number;
  power: number;
  toughness: number;
  unread: boolean;
  first: boolean; // deals damage in the first-strike step
  regular: boolean; // …and in the regular one
  deathtouch: boolean;
  trample: boolean;
  lifelink: boolean;
  infect: boolean;
  wither: boolean;
  indestructible: boolean;
  toxic: number;
  marked: number;
  /** Of it, what came as −1/−1 counters (from infect and wither). */
  withered: number;
  touched: boolean; // dealt damage by a deathtouch source
  dead: boolean;
  // attackers
  target: number;
  /** The planeswalker it attacks, or null for the player. */
  walker: string | null;
  blocked: boolean;
  paper: boolean;
  blockers: Body[];
  // blockers
  blocking: Body | null;
}

function fighterOf(seat: number, unit: CombatUnit, read: UnitRead | null, n: number): Fighter {
  return {
    seat,
    unit: { kind: unit.kind, id: unit.id },
    name: read?.name ?? '',
    n,
    present: read !== null && n > 0,
    power: read?.power ?? 0,
    toughness: read?.toughness ?? 0,
    unread: read?.unread ?? false,
    printed: read?.printed ?? [],
    granted: read?.granted ?? [],
    toxic: read?.toxic ?? 0,
    commander: read?.commander ?? null,
    dies: 0,
  };
}

function bodyOf(fighter: Fighter, read: UnitRead, side: Body['side'], attack: number, copies = 1): Body {
  const firstStrike = hasKeyword(read, 'first strike');
  const doubleStrike = hasKeyword(read, 'double strike');
  return {
    fighter,
    attack,
    side,
    copies,
    power: Math.max(0, read.power),
    toughness: read.toughness,
    unread: read.unread,
    first: firstStrike || doubleStrike,
    regular: !firstStrike || doubleStrike,
    deathtouch: hasKeyword(read, 'deathtouch'),
    trample: hasKeyword(read, 'trample'),
    lifelink: hasKeyword(read, 'lifelink'),
    infect: hasKeyword(read, 'infect'),
    wither: hasKeyword(read, 'wither'),
    indestructible: hasKeyword(read, 'indestructible'),
    toxic: read.toxic,
    marked: 0,
    withered: 0,
    touched: false,
    dead: false,
    target: -1,
    walker: null,
    blocked: false,
    paper: false,
    blockers: [],
    blocking: null,
  };
}

const EMPTY = (): CombatResult => ({
  outcome: { players: [], deaths: [] },
  attacks: [],
  defenders: [],
  walkers: [],
  gains: [],
  unread: [],
  check: [],
  infectOnCreatures: false,
});

const isUnit = (u: unknown): u is CombatUnit => {
  const x = u as CombatUnit | null;
  return !!x && (x.kind === 'card' || x.kind === 'stack') && typeof x.id === 'string';
};
const wholeCopies = (entry: { n?: number }) => {
  const n = copiesOf(entry);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

/** One declared blocker copy: whose it is and whether it is still there. */
interface Slot {
  fighter: Fighter;
  read: UnitRead | null;
  /** The copy is gone (its stack shrank) or the attacker it took is. */
  lost: boolean;
}

/** One attack while it is being worked out. */
interface Work {
  attack: CombatAttack;
  index: number;
  read: UnitRead | null;
  row: AttackResult;
  declared: number;
  n: number; // copies still counted as attacking
  slots: Slot[];
}

function resolve(game: GameState, combat: CombatState, records: CardRecords): CombatResult {
  const result = EMPTY();
  const seats = new Map<number, SeatRead>();
  const seatRead = (seat: number) => {
    let read = seats.get(seat);
    if (!read) seats.set(seat, (read = readSeat(game, seat, records)));
    return read;
  };
  const attacker = combat.active;
  const flagged = new Set<Fighter>();

  // 1) Read every declared attack and blocker.
  const works: Work[] = [];
  (combat.attacks ?? []).forEach((attack, index) => {
    if (!attack || !isUnit(attack.unit) || !game.players[attack.target]) return;
    const read = readUnit(game, attacker, attack.unit, records, seatRead(attacker));
    const declared = attack.unit.kind === 'card' ? 1 : wholeCopies(attack);
    const blockers: CombatBlock[] = (Array.isArray(attack.blockers) ? attack.blockers : []).filter(isUnit);
    const slots: Slot[] = [];
    const rows: Fighter[] = [];
    for (const b of blockers) {
      const blockerRead = readUnit(game, attack.target, b, records, seatRead(attack.target));
      const copies = b.kind === 'card' ? 1 : wholeCopies(b);
      const fighter = fighterOf(attack.target, b, blockerRead, copies);
      rows.push(fighter);
      for (let i = 0; i < copies; i++) slots.push({ fighter, read: blockerRead, lost: blockerRead === null });
    }
    // A stack attack of n copies is n attackers: no more blockers than that.
    if (attack.unit.kind === 'stack') {
      for (const extra of slots.splice(declared)) extra.fighter.n -= 1;
    }
    const row: AttackResult = {
      ...fighterOf(attacker, attack.unit, read, declared),
      index,
      target: attack.target,
      blocked: 0,
      paper: attack.blocked === true,
      blockers: rows,
      toPlayer: 0,
      walker: typeof attack.walker === 'string' ? attack.walker : null,
      toWalker: 0,
    };
    works.push({ attack, index, read, row, declared, n: read ? declared : 0, slots });
  });

  // 2) A stack that now holds fewer copies than the combat says are
  // fighting has lost its unblocked copies first, then the ones a paper
  // card stopped, then the ones a blocker on the tablet took (last first).
  const attackingStacks = new Map<string, Work[]>();
  for (const w of works) {
    if (w.attack.unit.kind !== 'stack' || !w.read) continue;
    attackingStacks.set(w.attack.unit.id, [...(attackingStacks.get(w.attack.unit.id) ?? []), w]);
  }
  for (const entries of attackingStacks.values()) {
    let over = entries.reduce((total, w) => total + w.n, 0) - entries[0].read!.count;
    if (over <= 0) continue;
    for (const w of entries) flagged.add(w.row);
    const backwards = [...entries].reverse();
    const taken = (w: Work) => Math.min(w.n, w.slots.length);
    for (const paper of [false, true]) {
      for (const w of backwards) {
        if (w.row.paper !== paper) continue;
        const lose = Math.min(over, w.n - taken(w));
        w.n -= lose;
        over -= lose;
      }
    }
    for (const w of backwards) {
      const lose = Math.min(over, w.n);
      w.n -= lose;
      over -= lose;
    }
  }
  for (const w of works) {
    w.row.n = w.n;
    w.row.present = w.read !== null && w.n > 0;
    // Blockers left without the attacking copy they took fight nobody.
    if (w.attack.unit.kind === 'stack' || !w.read) w.slots.slice(w.read ? w.n : 0).forEach((s) => (s.lost = true));
  }
  // …and a blocking stack that shrank loses its last-declared blocks. What
  // those were blocking stays blocked: that was decided when they were declared.
  const blockingStacks = new Map<string, Slot[]>();
  for (const w of works) {
    for (const slot of w.slots) {
      if (slot.fighter.unit.kind !== 'stack' || !slot.read) continue;
      const key = `${slot.fighter.seat}:${slot.fighter.unit.id}`;
      blockingStacks.set(key, [...(blockingStacks.get(key) ?? []), slot]);
    }
  }
  for (const slots of blockingStacks.values()) {
    const over = slots.length - slots[0].read!.count;
    if (over <= 0) continue;
    for (const slot of slots.slice(slots.length - over)) {
      slot.read = null;
      slot.lost = true;
      slot.fighter.n -= 1;
      flagged.add(slot.fighter);
    }
  }
  for (const w of works) {
    for (const fighter of w.row.blockers) fighter.present = fighter.present && fighter.n > 0;
  }

  // 3) Line the creatures up.
  const attackers: Body[] = [];
  const blockers: Body[] = [];
  const blockerBody = (slot: Slot, w: Work, blocking: Body | null): Body | null => {
    if (!slot.read) return null;
    const body = bodyOf(slot.fighter, slot.read, 'blocker', w.index);
    body.blocking = slot.lost ? null : blocking;
    blockers.push(body);
    return slot.lost ? null : body;
  };
  for (const w of works) {
    // An attacker that is gone is skipped: whatever stood in its way fights nobody.
    if (!w.read || w.n <= 0) continue;
    const attackerBody = (copies: number): Body => {
      const body = bodyOf(w.row, w.read!, 'attacker', w.index, copies);
      body.target = w.attack.target;
      body.walker = w.row.walker;
      body.paper = w.row.paper;
      attackers.push(body);
      return body;
    };
    if (w.attack.unit.kind === 'card') {
      // Its blockers all gang up on it.
      const body = attackerBody(1);
      body.blocked = w.slots.length > 0 || w.row.paper;
      for (const slot of w.slots) {
        const blocker = blockerBody(slot, w, body);
        if (blocker) body.blockers.push(blocker);
      }
      w.row.blocked = body.blocked ? 1 : 0;
      continue;
    }
    // A stack: each blocking copy takes its own attacking copy, in the order declared.
    const taken = Math.min(w.n, w.slots.length);
    for (let i = 0; i < taken; i++) {
      const body = attackerBody(1);
      body.blocked = true;
      const blocker = blockerBody(w.slots[i], w, body);
      if (blocker) body.blockers.push(blocker);
    }
    const rest = w.n - taken;
    if (rest > 0) {
      const body = attackerBody(rest); // they never take damage: one body for all of them
      body.blocked = w.row.paper;
    }
    w.row.blocked = w.row.paper ? w.n : taken;
  }

  // 4) Two damage steps. Everything in a step is dealt at once; a creature
  // dead after the first deals nothing in the second, and what the first
  // marked stays marked.
  const defenders = new Map<number, DefenderResult>();
  const defender = (seat: number) => {
    let d = defenders.get(seat);
    if (!d) defenders.set(seat, (d = { seat, commanders: [], other: 0, poison: 0 }));
    return d;
  };
  for (const w of works) if (w.row.walker === null) defender(w.attack.target);
  // The planeswalkers attacked, while they are still there to be hit.
  const walkers = new Map<string, WalkerResult>();
  for (const w of works) {
    if (w.row.walker === null) continue;
    const card = game.players[w.attack.target]?.cards?.battlefield.find((c) => c.iid === w.row.walker);
    const key = `${w.attack.target}:${w.row.walker}`;
    if (card && !walkers.has(key)) walkers.set(key, { seat: w.attack.target, iid: card.iid, name: card.name, damage: 0 });
  }
  const gains = new Map<number, number>();
  const gain = (body: Body, amount: number) => {
    if (body.lifelink && amount > 0) gains.set(body.fighter.seat, (gains.get(body.fighter.seat) ?? 0) + amount);
  };
  const hitPlayer = (body: Body, amount: number) => {
    if (amount <= 0) return;
    // At a planeswalker: its loyalty takes it — no life, no commander
    // damage, no poison. One that has left takes nothing, and nobody else does.
    if (body.walker !== null) {
      const walker = walkers.get(`${body.target}:${body.walker}`);
      if (!walker) return;
      walker.damage += amount;
      works.find((w) => w.index === body.attack)!.row.toWalker += amount;
      gain(body, amount);
      return;
    }
    const d = defender(body.target);
    works.find((w) => w.index === body.attack)!.row.toPlayer += amount;
    gain(body, amount);
    const key = body.fighter.commander;
    if (key) {
      let gauge = d.commanders.find((c) => c.key === key);
      if (!gauge) d.commanders.push((gauge = { key, damage: 0, life: 0 }));
      gauge.damage += amount;
      if (!body.infect) gauge.life += amount;
    } else if (!body.infect) {
      d.other += amount;
    }
    // Infect: that many poison counters instead of life. Toxic: N more on
    // top, once for every creature that connected.
    if (body.infect) d.poison += amount;
    d.poison += body.toxic * body.copies;
  };
  const strikes = (body: Body, step: 'first' | 'regular') =>
    !body.dead && !body.unread && body.power > 0 && (step === 'first' ? body.first : body.regular);
  /** What this attacker has to put on that blocker before it may move on. */
  const lethal = (from: Body, to: Body) => {
    if (from.deathtouch) return to.touched ? 0 : 1;
    // A blocker whose toughness the app cannot trust soaks up everything.
    if (to.unread || to.toughness < 1) return Infinity;
    return Math.max(0, to.toughness - to.marked);
  };

  for (const step of ['first', 'regular'] as const) {
    const hits: { from: Body; to: Body; amount: number }[] = [];
    const toPlayers: { from: Body; amount: number }[] = [];
    for (const body of attackers) {
      if (!strikes(body, step)) continue;
      if (!body.blocked) {
        toPlayers.push({ from: body, amount: body.power * body.copies });
        continue;
      }
      // Blocked — by the declared list, not by who is still there.
      const alive = body.blockers.filter((b) => !b.dead);
      let left = body.power;
      alive.forEach((blocker, i) => {
        const last = i === alive.length - 1;
        const amount = last && !body.trample ? left : Math.min(left, lethal(body, blocker));
        if (amount > 0) hits.push({ from: body, to: blocker, amount });
        left -= amount;
      });
      // The rest goes to the player only with trample — and never past a
      // paper blocker, whose size nobody told the app.
      if (left > 0 && body.trample && !body.paper) toPlayers.push({ from: body, amount: left });
    }
    for (const body of blockers) {
      if (!strikes(body, step) || !body.blocking || body.blocking.dead) continue;
      hits.push({ from: body, to: body.blocking, amount: body.power });
    }
    for (const { from, to, amount } of hits) {
      to.marked += amount;
      if (from.deathtouch) to.touched = true;
      // As −1/−1 counters: it is smaller from the next damage step on.
      if (from.infect || from.wither) {
        to.withered += amount;
        to.power = Math.max(0, to.power - amount);
      }
      gain(from, amount);
    }
    for (const { from, amount } of toPlayers) hitPlayer(from, amount);
    // Dead: dealt at least 1, a toughness of at least 1 in the app, and
    // either lethal damage or any from deathtouch — unless indestructible,
    // unless unread.
    for (const body of [...attackers, ...blockers]) {
      if (body.dead || body.marked < 1 || body.toughness < 1 || body.unread) continue;
      // Indestructible: only −1/−1 counters that take its toughness to 0 kill it.
      if (body.indestructible ? body.withered >= body.toughness : body.marked >= body.toughness || body.touched) body.dead = true;
    }
  }

  // 5) Write it up.
  const deaths = new Map<string, CombatOutcome['deaths'][number]>();
  const deadIn = new Map<number, number>(); // attack index → attacking stack copies dead
  for (const body of [...attackers, ...blockers]) {
    if (!body.dead) continue;
    const { fighter } = body;
    fighter.dies += body.copies;
    const key = `${fighter.seat}:${unitKey(fighter.unit)}`;
    let death = deaths.get(key);
    if (!death) {
      death = { seat: fighter.seat, unit: fighter.unit, ...(fighter.unit.kind === 'stack' ? { n: 0 } : {}) };
      if (fighter.commander !== null) death.toCommand = true;
      deaths.set(key, death);
    }
    if (fighter.unit.kind === 'stack') {
      death.n = (death.n ?? 0) + body.copies;
      if (body.side === 'attacker') deadIn.set(body.attack, (deadIn.get(body.attack) ?? 0) + body.copies);
    }
  }
  // Of an attack's dead copies, as many were tapped as the declaration tapped.
  for (const w of works) {
    const tapped = Math.min(deadIn.get(w.index) ?? 0, Math.max(0, w.attack.tapped ?? 0));
    if (tapped <= 0) continue;
    const death = deaths.get(`${w.row.seat}:${unitKey(w.row.unit)}`)!;
    death.tapped = (death.tapped ?? 0) + tapped;
  }
  // −1/−1 counters (infect, wither) stay on a card that lives through it;
  // on one copy of a stack they cannot be kept, and count as damage.
  for (const body of [...attackers, ...blockers]) {
    if (body.dead || body.withered < 1) continue;
    if (body.fighter.unit.kind !== 'card') {
      result.infectOnCreatures = true;
      continue;
    }
    result.outcome.shrunk = [...(result.outcome.shrunk ?? []), { seat: body.fighter.seat, unit: body.fighter.unit, n: body.withered }];
  }
  // Attackers first, each followed by what stood in its way.
  const order: Fighter[] = works.flatMap((w) => [w.row, ...w.row.blockers]);
  const listed = new Set<string>();
  for (const fighter of order) {
    const key = `${fighter.seat}:${unitKey(fighter.unit)}`;
    if (!listed.has(key) && deaths.has(key)) result.outcome.deaths.push(deaths.get(key)!);
    listed.add(key);
  }
  const named = (into: UnitRef[], fighter: Fighter) => {
    if (!into.some((u) => u.seat === fighter.seat && unitKey(u.unit) === unitKey(fighter.unit))) {
      into.push({ seat: fighter.seat, unit: fighter.unit, name: fighter.name });
    }
  };
  for (const fighter of order) {
    if (flagged.has(fighter)) {
      fighter.check = true;
      named(result.check, fighter);
    }
    if (fighter.present && fighter.unread) named(result.unread, fighter);
  }

  result.attacks = works.map((w) => w.row);
  result.defenders = [...defenders.values()];
  result.walkers = [...walkers.values()];
  const hurt = result.walkers.filter((w) => w.damage > 0);
  if (hurt.length > 0) result.outcome.walkers = hurt.map((w) => ({ seat: w.seat, iid: w.iid, n: w.damage }));
  result.gains = [...gains].map(([seat, life]) => ({ seat, life }));
  const changed = [...result.defenders.map((d) => d.seat), ...result.gains.map((g) => g.seat)];
  for (const seat of [...new Set(changed)]) {
    const d = defenders.get(seat);
    const lost = d ? d.other + d.commanders.reduce((total, c) => total + c.life, 0) : 0;
    const life = (gains.get(seat) ?? 0) - lost;
    const gauges = (d?.commanders ?? []).filter((c) => c.damage > 0);
    const poison = d?.poison ?? 0;
    if (life === 0 && gauges.length === 0 && poison === 0) continue;
    result.outcome.players.push({
      seat,
      life,
      ...(gauges.length > 0 ? { commander: Object.fromEntries(gauges.map((c) => [c.key, c.damage])) } : {}),
      ...(poison > 0 ? { poison } : {}),
    });
  }
  return result;
}

/** Works the fight out: who deals what to whom over the two damage steps,
 * who dies, and everything a screen needs to explain it without deriving
 * anything again. `combat` is the live combat (liveCombat(game)); the
 * result is only as good as `records` — ask cardsRead before applying it.
 *
 * - First strike deals in the first step only, double strike in both.
 * - Unblocked: all its damage to the defending player. Blocked: it deals
 *   ALL its power — lethal to each blocker in the order declared (with
 *   deathtouch 1 is lethal), the rest on the last one unless it has
 *   trample, which sends the rest to the player. "Blocked" is decided by
 *   the declared list: an attacker whose blockers are all gone deals
 *   nothing without trample and everything to the player with it.
 * - A creature dies when it was dealt at least 1, its toughness in the app
 *   is at least 1, and the damage on it is lethal or any of it came from
 *   deathtouch — unless it is indestructible, unless it is unread.
 * - Lifelink counts every point dealt, to players and creatures alike.
 * - Infect: its damage to a player is poison and no life (a commander's
 *   still counts on the gauge). Toxic N: N poison on top, when it connects. */
export function resolveCombat(game: GameState, combat: CombatState, records: CardRecords): CombatResult {
  try {
    if (!game || !combat || !Array.isArray(game.players)) return EMPTY();
    return resolve(game, combat, records ?? {});
  } catch {
    // A fight that cannot be worked out must not take the screen down with it.
    return { ...EMPTY(), failed: true };
  }
}
