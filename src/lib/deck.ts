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

export function addCard(deck: Deck, card: CardRecord): Deck {
  const existing = deck.cards.find((c) => c.cardId === card.id);
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

export function setCommander(deck: Deck, card: CardRecord): Deck {
  return touched({
    ...deck,
    commander: toDeckCard(card),
    colors: card.colorIdentity ?? card.colors,
  });
}

export function deckSize(deck: Deck): number {
  return deck.cards.reduce((sum, c) => sum + c.count, 0) + (deck.commander ? 1 : 0);
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

/** Buckets 0–6 and 7+, nonland cards only, weighted by copy count. */
export function manaCurve(cards: DeckCard[]): number[] {
  const curve = new Array<number>(8).fill(0);
  for (const card of cards) {
    if (bucketOf(card.typeLine) === 'Lands') continue;
    curve[Math.min(7, manaValue(card.manaCost))] += card.count;
  }
  return curve;
}
