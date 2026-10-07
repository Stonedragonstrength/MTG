import { useMemo, useState, type CSSProperties } from 'react';
import { normalize } from '../lib/fuzzy';
import type { CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';

interface Props {
  playerIdx: number;
  /** Assist scope for someone else's seat: draw/mill/shuffle only. */
  claimed: boolean;
  onClose: () => void;
}

type Dest = 'top' | 'bottom' | 'graveyard' | 'hand';
const DESTS: { key: Dest; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'graveyard', label: 'Graveyard' },
  { key: 'hand', label: 'Hand' },
];

/** The library's controls. Search shows names ALPHABETICALLY, never in
 * order, and taking a card shuffles — nobody learns the deck order.
 * "Look at top N" is the one ordered view: scry, surveil, look-and-pick. */
export default function LibrarySheet({ playerIdx, claimed, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  // A build behind the table cannot write, so its look could not announce itself.
  const stale = useAppStore((s) => s.online?.status.kind === 'stale-build');
  const drawCards = useAppStore((s) => s.drawCards);
  const millCards = useAppStore((s) => s.millCards);
  const shuffleSeat = useAppStore((s) => s.shuffleSeat);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const lookNotice = useAppStore((s) => s.lookNotice);
  const arrangeTop = useAppStore((s) => s.arrangeTop);
  const [n, setN] = useState(1);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState('');
  // The look: the cards as captured, the order they now sit in, and where
  // each is headed. Nothing moves until Done.
  const [looked, setLooked] = useState<string[] | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [dests, setDests] = useState<Record<string, Dest>>({});

  const library = game?.players[playerIdx]?.cards?.library ?? [];
  const alphabetical = useMemo(
    () =>
      [...library]
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((c) => !filter.trim() || normalize(c.name).includes(normalize(filter))),
    [library, filter],
  );
  // A card drawn meanwhile drops out; a shuffle voids the look outright —
  // what was seen is only arrangeable while it is still the top.
  const remaining = order
    .map((iid) => library.find((c) => c.iid === iid))
    .filter((c): c is CardInstance => c !== undefined);
  const onTop = new Set(library.slice(0, remaining.length).map((c) => c.iid));
  const intact = remaining.length > 0 && remaining.every((c) => onTop.has(c.iid));
  const seen = intact ? remaining : [];
  const records = useCardRecords(seen);
  const destOf = (iid: string) => dests[iid] ?? 'top';
  const going = (d: Dest) => seen.filter((c) => destOf(c.iid) === d).map((c) => c.iid);

  function take(iid: string, to: 'hand' | 'battlefield') {
    moveVirtualCard(playerIdx, iid, 'library', to, to === 'battlefield' ? { row: 'front' } : undefined);
    shuffleSeat(playerIdx); // a searched library is always shuffled
    setSearching(false);
    setFilter('');
  }

  function look() {
    const iids = library.slice(0, n).map((c) => c.iid);
    if (iids.length === 0) return;
    lookNotice(playerIdx, iids.length); // the table hears about the look itself
    setLooked(iids);
    setOrder(iids);
    setDests({});
  }

  function nudge(iid: string, by: -1 | 1) {
    const ids = seen.map((c) => c.iid);
    const i = ids.indexOf(iid);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(ids);
  }

  function commit() {
    const here = new Set(seen.map((c) => c.iid));
    arrangeTop(
      playerIdx,
      (looked ?? []).filter((iid) => here.has(iid)),
      { top: going('top'), bottom: going('bottom'), graveyard: going('graveyard'), hand: going('hand') },
    );
    onClose();
  }

  const staying = going('top');
  // Up to four across; past that, two even rows rather than one long one and a straggler.
  const cols = seen.length <= 4 ? seen.length : Math.min(4, Math.ceil(seen.length / 2));
  const footer = !looked ? undefined : intact ? (
    <button className="primary" onClick={commit}>
      Done
    </button>
  ) : (
    <button onClick={() => setLooked(null)}>Look again</button>
  );

  return (
    <Sheet title={`Library · ${library.length}`} onClose={onClose} size="wide" footer={footer}>
      {looked && !intact ? (
        <p className="hint">Your library changed while you were looking — those cards are not on top any more.</p>
      ) : looked ? (
        <>
          <p className="hint look-hint">
            Top card first. The arrows reorder; the table only sees how many went where.
          </p>
          <ol className="look-list" style={{ '--look-cols': cols } as CSSProperties}>
            {seen.map((c, idx) => {
              const dest = destOf(c.iid);
              const art = records[c.cardId]?.imageNormal;
              return (
                <li key={c.iid} className={`look-card look-card--${dest}`}>
                  <div className="look-face" data-name={c.name}>
                    {art && <img src={art} alt="" loading="lazy" />}
                    <span className="look-tag">
                      {dest === 'top'
                        ? staying.length > 1
                          ? `Top · ${staying.indexOf(c.iid) + 1}`
                          : 'Top'
                        : DESTS.find((d) => d.key === dest)!.label}
                    </span>
                  </div>
                  <div className="look-order">
                    <button
                      className="ghost look-move look-move--up"
                      aria-label={`move ${c.name} up`}
                      disabled={idx === 0}
                      onClick={() => nudge(c.iid, -1)}
                    />
                    <span className="look-name">{c.name}</span>
                    <button
                      className="ghost look-move look-move--down"
                      aria-label={`move ${c.name} down`}
                      disabled={idx === seen.length - 1}
                      onClick={() => nudge(c.iid, 1)}
                    />
                  </div>
                  <div className="look-dests" role="group" aria-label={`where ${c.name} goes`}>
                    {DESTS.map((d) => (
                      <button
                        key={d.key}
                        className={dest === d.key ? 'look-dest look-dest--on' : 'look-dest'}
                        aria-pressed={dest === d.key}
                        onClick={() => setDests((prev) => ({ ...prev, [c.iid]: d.key }))}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : !searching ? (
        <>
          <div className="detail-row">
            <span>How many</span>
            <div className="stepper">
              <button aria-label="fewer" onClick={() => setN(Math.max(1, n - 1))}>−</button>
              <span>{n}</span>
              <button aria-label="more" onClick={() => setN(Math.min(library.length || 1, n + 1))}>+</button>
            </div>
          </div>
          <div className="modal-actions library-actions">
            <button className="primary" disabled={library.length === 0} onClick={() => { drawCards(playerIdx, n); onClose(); }}>
              Draw {n}
            </button>
            <button disabled={library.length === 0} onClick={() => { millCards(playerIdx, n); onClose(); }}>
              Mill {n}
            </button>
            {claimed && (
              <button disabled={library.length === 0 || stale} onClick={look}>
                Look at top {n}
              </button>
            )}
            <button onClick={() => { shuffleSeat(playerIdx); onClose(); }}>Shuffle</button>
            {claimed && (
              <button className="ghost" onClick={() => setSearching(true)}>
                Search…
              </button>
            )}
          </div>
          {claimed ? (
            <p className="hint">
              Look is scry and surveil: see the top cards, then send each one to the top, bottom,
              graveyard or hand.
            </p>
          ) : (
            <p className="hint">Helping out a sleeping friend: draw, mill, shuffle only.</p>
          )}
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
