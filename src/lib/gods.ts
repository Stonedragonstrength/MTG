import { frontId, isBackId } from './faces';
import type { BoardItem, CardInstance, CardRecord, CombatUnit, GameState } from './types';

// ---- the Theros gods ----
// "As long as your devotion to green is less than five, Nylea isn't a
// creature." A god on the table is a creature only while its devotion
// reaches its number; below it, it is an enchantment (and whatever else it
// is) that cannot attack or block, is no creature a spell or an anthem
// reaches, and does not get summoning sick. Two cards are held the same
// way by something else: The Warring Triad (eight cards in your
// graveyard) and Arvinox (three permanents you control that you don't own).

type Records = Record<string, CardRecord | null | undefined>;
export type Colored = 'W' | 'U' | 'B' | 'R' | 'G';

/** What a card needs before it is a creature. */
export type GodNeed =
  | { kind: 'devotion'; colors: Colored[]; needs: number }
  | { kind: 'graveyard'; needs: number }
  | { kind: 'stolen'; needs: number };

const COLOR_WORD: Record<string, Colored> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const COLOR_NAME: Record<Colored, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
const NUMBER_WORD: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const amount = (word: string): number | null =>
  /^\d+$/.test(word) ? Number(word) : (NUMBER_WORD[word.toLowerCase()] ?? null);

const COLOR = '(white|blue|black|red|green)';

/** What the card's front face says it needs before it is a creature; null
 * for a card that is a creature (or not) by its type line alone. */
