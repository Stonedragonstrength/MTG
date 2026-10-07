import { useState } from 'react';
import type { ManaColor } from '../lib/mana';
import { useAppStore } from '../state/store';
import BattlefieldRow from './BattlefieldRow';
import BoardStrip from './BoardStrip';
import CenterHub from './CenterHub';
import CommanderDamage from './CommanderDamage';
import HandTray from './HandTray';
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
  edge?: string;
  focused?: boolean;
  showHub?: boolean;
}

export default function PlayerZone({
  playerIdx,
  edge,
  focused = false,
  showHub = false,
}: Props) {
  const game = useAppStore((s) => s.game);
  const adjustLife = useAppStore((s) => s.adjustLife);
  const flipped = useAppStore((s) => s.seatFlips[playerIdx] === true);
  const [sheetOpen, setSheetOpen] = useState(false);
  if (!game) return null;

  const player = game.players[playerIdx];
  const profile = game.config.profiles[playerIdx];
  const isActive = game.activePlayerIndex === playerIdx;
  const identity = profile.commanderColors ?? [];
  const accent = identity.length === 1 ? ACCENTS[identity[0]] : undefined;

  const classes = [
    'zone',
    `seat-${playerIdx}`,
    edge ? `edge-${edge}` : '',
    player.eliminated ? 'zone--dead' : '',
    isActive && !player.eliminated ? 'zone--active' : '',
    focused ? 'zone--focused' : '',
    player.cards ? 'zone--cards' : '', // compact chrome: the cards need the room
    flipped ? 'zone--flipped' : '', // drawn turned around on this device ("Flip this side")
    showHub && !focused ? 'zone--hub' : '', // a slim bar carrying the pinned turn bar
  ]
    .filter(Boolean)
    .join(' ');

  const chips: { key: string; label: string; className?: string }[] = [];
  // Virtual seats wear their card counts up top — table-glance info.
  if (player.cards) {
    // chip-cards: collapsed side bars drop these two for room.
    chips.push({ key: 'hand', label: `✋${player.cards.hand.length}`, className: 'chip-cards' });
    chips.push({
      key: 'library',
      label: `📚${player.cards.library.length}`,
      className: 'chip-cards',
    });
  }
  const poison = player.counters['poison'] ?? 0;
  const energy = player.counters['energy'] ?? 0;
  const experience = player.counters['experience'] ?? 0;
  if (poison > 0) chips.push({ key: 'poison', label: `☠${poison}`, className: 'chip-poison' });
  if (energy > 0) chips.push({ key: 'energy', label: `⚡${energy}` });
  if (experience > 0) chips.push({ key: 'exp', label: `✦${experience}` });
  // Seats that track tax per commander wear it on each pedestal instead —
  // a pair's deaths added together would be nobody's actual tax.
  if (player.commanderDeaths > 0 && !player.cards?.cmd)
    chips.push({ key: 'tax', label: `tax +${player.commanderDeaths * 2}` });

  return (
    <section className={classes} style={accent ? { borderColor: accent } : undefined}>
      <header className="zone-header">
        <span className="zone-id">
          {profile.avatarUrl ? (
            <img className="avatar avatar--small" src={profile.avatarUrl} alt="" />
          ) : (
            <div className="avatar avatar--small avatar--empty" />
          )}
          <button
            className="player-more"
            aria-label={`${profile.name} counters and badges`}
            onClick={(e) => {
              e.stopPropagation();
              setSheetOpen(true);
            }}
          >
            ☰
          </button>
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
        {chips.length > 0 && (
          <span className="zone-chips" onClick={(e) => e.stopPropagation()}>
            {chips.map((chip) => (
              <span key={chip.key} className={`player-chip ${chip.className ?? ''}`}>
                {chip.label}
              </span>
            ))}
          </span>
        )}
        {showHub && (
          <span className="header-hub" onClick={(e) => e.stopPropagation()}>
            <CenterHub variant="row" seat={playerIdx} compact={!focused} />
          </span>
        )}
        <span className="lifewrap" onClick={(e) => e.stopPropagation()}>
          <LifeCounter life={player.life} onAdjust={(delta) => adjustLife(playerIdx, delta)} />
          {game.config.format === 'commander' && <CommanderDamage playerIdx={playerIdx} />}
        </span>
      </header>
      {player.cards && <BattlefieldRow playerIdx={playerIdx} />}
      <BoardStrip playerIdx={playerIdx} />
      <LandsRow playerIdx={playerIdx} />
      {player.cards && <HandTray playerIdx={playerIdx} />}
      {player.eliminated && <div className="dead-overlay">DEFEATED</div>}
      {sheetOpen && <PlayerSheet playerIdx={playerIdx} onClose={() => setSheetOpen(false)} />}
    </section>
  );
}
