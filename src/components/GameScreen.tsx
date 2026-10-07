import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { registerBack } from '../lib/backstack';
import { boardSeat, liveCombat } from '../lib/combat';
import { useAppStore } from '../state/store';
import HandScreen from './HandScreen';
import LandBackground from './LandBackground';
import PlayerZone from './PlayerZone';
import RevealBanner from './RevealBanner';
import { shieldBoard } from './Sheet';
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

/** The active player holds the big board and passing the turn moves it —
 * except while a defender chooses blockers: then it is theirs, on every
 * device (on the shared tablet it turns to face them). */
export default function GameScreen() {
  const game = useAppStore((s) => s.game);
  const online = useAppStore((s) => s.online);
  const hubPinned = useAppStore((s) => s.settings.hubPinned);
  const exitToHome = useAppStore((s) => s.exitToHome);
  // auto = phones land on their hand, tablets on the table.
  const [view, setView] = useState<'auto' | 'table' | 'hand'>('auto');
  const narrow = useNarrow();
  // Tablet back = leave to home (game stays saved), not close the app.
  // (A fight is shared table state, not a layer: it never touches the back
  // button, and it is still there when the game is picked up again.)
  useEffect(() => registerBack(exitToHome), [exitToHome]);
  // Stray taps: whenever the fight's step or the seat acting in it changes,
  // or the fight ends — by a press here or by a state from another device —
  // the screen rearranges itself under whatever finger is on its way down.
  // The second half of a double tap on [Done] used to land in the zone
  // that had just swung under it and play a card. So every such change
  // raises the shield a closing sheet raises. (A layout effect: it is up
  // before the browser can deliver the next tap.)
  const fight = game ? liveCombat(game) : null;
  const moment = fight ? `${fight.id}:${fight.step}:${fight.defender ?? ''}` : '';
  const lastMoment = useRef(moment);
  useLayoutEffect(() => {
    if (lastMoment.current === moment) return; // also the first render: nothing has moved
    lastMoment.current = moment;
    shieldBoard();
  }, [moment]);
  if (!game) return null;

  const activeIdx = game.activePlayerIndex;
  const boardIdx = boardSeat(game);
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
          focused={i === boardIdx}
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
