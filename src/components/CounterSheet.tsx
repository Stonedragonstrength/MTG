import { useEffect, useState } from 'react';
import { counterTargets, stackNow } from '../lib/counterspells';
import { affordable, parseCost } from '../lib/pay';
import { seatSources } from '../lib/seatMana';
import type { SpellPrompt } from '../lib/spellEffects';
import type { StackSpell } from '../lib/types';
import { useAppStore } from '../state/store';
import { CostSymbols } from './ManaSymbol';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import { useTableRecords } from './useCombat';
import { useSettleTaps } from './useSettleTaps';

interface Props {
  /** Whose counterspell it is. */
  caster: number;
  /** The card that counters, by name: Counterspell, Mystic Snake. */
  source: string;
  /** That card, where it is one of the spells cast this turn (Mystic Snake
   * on the battlefield): it is not offered as its own target. */
  sourceIid?: string;
  /** The cast it belongs to, when it is a spell's: put aside (another
   * spell, an Undo), the list closes with it. */
  revealId?: string;
  prompt: Extract<SpellPrompt, { kind: 'counter' }>;
  /** What the counterspell was cast for: "unless its controller pays {X}". */
  x?: number;
  /** It countered something, or the spell's controller paid: its button is done. */
  onDone: () => void;
  onClose: () => void;
}

/** What a counterspell answers: the spells cast this turn, newest first —
 * the one just cast on top, where it nearly always is. A tap on one counters
 * it. "Unless its controller pays {3}" asks first: that player pays from
 * their lands and the spell stands, or does not and it is countered. A
 * spell that can't be countered, or is not the kind it names, is shown
 * with its reason and cannot be picked. */
export default function CounterSheet({ caster, source, sourceIid, revealId, prompt, x, onDone, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const counterSpell = useAppStore((s) => s.counterSpell);
  const payForSpell = useAppStore((s) => s.payForSpell);
  // It opens under the finger that pressed the banner's button: the rest
  // of that tap must not pick a row.
  useSettleTaps();
  const spells = game ? stackNow(game) : [];
  const records = useCardRecords(spells);
  const table = useTableRecords();
  const [chosen, setChosen] = useState<string | null>(null);
  // The cast was put aside meanwhile (another spell, an Undo): really close.
  const gone = revealId !== undefined && game?.reveal?.id !== revealId;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!game || gone) return null;

  // The counterspell's own cast is not one of its targets.
  const self = (revealId ? spells.find((s) => s.reveal === revealId)?.iid : undefined) ?? sourceIid;
  const targets = counterTargets(game, records, prompt.what, { iid: self });
  const name = (seat: number) => game.config.profiles[seat]?.name ?? '?';
  const picked = targets.find((t) => t.spell.id === chosen && !t.not)?.spell ?? null;

  // "Unless its controller pays {3}" ({X}: what the counterspell was cast for).
  const unless = prompt.unless && x !== undefined ? prompt.unless.replace(/\{X\}/g, `{${x}}`) : prompt.unless;
  const cost = unless ? parseCost(unless) : null;

  const counter = (spell: StackSpell) => {
    counterSpell(caster, source, spell.id, prompt.to);
    onDone();
  };
  const pick = (spell: StackSpell) => {
    if (unless) setChosen(spell.id);
    else counter(spell);
  };

  // Can their untapped mana cover it?
  const canPay =
    picked && cost ? affordable(cost, seatSources(game, picked.seat, { ...table, ...records })) : false;

  return (
    <Sheet
      title={`${source}: ${prompt.label.replace(/…$/, '')}`}
      onClose={onClose}
      footer={
        <button className="ghost" onClick={() => onClose()}>
          Not now
        </button>
      }
    >
      {targets.length === 0 ? (
        <p className="hint">No spell cast this turn for it to counter.</p>
      ) : (
        <ul className="attach-list">
          {targets.map(({ spell, not }) => {
            const read = records[spell.cardId];
            const art = read?.imageArtCrop ?? read?.imageNormal ?? null;
            const whose = spell.seat === caster ? 'yours' : `${name(spell.seat)}’s`;
            return (
              <li key={spell.id}>
                <button
                  className={spell.id === picked?.id ? 'attach-row attach-row--on' : 'attach-row'}
                  aria-label={not ? `${spell.name} — ${not}` : `counter ${spell.name}`}
                  aria-pressed={unless ? spell.id === picked?.id : undefined}
                  disabled={!!not}
                  onClick={() => pick(spell)}
                >
                  {art ? <img className="pile-art" src={art} alt="" loading="lazy" /> : <span className="pile-art pile-art--empty" />}
                  <span className="pile-name">
                    {spell.name}
                    <small className="counter-whose"> {whose}</small>
                  </span>
                  {not && <span className="spell-fate spell-fate--survives">{not}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {picked && cost && unless && (
        <div className="detail-section counter-unless">
          <span className="section-label">
            Does {picked.seat === caster ? 'you' : name(picked.seat)} pay <CostSymbols cost={cost} />?
          </span>
          {!canPay && <p className="hint">Their untapped mana can’t cover it.</p>}
          <div className="chip-row">
            <button
              className="chip"
              onClick={() => {
                void payForSpell(picked.id, unless, source);
                onDone();
              }}
            >
              {picked.seat === caster ? 'I pay' : `${name(picked.seat)} pays`} {unless}
            </button>
            <button className="chip chip--primary" onClick={() => counter(picked)}>
              No — counter {picked.name}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
