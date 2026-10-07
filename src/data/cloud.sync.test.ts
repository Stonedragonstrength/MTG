import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addCard, createDeck, setCommander, setPartner } from '../lib/deck';
import type { CardRecord, Deck, PlayerProfile } from '../lib/types';
import { createAppStore, flushPersistence } from '../state/store';
import {
  DECKS_PLAYERS_SQL,
  _resetForTests,
  deps,
  pokeOnResume,
  pokeSync,
  setCloudConfig,
  setupPending,
  syncAll,
  syncDecks,
  syncGarage,
  syncProfiles,
} from './cloud';
import { _useDbForTests, getDb } from './db';

// Decks and players between two devices, with the REAL stores and the real
// sync on both: only the network is stood in for, by a project that keeps
// its rows the way decks-players-setup.sql says it does.

type Wire = Record<string, unknown>;
interface Call {
  op: 'select' | 'upsert';
  table: string;
  columns?: string;
  keys?: string[];
}

const KEY: Record<string, string> = {
  garage_cards: 'card_id',
  decks: 'deck_id',
  player_profiles: 'profile_id',
};

/** A timestamptz as PostgREST prints it: an offset, and no trailing zeros. */
const pg = (ms: number) => new Date(ms).toISOString().replace(/\.?0*Z$/, '+00:00');
/** Everything crosses the wire as JSON. */
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The owner's Supabase project, for one signed-in user. A table that was
 * never created answers the way PostgREST does. */
function project(tables: string[] = ['garage_cards', 'decks', 'player_profiles']) {
  const held = new Map<string, Map<string, Wire>>();
  const calls: Call[] = [];
  let down = false;
  let missingCode = 'PGRST205';
  let gate: { match: (call: Call) => boolean; wait: Promise<void> } | null = null;
  const create = (...names: string[]) => {
    for (const name of names) if (!held.has(name)) held.set(name, new Map());
  };
  create(...tables);
  const missing = (table: string) => ({
    code: missingCode,
    message: `Could not find the table 'public.${table}' in the schema cache`,
  });
  const through = async (call: Call) => {
    if (down) throw new TypeError('Failed to fetch');
    calls.push(call);
    if (gate?.match(call)) await gate.wait;
  };

  deps.blocked = async () => null;
  deps.select = async (table, columns, only) => {
    await through({ op: 'select', table, columns, keys: only?.keys });
    const rows = held.get(table);
    if (!rows) return { error: missing(table) };
    const cols = columns === '*' ? null : columns.split(',');
    return {
      rows: [...rows.values()]
        .filter((row) => !only || only.keys.includes(String(row[only.column])))
        .map((row) => wire(cols ? Object.fromEntries(cols.map((c) => [c, row[c]])) : row)),
    };
  };
  deps.upsert = async (table, sent, onConflict) => {
    const body = wire(sent); // the request is on its way as it was when it left
    await through({ op: 'upsert', table, keys: sent.map((row) => String(row[KEY[table]])) });
    const rows = held.get(table);
    if (!rows) return missing(table);
    if (onConflict !== `user_id,${KEY[table]}`) return { code: '42P10', message: 'no such constraint' };
    if (table !== 'garage_cards' && body.some((row) => row.data === null || row.data === undefined))
      return { code: '23502', message: 'null value in column "data" violates not-null constraint' };
    for (const row of body) {
      const key = String(row[KEY[table]]);
      const stamp = row.updated_at === undefined ? Date.now() : Date.parse(String(row.updated_at));
      rows.set(key, { deleted: false, ...rows.get(key), ...row, updated_at: pg(stamp) });
    }
    return null;
  };

  return {
    calls,
    create,
    rows: (table: string) => [...(held.get(table)?.values() ?? [])],
    row: (table: string, key: string) => held.get(table)?.get(key) as Wire & { data: Wire },
    /** What went over the wire since the last look, as "op table" lines. */
    since(mark: number) {
      return calls.slice(mark).map((c) => `${c.op} ${c.table}${c.columns ? ` ${c.columns}` : ''}`);
    },
    offline(on: boolean) {
      down = on;
    },
    answerMissingWith(code: string) {
      missingCode = code;
    },
    /** Holds every matching request in the air until the returned function is called. */
    pause(match: (call: Call) => boolean) {
      let release = () => {};
      gate = { match, wait: new Promise<void>((resolve) => (release = resolve)) };
      return () => {
        gate = null;
        release();
      };
    },
  };
}

interface Device {
  name: string;
  store: ReturnType<typeof createAppStore>;
}

/** Puts the test on that device: every database call from here on is its own. */
async function on(d: Device) {
  await flushPersistence();
  _useDbForTests(d.name);
  return d.store.getState();
}

async function wipe() {
  const db = getDb();
  await Promise.all([db.kv.clear(), db.profiles.clear(), db.decks.clear(), db.garage.clear()]);
}

/** A device with nothing on it, started up. */
async function device(name: string): Promise<Device> {
  await flushPersistence();
  _useDbForTests(name);
  await wipe();
  const store = createAppStore();
  await store.getState().init();
  return { name, store };
}

