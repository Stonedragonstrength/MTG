import { describe, expect, test } from 'vitest';
import {
  bare,
  keysToPull,
  mergeProfiles,
  mergePulled,
  mergeRows,
  type ProfileRow,
  type RowHead,
} from './sync';

interface Row {
  id: string;
  text: string;
  updatedAt?: number;
  deleted?: true;
  dirty?: 0 | 1;
}

const keyOf = (r: Row) => r.id;
const row = (id: string, text: string, updatedAt: number, extra: Partial<Row> = {}): Row => ({
  id,
  text,
  updatedAt,
  dirty: 0,
  ...extra,
});
const byId = (rows: Row[], id: string) => rows.find((r) => r.id === id);

describe('mergeRows: last write wins, row by row', () => {
  test('the newer side wins, whichever side that is', () => {
    const { merged, toPush } = mergeRows(
      [row('a', 'ours-old', 100, { dirty: 1 }), row('b', 'ours-new', 500)],
      [row('a', 'theirs-new', 900), row('b', 'theirs-old', 100)],
      keyOf,
    );
    expect(byId(merged, 'a')).toEqual(row('a', 'theirs-new', 900)); // arrives clean
    expect(byId(merged, 'b')?.text).toBe('ours-new');
    expect(toPush.map(keyOf)).toEqual(['b']); // what is newer here goes up, dirty or not
  });

  test('a tie goes to the cloud, even over a change that was still waiting to go up', () => {
    const { merged, toPush } = mergeRows(
      [row('a', 'ours', 500, { dirty: 1 })],
      [row('a', 'theirs', 500)],
      keyOf,
    );
    expect(merged).toEqual([row('a', 'theirs', 500)]);
    expect(toPush).toEqual([]);
  });

  test('a row only this device has goes up when it is waiting to, and stays put when it is not', () => {
    const waiting = row('new', 'typed here', 100, { dirty: 1 });
    const settled = row('old', 'synced long ago', 100);
    const { merged, toPush } = mergeRows([waiting, settled], [row('far', 'from the cloud', 200)], keyOf);
    expect(merged.map(keyOf).sort()).toEqual(['far', 'new', 'old']);
    expect(toPush).toEqual([waiting]);
  });

  test('a row that wins or stays is handed back as the very object that came in', () => {
    const newer = row('a', 'ours', 900, { dirty: 1 });
    const alone = row('b', 'ours', 100);
    const { merged } = mergeRows([newer, alone], [row('a', 'theirs', 100)], keyOf);
    expect(byId(merged, 'a')).toBe(newer);
    expect(byId(merged, 'b')).toBe(alone);
  });

  test('a tombstone wins over an older live row, from either side', () => {
    const fromCloud = mergeRows(
      [row('a', 'still here', 100)],
      [row('a', 'gone', 900, { deleted: true })],
      keyOf,
    );
    expect(fromCloud.merged[0]).toMatchObject({ id: 'a', deleted: true, dirty: 0 });
    expect(fromCloud.toPush).toEqual([]);

    const fromHere = mergeRows(
      [row('a', 'gone', 900, { deleted: true, dirty: 1 })],
      [row('a', 'still there', 100)],
      keyOf,
    );
    expect(fromHere.merged[0]).toMatchObject({ id: 'a', deleted: true });
    expect(fromHere.toPush.map(keyOf)).toEqual(['a']);
  });

  test('a tombstone loses to a newer restore, from either side', () => {
    const restoredHere = mergeRows(
      [row('a', 'back', 900, { dirty: 1 })],
      [row('a', 'gone', 500, { deleted: true })],
      keyOf,
    );
    expect(restoredHere.merged[0].deleted).toBeUndefined();
    expect(restoredHere.toPush.map(keyOf)).toEqual(['a']);

    const restoredThere = mergeRows(
      [row('a', 'gone', 500, { deleted: true })],
      [row('a', 'back', 900)],
      keyOf,
    );
    expect(restoredThere.merged[0]).toEqual(row('a', 'back', 900));
    expect(restoredThere.toPush).toEqual([]);
  });

  test('a row that was never stamped counts as the oldest there is', () => {
    const { merged, toPush } = mergeRows(
      [{ id: 'a', text: 'saved before stamps', dirty: 1 }],
      [row('a', 'stamped', 1)],
      keyOf,
    );
    expect(merged[0].text).toBe('stamped');
    expect(toPush).toEqual([]);
  });
});

const head = (key: string, updatedAt: number, deleted = false): RowHead => ({ key, updatedAt, deleted });

