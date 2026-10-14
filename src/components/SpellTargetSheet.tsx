import { useEffect, useState } from 'react';
import { opponentsOf, spellChoices, type SpellPrompt, type SpellTarget } from '../lib/spellEffects';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useTableRecords } from './useCombat';
import { useSettleTaps } from './useSettleTaps';

interface Props {
  /** Whose effect it is: "you" in its text. */
  caster: number;
  /** The card it is an effect of, by name. */
  spell: string;
  /** The cast it belongs to, when it is a spell's: put aside (another
   * spell, an Undo), the list closes with it. */
  revealId?: string;
  /** The effect being pointed at something. */
  prompt: SpellPrompt;
  /** A row was tapped: the caller applies the effect and closes this. */
  onPick: (target: SpellTarget) => void;
  onClose: () => void;
}

/** What a spell's effect is pointed at: one list, a tab per player. What
 * hurts opens on the first opponent's side, what helps on the caster's
 * own. Where players can be hit, the player is the first row; then that
 * side's permanents of the kinds the card names. A tap on a row does it.
 * No picking on the board: the list is the whole of it. */
export default function SpellTargetSheet({ caster, spell, revealId, prompt, onPick, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const helps =
    prompt.kind === 'counters' || prompt.kind === 'draw' || (prompt.kind === 'pump' && prompt.power + prompt.toughness >= 0);
  const [tab, setTab] = useState(() => (helps || !game ? caster : (opponentsOf(game, caster)[0] ?? caster)));
  // It opens under the finger that pressed the banner's button: the rest
  // of that tap must not pick a row.
  useSettleTaps();
  const records = useTableRecords();
  // The cast was put aside meanwhile (another spell, an Undo): really close.
  const gone = revealId !== undefined && game?.reveal?.id !== revealId;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!game || gone) return null;

  // The caster's own side first, then the others in turn order.
  const seats = game.players.map((_, i) => (caster + i) % game.players.length);
  const shown = seats.includes(tab) ? tab : caster;
  const choices = spellChoices(game, shown, prompt, caster, records);

  return (
    <Sheet
      title={`${spell}: ${prompt.label.replace(/…$/, '')}`}
      onClose={onClose}
      footer={
        <button className="ghost" onClick={() => onClose()}>
          Not now
        </button>
      }
    >
      {seats.length > 1 && (
        <div role="tablist" className="segmented attach-tabs">
          {seats.map((seat) => (
            <button
              key={seat}
              role="tab"
              aria-selected={seat === shown}
              className={seat === shown ? 'segment active' : 'segment'}
              onClick={() => setTab(seat)}
            >
              {seat === caster ? 'Mine' : (game.config.profiles[seat]?.name ?? '?')}
            </button>
          ))}
        </div>
      )}
      {choices.length === 0 ? (
        <p className="hint">Nothing here it can be pointed at.</p>
      ) : (
        <ul className="attach-list">
          {choices.map((choice) => {
            const t = choice.target;
            return (
              <li key={t.kind === 'player' ? 'player' : `${t.kind}:${t.id}`}>
                <button
                  className={t.kind === 'player' ? 'attach-row spell-row--player' : 'attach-row'}
                  aria-label={choice.fate ? `${choice.name} — ${choice.fate}` : choice.name}
                  onClick={() => onPick(t)}
                >
                  {choice.art ? (
                    <img className="pile-art" src={choice.art} alt="" loading="lazy" />
                  ) : (
                    <span className="pile-art pile-art--empty" />
                  )}
                  <span className="pile-name">{choice.name}</span>
                  {choice.size && <span className="attach-size">{choice.size}</span>}
                  {choice.fate && <span className={`spell-fate spell-fate--${choice.fate}`}>{choice.fate}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
