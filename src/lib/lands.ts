import { counterName } from './entering';
import type { CardRecord } from './types';

/** How a land comes in: tapped, untapped, or its player is asked whether to
 * pay 2 life to have it untapped (a shock land). */
export type LandEntry = 'tapped' | 'untapped' | 'life';

/** What a card's "if you control…" / "unless…" looks at. Only `mine` is
 * always known; a condition on anything left out cannot be told (null). */
export interface Conditions {
  /** Front-face type lines of its controller's permanents: for a land
   * being played the OTHER ones, for a mana ability every one, itself too. */
  mine: string[];
  /** Front-face type lines of the other cards in its controller's hand. */
  hand?: string[];
  /** Living opponents. */
  opponents?: number;
  /** Every living player's life. */
  lives?: number[];
  /** Lands its controller's opponents have on the table (as far as the table shows). */
  opponentLands?: number;
  /** The card itself arrived this turn (as far as the table knows: its sick flag). */
  fresh?: boolean;
  /** The counters on the card itself, named as the table keeps them. */
  counters?: Record<string, number>;
}

/** What a land's "enters tapped unless…" looks at: its controller's other
 * permanents and hand, the table. */
export interface LandContext extends Conditions {
  hand: string[];
  opponents: number;
  lives: number[];
  opponentLands: number;
}

const NUMBER: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w: string) => NUMBER[w.toLowerCase()] ?? Number(w);
const front = (typeLine: string) => typeLine.split(' // ')[0];

/** Does one of these type lines say all of `words` ("basic land", "legendary creature", "Forest")? */
function anyWith(typeLines: string[], phrase: string): boolean {
  const words = phrase
    .toLowerCase()
    .replace(/s$/, '')
    .split(/\s+/)
    .filter((w) => w !== 'a' && w !== 'an');
  return typeLines.some((t) => {
    const line = front(t).toLowerCase().replace(/’/g, "'");
    return words.every((w) => new RegExp(`\\b${w}s?\\b`).test(line));
  });
}

const countWith = (typeLines: string[], phrase: string) => typeLines.filter((t) => anyWith([t], phrase)).length;

/** "you control a Forest or an Island", "you control two or fewer other
 * lands", "a player has 13 or less life", "you control an Urza's Mine and an
 * Urza's Power-Plant"… true when it holds; null when the app cannot tell
 * (a land then comes in untapped, a mana ability stays on offer: generous). */
