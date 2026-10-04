import { useAppStore } from '../state/store';
import PlayerZone from './PlayerZone';
import '../styles/zones.css';

export default function GameScreen() {
  const game = useAppStore((s) => s.game);
  if (!game) return null;

  return (
    <div className={`game-screen players-${game.players.length}`}>
      {game.players.map((p, i) => (
        <PlayerZone key={p.profileId} playerIdx={i} />
      ))}
    </div>
  );
}
