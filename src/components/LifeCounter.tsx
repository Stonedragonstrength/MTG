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
  /** The player's commander-damage gauges: a hit that raised one shows
   * whose commander it was beside the number that floats up. */
  gauges?: Record<string, number>;
  /** A face per gauge key (the commander's player's picture). */
  faces?: Record<string, string | null>;
}

/** Changes this close together float up as one number: a count-down by taps. */
export const FLOAT_MERGE_MS = 1200;

interface Float {
  id: number;
  n: number;
  face: string | null;
  at: number;
}

/** Compact inline counter: [−] 40 [+], hold for ±5. Stops click propagation
 * so taps never bubble into the zone header's focus toggle. Every change of
 * life floats up off the number: red for a loss, green for a gain. */
export default function LifeCounter({ life, onAdjust, after = null, labels, gauges, faces }: Props) {
  const prev = useRef(life);
  const prevGauges = useRef(gauges);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const [float, setFloat] = useState<Float | null>(null);

  useEffect(() => {
    if (life === prev.current) return;
    const delta = life - prev.current;
    setFlash(delta > 0 ? 'up' : 'down');
    prev.current = life;
    // Whose commander dealt it: a gauge that went up with the loss.
    const raised = Object.keys(gauges ?? {}).find((k) => (gauges?.[k] ?? 0) > (prevGauges.current?.[k] ?? 0));
    const face = delta < 0 && raised ? (faces?.[raised] ?? null) : null;
    const now = Date.now();
    setFloat((was) =>
      was && now - was.at < FLOAT_MERGE_MS
        ? { id: was.id + 1, n: was.n + delta, face: face ?? was.face, at: now }
        : { id: (was?.id ?? 0) + 1, n: delta, face, at: now },
    );
    const t = window.setTimeout(() => setFlash(null), 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [life]);
  useEffect(() => {
    prevGauges.current = gauges;
  });
  useEffect(() => {
    if (!float) return;
    const t = window.setTimeout(() => setFloat(null), FLOAT_MERGE_MS + 600);
    return () => window.clearTimeout(t);
  }, [float]);

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
      {float && float.n !== 0 && (
        <span
          key={float.id}
          className={`life-float life-float--${float.n < 0 ? 'down' : 'up'}`}
          data-testid="life-float"
          aria-hidden="true"
        >
          {float.face && <img src={float.face} alt="" />}
          {float.n < 0 ? `−${-float.n}` : `+${float.n}`}
        </span>
      )}
    </div>
  );
}