/** One full sync on that device, the way the app runs it: sync, then re-read the lists. */
async function sync(d: Device): Promise<string> {
  const state = await on(d);
  const line = await syncAll();
  await state.refreshSynced();
  return line;
}

const card = (id: string, name: string, typeLine: string): CardRecord => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  typeLine,
  oracleText: '',
  manaCost: '',
  power: null,
  toughness: null,
  colors: ['G'],
  colorIdentity: ['G'],
  imageNormal: `https://img.example/${id}.jpg`,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: typeLine.startsWith('Basic Land'),
});

const forest = card('c-forest', 'Forest', 'Basic Land — Forest');
const bolt = card('c-bolt', 'Lightning Bolt', 'Instant');

function stompy(id = 'stompy'): Deck {
  const deck = setCommander({ ...createDeck('Stompy'), id }, card('c-ashaya', 'Ashaya', 'Legendary Creature — Elemental'));
  return addCard(deck, forest);
}

/** A partner pair, marked as owned: the two optional fields a deck can carry. */
function pair(): Deck {
  let deck = setCommander({ ...createDeck('Pair'), id: 'pair' }, card('c-thrasios', 'Thrasios', 'Legendary Creature — Merfolk'));
  deck = setPartner(deck, card('c-tymna', 'Tymna', 'Legendary Creature — Human'));
  return { ...addCard(deck, forest), owned: true };
}

const sam: PlayerProfile = { id: 'sam', name: 'Sam', avatarUrl: 'sam.jpg', commanderName: 'Atraxa' };
const alex: PlayerProfile = { id: 'alex', name: 'Alex', avatarUrl: null, commanderName: null };

const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

beforeEach(async () => {
  await flushPersistence();
  _useDbForTests();
  await wipe();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await flushPersistence();
  _resetForTests();
  _useDbForTests();
});

