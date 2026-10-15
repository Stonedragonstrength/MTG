import { frontId, isBackId } from './faces';
import { conditionHolds, type Conditions } from './lands';
import type { ManaColor } from './mana';
import type { BoardItem, CardInstance, CardRecord } from './types';

// ---- mana abilities that read the table ----
// Urza's Tower makes {C}{C}{C} once the Mine and the Power-Plant are out,
// Nykthos makes your devotion, a Verge makes its second color only beside
// the right land. The mana reader (mana.ts tapManaFromText) reads printed
// words; manaTextHere first turns a card's words into what they say on THIS
// table, and the reader reads that.

type Records = Record<string, CardRecord | null | undefined>;
type Colored = Exclude<ManaColor, 'C'>;

const COLORED: Colored[] = ['W', 'U', 'B', 'R', 'G'];

/** What a seat's mana abilities look at. */
export interface ManaTable {
  /** The type line of every permanent the seat controls (each copy of a
   * token stack once). */
  mine: string[];
  devotion: Record<Colored, number>;
}

/** The mana cost of the face that is up. A card lying on its back has its
 * back face's cost — a transformed card's back has none — read off the
 * front record where the table has it, otherwise nothing. */
function costUp(c: CardInstance, records: Records): string {
  if (!isBackId(c.cardId)) return (records[c.cardId]?.manaCost ?? '').split(' // ')[0];
  return records[frontId(c.cardId)]?.back?.manaCost ?? '';
}

/** Each {G} in the mana costs of the permanents a seat controls counts
 * toward its devotion to green; a hybrid {G/W} counts toward both, {2/G}
 * and {G/P} toward green. */
function addDevotion(into: Record<Colored, number>, manaCost: string, times: number): void {
  for (const [, symbol] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    for (const part of new Set(symbol.toUpperCase().split('/'))) {
      if ((COLORED as string[]).includes(part)) into[part as Colored] += times;
    }
  }
}

export function manaTable(battlefield: CardInstance[], records: Records, board: BoardItem[]): ManaTable {
  const mine: string[] = [];
  const devotion: Record<Colored, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of battlefield) {
    const record = records[c.cardId];
    if (record) mine.push(record.typeLine);
    addDevotion(devotion, costUp(c, records), 1);
  }
  for (const item of board) {
    const copies = Math.max(0, Math.min(item.count, 60));
    for (let i = 0; i < copies; i++) mine.push(item.typeLine);
    // A token's cost is empty; a stack of a real card (or a copy of one) has its card's.
    if (item.cardId) addDevotion(devotion, (records[item.cardId]?.manaCost ?? '').split(' // ')[0], copies);
  }
  return { mine, devotion };
}

/** Mana an ability costs on top of its {T}: "{2}, {T}" is 2. */
const costOf = (head: string) =>
  [...head.matchAll(/\{(\d+)\}/g)].reduce((sum, [, n]) => sum + Number(n), 0) + [...head.matchAll(/\{[WUBRGC]\}/g)].length;

function lineHere(line: string, table: ManaTable, ctx: Conditions): string[] {
  // A quoted ability belongs to whatever is given it; a line with no {T} ability that adds is not mana.
  if (line.includes('"') || !/\{T\}[^:]*:.*\badd\b/i.test(line)) return [line];
  // "Activate only if you control a Swamp" (Tainted Isle, the Verges, Temple of the False God, Mox Opal).
  const only = line.match(/\bactivate only if ([^.]+)\./i);
  if (only && conditionHolds(only[1], ctx) === false) return [];
  // "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead."
  const instead = line.match(/^(.*?\badd\s+)([^.]*)\.\s*if ([^,]+), add\s+(.+?)\s+instead\.(.*)$/i);
  if (instead) {
    const [, head, plain, cond, more, rest] = instead;
    return [`${head}${conditionHolds(cond, ctx) === true ? more : plain}.${rest}`];
  }
  // Nykthos, Nyx Lotus: "Choose a color. Add an amount of mana of that color equal to your devotion to
  // that color." — one ability per color worth choosing. Karametra's Acolyte: "an amount of {G}".
  const chosen = line.match(
    /^(.*?\{T\}[^:]*:\s*)choose a color\.\s*add an amount of mana of that color equal to your devotion to that color\b/i,
  );
  const fixed = line.match(/^(.*?\{T\}[^:]*:\s*)add an amount of \{([WUBRG])\} equal to your devotion to (?:white|blue|black|red|green)\b/i);
  const head = (chosen ?? fixed)?.[1];
  if (head !== undefined) {
    const paid = costOf(head);
    const colors = fixed ? [fixed[2].toUpperCase() as Colored] : COLORED;
    return colors.filter((c) => table.devotion[c] > paid).map((c) => `${head}Add ${`{${c}}`.repeat(table.devotion[c])}.`);
  }
  return [line];
}

/** A card's words as its mana abilities stand on this table: an ability
 * whose "Activate only if…" fails is gone, an "add {C}{C}{C} instead" that
 * holds replaces what the ability adds, and devotion becomes that many mana
 * symbols. What the app cannot judge stays as printed. */
export function manaTextHere(
  text: string,
  table: ManaTable,
  self: Pick<CardInstance, 'sick' | 'counters'>,
): string {
  if (!/\binstead\b|activate only if|devotion/i.test(text)) return text;
  const ctx: Conditions = { mine: table.mine, fresh: !!self.sick, counters: self.counters ?? {} };
  return text
    .split('\n')
    .flatMap((line) => lineHere(line, table, ctx))
    .join('\n');
}
