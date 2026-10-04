import type { CardRecord } from './types';

// Mechanics readable from rules text. Heuristic by design: it finds cards
// that talk about the same things, which is similarity, not deck wisdom.
const TEXT_THEMES: { key: string; pattern: RegExp }[] = [
  { key: 'tokens', pattern: /create[^.]*token/i },
  { key: 'treasure', pattern: /treasure/i },
  { key: 'counters', pattern: /\+1\/\+1 counter/i },
  { key: 'lifegain', pattern: /gain(s|ed)?[^.]*life|lifelink/i },
  { key: 'graveyard', pattern: /graveyard/i },
  { key: 'sacrifice', pattern: /sacrifice/i },
  { key: 'card draw', pattern: /draws? (a|two|three|x|that many) card/i },
  { key: 'discard', pattern: /discard/i },
  { key: 'mill', pattern: /\bmills?\b/i },
  { key: 'spellslinger', pattern: /instant or sorcery|noncreature spell|magecraft/i },
  { key: 'artifacts', pattern: /artifact/i },
  { key: 'enchantments', pattern: /enchantment/i },
  { key: 'lands matter', pattern: /landfall|land enters|play an additional land|search[^.]*land card/i },
  { key: 'exile', pattern: /\bexile(s|d)?\b/i },
  { key: 'blink', pattern: /exile[^.]*return[^.]*battlefield/i },
  { key: 'equipment', pattern: /\bequip/i },
  { key: 'energy', pattern: /\{E\}|energy counter/i },
];

const TRIBAL_PREFIX = 'tribal:';

function subtypes(typeLine: string): string[] {
  const dash = typeLine.split('—')[1];
  if (!dash) return [];
  return dash
    .split('//')[0]
    .trim()
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w));
}

function wordIn(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(haystack);
}

/** Themes a card is "about": mechanics its text references, plus its own
 * tribes when the text cares about them (a vanilla Bear is not Bear tribal). */
export function cardThemes(card: CardRecord): string[] {
  const themes = TEXT_THEMES.filter((t) => t.pattern.test(card.oracleText)).map((t) => t.key);
  for (const tribe of subtypes(card.typeLine)) {
    if (wordIn(card.oracleText, tribe)) themes.push(`${TRIBAL_PREFIX}${tribe}`);
  }
  return themes;
}

/** The themes a candidate shares with a source theme set. */
export function sharedThemes(sourceThemes: string[], candidate: CardRecord): string[] {
  const shared: string[] = [];
  const candidateText = cardThemes(candidate);
  for (const theme of sourceThemes) {
    if (theme.startsWith(TRIBAL_PREFIX)) {
      const tribe = theme.slice(TRIBAL_PREFIX.length);
      if (wordIn(candidate.typeLine, tribe) || wordIn(candidate.oracleText, tribe)) {
        shared.push(theme);
      }
    } else if (candidateText.includes(theme)) {
      shared.push(theme);
    }
  }
  return shared;
}

/** Tribe hits weigh double — a Dwarf for a Dwarf commander beats a generic overlap. */
export function synergyScore(sourceThemes: string[], candidate: CardRecord): number {
  return sharedThemes(sourceThemes, candidate).reduce(
    (sum, theme) => sum + (theme.startsWith(TRIBAL_PREFIX) ? 2 : 1),
    0,
  );
}