export function godNeed(text: string): GodNeed | null {
  const front = text.split('\n//\n')[0];
  let m = front.match(
    new RegExp(`as long as your devotion to ${COLOR}(?: and ${COLOR})? is less than (\\w+), [^\\n]*?isn['’]t a creature`, 'i'),
  );
  if (m) {
    const needs = amount(m[3]);
    const colors = [m[1], m[2]].filter(Boolean).map((w) => COLOR_WORD[w.toLowerCase()]);
    return needs === null ? null : { kind: 'devotion', colors, needs };
  }
  // The Warring Triad.
  m = front.match(/as long as there are fewer than (\w+) cards in your graveyard, [^\n]*?isn['’]t a creature/i);
  if (m) {
    const needs = amount(m[1]);
    return needs === null ? null : { kind: 'graveyard', needs };
  }
  // Arvinox, the Mind Flail.
  m = front.match(/isn['’]t a creature unless you control (\w+) or more permanents you don['’]t own/i);
  if (m) {
    const needs = amount(m[1]);
    return needs === null ? null : { kind: 'stolen', needs };
  }
  return null;
}

/** The mana cost of the face that is up. A card lying on its back has its
 * back face's cost — a transformed card's back has none — read off the
 * front record where the table has it, otherwise nothing. */
function costUp(c: Pick<CardInstance, 'cardId'>, records: Records): string {
  if (!isBackId(c.cardId)) return (records[c.cardId]?.manaCost ?? '').split(' // ')[0];
  return records[frontId(c.cardId)]?.back?.manaCost ?? '';
}

/** The mana costs of what a seat controls, each with how many copies have
 * it: a card once, a stack of a real card (or a copy of one) once per copy;
 * a token's cost is empty. */
export function costsOf(battlefield: CardInstance[], board: BoardItem[], records: Records): Array<[string, number]> {
  const out: Array<[string, number]> = battlefield.map((c) => [costUp(c, records), 1]);
  for (const item of board) {
    if (!item.cardId) continue;
    out.push([(records[item.cardId]?.manaCost ?? '').split(' // ')[0], Math.max(0, Math.min(item.count, 60))]);
  }
  return out;
}

/** A seat's devotion to one color or more: each mana symbol in those costs
 * that is any of the colors counts once. A hybrid {G/W} counts toward
 * green and toward white, and once toward "green and white"; {2/G} and
 * {G/P} count toward green. */
export function devotionTo(costs: Array<[string, number]>, colors: Colored[]): number {
  let n = 0;
  for (const [cost, times] of costs) {
    for (const [, symbol] of cost.matchAll(/\{([^}]+)\}/g)) {
      if (symbol.toUpperCase().split('/').some((part) => (colors as string[]).includes(part))) n += times;
    }
  }
  return n;
}

/** One god (or the like) on a seat's side of the table, as it stands. */
export interface GodRead {
  need: GodNeed;
  /** What the seat has of it now: the devotion, the cards in the graveyard. */
  now: number;
  /** It has reached its number: it is a creature. */
  creature: boolean;
}

/** The key a unit goes under: 'card:<iid>' or 'stack:<id>', as a fight names it. */
export const godKey = (unit: Pick<CombatUnit, 'kind' | 'id'>) => `${unit.kind}:${unit.id}`;

interface SeatCards {
  battlefield: CardInstance[];
  board: BoardItem[];
  /** Cards in the graveyard; null when not known (then a card that counts
   * them is left to its type line). */
  graveyard: number | null;
}

const cache = new WeakMap<CardInstance[], { board: BoardItem[]; graveyard: number | null; records: Records; out: Map<string, GodRead> }>();

/** Every god (or the like) a seat controls, by godKey; the rest are left out. */
export function godsFrom(seat: SeatCards, records: Records): Map<string, GodRead> {
  const hit = cache.get(seat.battlefield);
  if (hit && hit.board === seat.board && hit.graveyard === seat.graveyard && hit.records === records) return hit.out;
  const out = new Map<string, GodRead>();
  const found: Array<[string, GodNeed]> = [];
  for (const c of seat.battlefield) {
    const need = godNeed(records[c.cardId]?.oracleText ?? '');
    if (need) found.push([godKey({ kind: 'card', id: c.iid }), need]);
  }
  for (const item of seat.board) {
    const need = godNeed(item.oracleText ?? (item.cardId ? (records[item.cardId]?.oracleText ?? '') : ''));
    if (need) found.push([godKey({ kind: 'stack', id: item.id }), need]);
  }
  let costs: Array<[string, number]> | null = null;
  for (const [key, need] of found) {
    let now: number;
    if (need.kind === 'devotion') now = devotionTo((costs ??= costsOf(seat.battlefield, seat.board, records)), need.colors);
    else if (need.kind === 'stolen') now = seat.battlefield.filter((c) => c.stolen).length;
    else if (seat.graveyard === null) continue;
    else now = seat.graveyard;
    out.set(key, { need, now, creature: now >= need.needs });
  }
  cache.set(seat.battlefield, { board: seat.board, graveyard: seat.graveyard, records, out });
  return out;
}

/** Every god (or the like) seat `seat` controls. */
export function godsOf(g: GameState, seat: number, records: Records): Map<string, GodRead> {
  const player = g.players[seat];
  if (!player) return new Map();
  return godsFrom(
    { battlefield: player.cards?.battlefield ?? [], board: player.board, graveyard: player.cards?.graveyard.length ?? null },
    records,
  );
}

/** false only for a god (or the like) below its number: everything else is
 * what its type line says. */
export function notHeldBack(gods: Map<string, GodRead>, unit: Pick<CombatUnit, 'kind' | 'id'>): boolean {
  return gods.get(godKey(unit))?.creature !== false;
}

/** A type line without its creature: "Legendary Enchantment Creature — God"
 * as a god below its devotion stands, "Legendary Enchantment — God". */
export const notCreature = (typeLine: string) => typeLine.replace(/\s*\bCreature\b/, '');

/** What it still lacks, in words: "devotion to green 3 of 5". */
export function godWords(god: GodRead): string {
  const { need, now } = god;
  if (need.kind === 'devotion') return `devotion to ${need.colors.map((c) => COLOR_NAME[c]).join(' and ')} ${now} of ${need.needs}`;
  if (need.kind === 'graveyard') return `${now} of ${need.needs} cards in the graveyard`;
  return `${now} of ${need.needs} permanents you don't own`;
}