describe('two devices, one project', () => {
  test('the first sync uploads everything this device has, rows from before syncing included', async () => {
    const cloud = project();
    const desk = await device('desk');
    // Saved by an older build: no flags, and the player was never stamped.
    await getDb().decks.put({ ...createDeck('Old list'), id: 'old', updatedAt: 1000 });
    await getDb().profiles.put({ id: 'jo', name: 'Jo', avatarUrl: null, commanderName: null });
    await desk.store.getState().saveDeck(pair());
    await desk.store.getState().saveProfile(sam);
    await desk.store.getState().addToGarage(bolt);

    expect(await sync(desk)).toBe('Synced 1 card · 2 decks · 2 players');

    expect(cloud.rows('decks').map((r) => r.deck_id).sort()).toEqual(['old', 'pair']);
    expect(cloud.rows('player_profiles').map((r) => r.profile_id).sort()).toEqual(['jo', 'sam']);
    expect(cloud.rows('garage_cards').map((r) => r.card_id)).toEqual(['c-bolt']);

    const local = (await getDb().decks.get('pair'))!;
    const sent = cloud.row('decks', 'pair');
    expect(sent.deleted).toBe(false);
    expect(Date.parse(String(sent.updated_at))).toBe(local.updatedAt);
    expect(sent.data).toMatchObject({ id: 'pair', name: 'Pair', owned: true });
    expect(sent.data).not.toHaveProperty('dirty'); // the row as JSON, without the waiting flag

    // Nothing waits any more, and the lists show the old rows too.
    expect((await getDb().decks.toArray()).map((d) => d.dirty)).toEqual([0, 0]);
    expect((await getDb().profiles.toArray()).map((p) => p.dirty)).toEqual([0, 0]);
    expect(names(desk.store.getState().decks)).toEqual(['Old list', 'Pair']);
    expect(names(desk.store.getState().profiles)).toEqual(['Jo', 'Sam']);
  });

  test('a second device downloads it all, a partner and the "I own these" mark included', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(pair());
    await desk.store.getState().saveDeck(stompy());
    await desk.store.getState().saveProfile(sam);
    await sync(desk);
    const onDesk = desk.store.getState();

    const tablet = await device('tablet');
    const mark = cloud.calls.length;
    expect(await sync(tablet)).toBe('Synced 0 cards · 2 decks · 1 player');

    const onTablet = tablet.store.getState();
    expect(onTablet.decks).toEqual(onDesk.decks); // every field, stamps too
    expect(onTablet.decks.find((d) => d.id === 'pair')).toMatchObject({
      owned: true,
      partner: { name: 'Tymna' },
      commander: { name: 'Thrasios' },
    });
    expect(onTablet.decks.find((d) => d.id === 'stompy')).not.toHaveProperty('owned');
    expect(onTablet.profiles).toEqual(onDesk.profiles);
    expect(onTablet.decks[0]).not.toHaveProperty('dirty');
    // It only took: nothing went back up.
    expect(cloud.calls.slice(mark).filter((c) => c.op === 'upsert')).toEqual([]);
  });

  test('an edit on one device reaches the other, in both directions', async () => {
    project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await desk.store.getState().saveProfile(sam);
    await sync(desk);
    const tablet = await device('tablet');
    await sync(tablet);

    // A rename on the desktop: no card changed, only the save's own stamp says it is newer.
    const d = await on(desk);
    await d.saveDeck({ ...d.decks[0], name: 'Stompier' });
    await sync(desk);
    await sync(tablet);
    expect(tablet.store.getState().decks.map((x) => x.name)).toEqual(['Stompier']);

    // A commander picked on the tablet.
    const t = await on(tablet);
    await t.saveProfile({ ...t.profiles[0], commanderName: 'Magda' });
    await t.saveDeck(addCard(t.decks[0], bolt));
    await sync(tablet);
    await sync(desk);
    expect(desk.store.getState().profiles[0].commanderName).toBe('Magda');
    expect(desk.store.getState().decks[0].cards.map((c) => c.name)).toEqual(['Forest', 'Lightning Bolt']);
    expect(desk.store.getState().decks[0].name).toBe('Stompier');
  });

  test('a delete on one device removes it on the other, and it does not come back', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await desk.store.getState().saveDeck(pair());
    await desk.store.getState().saveProfile(sam);
    await desk.store.getState().saveProfile(alex);
    await sync(desk);
    const tablet = await device('tablet');
    await sync(tablet);

    const d = await on(desk);
    await d.deleteDeck('stompy');
    await d.deleteProfile('alex');
    await sync(desk);
    await sync(tablet);
    expect(names(tablet.store.getState().decks)).toEqual(['Pair']);
    expect(names(tablet.store.getState().profiles)).toEqual(['Sam']);
    expect(cloud.row('decks', 'stompy').deleted).toBe(true);
    expect(cloud.row('player_profiles', 'alex').deleted).toBe(true);
    // The tablet can still bring the deck back: the tombstone came with the deck in it.
    expect((await tablet.store.getState().removedDecks()).map((x) => x.name)).toEqual(['Stompy']);

    // Round and round: neither device hands the old copy back to the other.
    for (let i = 0; i < 2; i++) {
      await sync(tablet);
      await sync(desk);
    }
    expect(names(desk.store.getState().decks)).toEqual(['Pair']);
    expect(names(tablet.store.getState().decks)).toEqual(['Pair']);
    expect(names(desk.store.getState().profiles)).toEqual(['Sam']);
    expect(names(tablet.store.getState().profiles)).toEqual(['Sam']);
    expect(cloud.row('decks', 'stompy').deleted).toBe(true);
  });

  test('a restore on the other device revives the deck everywhere, whole', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(pair());
    await sync(desk);
    const tablet = await device('tablet');
    await sync(tablet);

    await (await on(desk)).deleteDeck('pair');
    await sync(desk);
    await sync(tablet);
    expect(tablet.store.getState().decks).toEqual([]);

    await (await on(tablet)).restoreDeck('pair');
    await sync(tablet);
    await sync(desk);
    expect(cloud.row('decks', 'pair').deleted).toBe(false);
    for (const d of [desk, tablet]) {
      const [deck] = d.store.getState().decks;
      expect(deck).toMatchObject({ id: 'pair', owned: true, partner: { name: 'Tymna' } });
      expect(deck.cards.map((c) => c.name)).toEqual(['Forest']);
      await on(d);
      expect(await d.store.getState().removedDecks()).toEqual([]);
    }
  });

  test('a delete made on a device that had not seen the newer list does not take that list away: Restore brings it back, on either device', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await sync(desk);
    const tablet = await device('tablet');
    await sync(tablet);

    // More of the list is typed in on the desktop. The tablet does not hear of it…
    const d = await on(desk);
    await d.saveDeck(addCard(d.decks[0], bolt));
    await sync(desk);
    // …and the deck is deleted there, by mistake, as the one-card list it still holds.
    await (await on(tablet)).deleteDeck('stompy');
    await sync(tablet);
    expect(cloud.row('decks', 'stompy').data.cards).toHaveLength(1);

    await sync(desk);
    expect(desk.store.getState().decks).toEqual([]); // the delete did arrive
    const [shelved] = await desk.store.getState().removedDecks();
    expect(shelved.cards.map((c) => c.name)).toEqual(['Forest', 'Lightning Bolt']);
    expect(shelved).not.toHaveProperty('contentAt');

    // The tablet's shelf learns of the fuller list too.
    await sync(tablet);
    expect(tablet.store.getState().decks).toEqual([]);
    await (await on(tablet)).restoreDeck('stompy');
    expect(tablet.store.getState().decks[0].cards.map((c) => c.name)).toEqual(['Forest', 'Lightning Bolt']);
    expect(tablet.store.getState().decks[0]).not.toHaveProperty('contentAt');
    await sync(tablet);
    await sync(desk);
    expect(desk.store.getState().decks[0].cards.map((c) => c.name)).toEqual(['Forest', 'Lightning Bolt']);
    expect(cloud.row('decks', 'stompy').deleted).toBe(false);
    expect(cloud.row('decks', 'stompy').data).not.toHaveProperty('contentAt');
  });

  test('Restore on the device that held the newer list brings that list back', async () => {
    project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await sync(desk);
    const tablet = await device('tablet');
    await sync(tablet);
    const d = await on(desk);
    await d.saveDeck(addCard(d.decks[0], bolt));
    await sync(desk);
    await (await on(tablet)).deleteDeck('stompy');
    await sync(tablet);
    await sync(desk);

    await (await on(desk)).restoreDeck('stompy');
    expect(desk.store.getState().decks[0].cards.map((c) => c.name)).toEqual(['Forest', 'Lightning Bolt']);
    await sync(desk);
    await sync(tablet);
    expect(tablet.store.getState().decks[0].cards.map((c) => c.name)).toEqual(['Forest', 'Lightning Bolt']);
  });

  test('a deck edited and then deleted on one device comes back from the other as it was last edited', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await sync(desk);
    const tablet = await device('tablet');
    await sync(tablet);

    // The newer list is the deleted one this time: the desktop's copy is the old one.
    const t = await on(tablet);
    await t.saveDeck(addCard(t.decks[0], bolt));
    await (await on(tablet)).deleteDeck('stompy');
    await sync(tablet);
    const mark = cloud.calls.length;
    await sync(desk);
    expect(cloud.calls.slice(mark).filter((c) => c.op === 'upsert')).toEqual([]); // nothing to add

    await (await on(desk)).restoreDeck('stompy');
    expect(desk.store.getState().decks[0].cards.map((c) => c.name)).toEqual(['Forest', 'Lightning Bolt']);
  });

  test('decks are pulled in two steps: the light index every time, whole rows only for what changed', async () => {
    const cloud = project();
    const desk = await device('desk');
    for (const id of ['one', 'two', 'three']) await desk.store.getState().saveDeck(stompy(id));
    await sync(desk);
    const tablet = await device('tablet');

    let mark = cloud.calls.length;
    await sync(tablet); // a new device needs them all
    const first = cloud.calls.slice(mark).filter((c) => c.table === 'decks');
    expect(first.map((c) => c.columns)).toEqual(['deck_id,updated_at,deleted', '*']);
    expect([...first[1].keys!].sort()).toEqual(['one', 'three', 'two']);

    mark = cloud.calls.length;
    await sync(tablet); // nothing changed anywhere: the index, and that is all
    expect(cloud.since(mark).filter((l) => l.includes(' decks'))).toEqual([
      'select decks deck_id,updated_at,deleted',
    ]);

    const d = await on(desk);
    await d.saveDeck({ ...d.decks.find((x) => x.id === 'two')!, name: 'Two, renamed' });
    await sync(desk);
    mark = cloud.calls.length;
    await sync(tablet);
    const after = cloud.calls.slice(mark).filter((c) => c.table === 'decks');
    expect(after.map((c) => [c.op, c.columns, c.keys])).toEqual([
      ['select', 'deck_id,updated_at,deleted', undefined],
      ['select', '*', ['two']], // the one deck that moved, not the three
    ]);
    expect(names(tablet.store.getState().decks)).toEqual(['Stompy', 'Stompy', 'Two, renamed']);

    // And the device that made the change does not download its own deck back.
    mark = cloud.calls.length;
    await sync(desk);
    expect(cloud.since(mark).filter((l) => l.includes(' decks'))).toEqual([
      'select decks deck_id,updated_at,deleted',
    ]);
  });

  test('a deck deleted before this device ever saw it is not downloaded', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await desk.store.getState().saveDeck(pair());
    await desk.store.getState().deleteDeck('stompy');
    await sync(desk);

    const tablet = await device('tablet');
    const mark = cloud.calls.length;
    await sync(tablet);
    const whole = cloud.calls.slice(mark).filter((c) => c.table === 'decks' && c.columns === '*');
    expect(whole.map((c) => c.keys)).toEqual([['pair']]);
    expect(names(tablet.store.getState().decks)).toEqual(['Pair']);
    expect(await getDb().decks.count()).toBe(1);
  });

  test('a late save from another device that put an older copy back over ours is put right', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await sync(desk);
    const d = await on(desk);
    await d.saveDeck({ ...d.decks[0], name: 'The latest' });
    await sync(desk);
    const latest = (await getDb().decks.get('stompy'))!;
    expect(latest.dirty).toBe(0);

    // The tablet read the index a moment too early and pushed what it had: an older copy.
    await deps.upsert(
      'decks',
      [{ deck_id: 'stompy', data: { ...stompy(), name: 'Stale' }, deleted: false, updated_at: pg(latest.updatedAt - 5000) }],
      'user_id,deck_id',
    );
    await sync(desk);
    expect(cloud.row('decks', 'stompy').data.name).toBe('The latest'); // newer here: it goes up again
    expect(Date.parse(String(cloud.row('decks', 'stompy').updated_at))).toBe(latest.updatedAt);
    expect(desk.store.getState().decks[0].name).toBe('The latest');
  });

  test('a large first sync goes up and comes down in several requests', async () => {
    const cloud = project();
    const desk = await device('desk');
    for (let i = 0; i < 45; i++) await desk.store.getState().saveDeck(stompy(`deck-${i}`));
    expect(await sync(desk)).toBe('Synced 0 cards · 45 decks · 0 players');
    const ups = cloud.calls.filter((c) => c.op === 'upsert' && c.table === 'decks');
    expect(ups.length).toBeGreaterThan(1);
    expect(Math.max(...ups.map((c) => c.keys!.length))).toBeLessThanOrEqual(10);

    const tablet = await device('tablet');
    const mark = cloud.calls.length;
    expect(await sync(tablet)).toBe('Synced 0 cards · 45 decks · 0 players');
    const pulls = cloud.calls.slice(mark).filter((c) => c.table === 'decks' && c.columns === '*');
    expect(pulls.length).toBeGreaterThan(1); // keys travel in the URL: never 45 at once
    expect(pulls.flatMap((c) => c.keys!)).toHaveLength(45);
    expect(tablet.store.getState().decks).toHaveLength(45);
  });
});

