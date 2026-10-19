import { useMemo } from 'react';
import type { CardRecords } from '../lib/combatEngine';
import { useAppStore } from '../state/store';
import { useCardRecords } from './useCardRecords';
import { useTableRecords } from './useCombat';

/** What pricing a cast reads for the seat at `playerIdx` (lib/costs.ts):
 * every battlefield's cards, the seat's graveyard ("for each creature card
 * in your graveyard", delve) and its tokens (convoke pays their color). */
export function useCastRecords(playerIdx: number): CardRecords {
  const table = useTableRecords();
  const player = useAppStore((s) => s.game?.players[playerIdx]);
  const more = useCardRecords([
    ...(player?.cards?.graveyard ?? []),
    ...(player?.board ?? []).flatMap((it) => (it.cardId ? [{ cardId: it.cardId, name: it.name }] : [])),
  ]);
  const key = Object.keys(more).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ ...table, ...more }), [table, key]);
}
