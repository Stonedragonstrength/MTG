import type { BoardItem, CardInstance, CardRecord } from './types';

/** Reading keyword abilities off rules text: which ones a card has itself,
 * and which ones a seat's other permanents hand to its creatures. Summoning
 * sickness asks about haste (keywordsOf + grantedKeywords: generous);
 * combat asks about the rest (keywordsOf + combatGrants: strict).
 *
 * Like the mana reading in mana.ts this reads generously and by shape, not
 * from a list of every keyword ever printed: a keyword line is a line with
 * no sentence in it, so tomorrow's keywords read as well as today's. */

interface Keyword {
  /** Lower case, without its number or cost: 'flying', 'first strike', 'toxic'. */
  name: string;
  /** Whatever follows the name: '2', '{2}', 'from red'. Empty when bare. */
  value: string;
}

/** Keywords whose parameter is words rather than a number or a cost, so the
 * shape rule below cannot tell where the name ends. Longest first. */
const WORDY: [prefix: string, name: string][] = [
  ['bands with other', 'bands with other'],
  ['hexproof from', 'hexproof from'], // not hexproof: only some things cannot target it
  ['partner with', 'partner with'],
  ['affinity for', 'affinity'],
  ['splice onto', 'splice'],
  ['protection', 'protection'],
  ['champion', 'champion'],
  ['enchant', 'enchant'],
  ['equip', 'equip'],
];

/** One entry of a keyword list: "flying", "first strike", "toxic 2",
 * "ward {2}", "protection from red". Null for anything else. */
function readPart(part: string): Keyword | null {
  for (const [prefix, name] of WORDY) {
    if (part === prefix || part.startsWith(`${prefix} `)) {
      return { name, value: part.slice(prefix.length).trim() };
    }
  }
  // One or two words, then at most a number or a cost — prose never fits.
  const m = part.match(/^([a-z][a-z'’!-]*(?: [a-z][a-z'’!-]*)?)(?: ((?:\d|\{|x\b).*))?$/);
  return m ? { name: m[1], value: m[2] ?? '' } : null;
}

/** The keywords on one line of rules text — none unless the line is made
 * of keywords only. */