describe('whatever order things happen in', () => {
  /** A small seeded generator: the same seed is the same afternoon, every run. */
  function dice(seed: number) {
    let s = seed;
    return (n: number) => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s % n;
    };
  }

  test.each([1, 7, 42])('three devices that edit, delete, restore and sync at random end up alike (seed %i)', async (seed) => {
    const cloud = project();
    const roll = dice(seed);
    const devices = [await device('desk'), await device('tablet'), await device('phone')];
    let made = 0;

    for (let step = 0; step < 60; step++) {
      const d = devices[roll(devices.length)];
      const state = await on(d);
      const pick = <T,>(list: T[]): T | undefined => list[roll(Math.max(1, list.length))];
      switch (roll(8)) {
        case 0:
          await state.saveDeck(stompy(`deck-${made++}`));
          break;
        case 1: {
          const deck = pick(state.decks);
          if (deck) await state.saveDeck({ ...deck, name: `${deck.name}!` });
          break;
        }
        case 2: {
          const deck = pick(state.decks);
          if (deck) await state.deleteDeck(deck.id);
          break;
        }
        case 3: {
          const gone = pick(await state.removedDecks());
          if (gone) await state.restoreDeck(gone.id);
          break;
        }
        case 4:
          await state.saveProfile({ ...alex, id: `player-${made}`, name: `Player ${made++}` });
          break;
        case 5: {
          const who = pick(state.profiles);
          if (who) await state.saveProfile({ ...who, commanderName: `Commander ${step}` });
          break;
        }
        case 6: {
          const who = pick(state.profiles);
          if (who) await state.deleteProfile(who.id);
          break;
        }
        default:
          await sync(d);
      }
    }

    // Everyone syncs until nobody has anything left to say.
    for (let round = 0; round < 3; round++) for (const d of devices) await sync(d);
    const mark = cloud.calls.length;
    for (const d of devices) await sync(d);
    expect(cloud.calls.slice(mark).filter((c) => c.op === 'upsert')).toEqual([]);

    const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    const [first, ...rest] = devices.map((d) => ({
      decks: byId(d.store.getState().decks),
      profiles: byId(d.store.getState().profiles),
    }));
    for (const other of rest) expect(other).toEqual(first);
    // And the cloud agrees with them about what is live.
    const live = (table: string, key: string) =>
      cloud.rows(table).filter((r) => !r.deleted).map((r) => String(r[key])).sort();
    expect(live('decks', 'deck_id')).toEqual(first.decks.map((x) => x.id));
    expect(live('player_profiles', 'profile_id')).toEqual(first.profiles.map((x) => x.id));
    // Nothing is left waiting anywhere.
    for (const d of devices) {
      await on(d);
      expect((await getDb().decks.toArray()).filter((r) => r.dirty !== 0)).toEqual([]);
      expect((await getDb().profiles.toArray()).filter((r) => r.dirty !== 0)).toEqual([]);
    }
  });
});