export function conditionHolds(cond: string, ctx: Conditions): boolean | null {
  const c = cond.trim().replace(/\.$/, '').replace(/’/g, "'");
  let m: RegExpMatchArray | null;
  // "this land entered this turn or if you control a basic land"
  if ((m = c.match(/^(.+?) or if (.+)$/i))) {
    const [a, b] = [conditionHolds(m[1], ctx), conditionHolds(m[2], ctx)];
    return a === true || b === true ? true : a === false && b === false ? false : null;
  }
  if ((m = c.match(/^you control (\w+) or (fewer|more) (other )?(lands|[a-z]+s)$/i))) {
    const n = num(m[1]);
    const count = m[4].toLowerCase() === 'lands' ? countWith(ctx.mine, 'land') : countWith(ctx.mine, m[4]);
    return m[2] === 'fewer' ? count <= n : count >= n;
  }
  if ((m = c.match(/^you control (\w+) or more basic lands$/i))) return countWith(ctx.mine, 'basic land') >= num(m[1]);
  if ((m = c.match(/^you have (\w+) or more opponents$/i))) return ctx.opponents === undefined ? null : ctx.opponents >= num(m[1]);
  if ((m = c.match(/^a player has (\d+) or less life$/i)))
    return ctx.lives === undefined ? null : ctx.lives.some((l) => l <= Number(m![1]));
  if ((m = c.match(/^your opponents control (\w+) or more lands$/i)))
    return ctx.opponentLands === undefined ? null : ctx.opponentLands >= num(m[1]);
  if (/^this (?:land|artifact|creature|enchantment|permanent) entered (?:the battlefield )?this turn$/i.test(c))
    return ctx.fresh ?? null;
  // "this artifact has two or more oil counters on it", "this creature has a +1/+1 counter on it",
  // "there are three or more brick counters on this artifact".
  if (
    (m =
      c.match(/^this (?:land|artifact|creature|enchantment|permanent) has (an?|\w+)(?: or more)? (\S+) counters? on it$/i) ??
      c.match(/^there (?:is|are) (an?|\w+)(?: or more)? (\S+) counters? on this (?:land|artifact|creature|enchantment|permanent)$/i))
  ) {
    if (!ctx.counters) return null;
    const n = /^an?$/i.test(m[1]) ? 1 : num(m[1]);
    return Number.isNaN(n) ? null : (ctx.counters[counterName(m[2])] ?? 0) >= n;
  }
  // "…unless you revealed a Dragon card this way or you control a Dragon" (the reveal is from the hand).
  if ((m = c.match(/^you revealed an? (.+?) card this way or you control an? (.+)$/i)))
    return ctx.hand === undefined ? null : anyWith(ctx.hand, m[1]) || anyWith(ctx.mine, m[2]);
  // Urza's Tower: "you control an Urza's Mine and an Urza's Power-Plant" — both.
  if ((m = c.match(/^you control (an? .+?) and (an? .+)$/i))) {
    const both = [m[1], m[2]].map((o) => o.replace(/^an?\s+/i, ''));
    if (both.some((o) => /\d/.test(o))) return null;
    return both.every((o) => anyWith(ctx.mine, o));
  }
  if ((m = c.match(/^you control (an? .+)$/i))) {
    // "a Forest or an Island", "a Mount or Vehicle", "a legendary creature", "a basic land".
    const options = m[1].split(/\s+or\s+/).map((o) => o.replace(/^an?\s+/i, ''));
    if (options.some((o) => /\d/.test(o))) return null;
    return options.some((o) => anyWith(ctx.mine, o));
  }
  return null;
}

/** How this land comes in when it is played, by its own words. */
export function landEntry(record: Pick<CardRecord, 'name' | 'oracleText'> | null | undefined, ctx: LandContext): LandEntry {
  if (!record) return 'untapped';
  const name = record.name.split(' // ')[0];
  // A legend is called by its first name too: "Boseiju enters tapped."
  const short = name.split(',')[0];
  const text = (record.oracleText.split('\n//\n')[0] ?? '').replace(/\([^)]*\)/g, '');
  const sentences = text.split(/\n|(?<=\.)\s+/).map((s) => s.split(name).join('~').split(short).join('~').trim());
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (!/\benters (?:the battlefield )?tapped\b/i.test(s)) continue;
    // "As this land enters, you may pay 2 life. If you don't, it enters tapped."
    if (/^if you don['’]t\b/i.test(s)) {
      const before = sentences[i - 1] ?? '';
      if (/you may pay 2 life/i.test(before)) return 'life';
      const reveal = before.match(/you may reveal an? (.+?) card from your hand/i);
      if (reveal) {
        const options = reveal[1].split(/\s+or\s+|,\s*/).map((o) => o.replace(/^an?\s+/i, '').trim());
        return options.some((o) => anyWith(ctx.hand, o)) ? 'untapped' : 'tapped';
      }
      return 'tapped';
    }
    // "If you control two or more other lands, this land enters tapped."
    const iff = s.match(/^if (.+?), (?:this land|~|it) enters (?:the battlefield )?tapped/i);
    if (iff) {
      const yes = conditionHolds(iff[1], ctx);
      return yes === true ? 'tapped' : 'untapped';
    }
    const unless = s.match(/enters (?:the battlefield )?tapped unless (.+)$/i);
    if (unless) {
      const yes = conditionHolds(unless[1], ctx);
      return yes === false ? 'tapped' : 'untapped';
    }
    // "This land enters tapped." — and "…enters tapped with two charge counters on it."
    if (/^(?:this land|~|it) enters (?:the battlefield )?tapped\b/i.test(s)) return 'tapped';
  }
  return 'untapped';
}
