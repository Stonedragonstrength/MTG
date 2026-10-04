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

export function fuzzyScore(query: string, target: string): number {
  const q = normalize(query);
  const t = normalize(target);
  if (!q) return 0;

  let base = 0;
  if (t === q) base = 1000;
  else if (t.startsWith(q)) base = 800;
  else if (wordPrefixesInOrder(q.split(' '), t.split(' '))) base = 600;
  else if (wordPrefixesAnyOrder(q.split(' '), t.split(' '))) base = 500;
  else if (isSubsequence(q.replace(/ /g, ''), t.replace(/ /g, ''))) base = 300;
  else return 0;

  return base - Math.min(t.length, 100) * 0.5;
}

export function searchNames(
  query: string,
  names: { id: string; name: string }[],
  limit = 20,
): { id: string; name: string }[] {
  if (!normalize(query)) return [];
  return names
    .map((entry) => ({ entry, score: fuzzyScore(query, entry.name) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((r) => r.entry);
}
