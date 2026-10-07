import { landsPlayed } from './cards';
import type { GameState } from './types';

/** The turn rule a cards seat is held to besides paying for its spells:
 * one land per turn. (Summoning sickness is read in keywords.ts.) Nothing
 * here stops anything by itself — a refusal is for the table to show, with
 * a way around it behind the hold. */

/** Is this card played as a land from hand? Its FRONT face decides, the
 * way it does for summoning sickness: Growing Rites of Itlimoc
 * ("Legendary Enchantment // Legendary Land") is a spell that turns into a
 * land later, and Valakut Awakening ("Instant // Land") is cast unless the
 * player says otherwise — see hasLandBack. The hand, the store and the
 * price of a cast all ask here, so they cannot disagree. */
export function isLandCard(typeLine: string): boolean {
  return /\bLand\b/.test(typeLine.split(' // ')[0]);
}

/** A spell on the front, a land on the back: a tap casts it, and the hold
 * offers the land. (The type line cannot tell a card that may be played as
 * its back from one that only turns into it, so both get the offer.) */
export function hasLandBack(typeLine: string): boolean {
  const [front, ...backs] = typeLine.split(' // ');
  return !/\bLand\b/.test(front) && backs.some((face) => /\bLand\b/.test(face));
}

const COUNT: Record<string, number> = { an: 1, one: 1, two: 2, three: 3 };

// The three sentences that change the land drop, as rules text words them.
const HOW_MANY = '(an|one|two|three) additional lands?';
const EACH_TURN = '(?:on|during) each of'; // Storm Cauldron says "during"
const YOURS = new RegExp(`\\byou may play ${HOW_MANY} ${EACH_TURN} your turns\\b`, 'gi');
const EVERYONES = new RegExp(
  `\\beach player may play ${HOW_MANY} ${EACH_TURN} (?:their|his or her) turns\\b`,
  'gi',
);
/** Fastbond: no limit at all. */
const ANY_NUMBER = new RegExp(
  `\\byou may play any number of (?:additional )?lands ${EACH_TURN} your turns\\b`,
  'i',
);

/** The extra land plays one permanent's text grants. `mine` says the seat
 * controls it: on someone else's permanent only a line that speaks to
 * each player counts (their Exploration is theirs alone). */
function extraLands(text: string, mine: boolean): number {
  if (mine && ANY_NUMBER.test(text)) return Infinity;
  let extra = 0;
  if (mine) for (const [, word] of text.matchAll(YOURS)) extra += COUNT[word.toLowerCase()];
  for (const [, word] of text.matchAll(EVERYONES)) extra += COUNT[word.toLowerCase()];
  return extra;
}

/** How many lands a seat may play on each of its turns: one, plus what
 * the rules text of its permanents grants — "You may play an additional
 * land on each of your turns." (Exploration, Oracle of Mul Daya, Dryad of
 * the Ilysian Grove), "…two additional lands…" (Azusa), "Each player may
 * play an additional land on each of their turns." (Rites of Flourishing).
 * `others` is the text on everyone else's permanents, for that last kind.
 * A land "this turn" is a spell's doing and is not read: the hold covers it. */
export function landAllowance(texts: string[], others: string[] = []): number {
  let allowed = 1;
  for (const text of texts) allowed += extraLands(text, true);
  for (const text of others) allowed += extraLands(text, false);
  return allowed;
}

/** May this seat play a land from hand right now? Only on its own turn,
 * and only while it has drops left. `why` is the line the table shows
 * when it says no. */
export function canPlayLand(
  game: GameState,
  seat: number,
  texts: string[],
  others: string[] = [],
): { ok: boolean; why?: string } {
  if (game.activePlayerIndex !== seat) return { ok: false, why: "It isn't your turn." };
  if (landsPlayed(game, seat) >= landAllowance(texts, others))
    return { ok: false, why: 'You have already played a land this turn.' };
  return { ok: true };
}
