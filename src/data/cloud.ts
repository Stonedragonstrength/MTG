import { mergeGarage } from '../lib/garageSync';
import type { GarageCard } from '../lib/types';
import { getDb, kvGet, kvSet } from './db';

export interface CloudConfig {
  url: string;
  anonKey: string;
}

const CFG_KEY = 'cloudConfig';

type Supabase = import('@supabase/supabase-js').SupabaseClient;
let clientPromise: Promise<Supabase | null> | null = null;

export async function getCloudConfig(): Promise<CloudConfig | undefined> {
  return kvGet<CloudConfig>(CFG_KEY);
}

/** "xyz.supabase.co/" and friends become a URL the client accepts. */
export function normalizeProjectUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

export async function setCloudConfig(cfg: CloudConfig): Promise<void> {
  await kvSet(CFG_KEY, { url: normalizeProjectUrl(cfg.url), anonKey: cfg.anonKey.trim() });
  clientPromise = null; // next call builds a client against the new project
}

/** Lazy client: supabase-js stays out of the main bundle, and no client
 * exists at all until a config is saved. A config the client rejects
 * (mangled URL) yields null rather than a cached rejection. */
async function getClient(): Promise<Supabase | null> {
  clientPromise ??= (async () => {
    try {
      const cfg = await getCloudConfig();
      if (!cfg?.url || !cfg.anonKey) return null;
      const { createClient } = await import('@supabase/supabase-js');
      return createClient(normalizeProjectUrl(cfg.url), cfg.anonKey);
    } catch {
      clientPromise = null; // let a corrected config try again
      return null;
    }
  })();
  return clientPromise;
}

export async function sendMagicLink(email: string): Promise<string | null> {
  try {
    const cfg = await getCloudConfig();
    if (!cfg?.url || !cfg.anonKey) return 'Save your project URL and key first.';
    const client = await getClient();
    if (!client) return "That project URL doesn't look right — double-check it and Save again.";
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return error ? error.message : null;
  } catch (err) {
    return `Couldn't reach the project: ${err instanceof Error ? err.message : 'network error'}`;
  }
}

export async function signedInEmail(): Promise<string | null> {
  const client = await getClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user?.email ?? null;
}

interface RemoteRow {
  card_id: string;
  name: string;
  type_line: string;
  image: string | null;
  count: number;
  deleted: boolean;
  updated_at: string;
}

function toRemote(row: GarageCard) {
  return {
    card_id: row.cardId,
    name: row.name,
    type_line: row.typeLine,
    image: row.imageNormal,
    count: row.count,
    deleted: row.deleted,
    updated_at: new Date(row.updatedAt).toISOString(),
  };
}

function fromRemote(row: RemoteRow): GarageCard {
  return {
    cardId: row.card_id,
    name: row.name,
    typeLine: row.type_line,
    imageNormal: row.image,
    count: row.count,
    deleted: row.deleted,
    updatedAt: Date.parse(row.updated_at),
    dirty: 0,
  };
}

/** Pull the cloud garage, merge last-write-wins, push what's newer here.
 * Returns a human status line; never throws (offline is a status, not an
 * error). */
export async function syncGarage(): Promise<string> {
  const client = await getClient();
  if (!client) return 'Cloud not configured';
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) return 'Not signed in yet';

  try {
    const { data, error } = await client.from('garage_cards').select('*');
    if (error) return `Sync failed: ${error.message}`;
    const remote = (data as RemoteRow[]).map(fromRemote);
    const local = await getDb().garage.toArray();
    const { merged, toPush } = mergeGarage(local, remote);

    await getDb().garage.bulkPut(merged);
    if (toPush.length > 0) {
      const { error: pushError } = await client
        .from('garage_cards')
        .upsert(toPush.map(toRemote), { onConflict: 'user_id,card_id' });
      if (pushError) return `Push failed: ${pushError.message}`;
      await getDb().garage.bulkPut(toPush.map((r) => ({ ...r, dirty: 0 as const })));
    }
    await kvSet('garageLastSync', Date.now());
    return `Synced ${merged.filter((m) => !m.deleted).length} cards`;
  } catch (err) {
    return `Offline (${err instanceof Error ? err.message : 'network'})`;
  }
}

let pokeTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced background sync: schedules only when a cloud config exists,
 * so devices that never set up Supabase never tick a timer. */
export function pokeSync(onDone?: () => void): void {
  void getCloudConfig().then((cfg) => {
    if (!cfg?.url || !cfg.anonKey) return;
    clearTimeout(pokeTimer);
    pokeTimer = setTimeout(() => {
      void syncGarage().then(() => onDone?.());
    }, 4000);
  });
}

/** The SQL Nathan pastes once into the Supabase SQL editor. */
export const SETUP_SQL = `create table if not exists garage_cards (
  user_id uuid not null default auth.uid(),
  card_id text not null,
  name text not null,
  type_line text not null default '',
  image text,
  count int not null default 1,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
alter table garage_cards enable row level security;
create policy "own rows" on garage_cards for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);`;
