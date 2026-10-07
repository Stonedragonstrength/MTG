import Dexie, { type Table } from 'dexie';
import type { DeckRow, ProfileRow } from '../lib/sync';
import type { CardRecord, GarageCard } from '../lib/types';

export interface KvEntry {
  key: string;
  value: unknown;
}

export class AppDb extends Dexie {
  cards!: Table<CardRecord, string>;
  // Decks and profiles are stored with their sync bookkeeping (tombstone,
  // awaiting-push flag); the store hands the app the content only. Neither
  // flag is indexed — the tables are small — so no schema version for them.
  profiles!: Table<ProfileRow, string>;
  kv!: Table<KvEntry, string>;
  decks!: Table<DeckRow, string>;
  garage!: Table<GarageCard, string>;

  constructor(name = 'mtg-companion') {
    super(name);
    // Booleans are not valid IndexedDB keys, so isToken/isBasicLand are not indexed;
    // those lookups are rare one-off scans.
    this.version(1).stores({
      cards: 'id, nameLower',
      profiles: 'id',
      kv: 'key',
    });
    this.version(2).stores({
      decks: 'id',
    });
    this.version(3).stores({
      garage: 'cardId, dirty',
    });
  }
}

let instance: AppDb | null = null;

export function getDb(): AppDb {
  if (!instance) instance = new AppDb();
  return instance;
}

/** Test hook: points the whole app at another database, so one test can
 * be two devices. Called with no name it returns to the real one. */
const opened = new Map<string, AppDb>();
export function _useDbForTests(name = 'mtg-companion'): void {
  if (instance) opened.set(instance.name, instance);
  if (!opened.has(name)) opened.set(name, new AppDb(name));
  instance = opened.get(name)!;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const entry = await getDb().kv.get(key);
  return entry?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await getDb().kv.put({ key, value });
}

export async function kvDelete(key: string): Promise<void> {
  await getDb().kv.delete(key);
}