function readLine(line: string): Keyword[] {
  // "Ward—Pay 2 life.": a cost after a dash belongs to the keyword before
  // it. A dash set off by a space ends an ability word instead ("Landfall —
  // Whenever…") or a list of modes, and neither is a keyword.
  const dash = line.search(/[—–]/);
  if (dash !== -1 && !/\S/.test(line[dash - 1] ?? ' ')) return [];
  const head = (dash === -1 ? line : line.slice(0, dash)).trim().toLowerCase();
  if (head === '' || /[.:"“”•]/.test(head)) return []; // a sentence, an ability with a cost, a quote
  const found: Keyword[] = [];
  for (const part of head.split(/[,;]/).map((p) => p.trim())) {
    // "protection from white, from blue, and from black" is one keyword
    if (found.length > 0 && /^(?:and )?from\b/.test(part)) continue;
    const keyword = readPart(part);
    if (!keyword) return [];
    found.push(keyword);
  }
  return found;
}

/** The lines of rules text a permanent has as it sits on the battlefield.
 * A two-faced card is there front face up (data/scryfall.ts joins the
 * faces with a line of "//"); reminder text is not rules text; and what
 * stands under a level is not there until the level is reached — the
 * "LEVEL 2-4" block of a creature that levels up, the "{1}{W}: Level 2"
 * block of a Class. The app does not track levels, so those are left out:
 * an unlevelled Student of Warfare has no first strike. */
function standingLines(oracleText: string): string[] {
  const front = oracleText.split('\n//\n')[0].replace(/\([^)]*\)/g, '');
  const lines = front.split('\n').map((line) => line.trim());
  const level = lines.findIndex((line) => /^level \d/i.test(line) || /: level \d+$/i.test(line));
  return level === -1 ? lines : lines.slice(0, level);
}

function readKeywords(oracleText: string): Keyword[] {
  return standingLines(oracleText).flatMap(readLine);
}

/** The keyword abilities a card has itself, read from its keyword lines
 * ("Flying, vigilance"). A sentence that only mentions a keyword ("Target
 * creature gains haste until end of turn.") does not count, and neither
 * does one the card hands to others — see grantedKeywords. */
export function keywordsOf(oracleText: string): Set<string> {
  return new Set(readKeywords(oracleText).map((k) => k.name));
}

/** The number a card's keyword carries ("Toxic 2" → 2), added up if it
 * has the keyword twice. Zero when it has none, or it carries a cost. */
export function keywordAmount(oracleText: string, keyword: string): number {
  return readKeywords(oracleText)
    .filter((k) => k.name === keyword)
    .reduce((sum, k) => sum + (/^\d+$/.test(k.value) ? Number(k.value) : 0), 0);
}

/** How many poison counters this creature's combat damage also gives. */
export function toxicOf(oracleText: string): number {
  return keywordAmount(oracleText, 'toxic');
}

/** What a seat's permanents hand to all of its creatures: "Creatures you
 * control have haste.", "Other creatures you control have trample and
 * haste." ("other" is read as everyone, and a leading condition is taken
 * on trust: generous), "All creatures have haste.". Grants to only some
 * creatures (Goblins, tokens, the equipped one) are left out — reading
 * them as everyone would be a guess too far. */
export function grantedKeywords(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const sentence of text.replace(/\([^)]*\)/g, '').split(/[.\n]/)) {
      const m = sentence.match(
        /^(.*?)\b(?:all creatures|creatures you control)(?: get [+-]\d+\/[+-]\d+ and)? have (.*)$/i,
      );
      if (!m) continue;
      const [, before, list] = m;
      // Nothing may stand in front but "Other" or a condition ending in a
      // comma: "Goblin creatures you control" are not everyone, and a colon
      // makes it an ability that lasts a turn.
      if (before.includes(':') || !/^(?:.*,\s*)?(?:other\s+)?$/i.test(before)) continue;
      for (const piece of list.toLowerCase().split(/[,;]|\band\b/)) {
        // A condition behind the keyword ("…have haste as long as you control
        // a Dragon") is taken on trust like one in front. "Until end of turn"
        // is not cut off: that piece stays prose, and a loan is no grant.
        const keyword = readPart(piece.split(/\b(?:as long as|if|unless|during|while)\b/)[0].trim());
        // "…protection from black and from red": the second half is no keyword
        if (keyword && !/^from\b/.test(keyword.name)) out.add(keyword.name);
      }
    }
  }
  return out;
}

/** One permanent as the combat reading sees it. */
export interface GrantSource {
  /** Names the permanent, so that "other" can leave it out: one key per
   * card on the battlefield, one per board stack. */
  key: string;
  /** Its rules text ('' when the card is not read on this device). */
  text: string;
  /** How many of it there are: the copies of one stack are each other's
   * "other". Omitted = 1. */
  copies?: number;
}

/** What a seat's permanents hand to its creatures in a fight. */
export interface Grants {
  /** The keywords handed to the creature that IS the permanent `key`
   * (pass any key that names no source for a creature that hands out
   * nothing itself). Lower case, bare names, as keywordsOf gives them. */
  to(key: string): Set<string>;
  /** The number a handed-out keyword carries ("toxic 1"), added up over
   * every permanent that hands it to that creature. */
  amount(key: string, keyword: string): number;
}

