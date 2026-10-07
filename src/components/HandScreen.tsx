import { useEffect } from 'react';
import { handLine } from '../lib/combatView';
import { useAppStore } from '../state/store';
import BattlefieldRow from './BattlefieldRow';
import HandTray from './HandTray';
import LandsRow from './LandsRow';
import LifeCounter from './LifeCounter';

interface Props {
  seatIdx: number;
  onShowTable: () => void;
}

/** Phone-as-hand: your cards first, the table at a glance. The whole
 * screen is your seat — the glance strip is everyone else's. While it's
 * open the shared table collapses this hand's tray to a hint. */
export default function HandScreen({ seatIdx, onShowTable }: Props) {
  const game = useAppStore((s) => s.game);
  const adjustLife = useAppStore((s) => s.adjustLife);
  const setHandHeld = useAppStore((s) => s.setHandHeld);

  useEffect(() => {
    setHandHeld(seatIdx, true);
    // pagehide is the last breath a dying PWA reliably gets — release the
    // hand there too, so an OS-killed phone doesn't wedge the table's tray.
    const release = () => setHandHeld(seatIdx, false);
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
      setHandHeld(seatIdx, false);
    };
  }, [seatIdx, setHandHeld]);

  if (!game) return null;
  const me = game.players[seatIdx];
  if (!me?.cards) return null;
  // No picking here in this version (this screen draws no tokens and has no
  // Undo): a fight that involves this seat is one line, and the line is the
  // way to the table.
  const fightLine = handLine(game, seatIdx);

  return (
    <div className="hand-screen">
      <header className="hs-glance">
        {game.players.map((p, i) => {
          const prof = game.config.profiles[i];
          const classes = [
            'hs-player',
            i === seatIdx ? 'hs-player--me' : '',
            i === game.activePlayerIndex ? 'hs-player--active' : '',
            p.eliminated ? 'hs-player--dead' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <span key={p.profileId} className={classes}>
              <span className="hs-name">{prof?.name ?? '?'}</span>
              <span className="hs-life">{p.life}</span>
              {p.cards && (
                <span className="hs-counts">
                  ✋{p.cards.hand.length} 📚{p.cards.library.length}
                </span>
              )}
              {game.monarchIdx === i && (
                <span className="badge-monarch" title="The Monarch">
                  👑
                </span>
              )}
              {game.initiativeIdx === i && (
                <span className="badge-initiative" title="Has the Initiative">
                  🗡
                </span>
              )}
            </span>
          );
        })}
      </header>
      {fightLine && (
        <button className="hs-combat" aria-label={`${fightLine} — see table`} onClick={onShowTable}>
          <span aria-hidden="true">⚔ </span>
          {fightLine}
        </button>
      )}
      <section className="hs-board">
        <BattlefieldRow playerIdx={seatIdx} picks={false} />
        <LandsRow playerIdx={seatIdx} attackButton={false} />
      </section>
      <section className="hs-life-row" aria-label="my life">
        <LifeCounter life={me.life} onAdjust={(delta) => adjustLife(seatIdx, delta)} />
        <button className="ghost hs-table-btn" onClick={onShowTable}>
          See table
        </button>
      </section>
      <HandTray playerIdx={seatIdx} forceFanned />
    </div>
  );
}
