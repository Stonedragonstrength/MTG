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

export default function CenterHub() {
  const game = useAppStore((s) => s.game);
  const passTurn = useAppStore((s) => s.passTurn);
  const endGame = useAppStore((s) => s.endGame);
  const undo = useAppStore((s) => s.undo);
  const canUndo = useAppStore((s) => s.canUndo);
  const turnTimerOn = useAppStore((s) => s.settings.turnTimerOn);
  const [sheet, setSheet] = useState<SheetName>(null);

  if (!game) return null;
  const active = game.config.profiles[game.activePlayerIndex];

  return (
    <div className="center-hub">
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
        <span className="hub-active">{active.name}</span>
      </div>
      <button className="hub-pass" onClick={passTurn}>
        Pass turn
      </button>
      <div className="hub-actions">
        <button aria-label="undo" disabled={!canUndo()} onClick={undo}>
          <span className="hub-icon">↩️</span>
          <span className="hub-label">Undo</span>
        </button>
        <button aria-label="combat math" onClick={() => setSheet('combat')}>
          <span className="hub-icon">⚔️</span>
          <span className="hub-label">Combat</span>
        </button>
        <button aria-label="the stack" onClick={() => setSheet('stack')}>
          <span className="hub-icon">🌀</span>
          <span className="hub-label">Stack</span>
        </button>
        <button aria-label="dice" onClick={() => setSheet('dice')}>
          <span className="hub-icon">🎲</span>
          <span className="hub-label">Dice</span>
        </button>
        <button aria-label="rules" onClick={() => setSheet('rules')}>
          <span className="hub-icon">📖</span>
          <span className="hub-label">Rules</span>
        </button>
        <button aria-label="game log" onClick={() => setSheet('log')}>
          <span className="hub-icon">📜</span>
          <span className="hub-label">Log</span>
        </button>
        <button aria-label="settings" onClick={() => setSheet('settings')}>
          <span className="hub-icon">⚙️</span>
          <span className="hub-label">Settings</span>
        </button>
        <button aria-label="end game" onClick={() => setSheet('end')}>
          <span className="hub-icon">🏳️</span>
          <span className="hub-label">End</span>
        </button>
      </div>

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