// The whole line, nothing before it and one sentence only: a condition in
// front, a cost, a quote or a second sentence all fail to match.
const GRANT_LINE =
  /^(other )?(?:creatures|permanents) you control (?:get [+-]\d+\/[+-]\d+ and )?have ([^.:"“”]+)\.?$/i;
/** "…as long as you control a Dragon", "…until end of turn": not standing. */
const CONDITIONAL = /\b(?:as long as|if|unless|during|while|until|except)\b/i;

/** The strict reading a fight is worked out from. grantedKeywords above is
 * generous on purpose — a wrong "yes, it may attack" costs nothing — but
 * arithmetic has no generous side: a keyword read wrongly is a wrong death
 * either way. So only whole lines of the front face count, and only these:
 *   "Creatures you control have …"
 *   "Other creatures you control have …" / "Other permanents you control have …"
 * (also behind a boost, "…get +1/+1 and have …": the boost is not read,
 * the keywords are). Each listed keyword is judged on its own; a word that
 * is no keyword sinks nothing. "Other" leaves out the very permanent that
 * says it — by instance, not by name: two of the same card hand it to
 * each other, one Nylea does not grant herself trample. Not read at all:
 * "Attacking creatures you control have …" (it would be handed to the
 * same seat's blockers), anything conditional ("as long as …"), grants to
 * only some creatures, "All creatures have …", and anything under a level. */
export function combatGrants(sources: GrantSource[]): Grants {
  const grants: { from: string; copies: number; other: boolean; keyword: Keyword }[] = [];
  for (const source of sources) {
    for (const line of standingLines(source.text)) {
      const m = line.match(GRANT_LINE);
      if (!m || CONDITIONAL.test(m[2])) continue;
      for (const piece of m[2].toLowerCase().split(/[,;]|\band\b/)) {
        const keyword = readPart(piece.trim());
        // "…protection from black and from red": the second half is no keyword
        if (!keyword || /^from\b/.test(keyword.name)) continue;
        grants.push({ from: source.key, copies: source.copies ?? 1, other: !!m[1], keyword });
      }
    }
  }
  const handed = (key: string) =>
    grants.filter((g) => !g.other || g.from !== key || g.copies > 1).map((g) => g.keyword);
  return {
    to: (key) => new Set(handed(key).map((k) => k.name)),
    amount: (key, keyword) =>
      handed(key)
        .filter((k) => k.name === keyword)
        .reduce((sum, k) => sum + (/^\d+$/.test(k.value) ? Number(k.value) : 0), 0),
  };
}

/** Thousand-Year Elixir and Tyvar, Jubilant Brawler: "You may activate
 * abilities of creatures you control as though those creatures had haste."
 * That frees a fresh creature's tap (its mana above all) but is NOT haste —
 * it still cannot attack — so it stays out of grantedKeywords, and only
 * the mana engine asks. */
export function tapsAsThoughHasty(texts: string[]): boolean {
  return texts.some((text) =>
    /activate abilities of creatures you control as though (?:those creatures|they) had haste/i.test(text),
  );
}

/** The rules text of everything a seat has on the battlefield: its cards
 * whose records are read, and its board stacks. This is what
 * grantedKeywords and the land rules read. An unread card is simply not
 * there yet — it can never block anything. */
export function permanentTexts(
  battlefield: Pick<CardInstance, 'cardId'>[],
  records: Record<string, Pick<CardRecord, 'oracleText'> | null | undefined>,
  board: Pick<BoardItem, 'oracleText'>[],
): string[] {
  return [
    ...battlefield.map((c) => records[c.cardId]?.oracleText ?? ''),
    ...board.map((item) => item.oracleText),
  ].filter((text) => text !== '');
}

/** Is this battlefield card a creature that cannot attack or tap for mana
 * yet? Only when it arrived since its controller's turn began, its record
 * is read, its front face is a creature, and nothing gives it haste. An
 * unread record means no: what the app cannot read never blocks a play. */
export function isSummoningSick(
  card: Pick<CardInstance, 'sick'>,
  record: Pick<CardRecord, 'typeLine' | 'oracleText'> | null | undefined,
  seatTexts: string[],
): boolean {
  if (!card.sick || !record) return false;
  if (!/\bCreature\b/.test(record.typeLine.split(' // ')[0])) return false;
  return !keywordsOf(record.oracleText).has('haste') && !grantedKeywords(seatTexts).has('haste');
}

/** How many copies of a board stack are summoning sick: the ones that
 * only just arrived, unless the stack has haste of its own or by grant.
 * Whether the stack is a creature at all is the caller's question. */
export function sickCopies(
  item: Pick<BoardItem, 'sick' | 'oracleText'>,
  seatTexts: string[],
): number {
  const sick = item.sick ?? 0;
  if (sick <= 0) return 0;
  const hasty = keywordsOf(item.oracleText).has('haste') || grantedKeywords(seatTexts).has('haste');
  return hasty ? 0 : sick;
}
