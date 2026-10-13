import type { CardInstance } from '../lib/types';
import CombatMarks, { combatClasses } from './CombatMarks';
import FaceMark from './FaceMark';
import type { UnitLook } from './useCombat';
import { useLongPress } from './useLongPress';

interface Props {
  card: CardInstance;
  art: string | null;
  sick: boolean;
  /** How it stands in the fight on the table, if there is one. */
  look: UnitLook | null;
  /** The players' names by seat, for the marks. */
  names: string[];
  /** How many Auras and Equipment sit on it, where they are not drawn
   * beside it (a small card on a shelf): a count on its corner. */
  attached?: number;
  onTap: () => void;
  onDetail: () => void;
}

/** One real card on the shared battlefield: tap = tap it, hold = sheet.
 * A summoning-sick creature only wears a badge: tapping it stays allowed
 * (crewing and convoke are legal).
 *
 * While its seat picks attackers or blockers a creature changes meaning:
 * a tap picks it (or is ignored, dimmed, when it cannot fight — the hold
 * still opens the sheet, where "Attack anyway" and a plain Tap live).
 * Anything that is no creature keeps its ordinary tap. */
export default function VCard({ card, art, sick, look, names, attached = 0, onTap, onDetail }: Props) {
  const picks = look?.picks === true;
  const press = useLongPress(picks ? look.tap : onTap, onDetail);
  const p1p1 = card.counters?.p1p1 ?? 0;
  const job = look?.mode === 'attack' ? 'attack' : 'block';
  // The result is waiting and it fought: the tap says whether it dies.
  const judged = picks && look.mode === 'damage';
  const label = !picks
    ? `tap ${card.name}${sick ? ', summoning sick' : ''}`
    : judged
      ? look.picked > 0
        ? `${card.name} dies — tap if it lives`
        : `${card.name} lives — tap if it dies`
      : look.picked > 0
        ? `${card.name} ${job}s — tap to take it back`
        : look.dim
          ? `${card.name} cannot ${job}`
          : `${job} with ${card.name}`;
  return (
    <button
      className={`vcard${card.tapped ? ' vcard--tapped' : ''}${combatClasses('vcard', look)}`}
      aria-label={label}
      aria-pressed={picks ? look.picked > 0 : undefined}
      title={
        judged
          ? 'Tap to change whether it dies · hold for options'
          : picks
            ? `Tap to ${job} · hold for options`
            : 'Tap to tap · hold for options'
      }
      {...press}
    >
      {art ? (
        <img src={art} alt="" loading="lazy" />
      ) : (
        <span className="vcard-placeholder">{card.name}</span>
      )}
      {sick && (
        <span className="sick-badge" aria-hidden="true">
          💤
        </span>
      )}
      {p1p1 !== 0 && (
        <span className="count-badge vcard-counter">
          {p1p1 > 0 ? `+${p1p1}/+${p1p1}` : `${p1p1}/${p1p1}`}
        </span>
      )}
      {attached > 0 && (
        <span className="attached-badge" aria-label={`${attached} attached`}>
          🔗{attached}
        </span>
      )}
      <FaceMark cardId={card.cardId} />
      <CombatMarks look={look} names={names} />
    </button>
  );
}
