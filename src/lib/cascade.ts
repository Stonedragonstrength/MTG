import { manaValue } from './deck';
import { entryCounters } from './entering';
import { keywordsOf } from './keywords';
import { castCosts, hasX } from './pay';
import { isLandCard } from './turnRules';
import type { CardInstance, CardRecord } from './types';

/** Cascade and rebound: what a spell sets off as it is cast, and what one
 * cast from its owner's hand does as it resolves.
 *
 * Cascade: "When you cast this spell, exile cards from the top of your
 * library until you exile a nonland card whose mana value is less than this
 * spell's. You may cast it without paying its mana cost. Put the exiled
 * cards on the bottom of your library in a random order." The table reads
 * the library to find that card before anything moves, and the player's
 * answer — cast it or not — carries the whole cascade out in one move
 * (store.cascade).
 *
 * Rebound: "If you cast this spell from your hand, exile it as it resolves.
 * At the beginning of your next upkeep, you may cast this card from exile
 * without paying its mana cost." The card goes to exile instead of the
 * graveyard, marked with the turn it was cast in, and comes up as its
 * owner's next turn begins. */

/** A card's mana value as it lies in a library or in exile: both halves of a
 * split card (or a Room) added up; for a card with an Adventure, an Omen or
 * another spell beside it, the card's own half only. The record keeps both
 * costs ("{3}{B} // {B}"). */
export function cardManaValue(record: Pick<CardRecord, 'manaCost' | 'typeLine'>): number {
  const costs = record.manaCost.split(' // ');
  if (costs.length < 2) return manaValue(record.manaCost);
  const halves = record.typeLine.split(' // ');
  const spell = (half: string | undefined) => /\b(?:Instant|Sorcery)\b/.test(half ?? '');
  const beside = /\b(?:Adventure|Omen)\b/.test(halves[1] ?? '') || (!spell(halves[0]) && spell(halves[1]));
  return beside ? manaValue(costs[0]) : costs.reduce((n, cost) => n + manaValue(cost), 0);
}

/** The mana value of a spell as it is cast: with what was paid for X. */
export function spellManaValue(record: Pick<CardRecord, 'manaCost' | 'typeLine'>, x = 0): number {
  const xs = (record.manaCost.split(' // ')[0].match(/\{X\}/g) ?? []).length;
  return cardManaValue(record) + xs * Math.max(0, x);
}

/** One card a cascade exiles. */
export interface CascadeCard {
  iid: string;
  cardId: string;
  name: string;
}

/** What a cascade does, read off the library before anything moves. */
export interface CascadePlan {
  /** The cards exiled from the top of the library, in order: the card found
   * is the last of them. */
  exiled: CascadeCard[];
  /** The nonland card with a lesser mana value — null when the library
   * holds none: every card in it is exiled, and all go back in a random
   * order. `spell`: an instant or sorcery, which goes to the graveyard as
   * it is cast (a permanent goes onto the battlefield, with the counters
   * it enters with: `brings`). `x`: its cost has an X, which is 0. */
  found: (CascadeCard & { spell: boolean; x: boolean; brings: Record<string, number> }) | null;
}

/** Instants and sorceries are cast to the graveyard, the rest onto the
 * battlefield — as a card played from hand is routed (store.playCard). */
export const isSpellCard = (typeLine: string): boolean =>
  !isLandCard(typeLine) && /Instant|Sorcery/.test(typeLine) && !/Creature/.test(typeLine);

/** Cascade, from the top of this library: the cards it exiles until a
 * nonland card with mana value less than `below`, read one by one through
 * `read`. Null when a card on the way cannot be read: nothing is guessed. */
export async function planCascade(
  library: CardInstance[],
  below: number,
  read: (card: CardInstance) => Promise<CardRecord | null | undefined>,
): Promise<CascadePlan | null> {
  const exiled: CascadeCard[] = [];
  for (const card of library) {
    const record = await read(card);
    if (!record) return null;
    const one = { iid: card.iid, cardId: card.cardId, name: card.name };
    exiled.push(one);
    if (isLandCard(record.typeLine) || cardManaValue(record) >= below) continue;
    const spell = isSpellCard(record.typeLine);
    return {
      exiled,
      found: { ...one, spell, x: hasX(castCosts(record, 'hand')), brings: spell ? {} : entryCounters(record) },
    };
  }
  return { exiled, found: null };
}

/** The front face's rules text, one ability a line, without reminder text. */
const linesOf = (record: Pick<CardRecord, 'oracleText'>): string[] =>
  record.oracleText
    .split('\n//\n')[0]
    .split('\n')
    .map((line) => line.replace(/\s*\([^)]*\)/g, '').trim());

