import { useEffect, useState } from 'react';
import { useAppStore } from '../state/store';
import CombatSheet from './CombatSheet';
import DiceRoller from './DiceRoller';
import GameLogSheet from './GameLogSheet';
import RulesViewer from './RulesViewer';
import SettingsSheet from './SettingsSheet';
import Sheet from './Sheet';
import StackSheet from './StackSheet';

type SheetName = 'dice' | 'rules' | 'settings' | 'end' | 'log' | 'combat' | 'stack' | null;

function TurnClock({ since }: { since: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const m = Math.floor(elapsed / 60);
  const s = String(elapsed % 60).padStart(2, '0');
  return (
    <span className="turn-clock" data-testid="turn-clock">
      {m}:{s}
    </span>
  );
}

interface Props {
  /** 'overlay' floats centered over the table; 'row' docks inside a zone. */
  variant?: 'overlay' | 'row';
}

export default function CenterHub({ variant = 'overlay' }: Props) {
  const game = useAppStore((s) => s.game);
  const passTurn = useAppStore((s) => s.passTurn);
  const endGame = useAppStore((s) => s.endGame);
  const undo = useAppStore((s) => s.undo);
  const canUndo = useAppStore((s) => s.canUndo);
  const turnTimerOn = useAppStore((s) => s.settings.turnTimerOn);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [trayOpen, setTrayOpen] = useState(false);

  if (!game) return null;

  function openSheet(name: SheetName) {
    setTrayOpen(false);
    setSheet(name);
  }

  return (
    <div className={`center-hub${variant === 'row' ? ' center-hub--row' : ''}`}>
      <div className="hub-main">
        <div className="hub-turn">
          <span className="hub-turn-number">
            Turn {game.turnNumber}
            {turnTimerOn && (
              <>
                {' · '}
                <TurnClock since={game.turnStartedAt} />
              </>
            )}
          </span>
        </div>
        <button className="hub-pass" onClick={passTurn}>
          Pass turn
        </button>
        <div className="hub-actions">
          <button aria-label="undo" disabled={!canUndo()} onClick={undo}>
            <span className="hub-icon">↩️</span>
            <span className="hub-label">Undo</span>
          </button>
          <button
            aria-label="more options"
            aria-expanded={trayOpen}
            onClick={() => setTrayOpen((o) => !o)}
          >
            <span className="hub-icon">{trayOpen ? '✕' : '⋯'}</span>
            <span className="hub-label">{trayOpen ? 'Close' : 'More'}</span>
          </button>
        </div>
      </div>

      {trayOpen && (
        <div className="hub-tray">
          <button aria-label="combat math" onClick={() => openSheet('combat')}>
            <span className="hub-icon">⚔️</span>
            <span className="hub-label">Combat</span>
          </button>
          <button aria-label="the stack" onClick={() => openSheet('stack')}>
            <span className="hub-icon">🌀</span>
            <span className="hub-label">Stack</span>
          </button>
          <button aria-label="dice" onClick={() => openSheet('dice')}>
            <span className="hub-icon">🎲</span>
            <span className="hub-label">Dice</span>
          </button>
          <button aria-label="rules" onClick={() => openSheet('rules')}>
            <span className="hub-icon">📖</span>
            <span className="hub-label">Rules</span>
          </button>
          <button aria-label="game log" onClick={() => openSheet('log')}>
            <span className="hub-icon">📜</span>
            <span className="hub-label">Log</span>
          </button>
          <button aria-label="settings" onClick={() => openSheet('settings')}>
            <span className="hub-icon">⚙️</span>
            <span className="hub-label">Settings</span>
          </button>
          <button aria-label="end game" onClick={() => openSheet('end')}>
            <span className="hub-icon">🏳️</span>
            <span className="hub-label">End</span>
          </button>
        </div>
      )}

      {sheet === 'dice' && <DiceRoller onClose={() => setSheet(null)} />}
      {sheet === 'rules' && <RulesViewer onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet onClose={() => setSheet(null)} />}
      {sheet === 'log' && <GameLogSheet onClose={() => setSheet(null)} />}
      {sheet === 'combat' && <CombatSheet onClose={() => setSheet(null)} />}
      {sheet === 'stack' && <StackSheet onClose={() => setSheet(null)} />}
      {sheet === 'end' && (
        <Sheet
          title="End this game?"
          onClose={() => setSheet(null)}
          footer={
            <>
              <button className="danger" onClick={endGame}>
                Yes, end it
              </button>
              <button className="ghost" onClick={() => setSheet(null)}>
                Keep playing
              </button>
            </>
          }
        >
          <p>The game ends for everyone. Player profiles are kept.</p>
        </Sheet>
      )}
    </div>
  );
}
