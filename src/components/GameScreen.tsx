import { useAppStore } from '../state/store';
import LandBackground from './LandBackground';
import PlayerZone from './PlayerZone';
import '../styles/zones.css';

// Seats run clockwise from the near edge; 3+ players wrap the table's sides.
const EDGE_LAYOUTS: Record<number, string[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'right', 'left'],
  4: ['bottom', 'right', 'top', 'left'],
};

/** The active player always holds the big board; passing the turn moves it. */
export default function GameScreen() {
  const game = useAppStore((s) => s.game);
  if (!game) return null;

  const activeIdx = game.activePlayerIndex;
  const n = game.players.length;
  const edges = EDGE_LAYOUTS[n] ?? EDGE_LAYOUTS[4];
  const table360 = n > 2;

  return (
    <div className={`game-screen players-${n} focus-mode${table360 ? ' table-360' : ''}`}>
      <LandBackground />
      {game.players.map((p, i) => (
        <PlayerZone
          key={p.profileId}
          playerIdx={i}
          edge={edges[i]}
          focused={i === activeIdx}
          showHub={i === activeIdx}
        />
      ))}
    </div>
  );
}
