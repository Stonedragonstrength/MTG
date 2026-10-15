import type { Host } from './cards';
import { keywordsOf } from './keywords';
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
  /until end of turn|until your next turn|for each|where x|as long as|\bif\b|\bduring\b|that are|that's|chosen|attacking|blocking|this turn|perpetually|emblem|but don't own|to the left|\bin your\b|\bcards?\b/i;
const GETS = /^(.+?) gets? ([+-]\d+)\/([+-]\d+)(?: and (?:have|gain) [^.]*)?\.?$/i;

/** Who a sentence's "…get +N/+N" is for, or null when it is not read. */
function readSubject(raw: string): Omit<Anthem, 'power' | 'toughness'> | null {
  let s = raw.trim().toLowerCase();
  const a: Omit<Anthem, 'power' | 'toughness'> = {
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
  };
  if (s.startsWith('each other creature')) {
    a.other = true;
    s = 'creatures' + s.slice('each other creature'.length);
  } else if (s.startsWith('each creature')) s = 'creatures' + s.slice('each creature'.length);
  if (s.startsWith('other ')) {
    a.other = true;
    s = s.slice(6);
  } else if (s.startsWith('all ')) s = s.slice(4);
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
    if (list.length === 0 || list.some((w) => !/^[a-z][a-z'-]*$/.test(w) || /^(creature|permanent|token|land|it|they)s?$/.test(w)))
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
      const m = GETS.exec(s);
      if (!m) continue;
      const who = readSubject(m[1]);
      if (who) out.push({ ...who, power: Number(m[2]), toughness: Number(m[3]) });
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
  const sub = (front.split(/\s+—\s+/)[1] ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (
    a.types.length > 0 &&
    !a.types.some((group) => group.every((x) => sub.includes(x))) &&
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
  if (host.kind === 'card') {
    const card = player.cards?.battlefield.find((c) => c.iid === host.id);
    const record = card ? records[card.cardId] : undefined;
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

/** What the anthems on the table add to that creature's size, every seat's
 * permanents and token stacks counted (a stack once per copy). 0/0 when
 * nothing on the table is an anthem it fits. Never stored, like what it
 * wears: the lord leaves, the bonus goes with it. */
export function sizeAround(g: GameState, host: Host, records: Records): Size {
  const total: Size = { power: 0, toughness: 0 };
  let target: AnthemTarget | null | undefined;
  g.players.forEach((p, seat) => {
    for (const c of p.cards?.battlefield ?? []) {
      const record = records[c.cardId];
      if (!record) continue;
      for (const a of anthemsCached(record.oracleText)) {
        if (!whoseFits(a, seat, host.seat) || (a.other && host.kind === 'card' && host.id === c.iid && seat === host.seat)) continue;
        target ??= targetOf(g, host, records);
        if (!target || !fits(a, target)) continue;
        total.power += a.power;
        total.toughness += a.toughness;
      }
    }
    for (const it of p.board) {
      for (const a of anthemsCached(it.oracleText ?? '')) {
        if (!whoseFits(a, seat, host.seat)) continue;
        target ??= targetOf(g, host, records);
        if (!target || !fits(a, target)) continue;
        const copies = Math.max(0, it.count) - (a.other && host.kind === 'stack' && host.id === it.id && seat === host.seat ? 1 : 0);
        total.power += a.power * copies;
        total.toughness += a.toughness * copies;
      }
    }
  });
  return total;
}
