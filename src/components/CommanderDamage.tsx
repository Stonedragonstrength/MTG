import { useAppStore } from '../state/store';
import { useLongPress } from './useLongPress';

interface Props {
  playerIdx: number;
}

/** A slim gauge per enemy commander, sitting under the life total: fill
 * approaches 21. Tap +1, hold −1 (same convention as everywhere else). */
function Gauge({
  playerIdx,
  attackerId,
  attackerName,
  damage,
  threshold,
}: {
  playerIdx: number;
  attackerId: string;
  attackerName: string;
  damage: number;
  threshold: number;
}) {
  const applyCommanderDamage = useAppStore((s) => s.applyCommanderDamage);
  const press = useLongPress(
    () => applyCommanderDamage(playerIdx, attackerId, 1),
    () => applyCommanderDamage(playerIdx, attackerId, -1),
  );
  const pct = Math.min(100, (damage / threshold) * 100);
  return (
    <button
      type="button"
      className={`cmd-gauge${damage >= threshold ? ' cmd-gauge--lethal' : ''}`}
      aria-label={`commander damage from ${attackerName}`}
      title={`Commander damage from ${attackerName} — ${damage}/${threshold}. Tap +1, hold −1. Also lowers life.`}
      {...press}
    >
      <span className="cmd-gauge-name">{attackerName.slice(0, 4)}</span>
      <span className="cmd-gauge-value">{damage}</span>
      <span className="cmd-gauge-bar">
        <i style={{ width: `${pct}%` }} />
      </span>
    </button>
  );
}

export default function CommanderDamage({ playerIdx }: Props) {
  const game = useAppStore((s) => s.game);
  if (!game) return null;
  const player = game.players[playerIdx];
  const enemies = game.config.profiles.filter((_, j) => j !== playerIdx);

  return (
    <div className="cmd-gauges" title="Commander damage taken from each enemy commander">
      {enemies.map((profile) => (
        <Gauge
          key={profile.id}
          playerIdx={playerIdx}
          attackerId={profile.id}
          attackerName={profile.name}
          damage={player.commanderDamage[profile.id] ?? 0}
          threshold={game.config.commanderDamageThreshold}
        />
      ))}
    </div>
  );
}
