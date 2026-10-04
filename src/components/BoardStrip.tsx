import { useState } from 'react';
import { computedPT } from '../lib/board';
import { useAppStore } from '../state/store';
import CardDetail from './CardDetail';
import CardSearch from './CardSearch';

interface Props {
  playerIdx: number;
}

export default function BoardStrip({ playerIdx }: Props) {
  const game = useAppStore((s) => s.game);
  const changeCount = useAppStore((s) => s.changeCount);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  if (!game) return null;
  const board = game.players[playerIdx].board;

  return (
    <div className="board-strip">
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
            </div>
          </div>
        );
      })}
      <button className="add-tile" aria-label="add a card" onClick={() => setSearchOpen(true)}>
        +
      </button>
      {searchOpen && <CardSearch playerIdx={playerIdx} onClose={() => setSearchOpen(false)} />}
      {detailId && (
        <CardDetail playerIdx={playerIdx} itemId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}
