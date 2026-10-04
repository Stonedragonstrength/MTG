import { useAppStore } from '../state/store';
import CommanderDamage from './CommanderDamage';
import LifeCounter from './LifeCounter';

interface Props {
  playerIdx: number;
}

export default function PlayerZone({ playerIdx }: Props) {
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
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes}>
      <header className="zone-header">
        {profile.avatarUrl ? (
          <img className="avatar avatar--small" src={profile.avatarUrl} alt="" />
        ) : (
          <div className="avatar avatar--small avatar--empty" />
        )}
        <span className="zone-name">{profile.name}</span>
      </header>
      <LifeCounter life={player.life} onAdjust={(delta) => adjustLife(playerIdx, delta)} />
      {game.config.format === 'commander' && <CommanderDamage playerIdx={playerIdx} />}
      <div className="board-strip-slot" data-player={playerIdx} />
      {player.eliminated && <div className="dead-overlay">DEFEATED</div>}
    </section>
  );
}
