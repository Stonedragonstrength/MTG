import type { CardRecord } from './types';

/** How a land comes in: tapped, untapped, or its player is asked whether to
 * pay 2 life to have it untapped (a shock land). */
export type LandEntry = 'tapped' | 'untapped' | 'life';

/** What a land's "enters tapped unless…" looks at: its controller's other
 * permanents and hand, the table. */
export interface LandContext {
  /** Front-face type lines of its controller's other permanents. */
  mine: string[];
  /** Front-face type lines of the other cards in its controller's hand. */
  hand: string[];
  /** Living opponents. */
  opponents: number;
  /** Every living player's life. */
  lives: number[];
  /** Lands its controller's opponents have on the table (as far as the table shows). */
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
    const line = front(t).toLowerCase();
    return words.every((w) => new RegExp(`\\b${w}s?\\b`).test(line));
  });
}

const countWith = (typeLines: string[], phrase: string) => typeLines.filter((t) => anyWith([t], phrase)).length;

/** "you control a Forest or an Island", "you control two or fewer other
 * lands", "a player has 13 or less life"… true when it holds; null when the
 * app cannot tell (then the land comes in untapped: generous). */
function holds(cond: string, ctx: LandContext): boolean | null {
  const c = cond.trim().replace(/\.$/, '');
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^you control (\w+) or (fewer|more) other (lands|[a-z]+s)$/i))) {
    const n = num(m[1]);
    const count = m[3].toLowerCase() === 'lands' ? countWith(ctx.mine, 'land') : countWith(ctx.mine, m[3]);
    return m[2] === 'fewer' ? count <= n : count >= n;
  }
  if ((m = c.match(/^you control (\w+) or more basic lands$/i))) return countWith(ctx.mine, 'basic land') >= num(m[1]);
  if ((m = c.match(/^you have (\w+) or more opponents$/i))) return ctx.opponents >= num(m[1]);
  if ((m = c.match(/^a player has (\d+) or less life$/i))) return ctx.lives.some((l) => l <= Number(m![1]));
  if ((m = c.match(/^your opponents control (\w+) or more lands$/i))) return ctx.opponentLands >= num(m[1]);
  // "…unless you revealed a Dragon card this way or you control a Dragon" (the reveal is from the hand).
  if ((m = c.match(/^you revealed an? (.+?) card this way or you control an? (.+)$/i)))
    return anyWith(ctx.hand, m[1]) || anyWith(ctx.mine, m[2]);
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
      const yes = holds(iff[1], ctx);
      return yes === true ? 'tapped' : 'untapped';
    }
    const unless = s.match(/enters (?:the battlefield )?tapped unless (.+)$/i);
    if (unless) {
      const yes = holds(unless[1], ctx);
      return yes === false ? 'tapped' : 'untapped';
    }
    // "This land enters tapped." — and "…enters tapped with two charge counters on it."
    if (/^(?:this land|~|it) enters (?:the battlefield )?tapped\b/i.test(s)) return 'tapped';
  }
  return 'untapped';
}