describe('the two-step pull: the index first, whole rows only where the cloud is ahead', () => {
  test('asks for rows it has never seen and rows the cloud holds newer, and for nothing else', () => {
    const local = [row('same', '', 500), row('behind', '', 100), row('ahead', '', 900, { dirty: 1 })];
    const heads = [head('same', 500), head('behind', 700), head('ahead', 300), head('unseen', 50)];
    expect(keysToPull(local, heads, keyOf)).toEqual(['behind', 'unseen']);
  });

  test('a tie against a change still waiting here is the cloud’s to win, so its row is fetched', () => {
    expect(keysToPull([row('a', 'edited', 500, { dirty: 1 })], [head('a', 500)], keyOf)).toEqual(['a']);
  });

  test('a deck deleted before this device ever held it is not downloaded; one it holds is', () => {
    const local = [row('held', 'a whole deck', 100)];
    const heads = [head('held', 900, true), head('stranger', 900, true)];
    expect(keysToPull(local, heads, keyOf)).toEqual(['held']);
  });

  test('pulled rows win; rows already in step are left alone; what is newer here goes up', () => {
    const inStep = row('same', 'as the cloud has it', 500);
    const ahead = row('ahead', 'edited here', 900, { dirty: 1 });
    const fresh = row('fresh', 'made here', 100, { dirty: 1 });
    const local = [inStep, row('behind', 'stale', 100), ahead, fresh];
    const heads = [head('same', 500), head('behind', 700), head('ahead', 300), head('unseen', 50)];
    const pulled = [row('behind', 'from the cloud', 700), row('unseen', 'new to us', 50)];
    const { merged, toPush } = mergePulled(local, heads, pulled, keyOf);
    expect(byId(merged, 'behind')).toEqual(row('behind', 'from the cloud', 700));
    expect(byId(merged, 'unseen')).toEqual(row('unseen', 'new to us', 50));
    expect(byId(merged, 'same')).toBe(inStep);
    expect(byId(merged, 'ahead')).toBe(ahead);
    expect(toPush).toEqual([ahead, fresh]);
  });

  test('a row the cloud holds older goes up again even when this device thought it was sent', () => {
    // Another device's late save can put an older copy back over ours.
    const ours = row('a', 'the latest', 900); // not dirty
    const { toPush } = mergePulled([ours], [head('a', 300)], [], keyOf);
    expect(toPush).toEqual([ours]);
  });

  test('a wanted row that did not come back is not mistaken for one that lost', () => {
    const waiting = row('a', 'edited', 500, { dirty: 1 });
    const { merged, toPush } = mergePulled([waiting], [head('a', 500)], [], keyOf);
    expect(merged).toEqual([waiting]);
    expect(toPush).toEqual([waiting]); // still waiting: it goes up, and the next sync settles it
  });
});

const player = (id: string, name: string, extra: Partial<ProfileRow> = {}): ProfileRow => ({
  id,
  name,
  avatarUrl: null,
  commanderName: null,
  ...extra,
});

