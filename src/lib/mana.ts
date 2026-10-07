import type { BoardItem } from './types';

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export const MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export const COLOR_NAMES: Record<ManaColor, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

export const COLOR_HEX: Record<string, string> = {
  W: '#e8e3d0',
  U: '#5a9bd4',
  B: '#9a8fa8',
  R: '#d4705a',
  G: '#6aa877',
  C: '#a8a8b2',
};

/** What a card can produce, read from its rules text: specific colors in
 * order of appearance, ['any'] for any-color sources, [] for none. */
export function manaColorsFromText(text: string): (ManaColor | 'any')[] {
  if (/add (one|two|three|\w+) mana of any/i.test(text)) return ['any'];

  const produced: (ManaColor | 'any')[] = [];
  for (const segment of text.match(/add[^.\n]*/gi) ?? []) {
    for (const [, symbol] of segment.matchAll(/\{([WUBRGC])\}/g)) {
      const color = symbol as ManaColor;
      if (!produced.includes(color)) produced.push(color);
    }
  }
  return produced;
}

export function manaColors(item: BoardItem): (ManaColor | 'any')[] {
  return manaColorsFromText(item.oracleText);
}

const NUMBER_WORDS: Record<string, number> = {
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

/** What one tap actually yields, for paying costs: only real `{T}: Add …`
 * abilities count (a triggered "adds an additional {G}" is not a source),
 * abilities a card merely grants in quotes are ignored here, and mana the
 * ability costs comes off the top (a Signet nets one). An ability that
 * sacrifices something is skipped — a payment never spends a permanent —
 * but the card's other abilities still count (Phyrexian Tower keeps its
 * plain {C}). Several abilities report the best net amount and every
 * color any of them offers. Reads generously: blocking a legal play is
 * the failure that matters. */
export function tapManaFromText(text: string): {
  produces: (ManaColor | 'any')[];
  amount: number;
} {
  const produces: (ManaColor | 'any')[] = [];
  let amount = 0;
  const own = text.replace(/"[^"]*"/g, ''); // granted abilities belong to other permanents
  for (const line of own.split('\n')) {
    const m = line.match(/([^.(]*\{T\}[^:]*):\s*[^.]*?\badd\s+([^.]*)/i);
    if (!m) continue;
    const [, cost, phrase] = m;
    if (/\bsacrifice\b/i.test(cost)) continue;
    const paid =
      [...cost.matchAll(/\{(\d+)\}/g)].reduce((sum, [, n]) => sum + Number(n), 0) +
      [...cost.matchAll(/\{[WUBRGC]\}/g)].length;

    const symbols = [...phrase.matchAll(/\{([WUBRGC])\}/g)].map(([, s]) => s as ManaColor);
    // Mana named by a color the text doesn't print — "of any color", "of
    // the chosen color", "of that color", "of different colors", "any
    // type" — is taken as any color.
    const unnamed = /\bmana\b[^.]*\b(colou?rs?|types?)\b|any combination/i.test(phrase);
    if (!unnamed && symbols.length === 0) continue;
    if (unnamed && !produces.includes('any')) produces.push('any');
    for (const s of symbols) if (!produces.includes(s)) produces.push(s);

    let yielded = 1; // a choice between options is one mana
    if (unnamed && symbols.length === 0) {
      const word = phrase.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i)?.[1];
      yielded = word ? NUMBER_WORDS[word.toLowerCase()] : 1;
    } else if (!unnamed && !/\bor\b/i.test(phrase)) {
      yielded = symbols.length; // "{C}{C}" is that many
    }
    amount = Math.max(amount, yielded - paid);
  }
  return amount > 0 ? { produces, amount } : { produces: [], amount: 0 };
}

/** Sacrificing is part of the mana ability — spending it destroys it. */
export function isOneShotText(text: string): boolean {
  return /sacrifice[^.:]*:[^.]*add/i.test(text);
}

/** Treasure-style sources: sacrificing is part of the mana ability, so
 * "tapping" one in the app spends it instead of marking it tapped. */
export function isOneShotSource(item: BoardItem): boolean {
  return isOneShotText(item.oracleText);
}

/** What this stack taps for right now: the manual override when set
 * ('none' silences it), otherwise whatever the oracle text says. */
export function effectiveManaColors(item: BoardItem): (ManaColor | 'any')[] {
  if (item.manaMode === 'none') return [];
  if (item.manaMode) return [item.manaMode];
  return manaColors(item);
}

export interface LandSummary {
  total: number;
  colors: Record<ManaColor, number>;
  any: number;
}

/** A virtual (cards-mode) land on the shelf: its record's rules text when
 * resolved, null while the card DB lookup is still in flight. */
export interface VirtualManaSource {
  oracleText: string | null;
}

/** Capability tally over the whole board: how many sources can make each
 * color (duals count toward both — it's "what could you produce").
 * Board-zone sources (dorks, Ashaya-fied creatures) count toward the color
 * pips but not the land total. Virtual lands each count 1 toward the total;
 * unresolved ones still count but can't feed a pip yet. */
export function landSummary(
  items: BoardItem[],
  virtualLands: VirtualManaSource[] = [],
): LandSummary {
  const colors: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let total = 0;
  let any = 0;
  for (const item of items) {
    if (item.zone === 'lands') total += item.count;
    const produced = effectiveManaColors(item);
    if (produced[0] === 'any') any += item.count;
    else for (const color of produced) colors[color as ManaColor] += item.count;
  }
  for (const v of virtualLands) {
    total += 1;
    if (v.oracleText === null) continue;
    const produced = manaColorsFromText(v.oracleText);
    if (produced[0] === 'any') any += 1;
    else for (const color of produced) colors[color as ManaColor] += 1;
  }
  return { total, colors, any };
}