describe('two devices that stamped their edits alike', () => {
  // A clock that runs ahead on one device makes the next two edits of its deck
  // carry one stamp ("one past the copy I edited"). That takes devices that do
  // not share a clock or a store: each gets its own copy of every module here.
  const HOUR = 3_600_000;
  let clock = 0;
  let ahead = 0;

  async function ownDevice(name: string, skew: number) {
    vi.resetModules();
    const db = await import('./db');
    const itsCloud = await import('./cloud');
    const { createAppStore: create } = await import('../state/store');
    Object.assign(itsCloud.deps, deps); // the same project as everyone else
    db._useDbForTests(`alike-${name}`);
    const tables = db.getDb();
    await Promise.all([tables.kv.clear(), tables.profiles.clear(), tables.decks.clear(), tables.garage.clear()]);
    const store = create();
    ahead = skew;
    await store.getState().init();
    return {
      /** The store, with the clock on the wall of this device. */
      state() {
        ahead = skew;
        return store.getState();
      },
      async sync() {
        ahead = skew;
        await itsCloud.syncAll();
        await store.getState().refreshSynced();
      },
      row: (id: string) => tables.decks.get(id),
    };
  }

  /** The tablet's clock runs two hours ahead; desk and phone each edit its deck before syncing again. */
  async function tied(
    deskEdit: (deck: Deck) => Deck,
    phoneEdit: (deck: Deck) => Deck,
  ) {
    clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock + ahead);
    project();
    const tablet = await ownDevice('tablet', 2 * HOUR);
    await tablet.state().saveDeck({ ...createDeck('Stompy'), id: 'x' });
    await tablet.sync();
    clock += 10 * 60_000;
    const desk = await ownDevice('desk', 0);
    const phone = await ownDevice('phone', 0);
    await desk.sync();
    await phone.sync();
    clock += 60_000;
    await desk.state().saveDeck(deskEdit(desk.state().decks[0]));
    clock += 60_000;
    await phone.state().saveDeck(phoneEdit(phone.state().decks[0]));
    expect((await phone.row('x'))!.updatedAt).toBe((await desk.row('x'))!.updatedAt); // the tie
    clock += 60_000;
    await desk.sync();
    await phone.sync();
    return { desk, phone };
  }

  test('the one that lost shows what its database now holds', async () => {
    const { phone } = await tied(
      (deck) => ({ ...deck, name: 'Desk name' }),
      (deck) => ({ ...deck, name: 'Phone name' }),
    );
    const stored = (await phone.row('x'))!;
    expect(stored).toMatchObject({ name: 'Desk name', dirty: 0 });
    expect(phone.state().decks[0].name).toBe('Desk name');
  });

  test('and its next tap on that deck does not undo the winner on every device', async () => {
    const { desk, phone } = await tied(
      (deck) => addCard(deck, forest),
      (deck) => ({ ...deck, name: 'Phone name' }),
    );
    expect((await phone.row('x'))!.cards).toHaveLength(1);
    clock += 60_000;
    await phone.state().saveDeck({ ...phone.state().decks[0], owned: true }); // the "I own these" switch
    await phone.sync();
    await desk.sync();
    expect(desk.state().decks[0]).toMatchObject({ owned: true });
    expect(desk.state().decks[0].cards.map((c) => c.name)).toEqual(['Forest']);
  });
});

