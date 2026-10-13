import type { CardRecord } from './types';

/** A token some card says it makes, as far as the rules text names it. */
export interface TokenWant {
  /** "Soldier", "Elf Warrior", "Treasure". */
  name: string;
  power?: string;
  toughness?: string;
  /** WUBRG letters; empty for a colorless token; left out when the text
   * gives no size (a Treasure, a Clue: the name says it all). */
  colors?: string[];
}

const COLOR_LETTER: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

// "Create two 1/1 white Soldier creature tokens", "create a tapped
// Treasure token", "creates X 1/1 green and white Elf Warrior creature
// tokens with …". The name is the run of Capitalised words: colors and
// card types are printed in lower case, so the pattern is case-sensitive.
const COUNT = '(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|X|that many|a number of|\\d+)';
const SIZE = '(\\d+|X|\\*)\\/(\\d+|X|\\*)';
const COLORS = '((?:(?:white|blue|black|red|green|colorless|and)[, ]+)*)';
const NAME = "((?:[A-Z][A-Za-z'’-]*)(?: [A-Z][A-Za-z'’-]*)*)";
const TYPES = '(?:(?:legendary|snow|artifact|enchantment|land|creature) )*';
const CREATE = new RegExp(
  `\\b[Cc]reates? (?:${COUNT} )?(?:tapped (?:and attacking )?)?(?:${SIZE} )?${COLORS}${NAME} ${TYPES}tokens?\\b`,
  'g',
);

const keyOf = (t: TokenWant) =>
  `${t.name.toLowerCase()}|${t.power ?? ''}/${t.toughness ?? ''}|${(t.colors ?? []).join('')}`;

/** Every token these rules texts say they create, each once, in the order
 * met. "Investigate" makes a Clue. What the text does not name outright
 * (a copy of something, a token "named" this or that) is left out: the
 * search behind "+" covers it. */
export function tokensMadeBy(texts: string[]): TokenWant[] {
  const seen = new Set<string>();
  const out: TokenWant[] = [];
  const add = (want: TokenWant) => {
    const key = keyOf(want);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(want);
  };
  for (const text of texts) {
    for (const m of text.matchAll(CREATE)) {
      const [, power, toughness, colorWords, name] = m;
      const want: TokenWant = { name };
      if (power !== undefined && toughness !== undefined) {
        want.power = power;
        want.toughness = toughness;
        want.colors = (colorWords.match(/white|blue|black|red|green/g) ?? []).map(
          (word) => COLOR_LETTER[word],
        );
      }
      add(want);
    }
    if (/\binvestigates?\b/i.test(text)) add({ name: 'Clue' });
  }
  return out;
}

const sameColors = (a: string[], b: string[]) =>
  a.length === b.length && a.every((c) => b.includes(c));

/** The token card that fits a want best among cards of that name: its
 * size and colors when the text gave them, and a picture when one has it.
 * Undefined when none of them is a token at all. */
export function bestToken(want: TokenWant, candidates: CardRecord[]): CardRecord | undefined {
  let best: CardRecord | undefined;
  let bestScore = -1;
  for (const card of candidates) {
    if (!card.isToken || card.nameLower !== want.name.toLowerCase()) continue;
    let score = card.imageNormal ? 1 : 0;
    if (want.power !== undefined && card.power === want.power && card.toughness === want.toughness)
      score += 4;
    if (want.colors && sameColors(want.colors, card.colors)) score += 2;
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return best;
}
