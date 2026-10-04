import { useState } from 'react';
import { computedPT } from '../lib/board';
import type { BoardItem } from '../lib/types';
import { useAppStore } from '../state/store';
import CardDetail from './CardDetail';
import CardSearch from './CardSearch';
import { useLongPress } from './useLongPress';

/** Hold-to-remove: a stray tap must never vaporize a whole stack. */
function RemoveStackButton({ item, onRemove }: { item: BoardItem; onRemove: () => void }) {
  const [hint, setHint] = useState(false);
  const press = useLongPress(() => {
    setHint(true);
    window.setTimeout(() => setHint(false), 1200);
  }, onRemove);
  return (
    <button
      className={`stack-remove${hint ? ' show-hint' : ''}`}
      aria-label={`remove ${item.name} stack (hold)`}
      title="Hold to remove"
      {...press}
    >
      ✕
    </button>
  );
}

interface Props {
  playerIdx: number;
}

export default function BoardStrip({ playerIdx }: Props) {
  const game = useAppStore((s) => s.game);
  const changeCount = useAppStore((s) => s.changeCount);
  const removeItem = useAppStore((s) => s.removeItem);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  if (!game) return null;
  const board = game.players[playerIdx].board.filter((item) => item.zone !== 'lands');
  // Few cards get the big treatment; a wide board shrinks to fit.
  const size = board.length <= 3 ? 'lg' : board.length <= 8 ? 'md' : 'sm';

  return (
    <div className={`board-strip board-strip--${size}`}>
      {board.map((item) => {
        const pt = computedPT(item);
        return (
          <div className="board-item" key={item.id}>
            <button
              className="thumb"
              aria-label={`${item.name} details`}
              onClick={() => setDetailId(item.id)}
            >
              {item.imageNormal ? (
                <img src={item.imageNormal} alt="" loading="lazy" />
              ) : (
                <span className={`thumb-placeholder color-${item.color ?? 'C'}`}>{item.name}</span>
              )}
              {pt && (
                <span className="pt-badge">
                  {pt.power}/{pt.toughness}
                </span>
              )}
            </button>
            <div className="count-controls">
              <button
                aria-label={`remove one ${item.name}`}
                onClick={() => changeCount(playerIdx, item.id, -1)}
              >
                −
              </button>
              <span className="count-badge">×{item.count}</span>
              <button
                aria-label={`add one ${item.name}`}
                onClick={() => changeCount(playerIdx, item.id, 1)}
              >
                +
              </button>
              <RemoveStackButton item={item} onRemove={() => removeItem(playerIdx, item.id)} />
            </div>
          </div>
        );
      })}
      <button
        className={board.length === 0 ? 'add-tile add-tile--centered' : 'add-tile'}
        aria-label="add a card"
        onClick={() => setSearchOpen(true)}
      >
        +
      </button>
      {searchOpen && <CardSearch playerIdx={playerIdx} onClose={() => setSearchOpen(false)} />}
      {detailId && (
        <CardDetail playerIdx={playerIdx} itemId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}
