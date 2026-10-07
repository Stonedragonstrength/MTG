import type { Table } from 'dexie';
import { mergeGarage } from '../lib/garageSync';
import {
  keepNewerLists,
  keysToPull,
  mergeProfiles,
  mergePulled,
  type DeckRow,
  type ProfileRow,
  type RowHead,
} from '../lib/sync';
import type { GarageCard } from '../lib/types';
import { getDb, kvDelete, kvGet, kvSet } from './db';

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
 * (mangled URL) yields null rather than a cached rejection. Shared with
 * the online-table sync module. */
export async function getSupabase(): Promise<Supabase | null> {
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
    const client = await getSupabase();
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
  const client = await getSupabase();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user?.email ?? null;
}

/** A row as it travels: column → value. */
type Wire = Record<string, unknown>;

interface CloudError {
  code?: string;
  message: string;
}

/** Everything that touches the network, behind one seam: the sync itself is
 * tested against an in-memory stand-in for the project (cloud.sync.test.ts). */
export const deps = {
  now: () => Date.now(),

  /** Why this device cannot sync at all, as a status line — null when it can. */
  async blocked(): Promise<string | null> {
    const client = await getSupabase();
    if (!client) return 'Cloud not configured';
    const { data } = await client.auth.getUser();
    return data.user ? null : 'Not signed in yet';
  },

  /** The signed-in user's rows of `table` (row level security sees to
   * "own rows only"), narrowed to `only.keys` when given. */
  async select(
    table: string,
    columns: string,
    only?: { column: string; keys: string[] },
  ): Promise<{ rows: Wire[] } | { error: CloudError }> {
    const client = await getSupabase();
    if (!client) return { error: { message: 'Cloud not configured' } };
    const query = client.from(table).select(columns);
    const { data, error } = await (only ? query.in(only.column, only.keys) : query);
    if (error) return { error: { code: error.code, message: error.message } };
    return { rows: (data ?? []) as unknown as Wire[] };
  },

  async upsert(table: string, rows: Wire[], onConflict: string): Promise<CloudError | null> {
    const client = await getSupabase();
    if (!client) return { message: 'Cloud not configured' };
    const { error } = await client.from(table).upsert(rows, { onConflict });
    return error ? { code: error.code, message: error.message } : null;
  },
};

/** How one table's sync ended. A table that is not there yet is not a
 * failure: the owner has one more piece of SQL to paste. */
type Outcome =
  | { kind: 'synced'; count: number }
  | { kind: 'setup' }
  | { kind: 'failed'; line: string };

// A missing table, as PostgREST says it and as Postgres itself does.
const NO_SUCH_TABLE = ['PGRST205', '42P01'];

function refused(what: 'Sync' | 'Push', error: CloudError): Outcome {
  if (NO_SUCH_TABLE.includes(error.code ?? '')) return { kind: 'setup' };
  return { kind: 'failed', line: `${what} failed: ${error.message}` };
}

/** Never throws: offline is a status, not an error. */
async function attempt(run: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await run();
  } catch (err) {
    return { kind: 'failed', line: `Offline (${err instanceof Error ? err.message : 'network'})` };
  }
}