describe('the same player typed in on two devices', () => {
  test('same-name players become one, under the cloud’s id; same-name decks stay two', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveProfile({ id: 'd-sam', name: 'Sam', avatarUrl: null, commanderName: null });
    await desk.store.getState().saveProfile({ id: 'd-alex', name: 'Alex', avatarUrl: null, commanderName: null });
    await desk.store.getState().saveDeck(stompy('d-stompy'));
    await sync(desk);

    const tablet = await device('tablet');
    // Typed in on the tablet long before any of this, never stamped: the same Sam, with a face.
    await getDb().profiles.put({ id: 't-sam', name: ' sam', avatarUrl: 'sam.jpg', commanderName: 'Atraxa' });
    await getDb().profiles.put({ id: 't-jo', name: 'Jo', avatarUrl: null, commanderName: null });
    await getDb().decks.put({ ...stompy('t-stompy'), updatedAt: 1000 });
    await sync(tablet);

    const onTablet = tablet.store.getState().profiles;
    expect(names(onTablet)).toEqual(['Alex', 'Jo', 'Sam']);
    // One Sam, the cloud's — and the tablet's avatar and commander were not thrown away with its copy.
    expect(onTablet.find((p) => p.name === 'Sam')).toMatchObject({
      id: 'd-sam',
      avatarUrl: 'sam.jpg',
      commanderName: 'Atraxa',
    });
    expect(await getDb().profiles.get('t-sam')).toBeUndefined(); // gone outright: no tombstone owed
    expect(cloud.rows('player_profiles').map((r) => r.profile_id).sort()).toEqual(['d-alex', 'd-sam', 't-jo']);

    await sync(desk);
    const onDesk = desk.store.getState().profiles;
    expect(names(onDesk)).toEqual(['Alex', 'Jo', 'Sam']);
    expect(onDesk.find((p) => p.id === 'd-sam')).toMatchObject({ avatarUrl: 'sam.jpg', commanderName: 'Atraxa' });

    // Two decks with one name can be two lists: both stay, on both devices.
    expect(tablet.store.getState().decks.map((x) => x.id).sort()).toEqual(['d-stompy', 't-stompy']);
    expect(desk.store.getState().decks.map((x) => x.id).sort()).toEqual(['d-stompy', 't-stompy']);

    // Settled: another round changes nothing and sends nothing.
    const mark = cloud.calls.length;
    await sync(tablet);
    await sync(desk);
    expect(cloud.calls.slice(mark).filter((c) => c.op === 'upsert')).toEqual([]);
    expect(names(tablet.store.getState().profiles)).toEqual(['Alex', 'Jo', 'Sam']);
  });

  test('a second Sam added later, on a device that already has the first, is a second player', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveProfile({ id: 'd-sam', name: 'Sam', avatarUrl: null, commanderName: null });
    await sync(desk);
    await desk.store.getState().saveProfile({ id: 'd-sam-2', name: 'Sam', avatarUrl: 'other.jpg', commanderName: null });
    await sync(desk);
    expect(desk.store.getState().profiles.map((p) => p.id).sort()).toEqual(['d-sam', 'd-sam-2']);
    expect(cloud.rows('player_profiles')).toHaveLength(2);
  });
});

