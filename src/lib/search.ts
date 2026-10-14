import type { FoundTo } from './cards';
import type { CardRecord } from './types';

/** "Search your library for…": what a card's text sends its player to find,
 * read off the usual words. The search itself is carried out by its player
 * (LibrarySearchSheet): this only says which cards to show first, how many
 * the card allows, and where they go. What it cannot read it leaves open —
 * a search is never refused, only less filled in. */

type Read = Pick<CardRecord, 'typeLine' | 'oracleText'> & Partial<Pick<CardRecord, 'name'>>;

/** Which cards fit a search, as far as a type line (or a name) can say. */
export interface SearchFit {
  /** Supertypes every fitting card has: "Basic", "Legendary", "Snow". */
  supers: string[];
  /** Types and subtypes, any one of which will do: "Land", "Forest", "Dragon". */
  types: string[];
  /** "a card named …": that card and no other. */
  named: string | null;
}

export interface SearchAsk {
  /** The card's own words for what to find: "up to two basic land cards". */
  what: string;
  /** How many it lets its player find; null where the text gives no number. */
  upTo: number | null;
  /** The cards that fit; null when any card does. */
  fits: SearchFit | null;
  /** Where the cards found go, first to last; the last one repeats. */
  to: FoundTo[];
  /** When the search is made: as the spell resolves, as the permanent
   * enters, or at some other time (an ability, another trigger). */
  when: 'cast' | 'enters' | 'later';
}

const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const COUNT = /^(?:up to )?(an?|one|two|three|four|five|six|seven|x|any number of)\b/i;
const SUPERS = ['Basic', 'Legendary', 'Snow'];
const TYPES = ['Land', 'Creature', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Battle'];
const DESTS: { to: FoundTo; says: RegExp }[] = [
  { to: 'tapped', says: /\bonto the battlefield tapped\b/i },
  { to: 'battlefield', says: /\bonto the battlefield\b(?! tapped)/i },
  { to: 'hand', says: /\binto (?:your|their) hand\b/i },
  { to: 'graveyard', says: /\binto (?:your|their) graveyard\b/i },
  { to: 'top', says: /\bon top\b/i },
];

const frontType = (record: Read) => record.typeLine.split(' // ')[0];
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fitOf(what: string): SearchFit | null {
  const named = what.match(/\bnamed ([^,.]+)/i)?.[1].trim() ?? null;
  const words = what.replace(/\bnamed .*/i, '');
  const has = (word: string) => new RegExp(`\\b${word}\\b`, 'i').test(words);
  const supers = SUPERS.filter(has);
  const types = TYPES.filter(has);
  // Mid-sentence, a capitalized word is a subtype: "a Forest card", "a Dragon card".
  for (const m of words.matchAll(/\b[A-Z][a-z]+\b/g))
    if (![...SUPERS, ...TYPES].includes(m[0]) && !types.includes(m[0])) types.push(m[0]);
  return named || supers.length > 0 || types.length > 0 ? { supers, types, named } : null;
}

/** What the card's FRONT face sends its player to find; null for a card
 * that searches no library (or only somebody else's). */
export function searchAsk(record: Read | null | undefined): SearchAsk | null {
  if (!record) return null;
  const text = record.oracleText.split('\n//\n')[0].replace(/\([^)]*\)/g, '');
  const line = text.split('\n').find((l) => /\bsearch your library for\b/i.test(l));
  if (!line) return null;
  const from = line.search(/\bsearch your library for\b/i);
  const after = line.slice(from).replace(/^search your library for\s*/i, '');
  // Up to the word "card(s)" and what narrows it ("…named Squadron Hawk",
  // "…with mana value 3 or less") — not what is then done with the card.
  const upToCard = after.match(/^(.*?\bcards?\b(?: (?:named|with) (?:(?! and (?:put|reveal)\b)[^,.])*)?)/i);
  const what = (upToCard ? upToCard[1] : after.split(/[,.]/)[0]).trim();
  const rest = after.slice(what.length);

  const count = what.match(COUNT)?.[1].toLowerCase();
  const upTo = count ? (NUMBERS[count] ?? null) : null;

  const said = DESTS.flatMap(({ to, says }) => {
    const at = rest.search(says);
    return at < 0 ? [] : [{ to, at }];
  }).sort((a, b) => a.at - b.at);
  // "…put one onto the battlefield tapped and the other into your hand".
  const split = /\bthe (?:other|rest)\b/i.test(rest) && said.length >= 2;
  const to: FoundTo[] = said.length === 0 ? ['hand'] : split ? [said[0].to, said[1].to] : [said[0].to];

  const self = record.name ? `|${escaped(record.name.split(' // ')[0])}` : '';
  const when = /\b(?:Instant|Sorcery)\b/.test(frontType(record))
    ? 'cast'
    : new RegExp(`^When(?:ever)? (?:this \\w+${self}) enters\\b`, 'i').test(line.trim())
      ? 'enters'
      : 'later';
  return { what, upTo, fits: fitOf(what), to, when };
}

/** Does a card fit the search? One this device cannot read always does:
 * what the app cannot read is never hidden from its player. */
export function fitsSearch(
  fit: SearchFit | null,
  card: Pick<CardRecord, 'name' | 'typeLine'> | null | undefined,
): boolean {
  if (!fit || !card) return true;
  if (fit.named) return card.name.split(' // ')[0].toLowerCase() === fit.named.toLowerCase();
  const type = card.typeLine.split(' // ')[0];
  const has = (word: string) => new RegExp(`\\b${word}\\b`, 'i').test(type);
  return fit.supers.every(has) && (fit.types.length === 0 || fit.types.some(has));
}

/** The words for a place a found card goes. */
export const FOUND_TO: { to: FoundTo; label: string }[] = [
  { to: 'tapped', label: 'Battlefield, tapped' },
  { to: 'battlefield', label: 'Battlefield' },
  { to: 'hand', label: 'Hand' },
  { to: 'top', label: 'Top of library' },
  { to: 'graveyard', label: 'Graveyard' },
];
