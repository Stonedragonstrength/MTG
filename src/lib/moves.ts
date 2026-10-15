import type { CardZone, GameState } from './types';

/** One card that changed zones between two states of the table. */
export interface CardMove {
  seat: number;
  iid: string;
  cardId: string;
  name: string;
  from: CardZone;
  to: CardZone;
}

const ZONES: CardZone[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];

/** Every card that went from one zone to another, seat by seat, in the
 * order the cards lie in their new zones. Seats whose cards did not change
 * are not looked at. */
export function movesBetween(prev: GameState, next: GameState): CardMove[] {
  const out: CardMove[] = [];
  next.players.forEach((p, seat) => {
    const before = prev.players[seat]?.cards;
    const after = p.cards;
    if (!before || !after || before === after) return;
    const was = new Map<string, CardZone>();
    for (const z of ZONES) for (const c of before[z] ?? []) was.set(c.iid, z);
    for (const z of ZONES)
      for (const c of after[z] ?? []) {
        const from = was.get(c.iid);
        if (from && from !== z) out.push({ seat, iid: c.iid, cardId: c.cardId, name: c.name, from, to: z });
      }
  });
  return out;
}
