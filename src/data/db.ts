import Dexie, { type Table } from 'dexie';
import type { CardRecord, Deck, PlayerProfile } from '../lib/types';

export interface KvEntry {
  key: string;
  value: unknown;
}

export class AppDb extends Dexie {
  cards!: Table<CardRecord, string>;
  profiles!: Table<PlayerProfile, string>;
  kv!: Table<KvEntry, string>;
  decks!: Table<Deck, string>;

  constructor() {
    super('mtg-companion');
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
  }
}

let instance: AppDb | null = null;

export function getDb(): AppDb {
  if (!instance) instance = new AppDb();
  return instance;
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
