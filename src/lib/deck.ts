import { canPartner } from './partner';
import { cardThemes, synergyScore } from './themes';
import type { CardRecord, Deck, DeckCard } from './types';

export function createDeck(name: string): Deck {
  return {
    id: crypto.randomUUID(),
    name,
    commander: null,
    colors: [],
    cards: [],
    updatedAt: Date.now(),
  };
}

function toDeckCard(card: CardRecord): DeckCard {
  return {
    cardId: card.id,
    name: card.name,
    typeLine: card.typeLine,
    manaCost: card.manaCost,
    imageNormal: card.imageNormal,
    count: 1,
    colorIdentity: card.colorIdentity,
  };
}

function touched(deck: Deck): Deck {
  return { ...deck, updatedAt: Date.now() };
}

/** Commander is singleton: only basics stack. A duplicate non-basic add
 * returns the deck unchanged (same reference), so callers can tell and
 * say so. The row steppers remain the escape hatch for Relentless Rats. */
export function addCard(deck: Deck, card: CardRecord): Deck {
  const existing = deck.cards.find((c) => c.cardId === card.id);
  if (existing && !card.typeLine.startsWith('Basic Land')) return deck;
  const cards = existing
    ? deck.cards.map((c) => (c.cardId === card.id ? { ...c, count: c.count + 1 } : c))
    : [...deck.cards, toDeckCard(card)];
  return touched({ ...deck, cards });
}

export function changeCardCount(deck: Deck, cardId: string, delta: number): Deck {
  const cards = deck.cards
    .map((c) => (c.cardId === cardId ? { ...c, count: Math.max(0, c.count + delta) } : c))
    .filter((c) => c.count > 0);
  return touched({ ...deck, cards });
}

/** A data refresh can hand the same card a new id, so the name counts too. */
const isCard = (held: DeckCard | null | undefined, card: CardRecord) =>
  !!held && (held.cardId === card.id || held.name === card.name);

/** A new commander starts alone: whether a second commander is legal
 * depends on the first, so the old pairing is dropped with it. A card
 * seated in the command zone leaves the 99 — it is never in both. */
export function setCommander(deck: Deck, card: CardRecord): Deck {
  return touched({
    ...deck,
    commander: toDeckCard(card),
    partner: null,
    colors: card.colorIdentity ?? card.colors,
    cards: deck.cards.filter((c) => !isCard(c, card)),
  });
}

/** Seats (or removes, with null) the second commander. The deck's colors
 * become the pair's combined identity. No-op without a commander. */
export function setPartner(deck: Deck, card: CardRecord | null): Deck {
  if (!deck.commander) return deck;
  const partner = card ? toDeckCard(card) : null;
  // Decks saved before identities were stored only know their colors as a
  // whole — pin those to the commander before a partner widens them.
  const own = deck.commander.colorIdentity ?? deck.colors;
  const commander = { ...deck.commander, colorIdentity: own };
  const theirs = partner?.colorIdentity ?? (card ? card.colors : []);
  const colors = [...own, ...theirs.filter((c) => !own.includes(c))];
  const cards = card ? deck.cards.filter((c) => !isCard(c, card)) : deck.cards;
  return touched({ ...deck, commander, partner, colors, cards });
}

/** Hands the deck to a new commander and loses nothing: whoever leaves
 * the command zone stays in the deck as an ordinary card. The second
 * commander keeps its seat when the rules still allow the pair (its
 * record must be in `records`, keyed by card id, to tell), and promoting
 * the second commander swaps the two. */
export function changeCommander(
  deck: Deck,
  card: CardRecord,
  records: Record<string, CardRecord | null | undefined> = {},
): Deck {
  if (isCard(deck.commander, card)) return deck;
  // The partner first: it already was the second commander.
  const leaving = [deck.partner, deck.commander].filter(
    (held): held is DeckCard => !!held && !isCard(held, card),
  );
  const staying = leaving.find((held) => {
    const record = records[held.cardId];
    return !!record && canPartner(card, record);
  });
  let next = setCommander(deck, card);
  if (staying) next = setPartner(next, records[staying.cardId]!);
  const kept = leaving
    .filter((held) => held !== staying && !next.cards.some((c) => c.cardId === held.cardId))
    .map((held) => ({ ...held, count: 1 }));
  return kept.length > 0 ? { ...next, cards: [...next.cards, ...kept] } : next;
}

function copiesOf(deck: Deck, card: CardRecord): number {
  return (
    (deck.cards.find((c) => c.cardId === card.id)?.count ?? 0) +
    (isCard(deck.commander, card) ? 1 : 0) +
    (isCard(deck.partner, card) ? 1 : 0)
  );
}

