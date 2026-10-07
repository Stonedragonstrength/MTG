import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as cloud from '../data/cloud';
import { getDb } from '../data/db';
import { addCard, createDeck, setCommander } from '../lib/deck';
import type { CardRecord, Deck, PlayerProfile } from '../lib/types';
import { createAppStore, flushPersistence } from './store';

// What decks and player profiles carry on this device so that they can
// follow their owner to another one: a stamp on every save, a tombstone
// instead of a hole, a flag for what still has to go up. The cloud itself is
// in data/cloud.sync.test.ts.

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

function stompy(): Deck {
  const deck = setCommander(createDeck('Stompy'), card('c-ashaya', 'Ashaya', 'Legendary Creature — Elemental'));
  return addCard(deck, card('c-forest', 'Forest', 'Basic Land — Forest'));
}

const sam: PlayerProfile = { id: 'sam', name: 'Sam', avatarUrl: 'sam.jpg', commanderName: 'Atraxa' };

async function freshStore() {
  const store = createAppStore();
  await store.getState().init();
  return store;
}

beforeEach(async () => {
  await flushPersistence();
  const db = getDb();
  await db.kv.clear();
  await db.profiles.clear();
  await db.decks.clear();
  await db.garage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('every save is stamped and waits to go up', () => {
  test('a deck save stamps the moment it was made, whatever stamp it came in with', async () => {
    const store = await freshStore();
    const before = Date.now();
    await store.getState().saveDeck({ ...stompy(), updatedAt: 1000 });
    const row = (await getDb().decks.toArray())[0];
    expect(row.updatedAt).toBeGreaterThanOrEqual(before);
    expect(row.dirty).toBe(1);
    expect(row.deleted).toBeUndefined();
    expect(store.getState().decks[0].updatedAt).toBe(row.updatedAt); // the list knows the same stamp
  });

  test('a rename and the "I own these" switch count as saves too: each one is newer than the last', async () => {
    const store = await freshStore();
    await store.getState().saveDeck(stompy());
    const first = store.getState().decks[0];
    await store.getState().saveDeck({ ...first, name: 'Stompier' }); // no touched(): the stamp is the old one
    const renamed = store.getState().decks[0];
    expect(renamed.updatedAt).toBeGreaterThan(first.updatedAt);
    await store.getState().saveDeck({ ...renamed, owned: true });
    const row = await getDb().decks.get(first.id);
    expect(row).toMatchObject({ name: 'Stompier', owned: true, dirty: 1 });
    expect(row!.updatedAt).toBeGreaterThan(renamed.updatedAt);
  });

  test('a save outranks the copy it replaces even when this device’s clock runs behind', async () => {
    const store = await freshStore();
    const deck = stompy();
    const ahead = Date.now() + 3_600_000; // stamped by a device whose clock is an hour ahead
    await getDb().decks.put({ ...deck, updatedAt: ahead, dirty: 0 });
    await store.getState().saveDeck({ ...deck, name: 'Edited here' });
    const row = await getDb().decks.get(deck.id);
    expect(row!.updatedAt).toBeGreaterThan(ahead);
    expect(row).toMatchObject({ name: 'Edited here', dirty: 1 });
  });

  test('a profile save is stamped and waits to go up, and a second one is newer', async () => {
    const store = await freshStore();
    const before = Date.now();
    await store.getState().saveProfile(sam);
    const first = await getDb().profiles.get('sam');
    expect(first!.updatedAt).toBeGreaterThanOrEqual(before);
    expect(first!.dirty).toBe(1);
    await store.getState().saveProfile({ ...store.getState().profiles[0], commanderName: 'Magda' });
    const second = await getDb().profiles.get('sam');
    expect(second!.updatedAt!).toBeGreaterThan(first!.updatedAt!);
    expect(second).toMatchObject({ commanderName: 'Magda', dirty: 1 });
    expect(store.getState().profiles).toHaveLength(1);
  });

  test('each of them pokes the background sync', async () => {
    const poke = vi.spyOn(cloud, 'pokeSync').mockImplementation(() => {});
    const store = await freshStore();
    poke.mockClear();
    const deck = stompy();
    await store.getState().saveDeck(deck);
    expect(poke).toHaveBeenCalledTimes(1);
    await store.getState().deleteDeck(deck.id);
    expect(poke).toHaveBeenCalledTimes(2);
    await store.getState().restoreDeck(deck.id);
    expect(poke).toHaveBeenCalledTimes(3);
    await store.getState().saveProfile(sam);
    expect(poke).toHaveBeenCalledTimes(4);
    await store.getState().deleteProfile('sam');
    expect(poke).toHaveBeenCalledTimes(5);
  });
});

describe('a delete leaves a tombstone', () => {
  test('a deleted deck leaves the list, and its row stays with everything that was in it', async () => {
    const store = await freshStore();
    await store.getState().saveDeck(stompy());
    const saved = store.getState().decks[0];
    await store.getState().deleteDeck(saved.id);
    expect(store.getState().decks).toEqual([]);

    const row = await getDb().decks.get(saved.id);
    expect(row).toMatchObject({ name: 'Stompy', deleted: true, dirty: 1 });
    expect(row!.commander?.name).toBe('Ashaya');
    expect(row!.cards.map((c) => c.name)).toEqual(['Forest']);
    expect(row!.updatedAt).toBeGreaterThan(saved.updatedAt); // the deletion is the newest thing said about it
  });

  test('a deleted player leaves the list, and the row stays as a tombstone', async () => {
    const store = await freshStore();
    await store.getState().saveProfile(sam);
    const saved = await getDb().profiles.get('sam');
    await store.getState().deleteProfile('sam');
    expect(store.getState().profiles).toEqual([]);
    const row = await getDb().profiles.get('sam');
    expect(row).toMatchObject({ name: 'Sam', deleted: true, dirty: 1 });
    expect(row!.updatedAt!).toBeGreaterThan(saved!.updatedAt!);
  });

  test('deleting what is not there, or is already deleted, changes nothing', async () => {
    const store = await freshStore();
    await store.getState().deleteDeck('no-such-deck');
    await store.getState().deleteProfile('nobody');
    expect(await getDb().decks.count()).toBe(0);
    expect(await getDb().profiles.count()).toBe(0);

    await store.getState().saveDeck(stompy());
    const id = store.getState().decks[0].id;
    await store.getState().deleteDeck(id);
    const once = await getDb().decks.get(id);
    await store.getState().deleteDeck(id);
    expect(await getDb().decks.get(id)).toEqual(once); // not stamped again
  });

  test('a fresh start lists live rows only', async () => {
    const storeA = await freshStore();
    await storeA.getState().saveDeck(stompy());
    await storeA.getState().saveDeck({ ...createDeck('Doomed'), id: 'doomed' });
    await storeA.getState().deleteDeck('doomed');
    await storeA.getState().saveProfile(sam);
    await storeA.getState().saveProfile({ ...sam, id: 'alex', name: 'Alex' });
    await storeA.getState().deleteProfile('alex');

    const storeB = await freshStore();
    expect(storeB.getState().decks.map((d) => d.name)).toEqual(['Stompy']);
    expect(storeB.getState().profiles.map((p) => p.name)).toEqual(['Sam']);
  });

  test('decks and players saved before any of this existed are listed as ever', async () => {
    const old = { ...stompy(), updatedAt: 1000 };
    await getDb().decks.put(old); // no flags at all
    await getDb().profiles.put(sam); // no stamp either
    const store = await freshStore();
    expect(store.getState().decks).toEqual([old]);
    expect(store.getState().profiles).toEqual([sam]);
  });
});

describe('a deleted deck can be brought back', () => {
  test('the last few deleted decks are listed, newest first, as decks', async () => {
    const store = await freshStore();
    for (const name of ['One', 'Two', 'Three']) {
      await store.getState().saveDeck({ ...createDeck(name), id: name });
      await store.getState().deleteDeck(name);
    }
    await store.getState().saveDeck(stompy()); // a live one is not on the shelf
    const removed = await store.getState().removedDecks();
    expect(removed.map((d) => d.name)).toEqual(['Three', 'Two', 'One']);
    expect(removed[0]).not.toHaveProperty('deleted');
    expect(removed[0]).not.toHaveProperty('dirty');
  });

  test('the shelf holds the last few only', async () => {
    const store = await freshStore();
    for (let i = 0; i < 9; i++) {
      await store.getState().saveDeck({ ...createDeck(`Deck ${i}`), id: `d${i}` });
      await store.getState().deleteDeck(`d${i}`);
    }
    const removed = await store.getState().removedDecks();
    expect(removed).toHaveLength(6);
    expect(removed[0].name).toBe('Deck 8');
  });

  test('a restore is a save: the deck is back whole, newer than its tombstone, and waits to go up', async () => {
    const store = await freshStore();
    await store.getState().saveDeck({ ...stompy(), owned: true });
    const id = store.getState().decks[0].id;
    await store.getState().deleteDeck(id);
    const tombstone = await getDb().decks.get(id);

    await store.getState().restoreDeck(id);
    const back = store.getState().decks[0];
    expect(back).toMatchObject({ id, name: 'Stompy', owned: true });
    expect(back.cards.map((c) => c.name)).toEqual(['Forest']);
    expect(back.updatedAt).toBeGreaterThan(tombstone!.updatedAt);
    const row = await getDb().decks.get(id);
    expect(row!.deleted).toBeUndefined();
    expect(row!.dirty).toBe(1);
    expect(await store.getState().removedDecks()).toEqual([]);
  });

  test('restoring a deck that is not deleted does nothing', async () => {
    const store = await freshStore();
    await store.getState().saveDeck(stompy());
    const before = store.getState().decks;
    await store.getState().restoreDeck(before[0].id);
    await store.getState().restoreDeck('no-such-deck');
    expect(store.getState().decks).toBe(before);
  });
});

describe('the bookkeeping stays in the database', () => {
  test('decks and players in the store carry neither flag, after a save and after a restart', async () => {
    const storeA = await freshStore();
    await storeA.getState().saveDeck(stompy());
    await storeA.getState().saveProfile(sam);
    const storeB = await freshStore();
    for (const store of [storeA, storeB]) {
      for (const row of [...store.getState().decks, ...store.getState().profiles]) {
        expect(row).not.toHaveProperty('dirty');
        expect(row).not.toHaveProperty('deleted');
      }
    }
  });

  test('flags handed in with a save are not taken at their word', async () => {
    const store = await freshStore();
    const sneaky = { ...stompy(), deleted: true, dirty: 0 } as Deck;
    await store.getState().saveDeck(sneaky);
    expect(store.getState().decks).toHaveLength(1);
    expect(store.getState().decks[0]).not.toHaveProperty('deleted');
    const row = await getDb().decks.get(sneaky.id);
    expect(row!.deleted).toBeUndefined();
    expect(row!.dirty).toBe(1);
  });

  test('a profile copied into a new game’s config is clean', async () => {
    const store = await freshStore();
    await store.getState().saveProfile(sam);
    await store.getState().saveProfile({ ...sam, id: 'alex', name: 'Alex' });
    store.getState().startGame({
      format: 'commander',
      startingLife: 40,
      commanderDamageThreshold: 21,
      profiles: store.getState().profiles,
    });
    await flushPersistence();
    const inGame = store.getState().game!.config.profiles;
    expect(inGame.map((p) => p.name)).toEqual(['Sam', 'Alex']);
    for (const p of inGame) {
      expect(p).not.toHaveProperty('dirty');
      expect(p).not.toHaveProperty('deleted');
    }
    store.getState().endGame();
  });
});

describe('after a sync the lists are read again from the database', () => {
  test('what arrived shows up, what was deleted elsewhere goes, and tombstones stay hidden', async () => {
    const store = await freshStore();
    await store.getState().saveDeck(stompy());
    await store.getState().saveProfile(sam);
    const mine = store.getState().decks[0];

    // As a sync leaves them: a deck and a player from the other device, our deck deleted over there.
    const db = getDb();
    await db.decks.put({ ...createDeck('From the desktop'), id: 'far', updatedAt: mine.updatedAt + 5, dirty: 0 });
    await db.decks.put({ ...mine, updatedAt: mine.updatedAt + 9, deleted: true, dirty: 0 });
    await db.profiles.put({ id: 'alex', name: 'Alex', avatarUrl: null, commanderName: null, updatedAt: 5, dirty: 0 });
    await db.profiles.put({ id: 'gone', name: 'Gone', avatarUrl: null, commanderName: null, updatedAt: 5, deleted: true, dirty: 0 });

    await store.getState().refreshSynced();
    expect(store.getState().decks.map((d) => d.name)).toEqual(['From the desktop']);
    expect(store.getState().profiles.map((p) => p.name)).toEqual(['Sam', 'Alex']);
    expect(store.getState().decks[0]).not.toHaveProperty('dirty');
    expect(store.getState().profiles[1]).not.toHaveProperty('dirty');
  });

  test('a sync that changed nothing leaves the lists, and every object in them, exactly as they were', async () => {
    const store = await freshStore();
    await store.getState().saveDeck(stompy());
    await store.getState().saveProfile(sam);
    await store.getState().saveProfile({ ...sam, id: 'alex', name: 'Alex' });
    const { decks, profiles } = store.getState();

    // A push went through: the rows are marked as sent, and nothing else about them changed.
    await getDb().decks.toCollection().modify({ dirty: 0 });
    await getDb().profiles.toCollection().modify({ dirty: 0 });
    await store.getState().refreshSynced();
    expect(store.getState().decks).toBe(decks);
    expect(store.getState().profiles).toBe(profiles);
  });

  test('players keep their places: an edit from elsewhere does not shuffle the tiles', async () => {
    const store = await freshStore();
    for (const [id, name] of [['zed', 'Zed'], ['amy', 'Amy'], ['bob', 'Bob']])
      await store.getState().saveProfile({ ...sam, id, name });
    const [zed, amy, bob] = store.getState().profiles;

    const row = await getDb().profiles.get('amy');
    await getDb().profiles.put({ ...row!, commanderName: 'Magda', updatedAt: row!.updatedAt! + 50, dirty: 0 });
    await getDb().profiles.put({ id: 'aaa', name: 'New', avatarUrl: null, commanderName: null, updatedAt: 5, dirty: 0 });
    await store.getState().refreshSynced();

    const after = store.getState().profiles;
    expect(after.map((p) => p.name)).toEqual(['Zed', 'Amy', 'Bob', 'New']);
    expect(after[0]).toBe(zed); // untouched rows are the same objects
    expect(after[2]).toBe(bob);
    expect(after[1]).not.toBe(amy);
    expect(after[1].commanderName).toBe('Magda');
  });

  test('the Curation is read again too', async () => {
    const store = await freshStore();
    await getDb().garage.put({
      cardId: 'c-bolt',
      name: 'Lightning Bolt',
      typeLine: 'Instant',
      imageNormal: null,
      count: 3,
      updatedAt: 5,
      deleted: false,
      dirty: 0,
    });
    await store.getState().refreshSynced();
    expect(store.getState().garage.map((g) => g.name)).toEqual(['Lightning Bolt']);
  });
});
