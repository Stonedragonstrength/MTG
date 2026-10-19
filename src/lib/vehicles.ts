import type { CardInstance, CardRecord } from './types';

// ---- Vehicles ----
// A Vehicle is an artifact with a size that is no creature until it is
// crewed: "Crew 3 (Tap any number of untapped creatures you control with
// total power 3 or greater: This Vehicle becomes an artifact creature until
// end of turn.)". The card says it was crewed with a stamp of the turn
// (CardInstance.crewed); a stamp from any other turn is no crew at all, so
// nothing has to clear it. Every reader that asks "is it a creature?" of a
// card on the battlefield reads the record through `asItIs`, which hands a
// crewed Vehicle over as the artifact creature it now is.

type Read = Pick<CardRecord, 'typeLine'> | null | undefined;

/** A turn, as the game names it. */
interface Turn {
  turnNumber: number;
  activePlayerIndex: number;
}

const frontType = (record: Read) => (record?.typeLine ?? '').split(' // ')[0];

export function isVehicle(record: Read): boolean {
  return /\bVehicle\b/.test(frontType(record));
}

/** "Crew 3" on the front face: what it takes to crew it; null for no crew. */
export function crewOf(record: Pick<CardRecord, 'oracleText'> | null | undefined): number | null {
  const m = (record?.oracleText ?? '').split('\n//\n')[0].match(/^Crew (\d+)\b/im);
  return m ? Number(m[1]) : null;
}

/** Was it crewed this turn — is it a creature until the turn ends? */
export function crewedNow(g: Turn, card: Pick<CardInstance, 'crewed'> | null | undefined): boolean {
  const c = card?.crewed;
  return !!c && c.turn === g.turnNumber && c.active === g.activePlayerIndex;
}

/** "Legendary Artifact — Vehicle" → "Legendary Artifact Creature — Vehicle". */
export function asCreatureType(typeLine: string): string {
  const [front, ...rest] = typeLine.split(' // ');
  if (/\bCreature\b/.test(front)) return typeLine;
  const [types, subtypes] = front.split(' — ');
  const now = `${types} Creature${subtypes !== undefined ? ` — ${subtypes}` : ''}`;
  return [now, ...rest].join(' // ');
}

/** The card's record as the card is now: a Vehicle crewed this turn reads as
 * an artifact creature; anything else as it is. */
export function asItIs<R extends Pick<CardRecord, 'typeLine'>>(
  g: Turn,
  card: Pick<CardInstance, 'crewed'> | null | undefined,
  record: R | null | undefined,
): R | null | undefined {
  if (!record || !crewedNow(g, card) || !isVehicle(record)) return record;
  return { ...record, typeLine: asCreatureType(record.typeLine) };
}
