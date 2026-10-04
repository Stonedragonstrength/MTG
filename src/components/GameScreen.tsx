import { useAppStore } from '../state/store';
import LandBackground from './LandBackground';
import PlayerZone from './PlayerZone';
import '../styles/zones.css';

/** The active player always holds the big board; passing the turn moves it. */
export default function GameScreen() {
  const game = useAppStore((s) => s.game);
  if (!game) return null;

  const activeIdx = game.activePlayerIndex;

  return (
    <div className={`game-screen players-${game.players.length} focus-mode`}>
      <LandBackground />
      {game.players.map((p, i) => (
        <PlayerZone key={p.profileId} playerIdx={i} focused={i === activeIdx} showHub={i === activeIdx} />
      ))}
    </div>
  );
}
