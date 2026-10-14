import { sizeWords, type Size } from '../lib/attach';
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
  /** What its Auras and Equipment add to its size (lib/attach.ts sizeWorn):
   * the badge on the card says it together with its +1/+1 counters. */
  worn?: Size;
  /** What a tap does when that is not tapping the card, in one word: an
   * Equipment lying unattached is tapped to 'equip' it. The card wears the
   * word, and its label says it. */
  use?: string;
  onTap: () => void;
  onDetail: () => void;
}

/** The counters that keep time on a card, as its corner says them: a
 * Saga's chapter ("II"), Vanishing's time counters, Fading's, cumulative
 * upkeep's age. The first one it has; null for none. */
export function tallyOf(counters: CardInstance['counters']): { text: string; label: string } | null {
  const n = (kind: string) => Math.max(0, Math.floor(counters?.[kind] ?? 0));
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  if (n('lore') > 0) return { text: ROMAN[n('lore')] ?? `${n('lore')}`, label: `chapter ${ROMAN[n('lore')] ?? n('lore')}` };
  if (n('time') > 0) return { text: `⏳${n('time')}`, label: `${n('time')} time counter${n('time') === 1 ? '' : 's'}` };
  if (n('fade') > 0) return { text: `fade ${n('fade')}`, label: `${n('fade')} fade counter${n('fade') === 1 ? '' : 's'}` };
  if (n('age') > 0) return { text: `age ${n('age')}`, label: `${n('age')} age counter${n('age') === 1 ? '' : 's'}` };
  return null;
}

/** One real card on the shared battlefield: tap = tap it, hold = sheet.
 * A summoning-sick creature only wears a badge: tapping it stays allowed
 * (crewing and convoke are legal).
 *
 * While its seat picks attackers or blockers a creature changes meaning:
 * a tap picks it (or is ignored, dimmed, when it cannot fight — the hold
 * still opens the sheet, where "Attack anyway" and a plain Tap live).
 * Anything that is no creature keeps its ordinary tap. */
export default function VCard({ card, art, sick, look, names, attached = 0, worn, use, onTap, onDetail }: Props) {
  const picks = look?.picks === true;
  const press = useLongPress(picks ? look.tap : onTap, onDetail);
  // +1/+1 counters, less -1/-1 counters.
  const plus = (card.counters?.p1p1 ?? 0) - (card.counters?.m1m1 ?? 0);
  // How much bigger (or smaller) than printed: counters and what it wears.
  const change: Size = { power: plus + (worn?.power ?? 0), toughness: plus + (worn?.toughness ?? 0) };
  const tally = tallyOf(card.counters);
  const job = look?.mode === 'attack' ? 'attack' : 'block';
  // The result is waiting and it fought: the tap says whether it dies.
  const judged = picks && look.mode === 'damage';
  const label = !picks
    ? `${use ?? 'tap'} ${card.name}${sick ? ', summoning sick' : ''}`
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
            : `Tap to ${use ?? 'tap'} · hold for options`
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
      {(change.power !== 0 || change.toughness !== 0) && (
        <span className="count-badge vcard-counter">{sizeWords(change)}</span>
      )}
      {attached > 0 && (
        <span className="attached-badge" aria-label={`${attached} attached`}>
          🔗{attached}
        </span>
      )}
      {use && !picks && (
        <span className="use-band" aria-hidden="true">
          {use}
        </span>
      )}
      <FaceMark cardId={card.cardId} />
      {tally && (
        <span className="tally-badge" role="img" aria-label={tally.label} title={tally.label}>
          {tally.text}
        </span>
      )}
      <CombatMarks look={look} names={names} />
    </button>
  );
}
