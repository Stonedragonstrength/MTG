import { sizeWords, type Size } from '../lib/attach';
import { godWords, type GodRead } from '../lib/gods';
import type { CardInstance } from '../lib/types';
import CombatMarks, { combatClasses } from './CombatMarks';
import FaceMark from './FaceMark';
import ManaSymbol from './ManaSymbol';
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
  /** A Theros god (lib/gods.ts): its devotion against its number, on the
   * corner where its size is printed. Below the number it is no creature. */
  god?: GodRead | null;
  /** A Vehicle (lib/vehicles.ts): its crew number, and whether it is crewed this turn. */
  vehicle?: { crew: number; crewed: boolean } | null;
  onTap: () => void;
  onDetail: () => void;
}

/** The counters that keep time on a card, as its corner says them: a
 * Saga's chapter ("II"), Vanishing's time counters, Fading's, cumulative
 * upkeep's age — and the ones it keeps mana in: a storage land's storage
 * counters, a Mana Battery's or a Vivid land's charge counters. The first
 * one it has; null for none. `short`: for a small land on the lands shelf,
 * where "storage 3" does not fit — the number alone (its label names it). */
export function tallyOf(counters: CardInstance['counters']): { text: string; short: string; label: string } | null {
  const n = (kind: string) => Math.max(0, Math.floor(counters?.[kind] ?? 0));
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  if (n('lore') > 0) {
    const text = ROMAN[n('lore')] ?? `${n('lore')}`;
    return { text, short: text, label: `chapter ${ROMAN[n('lore')] ?? n('lore')}` };
  }
  if (n('time') > 0) return { text: `⏳${n('time')}`, short: `⏳${n('time')}`, label: `${n('time')} time counter${n('time') === 1 ? '' : 's'}` };
  for (const kind of ['fade', 'age', 'storage', 'charge', 'depletion', 'mining'])
    if (n(kind) > 0) return { text: `${kind} ${n(kind)}`, short: `${n(kind)}`, label: `${n(kind)} ${kind} counter${n(kind) === 1 ? '' : 's'}` };
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
export default function VCard({ card, art, sick, look, names, attached = 0, worn, use, god, vehicle, onTap, onDetail }: Props) {
  const picks = look?.picks === true;
  const press = useLongPress(picks ? look.tap : onTap, onDetail);
  // +1/+1 counters, less -1/-1 counters.
  const plus = (card.counters?.p1p1 ?? 0) - (card.counters?.m1m1 ?? 0);
  // How much bigger (or smaller) than printed: counters and what it wears.
  const change: Size = { power: plus + (worn?.power ?? 0), toughness: plus + (worn?.toughness ?? 0) };
  const tally = tallyOf(card.counters);
  // A planeswalker's loyalty, where it is kept: over the printed one.
  const loyalty = card.counters?.loyalty;
  const job = look?.mode === 'attack' ? 'attack' : 'block';
  // The result is waiting and it fought: the tap says whether it dies.
  const judged = picks && look.mode === 'damage';
  const label = !picks
    ? `${use ?? 'tap'} ${card.name}${sick ? ', summoning sick' : ''}${god && !god.creature ? ', not a creature' : ''}`
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
      className={`vcard${card.tapped ? ' vcard--tapped' : ''}${god && !god.creature ? ' vcard--dormant' : ''}${combatClasses('vcard', look)}`}
      data-iid={card.iid}
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
      {loyalty !== undefined && (
        // Keyed: it pulses as the loyalty changes.
        <span key={loyalty} className="loyalty-badge" role="img" aria-label={`loyalty ${loyalty}`} title={`loyalty ${loyalty}`}>
          {loyalty}
        </span>
      )}
      {god && (
        // Keyed: it pulses as the god wakes, or goes back to sleep.
        <span
          key={String(god.creature)}
          className={god.creature ? 'devotion-badge devotion-badge--awake' : 'devotion-badge'}
          role="img"
          aria-label={`${godWords(god)}${god.creature ? '' : ', not a creature'}`}
          title={`${godWords(god)}${god.creature ? ' — a creature' : ' — not a creature yet'}`}
        >
          {god.need.kind === 'devotion'
            ? god.need.colors.map((c) => <ManaSymbol key={c} symbol={c} label="" />)
            : god.need.kind === 'graveyard'
              ? '🪦'
              : '⇄'}
          <span className="devotion-count">
            {god.now}/{god.need.needs}
          </span>
        </span>
      )}
      {vehicle && (
        // Keyed: it lights up as the Vehicle is crewed.
        <span
          key={String(vehicle.crewed)}
          className={vehicle.crewed ? 'devotion-badge devotion-badge--awake crew-badge' : 'devotion-badge crew-badge'}
          role="img"
          aria-label={vehicle.crewed ? 'crewed, a creature this turn' : `crew ${vehicle.crew}`}
          title={vehicle.crewed ? 'Crewed — an artifact creature until end of turn' : `Crew ${vehicle.crew} — hold to crew it`}
        >
          {vehicle.crewed ? 'Crewed' : `Crew ${vehicle.crew}`}
        </span>
      )}
      {(change.power !== 0 || change.toughness !== 0) && (
        <span
          className={
            loyalty !== undefined || god || vehicle ? 'count-badge vcard-counter vcard-counter--beside' : 'count-badge vcard-counter'
          }
        >
          {sizeWords(change)}
        </span>
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
      {card.stolen && (
        // Whose card it really is, where another player has taken it.
        <span
          className={card.stolen.until ? 'stolen-badge stolen-badge--turn' : 'stolen-badge'}
          title={`${names[card.stolen.owner] ?? 'Someone'}'s card${card.stolen.until ? ', for this turn' : ''}`}
        >
          ⇄ {names[card.stolen.owner] ?? '?'}
        </span>
      )}
      {tally && (
        <span className="tally-badge" role="img" aria-label={tally.label} title={tally.label}>
          {tally.text}
        </span>
      )}
      <CombatMarks look={look} names={names} />
    </button>
  );
}
