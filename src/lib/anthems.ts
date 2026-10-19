import type { Host } from './cards';
import { godsOf, notHeldBack } from './gods';
import { keywordNames, keywordsOf } from './keywords';
import { asItIs } from './vehicles';
import type { CardRecord, GameState } from './types';

type Records = Record<string, CardRecord | null | undefined>;

interface Size {
  power: number;
  toughness: number;
}

/** A standing change of size one permanent hands to a set of creatures:
 * "Creatures you control get +1/+1." (Glorious Anthem), "Other Elves you
 * control get +1/+1." (a lord), "Creatures your opponents control get
 * -1/-1.", "White creatures get +1/+1." (Crusade). */
export interface Anthem {
  power: number;
  toughness: number;
  /** Whose creatures: the source's controller's, the others', everyone's. */
  whose: 'you' | 'opponents' | 'all';
  /** "Other …": the permanent saying it is left out. */
  other: boolean;
  /** Creature types (lower case, singular) as groups, any group of which
   * will do, a group needing all its types: "Eldrazi Spawn creatures" is
   * [[eldrazi, spawn]], "Demons, Devils, and Imps" [[demon], [devil], [imp]].
   * None = any creature. */
  types: string[][];
  /** Colors, any of which will do (WUBRG); none = any. */
  colors: string[];
  /** "Nonblack": none of these. */
  notColors: string[];
  colorless: boolean;
  multicolored: boolean;
  /** "Creature tokens" true, "Nontoken creatures" false, null = either. */
  token: boolean | null;
  legendary: boolean;
  artifact: boolean;
  /** "with flying" true, "without flying" false, null = either. */
  flying: boolean | null;
  /** What it hands out besides size: "…have haste", "…get +1/+1 and have
   * mountainwalk". (The plain "Creatures you control have …" stays with
   * keywords.ts combatGrants, which reads it already.) */
  keywords: string[];
  /** "Attacking creatures you control get +1/+0": only while attacking (or
   * blocking) — counted in a fight, never on the card at rest. */
  when: 'attacking' | 'blocking' | null;
}

