import type { BoardItem } from './types';

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export const MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

/** What a land can produce, read from its rules text: specific colors in
 * order of appearance, ['any'] for any-color sources, [] for none. */
export function manaColors(item: BoardItem): (ManaColor | 'any')[] {
  const text = item.oracleText;
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

export interface LandSummary {
  total: number;
  colors: Record<ManaColor, number>;
  any: number;
}

/** Capability tally over the lands zone: how many sources can make each
 * color (duals count toward both — it's "what could you produce"). */
export function landSummary(items: BoardItem[]): LandSummary {
  const colors: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let total = 0;
  let any = 0;
  for (const item of items) {
    if (item.zone !== 'lands') continue;
    total += item.count;
    const produced = manaColors(item);
    if (produced[0] === 'any') any += item.count;
    else for (const color of produced) colors[color as ManaColor] += item.count;
  }
  return { total, colors, any };
}