/** "Instant and sorcery" → [['instant'], ['sorcery']]: any one of the kinds,
 * each a list of words that all have to fit. Nothing named: any spell. */
const kindsOf = (what: string): string[][] => {
  const kinds = what
    .toLowerCase()
    .split(/,\s*(?:and |or )?|\s+(?:and|or)\s+/)
    .map((kind) => kind.split(/\s+/).filter((word) => word !== ''))
    .filter((words) => words.length > 0);
  return kinds.length > 0 ? kinds : [[]];
};

/** Which of its controller's spells a permanent gives cascade to. */
export interface CascadeGrant {
  /** Any one of these kinds (lib/triggers.ts fits them to the spell). */
  kinds: string[][];
  /** Only a commander ("Commander spells you cast have cascade."). */
  commander: boolean;
  /** Only one cast from its owner's hand. */
  fromHand: boolean;
  /** Only one with this mana value or greater; 0 for any. */
  atLeast: number;
  /** How many times it gives it ("Cascade, cascade." is twice). */
  times: number;
}

const GRANTS_CASCADE =
  /^(?:(.+?) )?spells you cast( from your hand)?(?: with mana value (\d+) or greater)? have (cascade|"cascade, cascade\.?")\.?$/i;

/** "Sliver spells you cast have cascade." (The First Sliver), "Instant and
 * sorcery spells you cast from your hand have cascade." (Quandrix), "Spells
 * you cast with mana value 6 or greater have cascade." (Imoti), "Commander
 * spells you cast have cascade." (Flamekin Herald), "Colorless spells you
 * cast from your hand with mana value 7 or greater have "Cascade, cascade.""
 * (Zhulodok). A grant with a condition the table cannot see ("The first
 * spell you cast each turn", "as long as…") is not read. */
export function cascadeGrants(record: Pick<CardRecord, 'oracleText'> | null | undefined): CascadeGrant[] {
  if (!record) return [];
  const out: CascadeGrant[] = [];
  for (const line of linesOf(record)) {
    const m = line.match(GRANTS_CASCADE);
    if (!m) continue;
    const what = (m[1] ?? '').trim();
    const commander = /^commander$/i.test(what);
    out.push({
      kinds: commander ? [[]] : kindsOf(what),
      commander,
      fromHand: !!m[2],
      atLeast: m[3] ? Number(m[3]) : 0,
      times: /cascade, cascade/i.test(m[4]) ? 2 : 1,
    });
  }
  return out;
}

const GRANTS_REBOUND = /^(?:(.+?) )?spells you control have rebound\.$/i;
const GAINS_REBOUND = /^Whenever you cast an? (.+?) spell from your hand, it gains rebound\.$/i;

/** Does this permanent give a spell of this type, cast from its owner's
 * hand, rebound? "Instant and sorcery spells you control have rebound."
 * (Cast Through Time), "Whenever you cast an instant spell from your hand,
 * it gains rebound." (Ojer Pakpatiq). One that asks for more ("if Taigam
 * attacked this turn") is not read. */
export function givesRebound(record: Pick<CardRecord, 'oracleText'> | null | undefined, typeLine: string): boolean {
  if (!record) return false;
  const front = typeLine.split(' // ')[0];
  const fits = (what: string | undefined) =>
    kindsOf(what ?? '').some((words) => words.every((word) => new RegExp(`\\b${word}\\b`, 'i').test(front)));
  return linesOf(record).some((line) => {
    const m = line.match(GRANTS_REBOUND) ?? line.match(GAINS_REBOUND);
    return !!m && fits(m[1]);
  });
}

/** Does this spell, cast from its owner's hand, go to exile with rebound?
 * Its own keyword, or one of its player's permanents (`permanents`) giving
 * it. Only an instant or a sorcery does. */
export function castsWithRebound(
  record: Pick<CardRecord, 'oracleText' | 'typeLine'> | null | undefined,
  permanents: (Pick<CardRecord, 'oracleText'> | null | undefined)[],
): boolean {
  if (!record || !isSpellCard(record.typeLine)) return false;
  return keywordsOf(record.oracleText).has('rebound') || permanents.some((p) => givesRebound(p, record.typeLine));
}

/** The turn a card cast with rebound in turn `at` comes back in: its
 * owner's next turn. The game counts rounds (turnNumber goes up as the
 * first seat's turn comes round again), so a seat after the one whose turn
 * it was is up later in the same round, and any other in the next one. */
export function reboundTurn(seat: number, at: { turn: number; active: number }): number {
  return seat > at.active ? at.turn : at.turn + 1;
}