describe('before the two tables exist', () => {
  test('it reads as one more setup step, the Curation still syncs, and nothing is lost', async () => {
    const cloud = project(['garage_cards']);
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await desk.store.getState().saveProfile(sam);
    await desk.store.getState().addToGarage(bolt);
    expect(await setupPending()).toBe(false);

    const line = await sync(desk);
    expect(line).toBe('Synced 1 card · decks and players need one more setup step');
    expect(line).not.toMatch(/fail|error|could not find/i);
    expect(cloud.rows('garage_cards')).toHaveLength(1); // the Curation went up regardless
    expect(await setupPending()).toBe(true);
    expect((await getDb().decks.get('stompy'))!.dirty).toBe(1); // still waiting, not dropped
    expect(names(desk.store.getState().decks)).toEqual(['Stompy']);

    // Each half says the same on its own, never an error.
    expect(await syncDecks()).toMatch(/one more setup step/i);
    expect(await syncProfiles()).toMatch(/one more setup step/i);
    expect(await syncGarage()).toBe('Synced 1 card');

    cloud.create('decks', 'player_profiles'); // the owner pasted the SQL
    expect(await sync(desk)).toBe('Synced 1 card · 1 deck · 1 player');
    expect(await setupPending()).toBe(false);
    expect(cloud.rows('decks')).toHaveLength(1);
    expect(cloud.rows('player_profiles')).toHaveLength(1);
  });

  test('Postgres’ own "no such table" is read the same way', async () => {
    const cloud = project(['garage_cards', 'decks']);
    cloud.answerMissingWith('42P01');
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await desk.store.getState().saveProfile(sam);
    expect(await sync(desk)).toBe('Synced 0 cards · 1 deck · decks and players need one more setup step');
    expect(await setupPending()).toBe(true);
  });
});

describe('when it cannot reach the cloud', () => {
  test('offline is a status, never a throw, and everything waits for the next sync', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await desk.store.getState().saveProfile(sam);
    cloud.offline(true);
    expect(await sync(desk)).toBe('Offline (Failed to fetch)');
    expect(await syncDecks()).toBe('Offline (Failed to fetch)');
    expect(await syncProfiles()).toBe('Offline (Failed to fetch)');
    expect((await getDb().decks.get('stompy'))!.dirty).toBe(1);

    cloud.offline(false);
    expect(await sync(desk)).toBe('Synced 0 cards · 1 deck · 1 player');
    expect(cloud.rows('decks')).toHaveLength(1);
  });

  test('a device with no project, or nobody signed in, says so and touches nothing', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    deps.blocked = async () => 'Not signed in yet';
    expect(await syncAll()).toBe('Not signed in yet');
    expect(await syncDecks()).toBe('Not signed in yet');
    expect(await syncProfiles()).toBe('Not signed in yet');
    expect(cloud.calls).toEqual([]);
  });

  test('a refused push is a status too: the Curation and the players still sync', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await desk.store.getState().saveProfile(sam);
    const upsert = deps.upsert;
    deps.upsert = async (table, rows, onConflict) =>
      table === 'decks' ? { code: '42501', message: 'permission denied' } : upsert(table, rows, onConflict);
    expect(await sync(desk)).toBe('Synced 0 cards · 1 player · decks: Push failed: permission denied');
    expect((await getDb().decks.get('stompy'))!.dirty).toBe(1);
    expect(cloud.rows('player_profiles')).toHaveLength(1);
    expect(await setupPending()).toBe(false);
  });

  test('a row in the cloud that is not a deck is passed over, and the rest still arrive', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await sync(desk);
    await deps.upsert(
      'decks',
      [
        { deck_id: 'junk', data: { hello: 'world' }, deleted: false, updated_at: pg(5000) },
        { deck_id: 'text', data: 'not an object', deleted: false, updated_at: pg(5000) },
      ],
      'user_id,deck_id',
    );
    await deps.upsert(
      'player_profiles',
      [{ profile_id: 'junk', data: { name: 7 }, deleted: false, updated_at: pg(5000) }],
      'user_id,profile_id',
    );
    const tablet = await device('tablet');
    expect(await sync(tablet)).toBe('Synced 0 cards · 1 deck · 0 players');
    expect(names(tablet.store.getState().decks)).toEqual(['Stompy']);
    expect(cloud.rows('decks')).toHaveLength(3); // left alone in the cloud
  });
});