const COLORS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const IRREGULAR: Record<string, string> = {
  elves: 'elf',
  dwarves: 'dwarf',
  wolves: 'wolf',
  werewolves: 'werewolf',
  allies: 'ally',
  mice: 'mouse',
  sphinxes: 'sphinx',
  fungi: 'fungus',
  homunculi: 'homunculus',
  pegasi: 'pegasus',
  foxes: 'fox',
  octopi: 'octopus',
  boxes: 'box',
};
const singular = (w: string) => IRREGULAR[w] ?? (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

/** Not standing, or not the whole of who gets it: left to the players. */
const NOT_STANDING =
  /until end of turn|until your next turn|for each|where x|as long as|\bif\b|\bduring\b|that are|that's|chosen|attacking you|blocking you|this turn|perpetually|emblem|but don't own|to the left|\bin your\b|\bcards?\b|\bgains?\b/i;
const GETS = /^(.+?) gets? ([+-]\d+)\/([+-]\d+)(?: and (?:have|has) ([^.]*))?\.?$/i;
const HAS = /^(.+?) (?:have|has) ([^.]+?)\.?$/i;

type Subject = Omit<Anthem, 'power' | 'toughness' | 'keywords'>;

/** Who a sentence's "…get +N/+N" (or "…have K") is for, or null when it is not read. */
function readSubject(raw: string): Subject | null {
  let s = raw.trim().toLowerCase();
  const a: Subject = {
    whose: 'all',
    other: false,
    types: [],
    colors: [],
    notColors: [],
    colorless: false,
    multicolored: false,
    token: null,
    legendary: false,
    artifact: false,
    flying: null,
    when: null,
  };
  if (s.startsWith('each other creature')) {
    a.other = true;
    s = 'creatures' + s.slice('each other creature'.length);
  } else if (s.startsWith('each creature')) s = 'creatures' + s.slice('each creature'.length);
  if (s.startsWith('other ')) {
    a.other = true;
    s = s.slice(6);
  } else if (s.startsWith('all ')) s = s.slice(4);
  const role = /^(attacking|blocking) /.exec(s);
  if (role) {
    a.when = role[1] as 'attacking' | 'blocking';
    s = s.slice(role[0].length);
  }
  const fly = / (with|without) flying\b/.exec(s);
  if (fly) {
    a.flying = fly[1] === 'with';
    s = s.replace(fly[0], '');
  }
  if (s.endsWith(' you control')) {
    a.whose = 'you';
    s = s.slice(0, -' you control'.length);
  } else if (s.endsWith(' your opponents control')) {
    a.whose = 'opponents';
    s = s.slice(0, -' your opponents control'.length);
  }
  let words: string[];
  if (/(^| )creature tokens$/.test(s)) {
    a.token = true;
    words = s.slice(0, -'creature tokens'.length).trim().split(/\s+/).filter(Boolean);
  } else if (/(^| )creatures$/.test(s)) {
    words = s.slice(0, -'creatures'.length).trim().split(/\s+/).filter(Boolean);
  } else {
    // The creature types themselves: "Elves", "Demons, Devils, Imps, and Tieflings".
    const list = s
      .split(/,\s*|\s+and\s+|\s+or\s+/)
      .map((w) => w.replace(/^and\s+/, '').trim())
      .filter(Boolean);
    // "You have hexproof", "Each player…": a player, not creatures.
    if (
      list.length === 0 ||
      list.some(
        (w) =>
          !/^[a-z][a-z'-]*$/.test(w) ||
          /^(creature|permanent|token|land|it|they|you|your|each|player|opponent|spell|card|emblem)s?$/.test(w),
      )
    )
      return null;
    a.types = list.map((w) => [singular(w)]);
    return a;
  }
  let group: string[] = [];
  for (const raw of words) {
    const w = raw.replace(/,$/, '');
    if (w === 'and' || w === 'or' || raw.endsWith(',')) {
      // "Wizard and Shaman creatures": either will do.
      if (raw.endsWith(',') && /^[a-z][a-z'-]*$/.test(w) && !COLORS[w]) group.push(w);
      if (group.length) a.types.push(group);
      group = [];
      continue;
    }
    if (COLORS[w]) a.colors.push(COLORS[w]);
    else if (/^non(white|blue|black|red|green)$/.test(w)) a.notColors.push(COLORS[w.slice(3)]);
    else if (w === 'colorless') a.colorless = true;
    else if (w === 'multicolored') a.multicolored = true;
    else if (w === 'nontoken') a.token = false;
    else if (w === 'legendary') a.legendary = true;
    else if (w === 'artifact') a.artifact = true;
    else if (/^[a-z][a-z'-]*$/.test(w)) group.push(w);
    else return null;
  }
  if (group.length) a.types.push(group);
  return a;
}

/** Every anthem in a card's rules text (its front face): whole sentences
 * of standing text only — nothing behind a cost, a condition, a quote or
 * an ability word ("Max speed — …"). */
export function anthemsOf(oracleText: string): Anthem[] {
  const front = (oracleText.split('\n//\n')[0] ?? '').replace(/\([^)]*\)/g, '');
  const out: Anthem[] = [];
  for (const line of front.split('\n')) {
    // An activated or loyalty ability, or a line under an ability word.
    if (/^[^"]*?(\{[^}]*\}|^[+−-]?[\dX]+)[^"]*?:\s/.test(line) || /\s[—]\s/.test(line)) continue;
    for (const sentence of line.split(/(?<=\.)\s+/)) {
      const s = sentence.trim();
      if (!s || s.includes('"') || s.includes('“') || NOT_STANDING.test(s)) continue;
      const got = GETS.exec(s);
      const has = got ? null : HAS.exec(s);
      const who = got ? readSubject(got[1]) : has ? readSubject(has[1]) : null;
      if (!who) continue;
      // The plain "(Other) creatures you control … have …" is combatGrants' own.
      const plain =
        who.whose === 'you' &&
        who.when === null &&
        who.types.length === 0 &&
        who.colors.length === 0 &&
        who.notColors.length === 0 &&
        !who.colorless &&
        !who.multicolored &&
        who.token === null &&
        !who.legendary &&
        !who.artifact &&
        who.flying === null;
      const keywords = plain ? [] : keywordNames((got ? got[4] : has?.[2]) ?? '');
      if (got) out.push({ ...who, power: Number(got[2]), toughness: Number(got[3]), keywords });
      else if (keywords.length > 0) out.push({ ...who, power: 0, toughness: 0, keywords });
    }
  }
  return out;
}

const parsed = new Map<string, Anthem[]>();
function anthemsCached(text: string): Anthem[] {
  let hit = parsed.get(text);
  if (!hit) {
    hit = anthemsOf(text);
    if (parsed.size > 2000) parsed.clear();
    parsed.set(text, hit);
  }
  return hit;
}

/** What a creature is, as far as an anthem asks. */
export interface AnthemTarget {
  typeLine: string;
  colors: string[];
  token: boolean;
  text: string;
}

export function fits(a: Anthem, t: AnthemTarget): boolean {
  const front = t.typeLine.split(' // ')[0];
  if (!/\bCreature\b/.test(front)) return false;
  const [mainPart, subPart] = front.split(/\s+—\s+/);
  const sub = (subPart ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  // "Land creatures you control have trample": a card type counts as well.
  const main = mainPart.toLowerCase().split(/\s+/);
  if (
    a.types.length > 0 &&
    !a.types.some((group) => group.every((x) => sub.includes(x) || main.includes(x))) &&
    !keywordsOf(t.text).has('changeling')
  )
    return false;
  if (a.colors.length > 0 && !a.colors.some((c) => t.colors.includes(c))) return false;
  if (a.notColors.some((c) => t.colors.includes(c))) return false;
  if (a.colorless && t.colors.length > 0) return false;
  if (a.multicolored && t.colors.length < 2) return false;
  if (a.token !== null && a.token !== t.token) return false;
  if (a.legendary && !/\bLegendary\b/.test(front)) return false;
  if (a.artifact && !/\bArtifact\b/.test(front)) return false;
  if (a.flying !== null && keywordsOf(t.text).has('flying') !== a.flying) return false;
  return true;
}

function targetOf(g: GameState, host: Host, records: Records): AnthemTarget | null {
  const player = g.players[host.seat];
  if (!player) return null;
  // A god below its devotion is no creature: no anthem reaches it.
  if (!notHeldBack(godsOf(g, host.seat, records), host)) return null;
  if (host.kind === 'card') {
    const card = player.cards?.battlefield.find((c) => c.iid === host.id);
    // A crewed Vehicle is a creature through the turn: "creatures you control" reach it.
    const record = card ? asItIs(g, card, records[card.cardId]) : undefined;
    if (!card || !record) return null;
    return { typeLine: record.typeLine, colors: record.colors ?? [], token: !!record.isToken, text: record.oracleText };
  }
  const item = player.board.find((it) => it.id === host.id);
  if (!item) return null;
  const record = item.cardId ? records[item.cardId] : undefined;
  return {
    typeLine: item.typeLine,
    colors: item.color ? [item.color] : (record?.colors ?? []),
    token: /\bToken\b/.test(item.typeLine) || !!record?.isToken,
    text: item.oracleText ?? '',
  };
}

const whoseFits = (a: Anthem, sourceSeat: number, seat: number) =>
  a.whose === 'all' || (a.whose === 'you' ? sourceSeat === seat : sourceSeat !== seat);

/** Every anthem on the table that creature fits, with how many copies of
 * its source say it (a token stack once per copy, "other" leaving the
 * creature itself out). */
function eachAnthem(g: GameState, host: Host, records: Records, visit: (a: Anthem, copies: number) => void): void {
  let target: AnthemTarget | null | undefined;
  const fitting = (a: Anthem) => {
    target ??= targetOf(g, host, records);
    return !!target && fits(a, target);
  };
  g.players.forEach((p, seat) => {
    for (const c of p.cards?.battlefield ?? []) {
      const record = records[c.cardId];
      if (!record) continue;
      for (const a of anthemsCached(record.oracleText)) {
        if (!whoseFits(a, seat, host.seat) || (a.other && host.kind === 'card' && host.id === c.iid && seat === host.seat)) continue;
        if (fitting(a)) visit(a, 1);
      }
    }
    for (const it of p.board) {
      for (const a of anthemsCached(it.oracleText ?? '')) {
        if (!whoseFits(a, seat, host.seat) || !fitting(a)) continue;
        const copies = Math.max(0, it.count) - (a.other && host.kind === 'stack' && host.id === it.id && seat === host.seat ? 1 : 0);
        if (copies > 0) visit(a, copies);
      }
    }
  });
}

/** What the standing anthems on the table add to that creature's size,
 * every seat's permanents and token stacks counted. 0/0 when nothing on the
 * table is an anthem it fits. Never stored, like what it wears: the lord
 * leaves, the bonus goes with it. Attacking-only ones are not in it (sizeWhen). */
export function sizeAround(g: GameState, host: Host, records: Records): Size {
  return sizeWhen(g, host, records, null);
}

/** The anthems for a creature in that role of a fight ("Attacking creatures
 * you control get +1/+0"); null = the standing ones. */
export function sizeWhen(g: GameState, host: Host, records: Records, role: Anthem['when']): Size {
  const total: Size = { power: 0, toughness: 0 };
  eachAnthem(g, host, records, (a, copies) => {
    if (a.when !== role) return;
    total.power += a.power * copies;
    total.toughness += a.toughness * copies;
  });
  return total;
}

/** The keywords the lords on the table hand that creature ("Other Goblins
 * you control have haste", "Slivers you control have flying"); with a role,
 * also the ones for attacking or blocking creatures. */
export function keywordsAround(g: GameState, host: Host, records: Records, role: Anthem['when'] = null): Set<string> {
  const out = new Set<string>();
  eachAnthem(g, host, records, (a) => {
    if (a.when === null || a.when === role) for (const k of a.keywords) out.add(k);
  });
  return out;
}
