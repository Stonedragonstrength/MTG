import { tapManaFromText } from './mana';
import { isLandCard } from './turnRules';
import type { CardInstance, CardRecord } from './types';

/** Where a battlefield card is DRAWN on its seat's board: the field is for
 * creatures, the lands shelf for whatever is there to make mana, and the
 * side shelf for the rest (artifacts, enchantments, planeswalkers). */
export type Shelf = 'field' | 'lands' | 'side';

type Read = Pick<CardRecord, 'typeLine' | 'oracleText'> | null | undefined;

/** A card's type, as its FRONT face prints it (the back of a double-faced
 * card is not what is on the table until it turns). */
const frontType = (record: Read) => (record?.typeLine ?? '').split(' // ')[0];

/** A creature on its front face. */
export function isCreatureCard(record: Read): boolean {
  return /\bCreature\b/.test(frontType(record));
}

/** A mana rock: a permanent that is no creature and no land, and taps for
 * mana by itself (Sol Ring, a Signet, a Talisman). Read off the front
 * face's own text; an ability that sacrifices the card does not count —
 * a Treasure is spent, not tapped. */
export function isManaRock(record: Read): boolean {
  if (!record || isCreatureCard(record) || isLandCard(record.typeLine)) return false;
  const front = record.oracleText.split('\n//\n')[0];
  return tapManaFromText(front).amount > 0;
}

/** The shelf a card is drawn on. A place the player chose by hand always
 * wins ('lands', 'side', 'field'); otherwise the card's type decides:
 * creatures take the field, lands and mana rocks the lands shelf, every
 * other permanent the side shelf. A card this device cannot read stays in
 * the field, where nothing is ever hidden.
 *
 * This is about drawing only. Which cards may fight is the engine's to say
 * (anything not put on the lands shelf by `row`), and a card on a shelf
 * keeps every action it had in the field. */
export function shelfOf(card: Pick<CardInstance, 'row'>, record: Read): Shelf {
  if (card.row === 'lands') return 'lands';
  if (card.row === 'side') return 'side';
  if (card.row === 'field') return 'field';
  if (!record) return 'field';
  if (isCreatureCard(record)) return 'field';
  if (isLandCard(record.typeLine) || isManaRock(record)) return 'lands';
  return 'side';
}