describe('mergeProfiles: the same player typed in on two devices', () => {
  test('a local player the cloud has never seen takes the id of the cloud player with the same name', () => {
    const local = [player('t-sam', '  sam ', { dirty: 1 })];
    const remote = [player('d-sam', 'Sam', { updatedAt: 500, dirty: 0 })];
    const { merged, toPush, dropped } = mergeProfiles(local, remote, 9000);
    expect(merged).toEqual([player('d-sam', 'Sam', { updatedAt: 500, dirty: 0 })]);
    expect(toPush).toEqual([]);
    expect(dropped).toEqual(['t-sam']); // the duplicate goes, with no tombstone: it never left
  });

  test('the newer content wins: a local player edited later keeps its content under the cloud id', () => {
    const local = [
      player('t-sam', 'Sam', { avatarUrl: 'tablet.jpg', commanderName: 'Atraxa', updatedAt: 900, dirty: 1 }),
    ];
    const remote = [player('d-sam', 'SAM', { avatarUrl: 'desk.jpg', updatedAt: 500, dirty: 0 })];
    const { merged, toPush, dropped } = mergeProfiles(local, remote, 9000);
    expect(merged).toEqual([
      player('d-sam', 'Sam', { avatarUrl: 'tablet.jpg', commanderName: 'Atraxa', updatedAt: 900, dirty: 1 }),
    ]);
    expect(toPush).toEqual(merged);
    expect(dropped).toEqual(['t-sam']);
  });

  test('what the winner lacks is kept from the copy that goes: an avatar, a commander, the recent ones', () => {
    const local = [
      player('t-sam', 'Sam', {
        avatarUrl: 'tablet.jpg',
        commanderName: 'Atraxa',
        commanderColors: ['W', 'U', 'B', 'G'],
        commanderImage: 'atraxa.jpg',
        commanderHistory: [
          { name: 'Atraxa', image: 'atraxa.jpg', colors: ['W', 'U', 'B', 'G'] },
          { name: 'Magda', image: 'magda.jpg', colors: ['R'] },
        ],
        dirty: 1,
      }),
    ];
    // Neither was ever stamped: a tie, so the cloud's copy leads — and it is bare.
    const remote = [
      player('d-sam', 'Sam', {
        updatedAt: 0,
        commanderHistory: [{ name: 'Magda', image: 'm2.jpg', colors: ['R'] }],
        dirty: 0,
      }),
    ];
    const { merged, toPush, dropped } = mergeProfiles(local, remote, 9000);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'd-sam',
      name: 'Sam',
      avatarUrl: 'tablet.jpg',
      commanderName: 'Atraxa',
      commanderColors: ['W', 'U', 'B', 'G'],
      commanderImage: 'atraxa.jpg',
      updatedAt: 9000, // newer than the cloud's copy, so every device takes it
      dirty: 1,
    });
    // The winner's own entries first and untouched; only what it did not have is added.
    expect(merged[0].commanderHistory).toEqual([
      { name: 'Magda', image: 'm2.jpg', colors: ['R'] },
      { name: 'Atraxa', image: 'atraxa.jpg', colors: ['W', 'U', 'B', 'G'] },
    ]);
    expect(toPush).toEqual(merged);
    expect(dropped).toEqual(['t-sam']);
  });

  test('a filled-in copy outranks the cloud’s even when this device’s clock runs behind', () => {
    const local = [player('t-sam', 'Sam', { avatarUrl: 'tablet.jpg', dirty: 1 })];
    const remote = [player('d-sam', 'Sam', { updatedAt: 50_000, dirty: 0 })];
    const { merged } = mergeProfiles(local, remote, 9000);
    expect(merged[0]).toMatchObject({ id: 'd-sam', avatarUrl: 'tablet.jpg', updatedAt: 50_001 });
  });

  test('a deleted player is nobody’s twin, on either side', () => {
    const live = player('t-sam', 'Sam', { dirty: 1 });
    const gone = player('d-sam', 'Sam', { updatedAt: 500, deleted: true, dirty: 0 });
    const a = mergeProfiles([live], [gone], 9000);
    expect(a.dropped).toEqual([]);
    expect(a.merged.map((p) => p.id).sort()).toEqual(['d-sam', 't-sam']);
    expect(a.toPush).toEqual([live]);

    const deletedHere = player('t-sam', 'Sam', { updatedAt: 900, deleted: true, dirty: 1 });
    const b = mergeProfiles([deletedHere], [player('d-sam', 'Sam', { updatedAt: 500, dirty: 0 })], 9000);
    expect(b.dropped).toEqual([]);
    expect(b.merged.find((p) => p.id === 'd-sam')?.deleted).toBeUndefined(); // the cloud's Sam is untouched
  });

  test('a second player of the same name added on a device that already has the first stays a second player', () => {
    const first = player('d-sam', 'Sam', { updatedAt: 500, dirty: 0 });
    const second = player('t-sam', 'Sam', { updatedAt: 900, dirty: 1 });
    const { merged, toPush, dropped } = mergeProfiles([first, second], [first], 9000);
    expect(dropped).toEqual([]);
    expect(merged.map((p) => p.id).sort()).toEqual(['d-sam', 't-sam']);
    expect(toPush).toEqual([second]);
  });

  test('one cloud player is one local player: a second local twin is kept as its own', () => {
    const local = [player('t1', 'Sam', { dirty: 1 }), player('t2', 'sam', { dirty: 1 })];
    const remote = [player('d-sam', 'Sam', { updatedAt: 500, dirty: 0 })];
    const { merged, dropped } = mergeProfiles(local, remote, 9000);
    expect(dropped).toEqual(['t1']);
    expect(merged.map((p) => p.id).sort()).toEqual(['d-sam', 't2']);
  });

  test('a player whose id the cloud already knows is merged by id, like any row', () => {
    const local = [player('p1', 'Sam', { updatedAt: 900, dirty: 1 })];
    const remote = [
      player('p1', 'Samantha', { updatedAt: 500, dirty: 0 }),
      player('p2', 'Sam', { updatedAt: 500, dirty: 0 }),
    ];
    const { merged, toPush, dropped } = mergeProfiles(local, remote, 9000);
    expect(dropped).toEqual([]);
    expect(merged.find((p) => p.id === 'p1')?.name).toBe('Sam');
    expect(merged.find((p) => p.id === 'p2')?.name).toBe('Sam');
    expect(toPush.map((p) => p.id)).toEqual(['p1']);
  });
});

describe('bare', () => {
  test('hands back the content without the bookkeeping, and leaves the row itself alone', () => {
    const stored = { id: 'a', name: 'Sam', updatedAt: 5, deleted: true as const, dirty: 1 as const };
    expect(bare(stored)).toEqual({ id: 'a', name: 'Sam', updatedAt: 5 });
    expect(stored.dirty).toBe(1);
  });
});
