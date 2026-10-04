import { useAppStore } from '../state/store';
import Sheet from './Sheet';

const PLAYER_COUNTERS = [
  { key: 'poison', label: 'Poison', icon: '☠' },
  { key: 'energy', label: 'Energy', icon: '⚡' },
  { key: 'experience', label: 'Experience', icon: '✦' },
];

interface Props {
  playerIdx: number;
  onClose: () => void;
}

/** Per-player extras: poison/energy/experience, commander tax, badges. */
export default function PlayerSheet({ playerIdx, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const setPlayerCounter = useAppStore((s) => s.setPlayerCounter);
  const setCommanderDeaths = useAppStore((s) => s.setCommanderDeaths);
  const claimMonarch = useAppStore((s) => s.claimMonarch);
  const claimInitiative = useAppStore((s) => s.claimInitiative);

  if (!game) return null;
  const player = game.players[playerIdx];
  const profile = game.config.profiles[playerIdx];

  return (
    <Sheet title={profile.name} onClose={onClose}>
      {PLAYER_COUNTERS.map(({ key, label, icon }) => {
        const value = player.counters[key] ?? 0;
        return (
          <div className="detail-row" key={key}>
            <span>
              {icon} {label}
              {key === 'poison' && <small className="hint-inline"> (10 is lethal)</small>}
            </span>
            <div className="stepper">
              <button
                aria-label={`less ${key}`}
                onClick={() => setPlayerCounter(playerIdx, key, value - 1)}
              >
                −
              </button>
              <span>{value}</span>
              <button
                aria-label={`more ${key}`}
                onClick={() => setPlayerCounter(playerIdx, key, value + 1)}
              >
                +
              </button>
            </div>
          </div>
        );
      })}

      {game.config.format === 'commander' && (
        <div className="detail-row">
          <span>
            Commander deaths <small className="hint-inline">(tax +{player.commanderDeaths * 2})</small>
          </span>
          <div className="stepper">
            <button
              aria-label="fewer commander deaths"
              onClick={() => setCommanderDeaths(playerIdx, player.commanderDeaths - 1)}
            >
              −
            </button>
            <span>{player.commanderDeaths}</span>
            <button
              aria-label="more commander deaths"
              onClick={() => setCommanderDeaths(playerIdx, player.commanderDeaths + 1)}
            >
              +
            </button>
          </div>
        </div>
      )}

      <div className="detail-row">
        <span>Badges</span>
        <div className="stepper">
          <button
            className={game.monarchIdx === playerIdx ? 'badge-btn active' : 'badge-btn'}
            onClick={() => claimMonarch(playerIdx)}
          >
            👑 Monarch
          </button>
          <button
            className={game.initiativeIdx === playerIdx ? 'badge-btn active' : 'badge-btn'}
            onClick={() => claimInitiative(playerIdx)}
          >
            🗡 Initiative
          </button>
        </div>
      </div>
    </Sheet>
  );
}
