import type { Size } from './attach';
import type { Boost, GameState } from './types';

/** "Until end of turn": what a spell or an ability did to a creature for the
 * rest of the turn it was done in — so much power and toughness, and maybe
 * some keywords (Giant Growth's +3/+3, Overrun's +3/+3 and trample, a
 * "gains indestructible"). It is stamped with that turn, like a land drop:
 * nothing ever takes it off, and a stamp from any other turn is simply no
 * boost at all. Read it through boostOf, never the field. */

type Turn = Pick<GameState, 'turnNumber' | 'activePlayerIndex'>;

/** What one effect adds. */
export interface BoostChange {
  power: number;
  toughness: number;
  keywords: string[];
}

/** The boost a card or stack has this turn, or null. */
export function boostOf(g: Turn, x: { boost?: Boost } | null | undefined): Boost | null {
  const b = x?.boost;
  return b && b.turn === g.turnNumber && b.active === g.activePlayerIndex ? b : null;
}

/** The boost after one more this turn: sizes add up, keywords join. */
export function addBoost(g: Turn, was: Boost | undefined, add: BoostChange): Boost {
  const now = boostOf(g, { boost: was });
  const keywords = [...new Set([...(now?.keywords ?? []), ...add.keywords])];
  return {
    turn: g.turnNumber,
    active: g.activePlayerIndex,
    power: (now?.power ?? 0) + add.power,
    toughness: (now?.toughness ?? 0) + add.toughness,
    ...(keywords.length > 0 ? { keywords } : {}),
  };
}

/** A size with this turn's boost on top. */
export const withBoost = (size: Size, b: Boost | null): Size => (b ? plusSize(size, b) : size);

/** Two changes of size together. */
export const plusSize = (a: Size, b: Size): Size => ({ power: a.power + b.power, toughness: a.toughness + b.toughness });

/** "+3/+3 and trample", "first strike": a boost as the table says it. */
export function boostWords(add: BoostChange): string {
  const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);
  const size = add.power !== 0 || add.toughness !== 0 ? `${signed(add.power)}/${signed(add.toughness)}` : '';
  return [size, ...add.keywords].filter((w) => w !== '').join(' and ');
}

/** One battlefield card gets the boost; the same game when it is not there. */
export function boostCard(g: GameState, seat: number, iid: string, add: BoostChange): GameState {
  const player = g.players[seat];
  const cards = player?.cards;
  if (!cards || !cards.battlefield.some((c) => c.iid === iid)) return g;
  const battlefield = cards.battlefield.map((c) => (c.iid === iid ? { ...c, boost: addBoost(g, c.boost, add) } : c));
  return { ...g, players: g.players.map((p, i) => (i === seat ? { ...p, cards: { ...cards, battlefield } } : p)) };
}

/** Every copy of one stack gets the boost; the same game when it is not there. */
export function boostStack(g: GameState, seat: number, itemId: string, add: BoostChange): GameState {
  const player = g.players[seat];
  if (!player || !player.board.some((it) => it.id === itemId)) return g;
  const board = player.board.map((it) => (it.id === itemId ? { ...it, boost: addBoost(g, it.boost, add) } : it));
  return { ...g, players: g.players.map((p, i) => (i === seat ? { ...p, board } : p)) };
}
