import { keywordsWorn } from './attach';
import { computedPT } from './board';
import { liveCombat } from './combat';
import type { CardRecords } from './combatEngine';
import { isSummoningSick, permanentTexts, sickCopies } from './keywords';
import type { CombatUnit, GameState } from './types';

/** Attacking the way it is done at a table: you turn your creatures
 * sideways, and that is the attack. So the table reads the attack off the
 * board — which of the active player's creatures are tapped — and offers
 * to declare exactly those. Nothing is kept anywhere: this is worked out
 * from the game as it stands, on every device alike. */

/** One creature (or some copies of a stack) turned sideways to attack. */
export interface DraftPick {
  unit: CombatUnit;
  /** Copies attacking: 1 for a card. */
  n: number;
  name: string;
}

/** What the active player has tapped that could be an attack, while no
 * fight is on. On your own turn everything of yours untapped as it began,
 * so a tapped creature was tapped this turn; what is left out:
 * - a creature whose tap paid for something (`spent`): it was tapped for
 *   mana, and so was one that attacked in an earlier fight this turn (its
 *   tap is marked used up);
 * - a creature that arrived this turn without haste: it may be tapped to
 *   crew or convoke, never to attack;
 * - anything on the lands shelf, anything that is no creature, and a card
 *   this device cannot read (the card's own sheet still starts a fight).
 * A stack offers its tapped copies, less the ones that only just arrived:
 * which copies are which is not tracked. */
export function tappedToAttack(game: GameState, records: CardRecords): DraftPick[] {
  if (liveCombat(game)) return [];
  const seat = game.activePlayerIndex;
  const player = game.players[seat];
  if (!player || player.eliminated) return [];
  const battlefield = player.cards?.battlefield ?? [];
  const texts = permanentTexts(battlefield, records, player.board);
  const picks: DraftPick[] = [];
  for (const card of battlefield) {
    if (card.row === 'lands' || !card.tapped || (card.spent ?? 0) > 0) continue;
    const record = records[card.cardId];
    if (!record || !/\bCreature\b/.test(record.typeLine.split(' // ')[0])) continue;
    if (isSummoningSick(card, record, texts, keywordsWorn(game, { seat, kind: 'card', id: card.iid }, records))) continue;
    picks.push({ unit: { kind: 'card', id: card.iid }, n: 1, name: record.name.split(' // ')[0] });
  }
  for (const item of player.board) {
    if (item.zone === 'lands' || computedPT({ ...item, counters: item.counters ?? {} }) === null) continue;
    const worn = item.count === 1 ? keywordsWorn(game, { seat, kind: 'stack', id: item.id }, records) : undefined;
    const n = Math.min(item.tapped ?? 0, item.count - sickCopies(item, texts, worn));
    if (n > 0) picks.push({ unit: { kind: 'stack', id: item.id }, n, name: item.name });
  }
  return picks;
}

/** How many attackers a draft holds. */
export const draftSize = (picks: DraftPick[]): number => picks.reduce((sum, p) => sum + p.n, 0);

/** "Grizzly Bears, Hill Giant and 2 Soldier": what a screen reader, and the
 * button's title, say is about to attack. */
export function draftWords(picks: DraftPick[]): string {
  const parts = picks.map((p) => (p.n > 1 ? `${p.n} ${p.name}` : p.name));
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The players an attack can be pointed at: every other living player, in
 * turn order after the active one. */
export function opponentsOf(game: GameState): number[] {
  const seats = game.players.length;
  const out: number[] = [];
  for (let step = 1; step < seats; step++) {
    const seat = (game.activePlayerIndex + step) % seats;
    if (game.players[seat]?.eliminated === false) out.push(seat);
  }
  return out;
}
