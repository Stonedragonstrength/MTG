import { counterName } from './entering';
import { frontId, isBackId } from './faces';
import { conditionHolds, countWith, type Conditions } from './lands';
import type { ManaColor } from './mana';
import type { BoardItem, CardInstance, CardRecord } from './types';

// ---- mana abilities that read the table ----
// Urza's Tower makes {C}{C}{C} once the Mine and the Power-Plant are out,
// Nykthos makes your devotion, a Verge makes its second color only beside
// the right land, Marwyn makes her power, Everflowing Chalice its charge
// counters. The mana reader (mana.ts tapManaFromText) reads printed words;
// manaTextHere first turns a card's words into what they say on THIS
// table, and the reader reads that.

type Records = Record<string, CardRecord | null | undefined>;
type Colored = Exclude<ManaColor, 'C'>;

const COLORED: Colored[] = ['W', 'U', 'B', 'R', 'G'];
const BASIC_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'];

/** One creature a seat controls, read the way a fight reads it
 * (lib/combatEngine.ts): counters, what it wears, boosts, anthems. A token
 * stack gives one per copy. */
export interface CreatureRead {
  /** The card's iid, or the stack's id. */
  key: string;
  power: number;
  toughness: number;
  /** It arrived since its controller's last turn began (its sick flag). */
  fresh: boolean;
  defender: boolean;
  /** A size the table cannot trust (a star size with nothing on it, a record not read yet). */
  unread: boolean;
}

/** What the mana engine reads off the whole table beyond a seat's own
 * cards — asked only when a card's mana counts it (lib/seatMana.ts). */
export interface TableRead {
  /** The seat's creatures. */
  creatures(): CreatureRead[];
  /** The type line of every permanent on the table, every seat's, as far
   * as this device has read them (a token stack once per copy). */
  everyone(): string[];
}

/** What a seat's mana abilities look at. */
export interface ManaTable {
  /** The type line of every permanent the seat controls (each copy of a
   * token stack once). */
  mine: string[];
  devotion: Record<Colored, number>;
  /** null: nothing beyond the seat's own cards is known — power and the
   * other seats' permanents are not counted. */
  read: TableRead | null;
}

/** The card whose words are being read. */
export type ManaSelf = Pick<CardInstance, 'iid' | 'sick' | 'counters'> & { name: string; typeLine: string };

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

export function manaTable(
  battlefield: CardInstance[],
  records: Records,
  board: BoardItem[],
  read: TableRead | null = null,
): ManaTable {
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
  return { mine, devotion, read };
}

/** Mana an ability costs on top of its {T}: "{2}, {T}" is 2. */
const costOf = (head: string) =>
  [...head.matchAll(/\{(\d+)\}/g)].reduce((sum, [, n]) => sum + Number(n), 0) + [...head.matchAll(/\{[WUBRGC]\}/g)].length;

/** The last word of a plural as the type line says it: Elves → Elf, Allies → Ally, Gates → Gate. */
function singular(noun: string): string {
  return noun.replace(/(\w+)$/, (w) => (/ves$/i.test(w) ? w.slice(0, -3) + 'f' : /ies$/i.test(w) ? w.slice(0, -3) + 'y' : w));
}

/** A number the table shows: "this creature's power", "the greatest power
 * among creatures you control", "Elves on the battlefield", "charge
 * counters on this artifact", "other creatures you control"… null when the
 * app cannot count it (then the card reads as printed). */
