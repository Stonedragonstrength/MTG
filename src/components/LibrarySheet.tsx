import { useMemo, useState } from 'react';
import { normalize } from '../lib/fuzzy';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';

interface Props {
  playerIdx: number;
  /** Assist scope for someone else's seat: draw/mill/shuffle only. */
  claimed: boolean;
  onClose: () => void;
}

/** The library's controls. Search shows names ALPHABETICALLY, never in
 * order, and taking a card shuffles — nobody learns the deck order. */
export default function LibrarySheet({ playerIdx, claimed, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const drawCards = useAppStore((s) => s.drawCards);
  const millCards = useAppStore((s) => s.millCards);
  const shuffleSeat = useAppStore((s) => s.shuffleSeat);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const [n, setN] = useState(1);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState('');

  const library = game?.players[playerIdx]?.cards?.library ?? [];
  const alphabetical = useMemo(
    () =>
      [...library]
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((c) => !filter.trim() || normalize(c.name).includes(normalize(filter))),
    [library, filter],
  );

  function take(iid: string, to: 'hand' | 'battlefield') {
    moveVirtualCard(playerIdx, iid, 'library', to, to === 'battlefield' ? { row: 'front' } : undefined);
    shuffleSeat(playerIdx); // a searched library is always shuffled
    setSearching(false);
    setFilter('');
  }

  return (
    <Sheet title={`Library · ${library.length}`} onClose={onClose} size="wide">
      {!searching ? (
        <>
          <div className="detail-row">
            <span>How many</span>
            <div className="stepper">
              <button aria-label="fewer" onClick={() => setN(Math.max(1, n - 1))}>−</button>
              <span>{n}</span>
              <button aria-label="more" onClick={() => setN(Math.min(library.length || 1, n + 1))}>+</button>
            </div>
          </div>
          <div className="modal-actions">
            <button className="primary" disabled={library.length === 0} onClick={() => { drawCards(playerIdx, n); onClose(); }}>
              Draw {n}
            </button>
            <button disabled={library.length === 0} onClick={() => { millCards(playerIdx, n); onClose(); }}>
              Mill {n}
            </button>
            <button onClick={() => { shuffleSeat(playerIdx); onClose(); }}>Shuffle</button>
            {claimed && (
              <button className="ghost" onClick={() => setSearching(true)}>
                Search…
              </button>
            )}
          </div>
          {!claimed && <p className="hint">Helping out a sleeping friend: draw, mill, shuffle only.</p>}
        </>
      ) : (
        <>
          <p className="hint">Alphabetical — the order stays secret. Taking a card shuffles.</p>
          <input
            autoFocus
            type="search"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul className="search-results stack-suggestions">
            {alphabetical.map((c) => (
              <li key={c.iid} className="search-result-row">
                <span className="search-result-main">{c.name}</span>
                <button onClick={() => take(c.iid, 'hand')}>Hand</button>
                <button onClick={() => take(c.iid, 'battlefield')}>Field</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
