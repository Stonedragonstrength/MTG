import { fuzzyScore, searchNames } from './fuzzy';

export interface DeckListLine {
  count: number;
  name: string;
  commander: boolean;
}

const SECTION_HEADERS = /^(deck|mainboard|main|sideboard|maybeboard|commander)s?:?$/i;

/** Parses the common decklist shapes: "24 Forest", "2x Bolt", bare names,
 * set/collector suffixes "(C21) 263" or "[CMR]", foil/flag markers "*F*",
 * Arena-style section headers, and commanders via *CMDR* or a Commander
 * section. Comments (//) and blanks are skipped. */
export function parseDeckList(text: string): DeckListLine[] {
  const out: DeckListLine[] = [];
  let section: 'commander' | 'other' = 'other';

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    const header = line.match(SECTION_HEADERS);
    if (header) {
      section = header[1].toLowerCase() === 'commander' ? 'commander' : 'other';
      continue;
    }

    let body = line.replace(/^sb:\s*/i, '');
    const cmdrFlag = /\*\s*cmdr\s*\*/i.test(body);
    body = body
      .replace(/\*[^*]*\*/g, '') // *F*, *CMDR*…
      .replace(/\s*\([A-Za-z0-9]{2,6}\)\s*[\w-]*\s*$/, '') // (C21) 263
      .replace(/\s*\[[A-Za-z0-9]{2,6}\]\s*[\w-]*\s*$/, '') // [CMR]
      .trim();

    const counted = body.match(/^(\d+)\s*x?\s+(.+)$/i);
    const count = counted ? Number(counted[1]) : 1;
    const name = (counted ? counted[2] : body).trim();
    if (!name || count <= 0) continue;

    out.push({ count, name, commander: cmdrFlag || section === 'commander' });
  }
  return out;
}

/** Capped Levenshtein: stops counting past `cap` so 35k comparisons stay cheap. */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** A wide camera crop OCRs into several lines (title, type line, rules
 * text). Each line tries to match a card name; the line that matches
 * most cleanly wins, so aim doesn't have to be surgical. */
export function bestScannedMatch(
  lines: string[],
  names: { id: string; name: string }[],
): { id: string; name: string }[] {
  let best: { hits: { id: string; name: string }[]; score: number } | null = null;
  for (const line of lines) {
    const hits = matchScannedTitle(line, names);
    if (hits.length === 0) continue;
    const cleaned = line.replace(/[^A-Za-z',\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
    // Direct fuzzy quality when available; edit-distance rescues rank
    // beneath any direct match but can still win an all-noise field.
    const score = Math.max(1, fuzzyScore(cleaned, hits[0].name));
    if (!best || score > best.score) best = { hits, score };
  }
  return best?.hits ?? [];
}

/** Fuzzy-rescues a scanned/OCR'd title: prefix/subsequence fuzzy first,
 * then an edit-distance pass for mid-word OCR damage ("Lightnmg Bolt").
 * Nothing comes back when the text is too short or too weak to trust. */
export function matchScannedTitle(
  raw: string,
  names: { id: string; name: string }[],
): { id: string; name: string }[] {
  const cleaned = raw.replace(/[^A-Za-z',\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 3) return [];

  const direct = searchNames(cleaned, names, 3).filter((h) => fuzzyScore(cleaned, h.name) >= 250);
  if (direct.length > 0) return direct;

  const needle = cleaned.toLowerCase();
  const cap = Math.max(1, Math.floor(needle.length / 4));
  const scored: { entry: { id: string; name: string }; d: number }[] = [];
  for (const entry of names) {
    const d = editDistance(needle, entry.name.toLowerCase(), cap);
    if (d <= cap) scored.push({ entry, d });
  }
  return scored
    .sort((a, b) => a.d - b.d || a.entry.name.localeCompare(b.entry.name))
    .slice(0, 3)
    .map((s) => s.entry);
}
