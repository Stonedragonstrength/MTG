import { useEffect, useRef, useState } from 'react';
import { useLongPress } from './useLongPress';

interface Props {
  life: number;
  onAdjust: (delta: number) => void;
}

export default function LifeCounter({ life, onAdjust }: Props) {
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
    <div className={`life-counter${flash ? ` flash-${flash}` : ''}`}>
      <button type="button" className="life-half life-gain" aria-label="gain life" {...gain} />
      <span className="life-total">{life}</span>
      <button type="button" className="life-half life-lose" aria-label="lose life" {...lose} />
    </div>
  );
}
