import { loadNameIndex } from '../data/scryfall';

let cached: Promise<{ id: string; name: string }[]> | null = null;

/** Name index is ~35k entries; load it once per session. */
export function getNameIndex(): Promise<{ id: string; name: string }[]> {
  cached ??= loadNameIndex();
  return cached;
}
