import { permanentTexts } from '../lib/keywords';
import { useAppStore } from '../state/store';
import { useCardRecords } from './useCardRecords';

/** The rules text on the table's permanents as one seat sees it: `own` is
 * everything that seat controls (its battlefield cards whose records are
 * read, and its board stacks), `others` everything anyone else does. The
 * turn rules need both — a seat's own Exploration gives it a land drop,
 * and so does somebody else's Rites of Flourishing. A card that is not
 * read yet is simply missing: it never blocks anything. */
export function useSeatTexts(playerIdx: number): { own: string[]; others: string[] } {
  const players = useAppStore((s) => s.game?.players);
  const records = useCardRecords((players ?? []).flatMap((p) => p.cards?.battlefield ?? []));
  const own: string[] = [];
  const others: string[] = [];
  (players ?? []).forEach((p, i) => {
    const texts = permanentTexts(p.cards?.battlefield ?? [], records, p.board);
    (i === playerIdx ? own : others).push(...texts);
  });
  return { own, others };
}
