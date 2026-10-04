import { cardThemes, sharedThemes, synergyScore } from '../lib/themes';
import type { CardRecord } from '../lib/types';
import { getDb } from './db';

export interface SynergyHit {
  card: CardRecord;
  score: number;
  shared: string[];
}

const PRUNE_AT = 400;
const PRUNE_TO = 150;

/** Streams the whole card database once, keeping the best theme-sharing
 * cards. Heuristic text similarity — EDHREC it is not, but it works offline. */
export async function findSynergiesFor(cardId: string, limit = 20): Promise<SynergyHit[]> {
  const db = getDb();
  const target = await db.cards.get(cardId);
  if (!target) return [];
  const themes = cardThemes(target);
  if (themes.length === 0) return [];

  let hits: SynergyHit[] = [];
  const prune = () => {
    hits.sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name));
    hits = hits.slice(0, PRUNE_TO);
  };

  await db.cards.each((candidate) => {
    if (candidate.id === cardId || candidate.isBasicLand || candidate.isToken) return;
    if (candidate.name === target.name) return;
    const score = synergyScore(themes, candidate);
    if (score <= 0) return;
    hits.push({ card: candidate, score, shared: sharedThemes(themes, candidate) });
    if (hits.length > PRUNE_AT) prune();
  });

  prune();
  return hits.slice(0, limit);
}
