import { counterName } from './entering';
import { tapManaFromText, type ManaColor } from './mana';
import type { CardInstance, CardRecord } from './types';

// ---- mana saved up as counters ----
// Dreadship Reef puts a storage counter on itself each turn and later
// takes them all off at once for that much mana; a Mana Battery does the
// same with charge counters, a Vivid land spends one of its two for a
// color it does not make, Pentad Prism and Druids' Repository are nothing
// but their counters. The mana reader (mana.ts) reads printed words;
// storedHere turns an ability paid with counters into what it makes with
// the counters the card has now, and says what a payment drawing on it
// takes off them.

type Colors = (ManaColor | 'any')[];

/** What a payment that draws on a source takes off the card's counters
 * (countersTaken). */
export interface StoredDraw {
  /** The card. */
  iid: string;
  /** Which counters: 'storage', 'charge', 'p1p1'… */
  kind: string;
  /** What the source makes without them: a payment within this takes none. */
  plain: number;
  plainColors: Colors;
  /** Counters one activation takes: so many, or 'X' — as many as wanted. */
  take: number | 'X';
  /** Mana one activation makes — for 'X', one counter. */
  makes: number;
  /** 'X': mana the activation makes besides (a Mana Battery's first {B}). */
  plus: number;
  /** Mana its cost takes that comes out of the counters themselves: a
   * source apart from the card's tap has no tap to pay it with. */
  pay: number;
  /** "If there are no depletion counters on this land, sacrifice it." */
  goes?: true;
}

/** One mana ability paid with the card's own counters, as printed. */
interface CounterAbility {
  /** Its line in the card's text. */
  line: number;
  kind: string;
  /** {T} is part of its cost. */
  tap: boolean;
  /** Mana in its cost: Dreadship Reef's {1}. */
  pay: number;
  take: number | 'X';
  makes: number;
  plus: number;
  /** "Activate only once each turn." */
  once: boolean;
  goes: boolean;
  /** What it adds for so much mana, as the mana reader reads it. */
  adds: (n: number) => string;
  /** What else the line says that the mana reader wants: "Spend this mana only…". */
  rest: string;
}

const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const REMOVE =
  /^Remove (X|any number of|one or more|an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([a-z]+|[+-]1\/[+-]1) counters? from (.+)$/i;
const MANA = /^(?:\{[^}]+\})+$/;

/** What an "X" ability adds: X mana of a kind, a symbol for each counter, a
 * symbol and one more for each, X plus one, "that much". */
function readX(first: string): Pick<CounterAbility, 'adds' | 'plus'> | null {
  let m: RegExpMatchArray | null;
  if ((m = first.match(/^X (mana\b.+)$/i))) {
    const what = m[1];
    return { plus: 0, adds: (n) => `${n} ${what}` };
  }
  if ((m = first.match(/^(\{[WUBRGC]\}) for each \S+ counter removed this way$/i))) {
    const symbol = m[1].toUpperCase();
    return { plus: 0, adds: (n) => symbol.repeat(n) };
  }
  if ((m = first.match(/^(\{[WUBRGC]\}), then add an additional \{[WUBRGC]\} for each \S+ counter removed this way$/i))) {
    const symbol = m[1].toUpperCase();
    return { plus: 1, adds: (n) => symbol.repeat(n) };
  }
  if ((m = first.match(/^an amount of (\{[WUBRGC]\}) equal to X plus one$/i))) {
    const symbol = m[1].toUpperCase();
    return { plus: 1, adds: (n) => symbol.repeat(n) };
  }
  if ((m = first.match(/^that much (\{[WUBRGC]\})$/i))) {
    const symbol = m[1].toUpperCase();
    return { plus: 0, adds: (n) => symbol.repeat(n) };
  }
  return null;
}

/** The card's mana abilities that remove its own counters, in the order
 * printed. A cost or an amount the table cannot read leaves the line out. */
