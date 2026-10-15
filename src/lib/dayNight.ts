import { isBackId } from './faces';
import { keywordsOf } from './keywords';
import type { CardRecord, GameState } from './types';

type Records = Record<string, CardRecord | null | undefined>;

/** Spells the active player has cast in the turn now going on. */
export function castsThisTurn(g: GameState): number {
  const c = g.casts;
  return c && c.turn === g.turnNumber && c.active === g.activePlayerIndex ? c.n : 0;
}

/** `next` with the spells the active player cast in this move counted
 * (`cast` is the seats of the spells the move cast). Comes back as it was
 * when the move cast nothing of theirs. */
export function withCasts(prev: GameState, next: GameState, cast: number[]): GameState {
  if (next === prev) return prev;
  const mine = cast.filter((seat) => seat === next.activePlayerIndex).length;
  if (mine === 0) return next;
  const turn = { turn: next.turnNumber, active: next.activePlayerIndex };
  return { ...next, casts: { ...turn, n: castsThisTurn(next) + mine } };
}

/** What day or night a new turn begins in, judged on the state just before
 * the turn passes: a day in which its player cast no spells becomes night,
 * a night in which they cast two or more becomes day. */
export function turnedDayNight(g: GameState): GameState['dayNight'] {
  const n = castsThisTurn(g);
  if (g.dayNight === 'day' && n === 0) return 'night';
  if (g.dayNight === 'night' && n >= 2) return 'day';
  return g.dayNight;
}

/** A card face, as far as day and night ask: which way it is bound. */
function bound(record: CardRecord | null | undefined): 'day' | 'night' | null {
  if (!record) return null;
  const k = keywordsOf(record.oracleText);
  return k.has('daybound') ? 'day' : k.has('nightbound') ? 'night' : null;
}

/** What the table needs because of day and night: whether it has to become
 * day (a daybound permanent is out and it is neither yet), and which cards
 * have to turn over to match (a daybound face at night, a nightbound face
 * by day). Records are looked up by the card id as it lies (a back id reads
 * the back face). */
export function dayNightNeeds(
  g: GameState,
  records: Records,
): { becomeDay: boolean; flips: { seat: number; iid: string; toBack: boolean; name: string }[] } {
  let daybound = false;
  const faces: { seat: number; iid: string; name: string; face: 'day' | 'night'; back: boolean }[] = [];
  g.players.forEach((p, seat) => {
    for (const c of p.cards?.battlefield ?? []) {
      const face = bound(records[c.cardId]);
      if (!face) continue;
      daybound ||= face === 'day';
      faces.push({ seat, iid: c.iid, name: c.name, face, back: isBackId(c.cardId) });
    }
  });
  const time = g.dayNight ?? (daybound ? 'day' : undefined);
  const flips = time
    ? faces
        .filter((f) => f.face !== time)
        .map((f) => ({ seat: f.seat, iid: f.iid, name: f.name, toBack: time === 'night' }))
    : [];
  return { becomeDay: g.dayNight === undefined && daybound, flips };
}
