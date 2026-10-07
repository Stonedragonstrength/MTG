import { isCommanderLegal } from '../lib/game';
import { canPartner, partnerKinds } from '../lib/partner';
import { cardThemes, profileScore, sharedThemes, synergyScore } from '../lib/themes';
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

/** Every card the rules let sit in the command zone beside this one:
 * partners, the named partner, Backgrounds, the Doctor's companions. */
export async function findPartnersFor(commander: CardRecord, limit = 80): Promise<CardRecord[]> {
  if (partnerKinds(commander).length === 0) return [];
  const found: CardRecord[] = [];
  await getDb().cards.each((candidate) => {
    if (candidate.isToken || candidate.id === commander.id) return;
    if (canPartner(commander, candidate)) found.push(candidate);
  });
  return found.sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
}

export interface CommanderMatch {
  card: CardRecord;
  score: number;
  shared: string[];
}

/** Reverse commander search: who wants to lead this pile? Streams the
 * database keeping commander-legal cards whose identity can cover the
 * deck's colors, ranked by how hard they lean into the deck's themes. */
export async function findCommandersFor(
  profile: Record<string, number>,
  deckColors: string[],
  limit = 10,
): Promise<CommanderMatch[]> {
  if (Object.keys(profile).length === 0) return [];
  const db = getDb();

  let hits: CommanderMatch[] = [];
  const prune = () => {
    hits.sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name));
    hits = hits.slice(0, PRUNE_TO);
  };

  await db.cards.each((candidate) => {
    if (candidate.isToken || !isCommanderLegal(candidate)) return;
    const identity = candidate.colorIdentity ?? candidate.colors;
    if (deckColors.some((c) => !identity.includes(c))) return;
    const { score, shared } = profileScore(profile, candidate);
    if (score <= 0) return;
    hits.push({ card: candidate, score, shared });
    if (hits.length > PRUNE_AT) prune();
  });

  prune();
  return hits.slice(0, limit);
}
