import type { CommanderEntry, Deck, PlayerProfile } from './types';

/** A row as a device stores it: the content (its `updatedAt` stamp included)
 * plus what two devices need in order to agree on it. The store hands the
 * app the content only — see `bare`. */
export type Synced<T> = T & {
  /** Tombstone: deleted, and kept so the other devices hear of it. Left
   * out while the row is live. */
  deleted?: true;
  /** On a deck's tombstone: the stamp its content carried when it was
   * deleted (`updatedAt` is then the deletion's own). It tells a device
   * that hears of the deletion whether the list it holds is the newer one. */
  contentAt?: number;
  /** 1 = changed here and not sent yet, 0 = as the cloud has it. A row
   * saved before syncing existed has neither and has never been sent. */
  dirty?: 0 | 1;
};

export type DeckRow = Synced<Deck>;
export type ProfileRow = Synced<PlayerProfile>;

/** The content of a stored row, without the bookkeeping. */
export function bare<T>(row: Synced<T>): T {
  const { deleted, contentAt, dirty, ...content } = row;
  return content as T;
}

/** What the merge reads off a row, whatever else the row holds. */
interface Stamped {
  updatedAt?: number;
  dirty?: 0 | 1;
}

/** A row that was never stamped is older than any that was. */
const at = (row: Stamped) => row.updatedAt ?? 0;

/** Last-write-wins merge of this device's rows against the cloud's copy.
 * The cloud wins ties. Returns the merged truth plus the local rows that
 * still need pushing: those newer than the cloud's, and those the cloud
 * has never held that are waiting to go up. Rows the cloud won come back
 * clean; rows that won or stayed come back as the same objects. */
export function mergeRows<T extends Stamped>(
  local: T[],
  remote: T[],
  keyOf: (row: T) => string,
): { merged: T[]; toPush: T[] } {
  const byKey = new Map<string, T>();
  for (const row of local) byKey.set(keyOf(row), row);

  const merged: T[] = [];
  const toPush: T[] = [];
  const seen = new Set<string>();

  for (const theirs of remote) {
    const key = keyOf(theirs);
    seen.add(key);
    const ours = byKey.get(key);
    if (!ours || at(theirs) >= at(ours)) {
      merged.push({ ...theirs, dirty: 0 });
    } else {
      merged.push(ours);
      toPush.push(ours);
    }
  }
  for (const ours of local) {
    if (seen.has(keyOf(ours))) continue;
    merged.push(ours);
    if (ours.dirty === 1) toPush.push(ours);
  }
  return { merged, toPush };
}

// ---- the two-step pull ----
// Heavy rows (a deck is a hundred cards) are not downloaded whole on every
// sync. The cloud is first asked for its index — key, stamp, deleted — and
// then only for the rows this device does not already hold as new.

/** One line of the cloud's index. */
export interface RowHead {
  key: string;
  updatedAt: number;
  deleted: boolean;
}

/** Step one: the keys whose whole row has to be fetched — every row the
 * merge would hand to the cloud, except the ones this device already holds
 * in that very version. A row deleted before this device ever held it is
 * nothing to it, and is not fetched either. */
export function keysToPull<T extends Stamped>(
  local: T[],
  heads: RowHead[],
  keyOf: (row: T) => string,
): string[] {
  const byKey = new Map<string, T>();
  for (const row of local) byKey.set(keyOf(row), row);
  return heads
    .filter((head) => {
      const ours = byKey.get(head.key);
      if (!ours) return !head.deleted;
      // On a tie the cloud wins: its copy is needed if ours has changed since.
      return head.updatedAt > at(ours) || (head.updatedAt === at(ours) && ours.dirty === 1);
    })
    .map((head) => head.key);
}

/** Step two: the same merge as `mergeRows`, with only the `pulled` rows
 * of the cloud's side in hand. For a row that was not pulled because ours
 * is the newer one, the merge reads nothing off the cloud's copy but its
 * stamp — so our own row stands in for it, under the cloud's stamp. Rows
 * already in step are left out and come back untouched. */
export function mergePulled<T extends Stamped>(
  local: T[],
  heads: RowHead[],
  pulled: T[],
  keyOf: (row: T) => string,
): { merged: T[]; toPush: T[] } {
  const ours = new Map<string, T>();
  for (const row of local) ours.set(keyOf(row), row);
  const theirs = new Map<string, T>();
  for (const row of pulled) theirs.set(keyOf(row), row);

  const remote: T[] = [];
  for (const head of heads) {
    const whole = theirs.get(head.key);
    const mine = ours.get(head.key);
    if (whole) remote.push(whole);
    else if (mine && at(mine) > head.updatedAt)
      remote.push({ ...mine, updatedAt: head.updatedAt, dirty: 0 });
  }
  return mergeRows(local, remote, keyOf);
}

// ---- a deletion that travelled ----