/** Applies a resolved decklist: first the command zone, from the lines
 * flagged as commanders, then every other line as an ordinary card.
 *
 * - Two flagged cards the rules let share a deck are the pair, whatever
 *   the deck held before and in whichever order they are listed (a
 *   Background listed first still ends up second). A card already in the
 *   first slot keeps it.
 * - A lone flagged card leads; if it is already one of the deck's
 *   commanders nothing changes, so pasting the rest of a list never costs
 *   a saved partner.
 * - Any further flagged card is an ordinary card, not a replacement.
 * - A card sitting in the command zone gets no second copy in the 99.
 *
 * `added` counts the copies from the list that the deck did not have. */
export function importLines(
  deck: Deck,
  lines: { card: CardRecord; count: number; commander: boolean }[],
): { deck: Deck; added: number } {
  let next = deck;
  const inZone = (card: CardRecord) => isCard(next.commander, card) || isCard(next.partner, card);

  const flagged: CardRecord[] = [];
  for (const l of lines) {
    if (l.commander && !flagged.some((c) => c.id === l.card.id)) flagged.push(l.card);
  }
  const [a, b] = flagged;
  if (a && b && (canPartner(a, b) || canPartner(b, a))) {
    const either = canPartner(a, b) && canPartner(b, a);
    const lead = either ? (isCard(next.commander, b) ? b : a) : canPartner(a, b) ? a : b;
    const second = lead === a ? b : a;
    if (!isCard(next.commander, lead)) next = setCommander(next, lead);
    if (!isCard(next.partner, second)) next = setPartner(next, second);
  } else if (a && !inZone(a)) {
    next = setCommander(next, a);
  }

  for (const { card, count } of lines) {
    if (inZone(card)) continue;
    next = addCard(next, card);
    if (count > 1) next = changeCardCount(next, card.id, count - 1);
  }

  let added = 0;
  const counted = new Set<string>();
  for (const { card } of lines) {
    if (counted.has(card.id)) continue;
    counted.add(card.id);
    added += Math.max(0, copiesOf(next, card) - copiesOf(deck, card));
  }
  return { deck: next, added };
}

export function deckSize(deck: Deck): number {
  return (
    deck.cards.reduce((sum, c) => sum + c.count, 0) +
    (deck.commander ? 1 : 0) +
    (deck.partner ? 1 : 0)
  );
}

/** How players file a card: a creature is a creature whatever else it is;
 * everything else falls to its first matching bucket, lands shown last. */
const GROUPS: { label: string; match: RegExp }[] = [
  { label: 'Creatures', match: /Creature/ },
  { label: 'Instants', match: /Instant/ },
  { label: 'Sorceries', match: /Sorcery/ },
  { label: 'Enchantments', match: /Enchantment/ },
  { label: 'Artifacts', match: /Artifact/ },
  { label: 'Planeswalkers', match: /Planeswalker/ },
  { label: 'Lands', match: /Land/ },
];

function bucketOf(typeLine: string): string {
  if (/Creature/.test(typeLine)) return 'Creatures';
  if (/Land/.test(typeLine)) return 'Lands';
  for (const g of GROUPS) if (g.match.test(typeLine)) return g.label;
  return 'Other';
}

/** The whole type line of a card's front face, supertype and all:
 * "Legendary Creature — Elf Druid". */
export function frontType(typeLine: string): string {
  return typeLine.split(' // ')[0];
}

/** The display subtype: "Creature — Elf Druid" → "Elf Druid". Cards
 * without a dash add nothing (the group header already says the type);
 * double-faced cards read their front face. */
export function shortType(typeLine: string): string {
  const face = frontType(typeLine);
  const dash = face.indexOf('—');
  return dash === -1 ? '' : face.slice(dash + 1).trim();
}

/** Legendary by its front face — the side a card is while it sits in a
 * deck or a binder. Any card type: creatures, lands, Backgrounds… */
export function isLegendary(typeLine: string): boolean {
  return /\bLegendary\b/.test(frontType(typeLine));
}

