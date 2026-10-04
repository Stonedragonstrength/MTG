import { useState } from 'react';
import { useAppStore } from '../state/store';
import DiceRoller from './DiceRoller';
import RulesViewer from './RulesViewer';
import SettingsSheet from './SettingsSheet';
import Sheet from './Sheet';

type SheetName = 'dice' | 'rules' | 'settings' | 'end' | null;

export default function CenterHub() {
  const game = useAppStore((s) => s.game);
  const passTurn = useAppStore((s) => s.passTurn);
  const endGame = useAppStore((s) => s.endGame);
  const [sheet, setSheet] = useState<SheetName>(null);

  if (!game) return null;
  const active = game.config.profiles[game.activePlayerIndex];

  return (
    <div className="center-hub">
      <div className="hub-turn">
        <span className="hub-turn-number">Turn {game.turnNumber}</span>
        <span className="hub-active">{active.name}</span>
      </div>
      <button className="hub-pass" onClick={passTurn}>
        Pass turn
      </button>
      <div className="hub-actions">
        <button aria-label="dice" onClick={() => setSheet('dice')}>
          <span className="hub-icon">🎲</span>
          <span className="hub-label">Dice</span>
        </button>
        <button aria-label="rules" onClick={() => setSheet('rules')}>
          <span className="hub-icon">📖</span>
          <span className="hub-label">Rules</span>
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
