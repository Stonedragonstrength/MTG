import { matchScannedTitle, parseDeckList } from '../lib/decklist';
import type { CardRecord } from '../lib/types';
import { findCardByName, getCardById, loadNameIndex } from './scryfall';

export interface ResolvedLine {
  card: CardRecord;
  count: number;
  commander: boolean;
}

export interface ImportResult {
  hits: ResolvedLine[];
  misses: string[]; // original-ish lines that found no real card
}

/** Turns pasted decklist text into real cards: exact name first, fuzzy
 * rescue second, tokens never. Unresolvable lines come back for the
 * human to deal with. */
export async function resolveDeckList(text: string): Promise<ImportResult> {
  const parsed = parseDeckList(text);
  const hits: ResolvedLine[] = [];
  const misses: string[] = [];
  let index: { id: string; name: string }[] | null = null;

  for (const line of parsed) {
    let card = await findCardByName(line.name).catch(() => undefined);
    if (!card || card.isToken) {
      index ??= await loadNameIndex();
      for (const candidate of matchScannedTitle(line.name, index)) {
        const record = await getCardById(candidate.id).catch(() => undefined);
        if (record && !record.isToken) {
          card = record;
          break;
        }
      }
    }
    if (!card || card.isToken) {
      misses.push(`${line.count} ${line.name}`);
      continue;
    }
    hits.push({ card, count: line.count, commander: line.commander });
  }
  return { hits, misses };
}
