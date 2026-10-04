import { useAppStore } from '../state/store';
import { useLongPress } from './useLongPress';

interface Props {
  playerIdx: number;
}

function Bubble({
  playerIdx,
  attackerId,
  attackerName,
  damage,
}: {
  playerIdx: number;
  attackerId: string;
  attackerName: string;
  damage: number;
}) {
  const applyCommanderDamage = useAppStore((s) => s.applyCommanderDamage);
  const press = useLongPress(
    () => applyCommanderDamage(playerIdx, attackerId, 1),
    () => applyCommanderDamage(playerIdx, attackerId, -1),
  );
  return (
    <button
      type="button"
      className="cmd-bubble"
      aria-label={`commander damage from ${attackerName}`}
      {...press}
    >
      <span className="cmd-name">{attackerName.slice(0, 3)}</span>
      <span className="cmd-value">{damage}</span>
    </button>
  );
}

/** One bubble per enemy commander; tap +1, hold −1. */
export default function CommanderDamage({ playerIdx }: Props) {
  const game = useAppStore((s) => s.game);
  if (!game) return null;
  const player = game.players[playerIdx];

  return (
    <div className="cmd-strip">
      {game.config.profiles.map((profile, j) => {
        if (j === playerIdx) return null;
        return (
          <Bubble
            key={profile.id}
            playerIdx={playerIdx}
            attackerId={profile.id}
            attackerName={profile.name}
            damage={player.commanderDamage[profile.id] ?? 0}
          />
        );
      })}
    </div>
  );
}
