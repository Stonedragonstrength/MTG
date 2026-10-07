import type { CardRecord } from './types';

/** A collection row joined to what the card database knows about it. */
export interface OwnedRow {
  cardId: string;
  count: number;
  /** Color identity; absent while the record is unresolved. */
  identity?: string[];
}

/** A commander the collection could be built around. */
export interface Buildable {
  card: CardRecord;
  score: number;
  shared: string[];
  /** Copies you own that are legal in its colors. */
  coverage: number;
  /** You own the commander itself. */
  owned: boolean;
}

/** How many owned copies fit inside a color identity (colorless cards fit
 * anywhere). Rows whose identity is not known yet are left out rather
 * than guessed at. */
export function ownedCoverage(identity: string[], rows: OwnedRow[]): number {
  return rows.reduce(
    (sum, row) =>
      row.identity && row.identity.every((c) => identity.includes(c)) ? sum + row.count : sum,
    0,
  );
}

/** A commander already in the binder beats a slightly better fit you
 * would have to go and buy. */
const OWNED_BOOST = 1.5;

/** Ranks theme matches for "what can I build?": by how hard each commander
 * leans into the collection's themes, lifted when you own it, with the
 * number of owned cards that fit its colors alongside. */
export function rankBuildable(
  matches: { card: CardRecord; score: number; shared: string[] }[],
  rows: OwnedRow[],
  limit = 10,
): Buildable[] {
  const ownedIds = new Set(rows.map((r) => r.cardId));
  const weight = (b: Buildable) => b.score * (b.owned ? OWNED_BOOST : 1);
  return matches
    .map((m) => ({
      ...m,
      coverage: ownedCoverage(m.card.colorIdentity ?? m.card.colors, rows),
      owned: ownedIds.has(m.card.id),
    }))
    .sort((a, b) => weight(b) - weight(a) || a.card.name.localeCompare(b.card.name))
    .slice(0, limit);
}
