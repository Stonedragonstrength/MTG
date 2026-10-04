import { useState } from 'react';
import type { ManaColor } from '../lib/mana';
import { useAppStore } from '../state/store';
import BoardStrip from './BoardStrip';
import CenterHub from './CenterHub';
import CommanderDamage from './CommanderDamage';
import DiceRoller from './DiceRoller';
import LandsRow from './LandsRow';
import LifeCounter from './LifeCounter';
import PlayerSheet from './PlayerSheet';

const ACCENTS: Record<string, string> = {
  W: '#e8e3d0',
  U: '#5a9bd4',
  B: '#9a8fa8',
  R: '#d4705a',
  G: '#6aa877',
};

interface Props {
  playerIdx: number;
  focused?: boolean;
  showHub?: boolean;
  onToggleFocus?: () => void;
}

export default function PlayerZone({
  playerIdx,
  focused = false,
  showHub = false,
  onToggleFocus,
}: Props) {
  const game = useAppStore((s) => s.game);
  const adjustLife = useAppStore((s) => s.adjustLife);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [diceOpen, setDiceOpen] = useState(false);
  if (!game) return null;

  const player = game.players[playerIdx];
  const profile = game.config.profiles[playerIdx];
  const isActive = game.activePlayerIndex === playerIdx;
  const identity = profile.commanderColors ?? [];
  const accent = identity.length === 1 ? ACCENTS[identity[0]] : undefined;

  const classes = [
    'zone',
    `seat-${playerIdx}`,
    player.eliminated ? 'zone--dead' : '',
    isActive && !player.eliminated ? 'zone--active' : '',
    focused ? 'zone--focused' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const chips: { key: string; label: string; className?: string }[] = [];
  const poison = player.counters['poison'] ?? 0;
  const energy = player.counters['energy'] ?? 0;
  const experience = player.counters['experience'] ?? 0;
  if (poison > 0) chips.push({ key: 'poison', label: `☠${poison}`, className: 'chip-poison' });
  if (energy > 0) chips.push({ key: 'energy', label: `⚡${energy}` });
  if (experience > 0) chips.push({ key: 'exp', label: `✦${experience}` });
  if (player.commanderDeaths > 0)
    chips.push({ key: 'tax', label: `tax +${player.commanderDeaths * 2}` });

  return (
    <section className={classes} style={accent ? { borderColor: accent } : undefined}>
      <header className="zone-header" onClick={onToggleFocus}>
        <span className="zone-id">
          {profile.avatarUrl ? (
            <img className="avatar avatar--small" src={profile.avatarUrl} alt="" />
          ) : (
            <div className="avatar avatar--small avatar--empty" />
          )}
          <span className="zone-name">{profile.name}</span>
          {game.monarchIdx === playerIdx && (
            <span className="badge-monarch" title="The Monarch">
              👑
            </span>
          )}
          {game.initiativeIdx === playerIdx && (
            <span className="badge-initiative" title="Has the Initiative">
              🗡
            </span>
          )}
          {identity.map((c) => (
            <span key={c} className={`mana-pip mana-pip--mini mana-${c as ManaColor}`} />
          ))}
        </span>
        <span className="zone-chips" onClick={(e) => e.stopPropagation()}>
          {chips.map((chip) => (
            <span key={chip.key} className={`player-chip ${chip.className ?? ''}`}>
              {chip.label}
            </span>
          ))}
          <button
            className="player-more"
            aria-label={`${profile.name} counters and badges`}
            onClick={() => setSheetOpen(true)}
          >
            ☰
          </button>
        </span>
        {showHub && (
          <span className="header-hub" onClick={(e) => e.stopPropagation()}>
            <CenterHub variant="row" />
          </span>
        )}
        {game.config.format === 'commander' && (
          <span onClick={(e) => e.stopPropagation()}>
            <CommanderDamage playerIdx={playerIdx} />
          </span>
        )}
        <LifeCounter life={player.life} onAdjust={(delta) => adjustLife(playerIdx, delta)} />
      </header>
      <button
        className="zone-dice"
        aria-label="dice roller"
        onClick={(e) => {
          e.stopPropagation();
          setDiceOpen(true);
        }}
      >
        🎲
      </button>
      <BoardStrip playerIdx={playerIdx} />
      <LandsRow playerIdx={playerIdx} />
      {player.eliminated && <div className="dead-overlay">DEFEATED</div>}
      {sheetOpen && <PlayerSheet playerIdx={playerIdx} onClose={() => setSheetOpen(false)} />}
      {diceOpen && <DiceRoller onClose={() => setDiceOpen(false)} />}
    </section>
  );
}