/** A deck can be deleted on a device that never heard of its latest edit:
 * the tombstone then carries that device's older list, and taking it whole
 * would put the older list on the "Recently deleted" shelf of the very
 * device that typed the newer one in — Restore would bring back the wrong
 * deck, and the right one would exist nowhere. So where the cloud's
 * tombstone beat a live deck here whose list is newer than the one inside
 * it, only the deletion is taken: the row keeps this device's list, and
 * goes back up one stamp past the cloud's so that every shelf gets it. */
export function keepNewerLists(
  local: DeckRow[],
  result: { merged: DeckRow[]; toPush: DeckRow[] },
): { merged: DeckRow[]; toPush: DeckRow[] } {
  const ours = new Map<string, DeckRow>();
  for (const row of local) ours.set(row.id, row);
  const kept: DeckRow[] = [];
  const merged = result.merged.map((row) => {
    const mine = ours.get(row.id);
    const cloudDeleted = row !== mine && row.deleted === true;
    // A tombstone that does not say how old its list is keeps it: unknown is not older.
    if (!cloudDeleted || !mine || mine.deleted || row.contentAt === undefined) return row;
    if (at(mine) <= row.contentAt) return row;
    const ourList: DeckRow = {
      ...mine,
      deleted: true,
      contentAt: at(mine),
      updatedAt: at(row) + 1,
      dirty: 1,
    };
    kept.push(ourList);
    return ourList;
  });
  return kept.length > 0 ? { merged, toPush: [...result.toPush, ...kept] } : result;
}

// ---- the same player on two devices ----

const sameName = (a: string, b: string) => {
  const name = a.trim().toLowerCase();
  return name !== '' && name === b.trim().toLowerCase();
};

const HISTORY_CAP = 8; // as many recent commanders as a profile keeps

/** `winner`, plus whatever it lacks that `other` has: the avatar, the
 * commander (as one piece), recent commanders it does not list. The same
 * object when there is nothing to add. */
function fillGaps(winner: ProfileRow, other: ProfileRow): ProfileRow {
  let out = winner;
  if (!winner.avatarUrl && other.avatarUrl) out = { ...out, avatarUrl: other.avatarUrl };
  if (!winner.commanderName && other.commanderName)
    out = {
      ...out,
      commanderName: other.commanderName,
      partnerName: other.partnerName,
      commanderColors: other.commanderColors,
      commanderImage: other.commanderImage,
    };
  const mine: CommanderEntry[] = winner.commanderHistory ?? [];
  const extra = (other.commanderHistory ?? []).filter((e) => !mine.some((m) => m.name === e.name));
  if (extra.length > 0 && mine.length < HISTORY_CAP)
    out = { ...out, commanderHistory: [...mine, ...extra].slice(0, HISTORY_CAP) };
  return out;
}

/** `mine` and the cloud's `twin` are one player. The row this device
 * keeps for them under the cloud's id — or null when the cloud's copy is
 * to be taken exactly as it is. */
function adopt(mine: ProfileRow, twin: ProfileRow, now: number): ProfileRow | null {
  const mineIsNewer = at(mine) > at(twin);
  const [winner, other] = mineIsNewer ? [mine, twin] : [twin, mine];
  const filled = fillGaps(winner, other);
  if (!mineIsNewer && filled === twin) return null;
  return {
    ...bare(filled),
    id: twin.id,
    // It has to outrank the cloud's copy to reach the other devices.
    updatedAt: mineIsNewer ? at(mine) : Math.max(now, at(twin) + 1),
    dirty: 1,
  };
}

/** The merge for player profiles. Before decks and players synced, the
 * same people were typed in on every device, each time under a new id. So
 * a live local player the cloud has never seen, whose name matches (trimmed,
 * any case) a live cloud player this device does not hold yet, IS that
 * player: the cloud's id is kept, the content of whichever is newer — with
 * what it lacks filled in from the other, because the local copy is about
 * to go for good. `dropped` lists the local ids to remove outright: they
 * never left this device, so no tombstone is owed.
 *
 * A second player of a name the device already holds is left alone: two
 * tiles side by side are two people. Decks never merge by name at all. */
export function mergeProfiles(
  local: ProfileRow[],
  remote: ProfileRow[],
  now: number,
): { merged: ProfileRow[]; toPush: ProfileRow[]; dropped: string[] } {
  const localIds = new Set(local.map((p) => p.id));
  const remoteIds = new Set(remote.map((p) => p.id));
  const taken = new Set<string>();
  const dropped: string[] = [];
  const ours: ProfileRow[] = [];

  for (const mine of local) {
    const twin =
      mine.deleted || remoteIds.has(mine.id)
        ? undefined
        : remote.find(
            (p) =>
              !p.deleted && !localIds.has(p.id) && !taken.has(p.id) && sameName(p.name, mine.name),
          );
    if (!twin) {
      ours.push(mine);
      continue;
    }
    taken.add(twin.id);
    dropped.push(mine.id);
    const kept = adopt(mine, twin, now);
    if (kept) ours.push(kept);
  }
  return { ...mergeRows(ours, remote, (p) => p.id), dropped };
}
