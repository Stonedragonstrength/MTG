import { mergeRows } from './sync';
import type { GarageCard } from './types';

/** Last-write-wins merge of the local garage against the cloud copy.
 * Returns the merged truth plus the local rows that still need pushing
 * (local-newer or local-only). Remote-won rows come back clean. The rule
 * itself is the one decks and players sync by: lib/sync.ts. */
export function mergeGarage(
  local: GarageCard[],
  remote: GarageCard[],
): { merged: GarageCard[]; toPush: GarageCard[] } {
  return mergeRows(local, remote, (row) => row.cardId);
}
