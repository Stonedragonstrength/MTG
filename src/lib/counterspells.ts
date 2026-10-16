import { isCommander } from './cards';
import { spendAllows, spendOnCard } from './spendOnly';
import type { CardRecord, CardZone, GameState, StackSpell } from './types';

// ---- counterspells ----
// The app has no stack: a spell is where it ends up the moment it is cast
// (an instant in the graveyard, a creature on the battlefield). What a
// counterspell answers is one of the spells cast this turn — `GameState.stack`,
// written by every move that casts one (store mutateGame → withStack). To
// counter it puts the card where a countered spell goes: its owner's
// graveyard (a commander home to the command zone), or where the
// counterspell says instead.

type Records = Record<string, CardRecord | null | undefined>;

/** Where a countered spell goes, as the counterspell says. */
export type CounteredTo = 'graveyard' | 'exile' | 'hand' | 'library';

/** What a counterspell says: which spells it answers ("spell", "noncreature
 * spell", "spell with mana value 2 or less"), the mana that saves the spell
 * ("unless its controller pays {3}"), and where the spell goes instead of
 * the graveyard. */
export interface CounterRead {
  what: string;
  unless: string | null;
  to: CounteredTo;
}

const COUNTER = /\bcounter (?:up to one )?target ([^.]*?\bspells?\b[^.]*?)(?: unless its controller pays ((?:\{[^}]+\})+)([^.]*))?\.(?=\s|$)/i;

/** The counter in a text ("Counter target noncreature spell unless its
 * controller pays {2}."), or null. A spell or ability it also answers ("or
 * ability") is left to the players; a payment the table cannot price
 * ("{1} for each card in your graveyard") leaves the whole counter unread. */
export function readCounter(text: string): CounterRead | null {
  const m = text.match(COUNTER);
  if (!m) return null;
  if (m[2] && m[3].trim() !== '') return null;
  // Saved some other way ("unless its controller discards their hand"): the players'.
  if (/\bunless\b/i.test(m[1])) return null;
  const what = m[1]
    // What it answers besides a spell is the players' to handle.
    .replace(/\b(?:activated|triggered) abilit(?:y|ies)(?: from [^,]+?)?,?\s*(?:or\s+)?/gi, '')
    .replace(/(?:,? or|,) (?:activated |triggered )?ability\b.*$/i, '')
    // What it does next is another effect: "…, then proliferate", "… and ~ deals 3 damage…".
    .replace(/(?:,\s*then\b| and (?!\/)).*$/i, '')
    .replace(/,\s*(?:or\s*)?$/, '')
    .trim();
  if (!/\bspells?\b/i.test(what)) return null;
  const after = text.slice((m.index ?? 0) + m[0].length);
  const to: CounteredTo = /\bexile it instead\b/i.test(after)
    ? 'exile'
    : /\binto its owner['’]s hand instead\b/i.test(after)
      ? 'hand'
      : /\b(?:on top of|on the bottom of) its owner['’]s library instead\b/i.test(after)
        ? 'library'
        : 'graveyard';
  return { what, unless: m[2] ?? null, to };
}

/** The kind of spell, short, for a button: "noncreature spell", not "spell
 * with mana value less than or equal to the number of cards in…". */
export function counterWords(what: string): string {
  const head = what.replace(/\s+(?:with|that|if|you|an opponent|cast|from|\[).*$/i, '').trim();
  return `${article(head)} ${head}`;
}

/** The spells cast this turn, oldest first: a stamp from another turn is no spell on the stack. */
export function stackNow(g: GameState): StackSpell[] {
  return (g.stack ?? []).filter((s) => s.turn === g.turnNumber && s.active === g.activePlayerIndex);
}

/** No more than this many spells are kept for one turn. */
const STACK_CAP = 12;

/** A cast, as the move that made it tells it. */
export interface Casting {
  /** Minted outside the move: a replay keeps the same id. */
  id: string;
  seat: number;
  iid: string;
  cardId: string;
  name: string;
  from?: CardZone;
}

const ZONES: CardZone[] = ['battlefield', 'graveyard', 'exile', 'hand', 'command', 'library'];

/** `next` with these casts on the stack: each where its card ended up in
 * that move (a cast that did not land is no spell), with the showing the
 * move put up for it. Spells of other turns are dropped as it is written. */
export function withStack(prev: GameState, next: GameState, casts: Casting[]): GameState {
  if (casts.length === 0) return next;
  const added: StackSpell[] = [];
  for (const c of casts) {
    const seat = next.players[c.seat]?.cards;
    const to = seat ? ZONES.find((z) => seat[z].some((card) => card.iid === c.iid)) : undefined;
    if (!to) continue;
    const reveal =
      next.reveal && next.reveal.id !== prev.reveal?.id && next.reveal.seat === c.seat && next.reveal.cards[0]?.cardId === c.cardId
        ? next.reveal.id
        : undefined;
    added.push({
      id: c.id,
      seat: c.seat,
      iid: c.iid,
      cardId: c.cardId,
      name: c.name,
      to,
      ...(c.from && c.from !== 'hand' ? { from: c.from } : {}),
      turn: next.turnNumber,
      active: next.activePlayerIndex,
      ...(reveal ? { reveal } : {}),
    });
  }
  if (added.length === 0) return next;
  return { ...next, stack: [...stackNow(next), ...added].slice(-STACK_CAP) };
}

/** A spell a counterspell could answer, and why it cannot where it cannot. */
export interface CounterTarget {
  spell: StackSpell;
  /** Why it is not offered: it can't be countered, or is not the kind the counterspell names. */
  not?: string;
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** The spells a counter can be pointed at, newest first: those cast this
 * turn that are not countered yet and still lie where their cast put them —
 * all but the one doing the countering (`by.iid`). One that can't be
 * countered, or is not of the kind it names, is listed with its reason. A
 * kind the app cannot read ("a spell that targets a permanent you control")
 * lets every spell through: the players know. */
export function counterTargets(g: GameState, records: Records, what: string, by: { iid?: string }): CounterTarget[] {
  const out: CounterTarget[] = [];
  for (const spell of [...stackNow(g)].reverse()) {
    if (spell.countered || spell.iid === by.iid) continue;
    if (!g.players[spell.seat]?.cards?.[spell.to].some((c) => c.iid === spell.iid)) continue;
    const record = records[spell.cardId];
    if (!record) {
      out.push({ spell });
      continue;
    }
    const name = record.name.split(' // ')[0];
    const front = record.oracleText.split('\n//\n')[0].split(name).join('~');
    if (/\b(?:this spell|~) can['’]t be countered\b/i.test(front)) {
      out.push({ spell, not: "can't be countered" });
      continue;
    }
    const fits = /^spells?$/i.test(what) ? true : spendAllows(`to cast ${article(what)} ${what}`, spendOnCard(record, 'cast'));
    out.push(fits === false ? { spell, not: `not ${article(what)} ${what}` } : { spell });
  }
  return out;
}

/** Where a countered spell goes: home to the command zone for a commander
 * (what its owner always chooses), else as the counterspell says. */
export function counteredTo(g: GameState, spell: StackSpell, to: CounteredTo): CardZone {
  const seat = g.players[spell.seat]?.cards;
  const commander = spell.from === 'command' || (!!seat && isCommander(seat, spell.iid) === true);
  return commander ? 'command' : to;
}

/** The stack with that spell countered (by the card named). */
export function markCountered(g: GameState, id: string, by: string): GameState {
  if (!g.stack?.some((s) => s.id === id)) return g;
  return { ...g, stack: g.stack.map((s) => (s.id === id ? { ...s, countered: by } : s)) };
}
