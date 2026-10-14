import { keywordAmount } from './keywords';
import type { CardRecord } from './types';

/** What a permanent brings with it onto the battlefield, by its own words:
 * "This creature enters with two +1/+1 counters on it", "This land enters
 * tapped with two charge counters on it", a Saga's first lore counter,
 * Vanishing 3's time counters, Fading 2's fade counters, Modular 2 and
 * Graft 2's +1/+1 counters, a planeswalker's loyalty. The store puts them on in the same move as the
 * card lands (a played card), or just after (anything else that arrives).
 *
 * Read strictly, off the face that is up: a number the table would have to
 * work out ("for each", "X", "if it was kicked") is left to its player. The
 * counters are named as the table keeps them: 'p1p1', 'm1m1', and every
 * other kind by its word ('lore', 'time', 'charge', 'shield'). */

type Read = Pick<CardRecord, 'name' | 'oracleText'> & { typeLine?: string | null; loyalty?: string | null };

const NUMBER: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const ENTERS_WITH =
  /^(.+?) enters(?: the battlefield)?(?: tapped(?: and)?)? with (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([a-z]+|[+-]1\/[+-]1) counters? on it\.$/i;

/** "+1/+1" → 'p1p1', "-1/-1" → 'm1m1', "lore" → 'lore'. */
export function counterName(word: string): string {
  const w = word.toLowerCase().replace(/[−–]/g, '-');
  return w === '+1/+1' ? 'p1p1' : w === '-1/-1' ? 'm1m1' : w;
}

/** A Saga: its chapters come with its lore counters. */
export function isSaga(record: Read | null | undefined): boolean {
  if (!record) return false;
  const type = record.typeLine?.split(' // ')[0];
  return type ? /\bSaga\b/.test(type) : /^\(As this Saga enters\b/m.test(record.oracleText.split('\n//\n')[0]);
}

/** The counters it enters with, by kind; empty when it says of none. */
export function entryCounters(record: Read | null | undefined): Record<string, number> {
  if (!record) return {};
  const out: Record<string, number> = {};
  const add = (kind: string, n: number) => {
    if (Number.isFinite(n) && n > 0) out[kind] = (out[kind] ?? 0) + n;
  };
  const name = record.name.split(' // ')[0];
  // A legendary card speaks of itself by its first name: "Yorvo enters with…".
  const short = name.includes(',') ? name.split(',')[0].trim() : null;
  const front = record.oracleText.split('\n//\n')[0];
  // …or by the start of it: "Daghatar enters with…" (Daghatar the Adamant).
  const itself = (subject: string) =>
    subject === '~' ||
    /^this [a-z]+$/i.test(subject) ||
    (subject.length >= 3 && !/^(?:an?|another|each|one|this|that|the|it) /i.test(subject) && `${name} `.startsWith(`${subject} `));
  for (const raw of front.split('\n')) {
    let line = raw.replace(/\s*\([^)]*\)/g, '').trim().split(name).join('~');
    if (short) line = line.split(short).join('~');
    const m = line.match(ENTERS_WITH);
    if (m && itself(m[1])) add(counterName(m[3]), NUMBER[m[2].toLowerCase()] ?? Number(m[2]));
  }
  add('time', keywordAmount(front, 'vanishing'));
  add('fade', keywordAmount(front, 'fading'));
  add('p1p1', keywordAmount(front, 'modular') + keywordAmount(front, 'graft'));
  // "As this Saga enters … add a lore counter" (Read ahead lets its player
  // start further on: they move it themselves).
  if (isSaga(record)) add('lore', 1);
  // A planeswalker enters with its printed loyalty ("X" and the like are its player's).
  if (isPlaneswalker(record) && /^\d+$/.test(record.loyalty ?? '')) add('loyalty', Number(record.loyalty));
  return out;
}

/** A planeswalker, by the face that is up. */
export function isPlaneswalker(record: Read | null | undefined): boolean {
  return !!record?.typeLine && /\bPlaneswalker\b/.test(record.typeLine.split(' // ')[0]);
}

const WORD = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "two +1/+1 counters and a lore counter": counters as the feed says them. */
export function countersWords(counters: Record<string, number>): string {
  const kind = (k: string) => (k === 'p1p1' ? '+1/+1' : k === 'm1m1' ? '-1/-1' : k);
  return Object.entries(counters)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n === 1 && /^[aeiou]/.test(kind(k)) ? 'an' : (WORD[n] ?? n)} ${kind(k)} counter${n === 1 ? '' : 's'}`)
    .join(' and ');
}

/** The counters of these kinds a card has none of yet: what an arrival the
 * store did not put them on for still needs. */
export function missingCounters(want: Record<string, number>, has: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(want).filter(([kind]) => !((has?.[kind] ?? 0) > 0)));
}
