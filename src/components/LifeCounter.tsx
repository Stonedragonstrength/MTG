import { useEffect, useRef, useState } from 'react';
import { useLongPress } from './useLongPress';

interface Props {
  life: number;
  onAdjust: (delta: number) => void;
  /** A fight's result is waiting: what this life comes to once it is
   * applied. Shown as "40 → 32", and the buttons then move that number
   * (the caller's `onAdjust` changes the result, not the life). */
  after?: number | null;
  /** What the two buttons are called while they do something else. */
  labels?: { lose: string; gain: string };
}

/** Compact inline counter: [−] 40 [+], hold for ±5. Stops click propagation
 * so taps never bubble into the zone header's focus toggle. */
export default function LifeCounter({ life, onAdjust, after = null, labels }: Props) {
  const prev = useRef(life);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (life === prev.current) return;
    setFlash(life > prev.current ? 'up' : 'down');
    prev.current = life;
    const t = window.setTimeout(() => setFlash(null), 600);
    return () => window.clearTimeout(t);
  }, [life]);

  const gain = useLongPress(
    () => onAdjust(1),
    () => onAdjust(5),
  );
  const lose = useLongPress(
    () => onAdjust(-1),
    () => onAdjust(-5),
  );

  return (
    <div
      className={`life-counter${flash ? ` flash-${flash}` : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" className="life-btn" aria-label={labels?.lose ?? 'lose life'} {...lose}>
        −
      </button>
      {after === null ? (
        <span className="life-total">{life}</span>
      ) : (
        <span className="life-total life-total--stake">
          <span className="life-was">{life}</span>
          <span className="life-arrow" aria-hidden="true">
            →
          </span>
          <span className={`life-after${after < life ? ' life-after--down' : after > life ? ' life-after--up' : ''}`}>
            {after}
          </span>
        </span>
      )}
      <button type="button" className="life-btn" aria-label={labels?.gain ?? 'gain life'} {...gain}>
        +
      </button>
    </div>
  );
}