function measure(phrase: string, table: ManaTable, self: ManaSelf): number | null {
  // "Marwyn's power", "counters on The Eternity Elevator": the card itself.
  const names = [self.name.split(' // ')[0], self.name.split(' // ')[0].split(',')[0]];
  let q = phrase.trim().replace(/’/g, "'");
  for (const name of names) if (name.trim()) q = q.split(name).join('this permanent');
  q = q.replace(/^the (?:number|amount) of /i, '');
  let m: RegExpMatchArray | null;
  const creatures = () => table.read?.creatures() ?? null;

  if ((m = q.match(/^this (?:creature|permanent)'s (power|toughness)$/i))) {
    const me = creatures()?.find((k) => k.key === self.iid);
    return me ? Math.max(0, m[1].toLowerCase() === 'power' ? me.power : me.toughness) : null;
  }
  if ((m = q.match(/^the greatest (power|toughness) among (other )?creatures you control( that entered this turn)?$/i))) {
    const list = creatures();
    if (!list) return null;
    const sizes = list
      .filter((k) => (!m![2] || k.key !== self.iid) && (!m![3] || k.fresh))
      .map((k) => (m![1].toLowerCase() === 'power' ? k.power : k.toughness));
    return Math.max(0, ...sizes);
  }
  // "+1/+1 counter on this creature", "charge counters on this artifact", "counter on Nardole".
  if ((m = q.match(/^(?:(\S+) )?counters? on this (?:creature|artifact|land|enchantment|permanent)$/i))) {
    const counters = self.counters ?? {};
    if (!m[1]) return Object.values(counters).reduce((sum, n) => sum + Math.max(0, n), 0);
    return Math.max(0, counters[counterName(m[1])] ?? 0);
  }
  if (/^basic land types among lands you control$/i.test(q)) {
    const lands = table.mine.filter((t) => /\bLand\b/.test(t)).map((t) => t.toLowerCase());
    return BASIC_TYPES.filter((type) => lands.some((t) => new RegExp(`\\b${type}\\b`).test(t))).length;
  }
  if ((m = q.match(/^(other )?creatures? you control with defender$/i))) {
    const list = creatures();
    return list ? list.filter((k) => k.defender && (!m![1] || k.key !== self.iid)).length : null;
  }
  // Leafkin Avenger: "creature with power 4 or greater you control".
  if ((m = q.match(/^creatures? with power (\d+) or greater you control$/i))) {
    const list = creatures();
    return list ? list.filter((k) => k.power >= Number(m![1])).length : null;
  }
  if ((m = q.match(/^(.+?) on the battlefield$/i))) {
    const everyone = table.read?.everyone();
    return everyone ? countWith(everyone, singular(m[1])) : null;
  }
  if ((m = q.match(/^(other )?(.+?) you control$/i))) {
    if (/\b(with|named|among|that)\b/i.test(m[2])) return null;
    const noun = singular(m[2]);
    const count = countWith(table.mine, noun);
    return m[1] && countWith([self.typeLine], noun) > 0 ? Math.max(0, count - 1) : count;
  }
  return null;
}

/** The ability rewritten to add `n` of what it adds, or gone when that is
 * no mana above what it costs. */
function yields(head: string, n: number, adds: (n: number) => string, rest = ''): string[] {
  return n > costOf(head) ? [`${head}Add ${adds(n)}.${rest}`] : [];
}

const symbols = (symbol: string) => (n: number) => `{${symbol.toUpperCase()}}`.repeat(n);

function lineHere(line: string, table: ManaTable, ctx: Conditions, self: ManaSelf): string[] {
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
  let m: RegExpMatchArray | null;
  // Nykthos, Nyx Lotus: "Choose a color. Add an amount of mana of that color equal to your devotion to
  // that color." — one ability per color worth choosing. Karametra's Acolyte: "an amount of {G}".
  if ((m = line.match(/^(.*?\{T\}[^:]*:\s*)choose a color\.\s*add an amount of mana of that color equal to your devotion to that color\b/i))) {
    const head = m[1];
    return COLORED.flatMap((c) => yields(head, table.devotion[c], symbols(c)));
  }
  if ((m = line.match(/^(.*?\{T\}[^:]*:\s*)add an amount of \{([WUBRG])\} equal to your devotion to (?:white|blue|black|red|green)\b/i)))
    return yields(m[1], table.devotion[m[2].toUpperCase() as Colored], symbols(m[2]));
  // Marwyn: "Add an amount of {G} equal to Marwyn's power." Bighorner Rancher: "…the greatest power…".
  if ((m = line.match(/^(.*?\{T\}[^:]*:\s*)add an amount of \{([WUBRGC])\} equal to ([^.]+)\.(.*)$/i))) {
    const n = measure(m[3], table, self);
    return n === null ? [line] : yields(m[1], n, symbols(m[2]), m[4]);
  }
  // Selvala: "Add X mana in any combination of colors, where X is the greatest power among creatures
  // you control." Kami of Whispered Hopes: "Add X mana of any one color, where X is this creature's power."
  if ((m = line.match(/^(.*?\{T\}[^:]*:\s*)add X (mana [^,.]+), where X is ([^.]+)\.(.*)$/i))) {
    const n = measure(m[3], table, self);
    const what = m[2];
    return n === null ? [line] : yields(m[1], n, (k) => `${k} ${what}`, m[4]);
  }
  // Brigid: "Add X {G} or X {W}, where X is the number of other creatures you control."
  if ((m = line.match(/^(.*?\{T\}[^:]*:\s*)add X \{([WUBRGC])\} or X \{([WUBRGC])\}, where X is ([^.]+)\.(.*)$/i))) {
    const n = measure(m[4], table, self);
    const head = m[1];
    return n === null ? [line] : [...yields(head, n, symbols(m[2])), ...yields(head, n, symbols(m[3]))];
  }
  // Gaea's Cradle: "Add {G} for each creature you control." Everflowing Chalice: "…for each charge
  // counter on this artifact." Priest of Titania: "…for each Elf on the battlefield."
  if ((m = line.match(/^(.*?\{T\}[^:]*:\s*)add \{([WUBRGC])\} for each ([^.]+)\.(.*)$/i))) {
    const n = measure(m[3], table, self);
    return n === null ? [line] : yields(m[1], n, symbols(m[2]), m[4]);
  }
  return [line];
}

/** A card's words as its mana abilities stand on this table: an ability
 * whose "Activate only if…" fails is gone, an "add {C}{C}{C} instead" that
 * holds replaces what the ability adds, and an amount the table shows —
 * devotion, a creature's power, a count — becomes that much mana. What the
 * app cannot judge or count stays as printed. */
export function manaTextHere(text: string, table: ManaTable, self: ManaSelf): string {
  if (!/\binstead\b|activate only if|devotion|equal to|where X is|for each/i.test(text)) return text;
  const ctx: Conditions = {
    mine: table.mine,
    fresh: !!self.sick,
    counters: self.counters ?? {},
    get creatures() {
      return table.read?.creatures();
    },
  };
  return text
    .split('\n')
    .flatMap((line) => lineHere(line, table, ctx, self))
    .join('\n');
}
