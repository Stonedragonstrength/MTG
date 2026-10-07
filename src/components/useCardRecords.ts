import { useEffect, useState } from 'react';
import { findCardByName, getCardById } from '../data/scryfall';
import type { CardRecord } from '../lib/types';

/** Module-level cache: a card resolved once stays resolved for the
 * session, across every component that asks. null = hopeless (render
 * the name-on-frame placeholder). */
const cache = new Map<string, CardRecord | null>();

/** Batch id→record resolution with the printing-drift chain:
 * getCardById → findCardByName → null. A card whose read failed has no
 * entry at all; a caller that cannot go on without an answer (a combat
 * waiting to be applied) asks again by raising `retry`. */
export function useCardRecords(
  instances: { cardId: string; name: string }[],
  retry = 0,
): Record<string, CardRecord | null> {
  const [, bump] = useState(0);
  const key = instances.map((i) => i.cardId).join(',');

  useEffect(() => {
    const missing = instances.filter((i) => !cache.has(i.cardId));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const m of missing) {
        if (cache.has(m.cardId)) continue;
        try {
          const byId = await getCardById(m.cardId);
          if (byId) {
            cache.set(m.cardId, byId);
            continue;
          }
          const byName = await findCardByName(m.name);
          // Only a RESOLVED miss is hopeless. A rejected read (DB closed
          // mid-sleep, blocked upgrade) stays uncached so a later mount
          // retries instead of poisoning the whole session.
          cache.set(m.cardId, byName ?? null);
        } catch {
          // transient — leave unresolved
        }
      }
      if (!cancelled) bump((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry]);

  const out: Record<string, CardRecord | null> = {};
  for (const i of instances) {
    const hit = cache.get(i.cardId);
    if (hit !== undefined) out[i.cardId] = hit;
  }
  return out;
}
