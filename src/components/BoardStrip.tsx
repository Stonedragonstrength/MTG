import { useEffect, useRef, useState } from 'react';
import { computedPT } from '../lib/board';
import { COLOR_NAMES, effectiveManaColors } from '../lib/mana';
import { playSlash } from '../lib/sound';
import type { BoardItem } from '../lib/types';
import { useAppStore } from '../state/store';

/** How long a removed card lingers while the slash animation plays. */
const DEATH_MS = 700;
import CardDetail from './CardDetail';
import CardSearch from './CardSearch';
import { useLongPress } from './useLongPress';

/** Tap = tap one copy (like a land); hold = card details. */
function TokenCard({
  item,
  onTap,
  onDetail,
}: {
  item: BoardItem;
  onTap: () => void;
  onDetail: () => void;
}) {
  const press = useLongPress(onTap, onDetail);
  const tapped = item.tapped ?? 0;
  const pt = computedPT(item);
  const mana = effectiveManaColors(item);
  const label = `${item.name}` + (tapped > 0 ? `, ${tapped} of ${item.count} tapped` : '');
  return (
    <button
      className={[
        'thumb',
        tapped >= item.count ? 'thumb--tapped' : tapped > 0 ? 'thumb--partial' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title="Tap to tap one · hold for details"
      {...press}
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
      {mana.length > 0 && (
        <span
          className="mana-badge"
          aria-label={`makes ${mana
            .map((c) => (c === 'any' ? 'any color' : COLOR_NAMES[c]))
            .join(' and ')} mana`}
        >
          {mana.map((c) => (
            <i key={c} className={`mana-dot mana-${c}`} />
          ))}
        </span>
      )}
      {tapped > 0 && <span className="tapped-badge">{tapped}⤵</span>}
      {item.count > 1 && <span className="thumb-count">×{item.count}</span>}
    </button>
  );
}

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
  const tapItem = useAppStore((s) => s.tapItem);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Afterimages of removed stacks: the store drops them instantly, these
  // linger in place just long enough for the slash animation.
  const [dying, setDying] = useState<{ item: BoardItem; at: number }[]>([]);
  const deathTimers = useRef<number[]>([]);
  useEffect(() => () => deathTimers.current.forEach((t) => window.clearTimeout(t)), []);

  if (!game) return null;
  const board = game.players[playerIdx].board.filter((item) => item.zone !== 'lands');

  function startDeath(item: BoardItem, at: number) {
    if (useAppStore.getState().settings.soundOn) playSlash();
    setDying((prev) =>
      prev.some((d) => d.item.id === item.id) ? prev : [...prev, { item, at }],
    );
    deathTimers.current.push(
      window.setTimeout(
        () => setDying((prev) => prev.filter((d) => d.item.id !== item.id)),
        DEATH_MS,
      ),
    );
  }

  const entries: { live: boolean; item: BoardItem; at: number }[] = board.map((item, i) => ({
    live: true,
    item,
    at: i,
  }));
  for (const d of [...dying].sort((a, b) => a.at - b.at)) {
    entries.splice(Math.min(d.at, entries.length), 0, { live: false, ...d });
  }

  // Few cards get the big treatment; a wide board shrinks to fit.
  const size = entries.length <= 3 ? 'lg' : entries.length <= 8 ? 'md' : 'sm';

  return (
    <div className={`board-strip board-strip--${size}`}>
      {entries.map(({ live, item, at }) =>
        live ? (
          <div className="board-item" key={item.id}>
            <TokenCard
              item={item}
              onTap={() => tapItem(playerIdx, item.id, 1)}
              onDetail={() => setDetailId(item.id)}
            />
            <span className="thumb-name">{item.name}</span>
            <div className="count-controls">
              <button
                aria-label={`remove one ${item.name}`}
                onClick={() => {
                  if (item.count === 1) startDeath(item, at);
                  changeCount(playerIdx, item.id, -1);
                }}
              >
                −
              </button>
              <span className="count-badge" key={item.count}>
                ×{item.count}
              </span>
              <button
                aria-label={`add one ${item.name}`}
                onClick={() => changeCount(playerIdx, item.id, 1)}
              >
                +
              </button>
              <RemoveStackButton
                item={item}
                onRemove={() => {
                  startDeath(item, at);
                  removeItem(playerIdx, item.id);
                }}
              />
            </div>
          </div>
        ) : (
          <div className="board-item board-item--dying" key={`dying-${item.id}`} aria-hidden="true">
            <span className="thumb thumb--ghost">
              {item.imageNormal ? (
                <img src={item.imageNormal} alt="" />
              ) : (
                <span className={`thumb-placeholder color-${item.color ?? 'C'}`}>{item.name}</span>
              )}
              <span className="death-slash" />
              <span className="death-x">✕</span>
            </span>
            <span className="thumb-name">{item.name}</span>
          </div>
        ),
      )}
      <button
        className={entries.length === 0 ? 'add-tile add-tile--centered' : 'add-tile'}
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
