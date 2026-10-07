import { useEffect, useState } from 'react';
import { registerBack } from '../lib/backstack';
import { useAppStore } from '../state/store';
import HandScreen from './HandScreen';
import LandBackground from './LandBackground';
import PlayerZone from './PlayerZone';
import RevealBanner from './RevealBanner';
import TablePill from './TablePill';
import '../styles/zones.css';

// Seats run clockwise from the near edge; 3+ players wrap the table's sides.
const EDGE_LAYOUTS: Record<number, string[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'right', 'left'],
  4: ['bottom', 'right', 'top', 'left'],
};

const NARROW_QUERY = '(max-width: 640px)';

/** Phone-sized viewport? jsdom has no matchMedia — default to wide. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia?.(NARROW_QUERY).matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_QUERY);
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

/** The active player always holds the big board; passing the turn moves it. */
export default function GameScreen() {
  const game = useAppStore((s) => s.game);
  const online = useAppStore((s) => s.online);
  const hubPinned = useAppStore((s) => s.settings.hubPinned);
  const exitToHome = useAppStore((s) => s.exitToHome);
  // auto = phones land on their hand, tablets on the table.
  const [view, setView] = useState<'auto' | 'table' | 'hand'>('auto');
  const narrow = useNarrow();
  // Tablet back = leave to home (game stays saved), not close the app.
  useEffect(() => registerBack(exitToHome), [exitToHome]);
  if (!game) return null;

  const activeIdx = game.activePlayerIndex;
  const n = game.players.length;
  const edges = EDGE_LAYOUTS[n] ?? EDGE_LAYOUTS[4];
  const table360 = n > 2;
  // Online: rotate the table so YOUR zone sits at your own bottom edge.
  const shift = online?.mySeat ?? 0;
  // "Turn bar stays put": the hub docks in the zone at this device's bottom
  // edge instead of travelling with the active player. (Not on a phone-width
  // 360 board: an edge bar that short cannot hold the hub and the life buttons.)
  const hubSeat = hubPinned && !(narrow && table360) ? shift % n : activeIdx;

  // Your claimed seat plays virtual cards: the hand view exists for you.
  const phoneSeat =
    online?.mySeat != null && game.players[online.mySeat]?.cards !== undefined
      ? online.mySeat
      : null;
  const handView = phoneSeat !== null && (view === 'hand' || (view === 'auto' && narrow));

  if (handView) {
    return (
      <div className={`game-screen players-${n} hand-mode`}>
        <HandScreen seatIdx={phoneSeat} onShowTable={() => setView('table')} />
        {online && <TablePill />}
        <RevealBanner />
      </div>
    );
  }

  return (
    <div className={`game-screen players-${n} focus-mode${table360 ? ' table-360' : ''}`}>
      <LandBackground />
      {game.players.map((p, i) => (
        <PlayerZone
          key={p.profileId}
          playerIdx={i}
          edge={edges[(i - shift + n) % n]}
          focused={i === activeIdx}
          showHub={i === hubSeat}
        />
      ))}
      {online && <TablePill />}
      {phoneSeat !== null && (
        <button className="hand-jump" aria-label="my hand" onClick={() => setView('hand')}>
          ✋
        </button>
      )}
      <RevealBanner />
    </div>
  );
}
