import { affordable } from '../lib/pay';
import { seatSources } from '../lib/seatMana';
import { wardWords, type Ward } from '../lib/ward';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useTableRecords } from './useCombat';

interface Props {
  /** Who points something at it: the one who pays. */
  caster: number;
  /** The permanent with ward, by name. */
  name: string;
  ward: Ward;
  /** What is pointed at it: the spell (or the card whose ability it is). */
  spell: string;
  /** The spell on the turn's stack, when it is one: not paid, it is countered. */
  spellId?: string;
  /** The seat that controls the permanent with ward. */
  holderSeat: number;
  /** Paid: what was pointed at it goes ahead. */
  onPaid: () => void;
  onBack: () => void;
  onClose: () => void;
}

/** Ward's question, put to whoever points a spell or an ability at somebody
 * else's permanent that has it (lib/ward.ts): pay — the mana from their
 * lands, the life — and it goes ahead; don't, and the spell is countered
 * (an ability's effect simply does not happen). A cost the app cannot pay
 * itself ("Discard a card") is done at the table, and "Paid" goes ahead. */
export default function WardSheet({ caster, name, ward, spell, spellId, holderSeat, onPaid, onBack, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const payWard = useAppStore((s) => s.payWard);
  const counterSpell = useAppStore((s) => s.counterSpell);
  const records = useTableRecords();
  if (!game) return null;
  const short = ward.mana > 0 && !affordable({ generic: ward.mana, pips: [] }, seatSources(game, caster, records));
  const casterName = game.config.profiles[caster]?.name ?? 'They';
  const pays = ward.mana > 0 || ward.life > 0;
  return (
    <Sheet
      title={`${name} has ward`}
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onBack}>
            Back
          </button>
          <button
            className="ghost"
            onClick={() => {
              if (spellId) counterSpell(holderSeat, `${name}'s ward`, spellId);
              onClose();
            }}
          >
            Don’t pay
          </button>
          <button
            className="primary"
            onClick={() => {
              // The ward is paid first; then what was pointed at it happens.
              void (async () => {
                if (pays) await payWard(caster, { mana: ward.mana, life: ward.life }, name, spell);
                onPaid();
              })();
            }}
          >
            {pays ? `Pay ${wardWords({ ...ward, other: [] })}` : 'Paid'}
          </button>
        </>
      }
    >
      <p className="ward-ask">
        {spell} {spellId ? 'is countered' : 'does nothing'} unless {casterName} pays <strong>{wardWords(ward)}</strong>.
      </p>
      {ward.other.length > 0 && (
        <p className="hint">The app does not do “{ward.other.join(', ').toLowerCase()}” itself: do it at the table.</p>
      )}
      {short && <p className="hint">Your untapped mana can’t cover it.</p>}
    </Sheet>
  );
}
