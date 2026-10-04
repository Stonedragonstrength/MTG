import { useEffect, useState } from 'react';
import { useAppStore } from '../state/store';
import CenterHub from './CenterHub';
import LandBackground from './LandBackground';
import PlayerZone from './PlayerZone';
import '../styles/zones.css';

export default function GameScreen() {
  const game = useAppStore((s) => s.game);
  const autoFocusOn = useAppStore((s) => s.settings.autoFocusOn);
  const activeIdx = game?.activePlayerIndex ?? null;
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (autoFocusOn && activeIdx !== null) setFocusedIdx(activeIdx);
  }, [autoFocusOn, activeIdx]);

  if (!game) return null;

  return (
    <div
      className={`game-screen players-${game.players.length}${
        focusedIdx !== null ? ' focus-mode' : ''
      }`}
    >
      <LandBackground />
      {game.players.map((p, i) => (
        <PlayerZone
          key={p.profileId}
          playerIdx={i}
          focused={focusedIdx === i}
          onToggleFocus={() => setFocusedIdx((f) => (f === i ? null : i))}
        />
      ))}
      <CenterHub />
    </div>
  );
}
