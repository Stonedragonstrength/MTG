import { useEffect, useRef, useState } from 'react';
import { liveCombat } from '../lib/combat';
import { useAppStore } from '../state/store';
import CombatSheet from './CombatSheet';
import DiceRoller from './DiceRoller';
import GameLogSheet from './GameLogSheet';
import RulesViewer from './RulesViewer';
import SettingsSheet from './SettingsSheet';
import Sheet from './Sheet';
import StackSheet from './StackSheet';
import { useConfirmTap } from './useConfirmTap';

type SheetName =
  | 'dice'
  | 'rules'
  | 'settings'
  | 'end'
  | 'log'
  | 'combat'
  | 'stack'
  | 'more'
  | null;

/** A tap this soon after the one before is the second half of a double tap, not
 * a second decision. It matters where the hub stays put under the finger: Pass
 * turn does not move away after a pass ("Turn bar stays put"), and "End" picked
 * in the options sheet opens its question right where that sheet was. */
const STRAY_TAP_MS = 600;
/** How long "End combat and pass?" waits for its answer before it is Pass turn again. */
const PASS_ASK_MS = 5000;

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
  /** The seat whose zone the hub is docked in. With "Turn bar stays put" that
   * is not always the active player's, and then the hub says whose turn it is. */
  seat?: number;
  /** Docked in a collapsed bar, which cannot grow: "More" opens the options in
   * a sheet instead of unfolding them in place. */
  compact?: boolean;
}

export default function CenterHub({ variant = 'overlay', seat, compact = false }: Props) {
  const game = useAppStore((s) => s.game);
  const passTurn = useAppStore((s) => s.passTurn);
  const endGame = useAppStore((s) => s.endGame);
  const undo = useAppStore((s) => s.undo);
  const canUndo = useAppStore((s) => s.canUndo);
  const turnTimerOn = useAppStore((s) => s.settings.turnTimerOn);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const passedAt = useRef<number | null>(null);
  const endPickedAt = useRef<number | null>(null);
  // A pinned hub stays mounted while its zone collapses and grows back with the
  // turn: a tray left unfolded must not sit there waiting to reappear.
  useEffect(() => setTrayOpen(false), [compact]);
  // Passing the turn ends whatever fight is on the table, with other players'
  // picks in it: while one is live, Pass turn asks in place first.
  const fightId = (game && liveCombat(game)?.id) ?? null;
  const endsFight = useConfirmTap();
  const asking = endsFight.armed;
  useEffect(() => {
    if (!asking) return;
    // A question nobody answers stands down; so does one whose fight is over.
    const t = window.setTimeout(endsFight.disarm, PASS_ASK_MS);
    return () => {
      window.clearTimeout(t);
      endsFight.disarm();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, fightId]);

  if (!game) return null;

  function openSheet(name: SheetName) {
    setTrayOpen(false);
    setSheet(name);
  }

  // A double tap passes once: the second half would skip the next player.
  function pass(tap: { timeStamp: number }) {
    if (passedAt.current !== null && tap.timeStamp - passedAt.current < STRAY_TAP_MS) return;
    if (fightId !== null && !endsFight.confirms(tap)) return; // armed: the next tap answers
    passedAt.current = tap.timeStamp;
    passTurn();
  }

  function askToEnd(tap: { timeStamp: number }) {
    endPickedAt.current = sheet === 'more' ? tap.timeStamp : null;
    openSheet('end');
  }

  function confirmEnd(tap: { timeStamp: number }) {
    const picked = endPickedAt.current;
    if (picked !== null && tap.timeStamp - picked < STRAY_TAP_MS) return;
    endGame();
  }

  const whose =
    seat !== undefined && seat !== game.activePlayerIndex
      ? game.config.profiles[game.activePlayerIndex]?.name
      : undefined;
  const unfolded = trayOpen && !compact;

  // The same options either way: unfolded under the hub, or in a sheet of their own.
  const options = (
    <>
      {/* The arithmetic sheet. The fight on the cards starts from the lands line ("⚔ Attack"). */}
      <button aria-label="combat math" onClick={() => openSheet('combat')}>
        <span className="hub-icon">⚔️</span>
        <span className="hub-label">Combat math</span>
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
      <button aria-label="end game" onClick={askToEnd}>
        <span className="hub-icon">🏳️</span>
        <span className="hub-label">End</span>
      </button>
    </>
  );

  return (
    <div
      className={`center-hub${variant === 'row' ? ' center-hub--row' : ''}${compact ? ' center-hub--compact' : ''}`}
    >
      <div className="hub-main">
        <div className="hub-turn">
          <span className="hub-turn-number">
            Turn {game.turnNumber}
            {whose && (
              <span className="hub-whose">
                <span className="hub-sep">{' · '}</span>
                <span className="hub-whose-name">{whose}</span>
              </span>
            )}
            {turnTimerOn && (
              <>
                {' · '}
                <TurnClock since={game.turnStartedAt} />
              </>
            )}
          </span>
        </div>
        <button className={`hub-pass${asking && fightId !== null ? ' hub-pass--asking' : ''}`} onClick={pass}>
          {asking && fightId !== null ? 'End combat and pass?' : 'Pass turn'}
        </button>
        <div className="hub-actions">
          <button aria-label="undo" disabled={!canUndo()} onClick={undo}>
            <span className="hub-icon">↩️</span>
            <span className="hub-label">Undo</span>
          </button>
          <button
            aria-label="more options"
            aria-expanded={compact ? sheet === 'more' : trayOpen}
            onClick={() => (compact ? setSheet('more') : setTrayOpen((o) => !o))}
          >
            <span className="hub-icon">{unfolded ? '✕' : '⋯'}</span>
            <span className="hub-label">{unfolded ? 'Close' : 'More'}</span>
          </button>
        </div>
      </div>

      {unfolded && <div className="hub-tray">{options}</div>}

      {sheet === 'more' && (
        <Sheet title="More" onClose={() => setSheet(null)}>
          <div className="hub-tray hub-tray--sheet">{options}</div>
        </Sheet>
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
              <button className="danger" onClick={confirmEnd}>
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
