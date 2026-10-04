import { useState } from 'react';
import { useAppStore } from '../state/store';
import DiceRoller from './DiceRoller';
import RulesViewer from './RulesViewer';
import SettingsSheet from './SettingsSheet';

type Sheet = 'dice' | 'rules' | 'settings' | 'menu' | null;

export default function CenterHub() {
  const game = useAppStore((s) => s.game);
  const passTurn = useAppStore((s) => s.passTurn);
  const endGame = useAppStore((s) => s.endGame);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

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
      <div className="hub-icons">
        <button aria-label="dice" title="Dice" onClick={() => setSheet('dice')}>
          🎲
        </button>
        <button aria-label="rules" title="Rules" onClick={() => setSheet('rules')}>
          📖
        </button>
        <button aria-label="settings" title="Settings" onClick={() => setSheet('settings')}>
          ⚙️
        </button>
        <button aria-label="menu" title="Menu" onClick={() => setSheet('menu')}>
          ☰
        </button>
      </div>

      {sheet === 'dice' && <DiceRoller onClose={() => setSheet(null)} />}
      {sheet === 'rules' && <RulesViewer onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet onClose={() => setSheet(null)} />}
      {sheet === 'menu' && (
        <div className="modal-backdrop" onClick={() => setSheet(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Menu</h2>
            {confirmEnd ? (
              <>
                <p>End this game for everyone?</p>
                <div className="modal-actions">
                  <button className="danger" onClick={endGame}>
                    Yes, end it
                  </button>
                  <button className="ghost" onClick={() => setConfirmEnd(false)}>
                    Keep playing
                  </button>
                </div>
              </>
            ) : (
              <div className="modal-actions">
                <button onClick={() => setConfirmEnd(true)}>End game</button>
                <button className="ghost" onClick={() => setSheet(null)}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