describe('changes made while a sync is in the air', () => {
  test('an edit made while the push travels is not marked as sent, and goes up with the next sync', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    const release = cloud.pause((c) => c.op === 'upsert' && c.table === 'decks');
    const running = syncAll();
    await vi.waitFor(() => expect(cloud.since(0)).toContain('upsert decks'));
    await desk.store.getState().saveDeck({ ...desk.store.getState().decks[0], name: 'Stompier' });
    release();
    await running;

    expect(cloud.row('decks', 'stompy').data.name).toBe('Stompy'); // what had left
    expect(await getDb().decks.get('stompy')).toMatchObject({ name: 'Stompier', dirty: 1 });
    await desk.store.getState().refreshSynced();
    expect(desk.store.getState().decks[0].name).toBe('Stompier'); // the screen never went back

    await sync(desk);
    expect(cloud.row('decks', 'stompy').data.name).toBe('Stompier');
    expect((await getDb().decks.get('stompy'))!.dirty).toBe(0);
  });

  test('an edit made while a newer copy is being downloaded is kept, not overwritten by it', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    await sync(desk);
    const tablet = await device('tablet');
    await sync(tablet);
    const d = await on(desk);
    await d.saveDeck({ ...d.decks[0], name: 'Renamed on the desktop' });
    await sync(desk);

    await on(tablet);
    const release = cloud.pause((c) => c.op === 'select' && c.table === 'decks' && c.columns === '*');
    const running = syncAll();
    await vi.waitFor(() => expect(cloud.calls.at(-1)).toMatchObject({ table: 'decks', columns: '*' }));
    const t = tablet.store.getState();
    await t.saveDeck(addCard(t.decks[0], bolt)); // the tablet's owner is mid-edit
    release();
    await running;

    const row = (await getDb().decks.get('stompy'))!;
    expect(row.cards.map((c) => c.name)).toEqual(['Forest', 'Lightning Bolt']);
    expect(row.dirty).toBe(1);
    // The newest save wins from here on, on both devices.
    await sync(tablet);
    await sync(desk);
    expect(desk.store.getState().decks[0].cards.map((c) => c.name)).toEqual(['Forest', 'Lightning Bolt']);
  });

  test('asked again while one is running, it runs once more afterwards and no more than that', async () => {
    const cloud = project();
    const desk = await device('desk');
    await desk.store.getState().saveDeck(stompy());
    const release = cloud.pause((c) => c.op === 'select' && c.table === 'garage_cards');
    const first = syncAll();
    await vi.waitFor(() => expect(cloud.calls).toHaveLength(1));
    const second = syncAll();
    const third = syncAll();
    expect(third).toBe(second); // however many ask, one more run answers them all
    release();
    expect(await first).toBe('Synced 0 cards · 1 deck · 0 players');
    expect(await second).toBe('Synced 0 cards · 1 deck · 0 players');
    expect(cloud.calls.filter((c) => c.op === 'select' && c.table === 'garage_cards')).toHaveLength(2);
  });
});

describe('when the background sync runs', () => {
  const fakeClock = () =>
    // Only the timers: fake-indexeddb does its work on setImmediate, which must stay real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  /** Lets the poke read the cloud config, then lets its timer run out. */
  async function pokeLands() {
    await getDb().kv.toArray();
    await vi.advanceTimersByTimeAsync(4000);
  }
  const garagePulls = (cloud: ReturnType<typeof project>) =>
    cloud.calls.filter((c) => c.op === 'select' && c.table === 'garage_cards').length;

  test('a local change pokes it, and a poke syncs all three and then re-reads the lists', async () => {
    const cloud = project();
    const desk = await device('desk');
    await setCloudConfig({ url: 'https://x.supabase.co', anonKey: 'k' });
    const reread = vi.fn();
    desk.store.setState({ refreshSynced: reread });
    fakeClock();
    await desk.store.getState().saveDeck(stompy());
    await desk.store.getState().saveProfile(sam);
    await pokeLands();
    await vi.waitFor(() => expect(reread).toHaveBeenCalled());
    expect(cloud.rows('decks')).toHaveLength(1);
    expect(cloud.rows('player_profiles')).toHaveLength(1);
    expect(garagePulls(cloud)).toBe(1); // two changes close together, one sync
  });

  test('a device that never set the cloud up never ticks a timer', async () => {
    const cloud = project();
    fakeClock();
    pokeSync();
    await pokeLands();
    expect(vi.getTimerCount()).toBe(0);
    expect(cloud.calls).toEqual([]);
  });

  test('coming back to the foreground pokes it, at most once a minute', async () => {
    const cloud = project();
    await setCloudConfig({ url: 'https://x.supabase.co', anonKey: 'k' });
    let clock = 1_000_000;
    deps.now = () => clock;
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    const done = vi.fn();
    pokeOnResume(done);
    fakeClock();
    const show = async (state: DocumentVisibilityState) => {
      visibility.mockReturnValue(state);
      document.dispatchEvent(new Event('visibilitychange'));
      await pokeLands();
    };

    await show('hidden'); // going away is not coming back
    expect(garagePulls(cloud)).toBe(0);

    await show('visible');
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(garagePulls(cloud)).toBe(1);

    clock += 30_000; // a glance at another app and back
    await show('hidden');
    await show('visible');
    expect(garagePulls(cloud)).toBe(1);

    clock += 31_000; // over a minute since the last one
    await show('visible');
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(2));
    expect(garagePulls(cloud)).toBe(2);
  });
});

describe('the setup SQL', () => {
  test('the constant the app shows is the file at the repo root, word for word', () => {
    const file = readFileSync(resolve(process.cwd(), 'decks-players-setup.sql'), 'utf8').replace(
      /\r\n/g,
      '\n',
    );
    expect(file).toContain(DECKS_PLAYERS_SQL);
    for (const table of ['decks', 'player_profiles']) {
      expect(DECKS_PLAYERS_SQL).toContain(`create table if not exists ${table} (`);
      expect(DECKS_PLAYERS_SQL).toContain(`drop policy if exists "own rows" on ${table};`);
    }
    expect(DECKS_PLAYERS_SQL).toContain('primary key (user_id, deck_id)');
    expect(DECKS_PLAYERS_SQL).toContain('primary key (user_id, profile_id)');
  });
});
