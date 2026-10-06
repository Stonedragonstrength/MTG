import type { GarageCard } from './types';

/** Last-write-wins merge of the local garage against the cloud copy.
 * Returns the merged truth plus the local rows that still need pushing
 * (local-newer or local-only). Remote-won rows come back clean. */
export function mergeGarage(
  local: GarageCard[],
  remote: GarageCard[],
): { merged: GarageCard[]; toPush: GarageCard[] } {
  const byId = new Map<string, GarageCard>();
  for (const row of local) byId.set(row.cardId, row);

  const merged: GarageCard[] = [];
  const toPush: GarageCard[] = [];
  const seen = new Set<string>();

  for (const theirs of remote) {
    seen.add(theirs.cardId);
    const ours = byId.get(theirs.cardId);
    if (!ours || theirs.updatedAt >= ours.updatedAt) {
      merged.push({ ...theirs, dirty: 0 });
    } else {
      merged.push(ours);
      toPush.push(ours);
    }
  }
  for (const ours of local) {
    if (seen.has(ours.cardId)) continue;
    merged.push(ours);
    if (ours.dirty === 1) toPush.push(ours);
  }
  return { merged, toPush };
}
