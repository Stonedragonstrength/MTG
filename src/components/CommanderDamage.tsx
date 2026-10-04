import { useAppStore } from '../state/store';
import { useLongPress } from './useLongPress';

interface Props {
  playerIdx: number;
}

function Bubble({
  playerIdx,
  attackerId,
  attackerName,
  attackerAvatar,
  showIdentity,
  damage,
}: {
  playerIdx: number;
  attackerId: string;
  attackerName: string;
  attackerAvatar: string | null;
  showIdentity: boolean;
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
      title={`Combat damage taken from ${attackerName}'s commander — 21 total eliminates you. Tap +1, hold −1. Also lowers life.`}
      {...press}
    >
      <span className="cmd-name">
        COM
        {showIdentity &&
          (attackerAvatar ? (
            <img className="cmd-mini-avatar" src={attackerAvatar} alt="" />
          ) : (
            <span className="cmd-initial">{attackerName[0]}</span>
          ))}
      </span>
      <span className="cmd-value">{damage}</span>
    </button>
  );
}

/** One bubble per enemy commander; tap +1, hold −1. */
export default function CommanderDamage({ playerIdx }: Props) {
  const game = useAppStore((s) => s.game);
  if (!game) return null;
  const player = game.players[playerIdx];

  const enemies = game.config.profiles.filter((_, j) => j !== playerIdx);

  return (
    <div className="cmd-strip" title="Commander damage taken from each enemy commander">
      {enemies.map((profile) => (
        <Bubble
          key={profile.id}
          playerIdx={playerIdx}
          attackerId={profile.id}
          attackerName={profile.name}
          attackerAvatar={profile.avatarUrl}
          showIdentity={enemies.length > 1}
          damage={player.commanderDamage[profile.id] ?? 0}
        />
      ))}
    </div>
  );
}