export function groupCards(cards: DeckCard[]): { label: string; cards: DeckCard[] }[] {
  const order = [...GROUPS.map((g) => g.label).filter((l) => l !== 'Lands'), 'Other', 'Lands'];
  const buckets = new Map<string, DeckCard[]>();
  for (const card of cards) {
    const label = bucketOf(card.typeLine);
    buckets.set(label, [...(buckets.get(label) ?? []), card]);
  }
  return order
    .filter((label) => buckets.has(label))
    .map((label) => ({
      label,
      cards: [...buckets.get(label)!].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/** The section legendary cards are filed under, in a deck list and in
 * the Curation. */
export const LEGENDARIES = 'Legendaries';

/** A deck list as the editor shows it: every legendary card first, in a
 * section of its own whatever its type, A–Z; then the type groups, which
 * hold only the rest. (`groupCards` alone still counts a legendary
 * creature as a creature — that is what the "Made of" line wants.) */
export function sectionCards(cards: DeckCard[]): { label: string; cards: DeckCard[] }[] {
  const legends = cards
    .filter((c) => isLegendary(c.typeLine))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rest = groupCards(cards.filter((c) => !isLegendary(c.typeLine)));
  return legends.length > 0 ? [{ label: LEGENDARIES, cards: legends }, ...rest] : rest;
}

/** {2}{G}{G} → 4. X counts 0; hybrids count their digit if any, else 1. */
export function manaValue(manaCost: string): number {
  let total = 0;
  for (const [, symbol] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const digits = symbol.match(/\d+/);
    if (digits) total += Number(digits[0]);
    else if (!symbol.includes('X')) total += 1;
  }
  return total;
}

/** Cards whose color identity leaves the commander's — best effort: cards
 * saved without identity data (older imports) are never flagged. */
export function offColorCards(deck: Deck): DeckCard[] {
  if (!deck.commander || deck.colors.length === 0) return [];
  const allowed = new Set(deck.colors);
  return deck.cards.filter(
    (c) => c.colorIdentity !== undefined && c.colorIdentity.some((color) => !allowed.has(color)),
  );
}

export interface DeckStats {
  lands: number;
  ramp: number;
  draw: number;
  removal: number;
}

/** Rough commander staples count from rules text — a nudge, not a judge. */
export function deckStats(
  entries: { typeLine: string; oracleText: string; count: number }[],
): DeckStats {
  const stats: DeckStats = { lands: 0, ramp: 0, draw: 0, removal: 0 };
  for (const e of entries) {
    if (bucketOf(e.typeLine) === 'Lands') {
      stats.lands += e.count;
      continue;
    }
    if (/add \{|add (one|two|three) mana|search your library for[^.]*land/i.test(e.oracleText))
      stats.ramp += e.count;
    if (/draw (a|one|two|three|x|that many) card/i.test(e.oracleText)) stats.draw += e.count;
    if (/(destroy|exile) target/i.test(e.oracleText)) stats.removal += e.count;
  }
  return stats;
}

/** How many copies each color appears in (a Golgari card counts toward
 * both B and G), plus true colorless and identity-unknown tallies. */
export function colorBreakdown(
  entries: { count: number; identity?: string[] }[],
): Record<'W' | 'U' | 'B' | 'R' | 'G', number> & { colorless: number; unknown: number } {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0, colorless: 0, unknown: 0 };
  for (const e of entries) {
    if (!e.identity) out.unknown += e.count;
    else if (e.identity.length === 0) out.colorless += e.count;
    else for (const c of e.identity) if (c in out) out[c as 'W'] += e.count;
  }
  return out;
}

/** What players track by name that the big buckets hide: two subtypes,
 * and the legendary cards of every type. */
export function compositionExtras(cards: DeckCard[]): {
  equipment: number;
  auras: number;
  legendaries: number;
} {
  let equipment = 0;
  let auras = 0;
  let legendaries = 0;
  for (const c of cards) {
    if (/\bEquipment\b/.test(c.typeLine)) equipment += c.count;
    if (/\bAura\b/.test(c.typeLine)) auras += c.count;
    if (isLegendary(c.typeLine)) legendaries += c.count;
  }
  return { equipment, auras, legendaries };
}

/** 0–5 stars per card: how hard it leans into the commander's themes,
 * scaled so the deck's best fit anchors five stars. Zero themes shared
 * (or no commander) = zero stars — honest, not flattering. */
export function starRatings(
  commander: CardRecord | null,
  entries: { cardId: string; record: CardRecord }[],
): Record<string, number> {
  if (!commander) return {};
  const themes = cardThemes(commander);
  if (themes.length === 0) return {};
  const raw = entries.map((e) => ({ cardId: e.cardId, score: synergyScore(themes, e.record) }));
  const max = Math.max(0, ...raw.map((r) => r.score));
  if (max === 0) return Object.fromEntries(raw.map((r) => [r.cardId, 0]));
  const stars: Record<string, number> = {};
  for (const r of raw) {
    stars[r.cardId] = r.score === 0 ? 0 : Math.max(1, Math.round((r.score / max) * 5));
  }
  return stars;
}

/** Buckets 0–6 and 7+, nonland cards only, weighted by copy count. */
export function manaCurve(cards: DeckCard[]): number[] {
  const curve = new Array<number>(8).fill(0);
  for (const card of cards) {
    if (bucketOf(card.typeLine) === 'Lands') continue;
    curve[Math.min(7, manaValue(card.manaCost))] += card.count;
  }
  return curve;
}
