import { useAppStore } from '../state/store';
import BoardStrip from './BoardStrip';
import CommanderDamage from './CommanderDamage';
import LandsRow from './LandsRow';
import LifeCounter from './LifeCounter';

interface Props {
  playerIdx: number;
  focused?: boolean;
  onToggleFocus?: () => void;
}

export default function PlayerZone({ playerIdx, focused = false, onToggleFocus }: Props) {
  const game = useAppStore((s) => s.game);
  const adjustLife = useAppStore((s) => s.adjustLife);
  if (!game) return null;

  const player = game.players[playerIdx];
  const profile = game.config.profiles[playerIdx];
  const isActive = game.activePlayerIndex === playerIdx;

  const classes = [
    'zone',
    `seat-${playerIdx}`,
    player.eliminated ? 'zone--dead' : '',
    isActive && !player.eliminated ? 'zone--active' : '',
    focused ? 'zone--focused' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes}>
      <header className="zone-header" onClick={onToggleFocus}>
        <span className="zone-id">
          {profile.avatarUrl ? (
            <img className="avatar avatar--small" src={profile.avatarUrl} alt="" />
          ) : (
            <div className="avatar avatar--small avatar--empty" />
          )}
          <span className="zone-name">{profile.name}</span>
        </span>
        {game.config.format === 'commander' && (
          <span onClick={(e) => e.stopPropagation()}>
            <CommanderDamage playerIdx={playerIdx} />
          </span>
        )}
        <LifeCounter life={player.life} onAdjust={(delta) => adjustLife(playerIdx, delta)} />
      </header>
      <BoardStrip playerIdx={playerIdx} />
      <LandsRow playerIdx={playerIdx} />
      {player.eliminated && <div className="dead-overlay">DEFEATED</div>}
    </section>
  );
}