function counterAbilities(lines: string[], name: string): CounterAbility[] {
  const full = name.split(' // ')[0];
  // A legendary card speaks of itself by its first name: "Remove five +1/+1 counters from Ramos".
  const short = full.includes(',') ? full.split(',')[0].trim() : null;
  // …or by the start of it: "from Rasputin" (Rasputin Dreamweaver).
  const itself = (subject: string) =>
    subject === '~' || /^this [a-z]+$/i.test(subject) || (subject.length >= 3 && `${full} `.startsWith(`${subject} `));
  const out: CounterAbility[] = [];
  lines.forEach((raw, i) => {
    let line = raw
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/^[A-Z][^—:]* — /, '') // an ability word: "Devouring Monster — {T}, …"
      .trim()
      .split(full)
      .join('~');
    if (short) line = line.replace(new RegExp(`\\b${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '~');
    const colon = line.indexOf(': ');
    if (colon < 0) return;
    const effect = line.slice(colon + 2);
    if (!/^Add /i.test(effect)) return;
    let tap = false;
    let pay = 0;
    let take: number | 'X' | null = null;
    let kind = '';
    for (const part of line.slice(0, colon).split(/,\s*/)) {
      const m = part.match(REMOVE);
      if (part === '{T}') tap = true;
      else if (MANA.test(part) && !/\{[TQX]\}/.test(part))
        pay += [...part.matchAll(/\{([^}]+)\}/g)].reduce((sum, [, s]) => sum + (/^\d+$/.test(s) ? Number(s) : 1), 0);
      else if (m && itself(m[3])) {
        const word = m[1].toLowerCase();
        take = word === 'x' || word === 'any number of' || word === 'one or more' ? 'X' : (COUNT[word] ?? Number(word));
        kind = counterName(m[2]);
      } else return; // a cost the table does not pay
    }
    if (take === null || take === 0) return;
    const sentences = effect.split(/(?<=\.)\s+/);
    const first = sentences[0].replace(/^Add /i, '').replace(/\.$/, '');
    const others = sentences.slice(1);
    const rest = others.filter((s) => /^Spend this mana only\b/i.test(s)).join(' ');
    const once = others.some((s) => /^Activate only once each turn\b/i.test(s));
    const goes = others.some((s) => /^If there are no \S+ counters on (?:~|this [a-z]+|it), sacrifice (?:it|~|this [a-z]+)\.?$/i.test(s));
    if (take === 'X') {
      const x = readX(first);
      if (!x) return;
      out.push({ line: i, kind, tap, pay, take, makes: 1, plus: x.plus, once, goes, adds: x.adds, rest });
    } else {
      const makes = tapManaFromText(`{T}: Add ${first}.`).amount;
      if (makes <= 0) return;
      out.push({ line: i, kind, tap, pay, take, makes, plus: 0, once, goes, adds: () => first, rest });
    }
  });
  return out;
}

/** "{T}: Add {B}{B}{B}{B}. Spend this mana only…": the ability as it stands. */
const tapLine = (ability: CounterAbility, n: number) => `{T}: Add ${ability.adds(n)}.${ability.rest ? ` ${ability.rest}` : ''}`;

/** A counter ability's mana from so many counters: an 'X' one all of them
 * at once (and what it makes besides), a fixed one as often as they last —
 * once, where it taps the card or may be activated once each turn. Less
 * what its own cost takes when nothing else pays that. */
function fromCounters(ability: CounterAbility, counters: number, pay: number): number {
  if (ability.take === 'X') return Math.max(0, ability.plus + ability.makes * counters - pay);
  const times = Math.floor(counters / ability.take);
  return Math.max(0, (ability.once || ability.tap ? Math.min(times, 1) : times) * ability.makes);
}

/** Mana a card's counters make apart from its tap: one source of it. */
export interface StoredApart {
  /** Its line in the card's text: two such abilities are two sources. */
  line: number;
  produces: Colors;
  amount: number;
  /** "Spend this mana only…": the words after "only". */
  only?: string;
  draw: StoredDraw;
}

export interface StoredHere {
  /** The card's words with each ability its counters pay for as it stands
   * now: one {T} ability adding what they come to, or nothing. */
  text: string;
  /** What a payment drawing on the card's tap takes off its counters
   * (only while it is untapped: a tapped card's counters are not on its tap). */
  draw: StoredDraw | null;
  /** Mana its counters make without its tap — Pentad Prism, a tapped
   * Dreadship Reef: each a source of its own. */
  apart: StoredApart[];
}

/** A card's words with its counter-paid mana as the counters on it make it
 * now. While it is untapped, an ability that taps it becomes "{T}: Add …"
 * that much (an alternative to its other {T} abilities, as it is), and one
 * that does not tap it but costs mana its own {T} can pay (Dreadship Reef:
 * "{1}, Remove X storage counters") is taken together with that tap. A
 * tapped card's tap abilities make what they make with no counters (a
 * Mana Battery's one {B}). Whatever the counters make without a tap is a
 * source apart, its cost paid out of them. Words it cannot read stay. */
export function storedHere(text: string, card: Pick<CardInstance, 'iid' | 'tapped' | 'counters'>, name: string): StoredHere {
  if (!/\bremove\b[^:\n]*\bcounters?\b[^:\n]*:[^\n]*\badd\b/i.test(text)) return { text, draw: null, apart: [] };
  const lines = text.split('\n');
  const abilities = counterAbilities(lines.map((l) => l.replace(/"[^"]*"/g, '')), name);
  if (abilities.length === 0) return { text, draw: null, apart: [] };
  const mine = new Set(abilities.map((a) => a.line));
  const plain = tapManaFromText(lines.filter((_, i) => !mine.has(i)).join('\n'));
  const has = (kind: string) => Math.max(0, Math.floor(card.counters?.[kind] ?? 0));
  const untapped = !card.tapped;
  const replaced = new Map<number, string | null>();
  const apart: StoredApart[] = [];
  let draw: StoredDraw | null = null;
  for (const ability of abilities) {
    const counters = has(ability.kind);
    const base = { iid: card.iid, kind: ability.kind, plain: plain.amount, plainColors: plain.produces, take: ability.take, makes: ability.makes, plus: ability.plus, ...(ability.goes ? { goes: true as const } : {}) };
    // Taps the card, or costs no more than its tap makes: one with its tap.
    const withTap = untapped && (ability.tap || (ability.pay > 0 && plain.amount >= ability.pay));
    if (withTap && !draw) {
      const n = fromCounters(ability, counters, 0);
      replaced.set(ability.line, n > 0 ? tapLine(ability, n) : null);
      if (n > 0) draw = { ...base, pay: 0 };
      continue;
    }
    if (ability.tap) {
      // Tapped: what it makes with none taken off (X = 0), if anything.
      replaced.set(ability.line, ability.take === 'X' && ability.plus > 0 && !untapped ? tapLine(ability, ability.plus) : null);
      continue;
    }
    replaced.set(ability.line, null);
    const amount = fromCounters(ability, counters, ability.pay);
    if (amount <= 0) continue;
    const read = tapManaFromText(`{T}: Add ${ability.adds(Math.max(1, amount))}.`);
    const only = ability.rest.match(/^Spend this mana only ([^.]+)/i)?.[1];
    apart.push({ line: ability.line, produces: read.produces, amount, ...(only ? { only } : {}), draw: { ...base, plain: 0, plainColors: [], pay: ability.pay } });
  }
  const out = lines.flatMap((l, i) => (!replaced.has(i) ? [l] : replaced.get(i) === null ? [] : [replaced.get(i) as string]));
  return { text: out.join('\n'), draw, apart };
}

/** Can mana of these colors pay that pip? */
const pays = (colors: Colors, pip: ManaColor[]) =>
  colors.some((c) => (c === 'any' ? pip.some((p) => p !== 'C') : pip.includes(c)));

/** How many counters come off when a payment draws `units` from the
 * source, `pips` being the colored ones they pay: none while what the card
 * makes without them covers it; else the activation that makes that much —
 * an 'X' one as many as it takes (less what it makes besides; plus its
 * cost, where that comes out of them), a fixed one each time it is used. */
export function countersTaken(draw: StoredDraw, units: number, pips: ManaColor[][]): number {
  if (units <= 0) return 0;
  if (units <= draw.plain && pips.every((pip) => pays(draw.plainColors, pip))) return 0;
  if (draw.take === 'X') {
    const beyond = units - draw.plus;
    return beyond > 0 ? Math.ceil((beyond + draw.pay) / draw.makes) : 0;
  }
  return Math.ceil(units / draw.makes) * draw.take;
}

/** "You may choose not to untap this land during your untap step": left
 * tapped, Bottomless Vault and its kind save up a storage counter each
 * upkeep. Its player untaps it by hand when they want the mana. */
export function staysTapped(record: Pick<CardRecord, 'name' | 'oracleText'> | null | undefined): boolean {
  if (!record) return false;
  const name = record.name.split(' // ')[0];
  const text = record.oracleText.split('\n//\n')[0].split(name).join('~');
  return /\bYou may choose not to untap (?:~|this [a-z]+) during your untap step\b/i.test(text);
}

/** Counters a payment takes off a card, and whether the card then goes. */
export interface Taken {
  iid: string;
  kind: string;
  n: number;
  goes?: true;
}
