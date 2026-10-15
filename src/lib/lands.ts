import { counterName } from './entering';
import type { CardInstance, CardRecord, GameState } from './types';

/** How a land comes in: tapped, untapped, or its player is asked whether to
 * pay life to have it untapped (a shock land: 2; The Black Gate and the
 * Zendikar Rising lands on the back of a spell: 3 — see `entryLife`). */
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
  /** Its controller's creatures as a fight reads them (a token stack once
   * per copy); `unread` = a size the table cannot trust. */
  creatures?: ReadonlyArray<{ power: number; unread?: boolean }>;
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
export function anyWith(typeLines: string[], phrase: string): boolean {
  const words = phrase
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/s$/, '')
    .split(/\s+/)
    .filter((w) => w !== 'a' && w !== 'an')
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return typeLines.some((t) => {
    const line = front(t).toLowerCase().replace(/’/g, "'");
    return words.every((w) => new RegExp(`\\b${w}s?\\b`).test(line));
  });
}

export const countWith = (typeLines: string[], phrase: string) => typeLines.filter((t) => anyWith([t], phrase)).length;

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
  // Ferocious: "you control a creature with power 4 or greater". Formidable:
  // "creatures you control have total power 8 or greater". A size the table
  // cannot trust might be the one that makes it: then it cannot be told.
  const ferocious = c.match(/^you control an? creature with power (\w+) or greater$/i);
  const formidable = c.match(/^creatures you control have total power (\w+) or greater$/i);
  if (ferocious || formidable) {
    const list = ctx.creatures;
    if (!list) return null;
    const n = num((ferocious ?? formidable)![1]);
    const read = list.filter((k) => !k.unread);
    const yes = ferocious ? read.some((k) => k.power >= n) : read.reduce((sum, k) => sum + k.power, 0) >= n;
    return yes ? true : read.length < list.length ? null : false;
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
      if (/you may pay \d+ life/i.test(before)) return 'life';
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

const NO_TABLE: LandContext = { mine: [], hand: [], opponents: 0, lives: [], opponentLands: 0 };

/** A land whose player is asked, as it comes in, whether to pay life for it
 * to be untapped (a shock land) — whatever the table looks like. */
export const asksLife = (record: Pick<CardRecord, 'name' | 'oracleText'> | null | undefined): boolean =>
  !!record && landEntry(record, NO_TABLE) === 'life';

/** The life a land that asks for it (`landEntry` 'life') costs to come in
 * untapped: "As this land enters, you may pay 3 life. If you don't, it
 * enters tapped." A shock land's 2 when the words cannot be read. */
export function entryLife(record: Pick<CardRecord, 'oracleText'> | null | undefined): number {
  const m = record?.oracleText.split('\n//\n')[0].match(/you may pay (\d+) life\.\s*If you don['’]t\b/i);
  return m ? Number(m[1]) : 2;
}

/** What a land coming in on `seat`'s side looks at (`landEntry`), read off
 * the table: that seat's permanents (the land itself is not among them
 * yet), the type lines of the cards in its hand (`hand`, for a land that
 * asks for a reveal), the other players. `records` = the battlefields'
 * cards, as far as they are known. */
export function landContext(
  g: GameState,
  seat: number,
  records: Record<string, Pick<CardRecord, 'typeLine'> | null | undefined>,
  hand: string[] = [],
): LandContext {
  const typeOf = (c: CardInstance) => records[c.cardId]?.typeLine ?? '';
  const me = g.players[seat];
  const mine = [...(me?.cards?.battlefield ?? []).map(typeOf), ...(me?.board ?? []).map((it) => it.typeLine)].filter(Boolean);
  const living = g.players.filter((p) => !p.eliminated);
  const opponentLands = g.players.reduce(
    (n, p, s) =>
      s === seat
        ? n
        : n +
          (p.cards?.battlefield.filter((c) => /\bLand\b/.test(typeOf(c))).length ?? 0) +
          p.board.filter((it) => it.zone === 'lands').reduce((k, it) => k + it.count, 0),
    0,
  );
  return {
    mine,
    hand,
    opponents: living.length - (me && !me.eliminated ? 1 : 0),
    lives: living.map((p) => p.life),
    opponentLands,
  };
}
