export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function wordPrefixesInOrder(queryWords: string[], targetWords: string[]): boolean {
  let ti = 0;
  for (const qw of queryWords) {
    while (ti < targetWords.length && !targetWords[ti].startsWith(qw)) ti++;
    if (ti >= targetWords.length) return false;
    ti++;
  }
  return true;
}

// "bone wall" should find "Wall of Bone": each query word claims a
// distinct target word, in any order.
function wordPrefixesAnyOrder(queryWords: string[], targetWords: string[]): boolean {
  const used = new Array<boolean>(targetWords.length).fill(false);
  for (const qw of queryWords) {
    const idx = targetWords.findIndex((tw, i) => !used[i] && tw.startsWith(qw));
    if (idx === -1) return false;
    used[idx] = true;
  }
  return true;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

/** A name as the matcher wants it: normalized once, not once per keystroke. */
interface Prepared {
  name: string;
  t: string;
  words: string[];
  squashed: string;
}

function prepare(name: string): Prepared {
  const t = normalize(name);
  return { name, t, words: t.split(' '), squashed: t.replace(/ /g, '') };
}

function score(q: string, qWords: string[], qSquashed: string, target: Prepared): number {
  const { t } = target;
  let base = 0;
  if (t === q) base = 1000;
  else if (t.startsWith(q)) base = 800;
  else if (wordPrefixesInOrder(qWords, target.words)) base = 600;
  else if (wordPrefixesAnyOrder(qWords, target.words)) base = 500;
  else if (isSubsequence(qSquashed, target.squashed)) base = 300;
  else return 0;

  return base - Math.min(t.length, 100) * 0.5;
}

export function fuzzyScore(query: string, target: string): number {
  const q = normalize(query);
  if (!q) return 0;
  return score(q, q.split(' '), q.replace(/ /g, ''), prepare(target));
}

/** The card index is ~36,000 names and every keystroke searches all of
 * them, so each index keeps its prepared names. An entry is re-read if
 * its name is no longer the one that was prepared. */
const preparedByIndex = new WeakMap<object, Prepared[]>();

export function searchNames(
  query: string,
  names: { id: string; name: string }[],
  limit = 20,
): { id: string; name: string }[] {
  const q = normalize(query);
  if (!q) return [];
  const qWords = q.split(' ');
  const qSquashed = q.replace(/ /g, '');
  let prepared = preparedByIndex.get(names);
  if (!prepared) preparedByIndex.set(names, (prepared = []));
  if (prepared.length > names.length) prepared.length = names.length;

  const hits: { entry: { id: string; name: string }; score: number }[] = [];
  for (let i = 0; i < names.length; i++) {
    const entry = names[i];
    let target = prepared[i];
    if (!target || target.name !== entry.name) target = prepared[i] = prepare(entry.name);
    const s = score(q, qWords, qSquashed, target);
    if (s > 0) hits.push({ entry, score: s });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((r) => r.entry);
}