async function blockedLine(): Promise<string | null> {
  try {
    return await deps.blocked();
  } catch (err) {
    return `Offline (${err instanceof Error ? err.message : 'network'})`;
  }
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

/** Pull the cloud garage, merge last-write-wins, push what's newer here. */
async function garageSync(): Promise<Outcome> {
  const reply = await deps.select('garage_cards', '*');
  if ('error' in reply) return { kind: 'failed', line: `Sync failed: ${reply.error.message}` };
  const remote = (reply.rows as unknown as RemoteRow[]).map(fromRemote);
  const local = await getDb().garage.toArray();
  const { merged, toPush } = mergeGarage(local, remote);

  await getDb().garage.bulkPut(merged);
  if (toPush.length > 0) {
    const pushError = await deps.upsert('garage_cards', toPush.map(toRemote), 'user_id,card_id');
    if (pushError) return { kind: 'failed', line: `Push failed: ${pushError.message}` };
    await getDb().garage.bulkPut(toPush.map((r) => ({ ...r, dirty: 0 as const })));
  }
  await kvSet('garageLastSync', Date.now());
  return { kind: 'synced', count: merged.filter((m) => !m.deleted).length };
}

// ---- decks and players ----
// One table each, own rows only: (user_id, deck_id | profile_id, data jsonb,
// deleted, updated_at) — DECKS_PLAYERS_SQL below. `data` is the row as JSON
// without its waiting flag; the id, the stamp and the tombstone are read
// back from their own columns, which is what the index is made of.

/** The whole of one stored row, as the merge and the wire need it. */
type Stored = { id: string; updatedAt?: number; deleted?: true; dirty?: 0 | 1 };

function toWire(row: Stored, key: string): Wire {
  const { dirty, ...data } = row;
  // A stamp no date can hold (a damaged row) must not stop every other row
  // from syncing: it goes up as the oldest there is.
  const stamp = new Date(row.updatedAt ?? 0);
  return {
    [key]: row.id,
    data,
    deleted: row.deleted === true,
    updated_at: (Number.isNaN(stamp.getTime()) ? new Date(0) : stamp).toISOString(),
  };
}

/** Null for anything that is not a row of ours (a newer build's shape, a
 * stray hand in the table editor): it is passed over, never stored. */
function fromWire<T extends Stored>(
  wire: Wire,
  key: string,
  sound: (data: Wire) => boolean,
): T | null {
  const id = wire[key];
  const data = wire.data;
  const stamp = Date.parse(String(wire.updated_at));
  if (typeof id !== 'string' || Number.isNaN(stamp)) return null;
  if (!data || typeof data !== 'object' || !sound(data as Wire)) return null;
  const { deleted, dirty, ...content } = data as Wire;
  return {
    ...content,
    id,
    updatedAt: stamp,
    ...(wire.deleted === true ? { deleted: true } : {}),
    dirty: 0,
  } as unknown as T;
}

const soundDeck = (d: Wire) =>
  typeof d.name === 'string' && Array.isArray(d.cards) && Array.isArray(d.colors);
const soundProfile = (p: Wire) => typeof p.name === 'string';

function toHead(wire: Wire, key: string): RowHead[] {
  const id = wire[key];
  const stamp = Date.parse(String(wire.updated_at));
  if (typeof id !== 'string' || Number.isNaN(stamp)) return [];
  return [{ key: id, updatedAt: stamp, deleted: wire.deleted === true }];
}

/** A row saved before decks and players synced carries no flag at all: it
 * has never been sent, so it is waiting like any other change. */
const waiting = <T extends Stored>(row: T): T =>
  row.dirty === undefined ? { ...row, dirty: 1 } : row;

/** Which copy of a row this is: its stamp, or -1 for no row at all. */
const version = (row: Stored | undefined) => (row ? (row.updatedAt ?? 0) : -1);

function* chunks<T>(all: T[], size: number): Generator<T[]> {
  for (let i = 0; i < all.length; i += size) yield all.slice(i, i + size);
}

// Keys travel in the URL, and a deck is a hundred cards: neither goes out
// in one piece when there are many.
const KEYS_PER_PULL = 40;
const DECKS_PER_PUSH = 10;
const PROFILES_PER_PUSH = 50;

/** Writes what the merge decided — unless the row was saved again on this
 * device after the merge read it. A sync spends its time waiting on the
 * network, and a save made meanwhile is newer than anything decided here:
 * it stays, still waiting, and the next sync settles it. `dropped` rows
 * are removed outright, under the same condition. */
async function applyMerged<T extends Stored>(
  table: Table<T, string>,
  before: T[],
  merged: T[],
  dropped: string[] = [],
): Promise<void> {
  const read = new Map(before.map((row) => [row.id, row]));
  await getDb().transaction('rw', table, async () => {
    for (const row of merged) {
      const was = read.get(row.id);
      if (row === was) continue; // ours won, or stayed: nothing to write
      // The cloud's copy is the one already held (the usual case when a
      // table is pulled whole): nothing to write either.
      const held = was?.dirty === 0 && version(was) === version(row) && was.deleted === row.deleted;
      if (!held && version(await table.get(row.id)) === version(was)) await table.put(row);
    }
    for (const id of dropped) {
      if (version(await table.get(id)) === version(read.get(id))) await table.delete(id);
    }
  });
}

/** Sends `rows` up in pieces and marks each piece as sent once the cloud has
 * it — again only the rows that have not been saved anew while it travelled. */
async function pushRows<T extends Stored>(
  table: Table<T, string>,
  name: string,
  key: string,
  rows: T[],
  perPush: number,
): Promise<CloudError | null> {
  for (const part of chunks(rows, perPush)) {
    const error = await deps.upsert(name, part.map((row) => toWire(row, key)), `user_id,${key}`);
    if (error) return error;
    await getDb().transaction('rw', table, async () => {
      for (const sent of part) {
        const now = await table.get(sent.id);
        if (now && version(now) === version(sent)) await table.put({ ...now, dirty: 0 });
      }
    });
  }
  return null;
}

/** The first time a sync reaches the cloud's table, this device's own rows
 * are put aside once, exactly as they were before any sync touched them.
 * Nothing in the app reads the copy and it never leaves the device: it is
 * there so that hand-typed decks can be brought back by hand if a first
 * sync ever goes wrong. A device with nothing yet notes an empty copy, so
 * what it downloads later is not mistaken for its own. */
async function keepCopyOnce(key: string, rows: unknown[]): Promise<void> {
  try {
    if ((await kvGet(key)) === undefined) await kvSet(key, { at: deps.now(), rows });
  } catch {
    // A safety copy is never worth failing a sync over.
  }
}

/** Decks are heavy and a sync runs seconds after every edit, so they are
 * pulled in two steps: the light index first, then whole rows only for
 * the decks the cloud holds newer than this device does. */
async function decksSync(): Promise<Outcome> {
  const db = getDb();
  const index = await deps.select('decks', 'deck_id,updated_at,deleted');
  if ('error' in index) return refused('Sync', index.error);
  const heads = index.rows.flatMap((row) => toHead(row, 'deck_id'));
  const stored = await db.decks.toArray();
  await keepCopyOnce('decksBeforeSync', stored);
  const local = stored.map(waiting);

  const pulled: DeckRow[] = [];
  const wanted = keysToPull(local, heads, (d) => d.id);
  for (const keys of chunks(wanted, KEYS_PER_PULL)) {
    const reply = await deps.select('decks', '*', { column: 'deck_id', keys });
    if ('error' in reply) return refused('Sync', reply.error);
    pulled.push(...reply.rows.flatMap((row) => fromWire<DeckRow>(row, 'deck_id', soundDeck) ?? []));
  }

  // A deletion from a device that had not seen this one's newer list takes
  // the deck off the screen, not the list out of the world (keepNewerLists).
  const { merged, toPush } = keepNewerLists(
    local,
    mergePulled(local, heads, pulled, (d) => d.id),
  );
  await applyMerged(db.decks, local, merged);
  const pushError = await pushRows(db.decks, 'decks', 'deck_id', toPush, DECKS_PER_PUSH);
  if (pushError) return refused('Push', pushError);
  return { kind: 'synced', count: await db.decks.filter((d) => !d.deleted).count() };
}

/** Profiles are small: pulled whole, and merged with the one extra rule
 * that the same player typed in on two devices becomes one (mergeProfiles). */
async function profilesSync(): Promise<Outcome> {
  const db = getDb();
  const reply = await deps.select('player_profiles', '*');
  if ('error' in reply) return refused('Sync', reply.error);
  const remote = reply.rows.flatMap(
    (row) => fromWire<ProfileRow>(row, 'profile_id', soundProfile) ?? [],
  );
  const stored = await db.profiles.toArray();
  await keepCopyOnce('playersBeforeSync', stored);
  const local = stored.map(waiting);

  const { merged, toPush, dropped } = mergeProfiles(local, remote, deps.now());
  await applyMerged(db.profiles, local, merged, dropped);
  const pushError = await pushRows(
    db.profiles,
    'player_profiles',
    'profile_id',
    toPush,
    PROFILES_PER_PUSH,
  );
  if (pushError) return refused('Push', pushError);
  return { kind: 'synced', count: await db.profiles.filter((p) => !p.deleted).count() };
}

// ---- status ----

const SETUP_KEY = 'cloudSetupPending';
const SETUP_LINE = 'need one more setup step';

/** True while the last sync found the decks / players tables missing: the
 * owner still has DECKS_PLAYERS_SQL to paste. Settings shows the step. */
export async function setupPending(): Promise<boolean> {
  return (await kvGet<boolean>(SETUP_KEY)) === true;
}

/** Remembers a missing table; forgets it only once both have answered. */
async function noteSetup(decks: Outcome | null, players: Outcome | null): Promise<void> {
  try {
    if (decks?.kind === 'setup' || players?.kind === 'setup') await kvSet(SETUP_KEY, true);
    else if (decks?.kind === 'synced' && players?.kind === 'synced') await kvDelete(SETUP_KEY);
  } catch {
    // Only a hint for the Settings screen: never worth failing a sync over.
  }
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function oneLine(outcome: Outcome, one: string, many: string): string {
  if (outcome.kind === 'synced') return `Synced ${counted(outcome.count, one, many)}`;
  if (outcome.kind === 'setup') return `${many[0].toUpperCase()}${many.slice(1)} ${SETUP_LINE}`;
  return outcome.line;
}

/** "Synced 412 cards · 9 decks · 5 players", and what did not go as planned. */
function statusLine(cards: Outcome, decks: Outcome, players: Outcome): string {
  const all: [Outcome, string, string, string][] = [
    [cards, 'card', 'cards', 'Curation'],
    [decks, 'deck', 'decks', 'decks'],
    [players, 'player', 'players', 'players'],
  ];
  const done = all.flatMap(([o, one, many]) =>
    o.kind === 'synced' ? counted(o.count, one, many) : [],
  );
  const failures = all.flatMap(([o, , , label]) =>
    o.kind === 'failed' ? { label, line: o.line } : [],
  );
  const setup = decks.kind === 'setup' || players.kind === 'setup';
  // Everything failed the same way (offline, mostly): say it once.
  if (failures.length === all.length && failures.every((f) => f.line === failures[0].line))
    return failures[0].line;
  return [
    ...(done.length > 0 ? [`Synced ${done.join(' · ')}`] : []),
    ...(setup ? [`decks and players ${SETUP_LINE}`] : []),
    ...failures.map((f) => `${f.label}: ${f.line}`),
  ].join(' · ');
}

// ---- the public syncs: each returns a human status line and never throws ----

export async function syncGarage(): Promise<string> {
  return (await blockedLine()) ?? oneLine(await attempt(garageSync), 'card', 'cards');
}

export async function syncDecks(): Promise<string> {
  const stop = await blockedLine();
  if (stop) return stop;
  const outcome = await attempt(decksSync);
  if (outcome.kind === 'setup') await noteSetup(outcome, null);
  return oneLine(outcome, 'deck', 'decks');
}

export async function syncProfiles(): Promise<string> {
  const stop = await blockedLine();
  if (stop) return stop;
  const outcome = await attempt(profilesSync);
  if (outcome.kind === 'setup') await noteSetup(null, outcome);
  return oneLine(outcome, 'player', 'players');
}

async function runAll(): Promise<string> {
  const stop = await blockedLine();
  if (stop) return stop;
  // One after the other, each on its own: a table that is missing or a push
  // that is refused never keeps the Curation, or the other table, from syncing.
  const cards = await attempt(garageSync);
  const decks = await attempt(decksSync);
  const players = await attempt(profilesSync);
  await noteSetup(decks, players);
  return statusLine(cards, decks, players);
}

let running: Promise<string> | null = null;
let queued: Promise<string> | null = null;

/** The Curation, decks and players, in one go and one status line.
 * Only one runs at a time. Asked again meanwhile (an edit made while a
 * sync is in the air pokes four seconds later), it runs once more when
 * the first is done — the first may have read the database too early to
 * see what changed — and however many asked share that one run. */
export function syncAll(): Promise<string> {
  if (!running) {
    running = runAll().finally(() => {
      running = null;
    });
    return running;
  }
  const again = () => {
    queued = null;
    return syncAll();
  };
  queued ??= running.then(again, again);
  return queued;
}

let pokeTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced background sync: schedules only when a cloud config exists,
 * so devices that never set up Supabase never tick a timer. */
export function pokeSync(onDone?: () => void): void {
  void getCloudConfig().then((cfg) => {
    if (!cfg?.url || !cfg.anonKey) return;
    clearTimeout(pokeTimer);
    pokeTimer = setTimeout(() => {
      void syncAll().then(() => onDone?.());
    }, 4000);
  });
}

const RESUME_GAP_MS = 60_000;
let resumeDone: (() => void) | undefined;
let resumeBound = false;
let lastResumePoke = 0;

function onVisibility() {
  if (document.visibilityState !== 'visible') return;
  const now = deps.now();
  if (now - lastResumePoke < RESUME_GAP_MS) return;
  lastResumePoke = now;
  pokeSync(resumeDone);
}

/** The tablet's app is rarely relaunched: it is resumed. So coming back
 * to the foreground pokes the sync too — at most once a minute, however
 * often the app is flicked away and back. */
export function pokeOnResume(onDone?: () => void): void {
  resumeDone = onDone;
  if (resumeBound || typeof document === 'undefined') return;
  resumeBound = true;
  document.addEventListener('visibilitychange', onVisibility);
}

/** Test hook: back to a module that has never synced or poked. */
export function _resetForTests(): void {
  clearTimeout(pokeTimer);
  pokeTimer = undefined;
  if (resumeBound) document.removeEventListener('visibilitychange', onVisibility);
  resumeBound = false;
  resumeDone = undefined;
  lastResumePoke = 0;
  running = null;
  queued = null;
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

/** The second paste: decks and players. The same text is kept at the repo
 * root as decks-players-setup.sql (a test holds the two together). Safe to
 * run twice — Supabase warns about the drop-policy lines, which is expected. */
export const DECKS_PLAYERS_SQL = `create table if not exists decks (
  user_id uuid not null default auth.uid(),
  deck_id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, deck_id)
);
alter table decks enable row level security;
drop policy if exists "own rows" on decks;
create policy "own rows" on decks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists player_profiles (
  user_id uuid not null default auth.uid(),
  profile_id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id)
);
alter table player_profiles enable row level security;
drop policy if exists "own rows" on player_profiles;
create policy "own rows" on player_profiles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);`;
