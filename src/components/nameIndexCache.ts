import { loadNameIndex } from '../data/scryfall';

let cached: Promise<{ id: string; name: string }[]> | null = null;

/** Name index is ~35k entries; load it once per session. */
export function getNameIndex(): Promise<{ id: string; name: string }[]> {
  cached ??= loadNameIndex();
  return cached;
}

/** Call after re-importing the card database so searches see the new index. */
export function invalidateNameIndex(): void {
  cached = null;
}
