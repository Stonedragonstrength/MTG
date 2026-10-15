import type { ManaColor } from './mana';
import type { CardRecord } from './types';

// "Spend this mana only to cast a creature spell": mana some sources keep
// for some things. What a payment is for (SpendOn) rides on its cost
// (pay.ts PayCost.on), and the words after "only" are judged against it.

/** What a payment is for, as far as "Spend this mana only…" asks. */
export interface SpendOn {
  /** Casting a spell, activating an ability of a permanent, or paying an upkeep. */
  act: 'cast' | 'ability' | 'upkeep';
  /** The type line of the face being cast, or of the permanent whose ability it is. */
  typeLine: string;
  /** Its colors. */
  colors: ManaColor[];
  manaValue: number;
  /** Its mana cost holds {X}. */
  x?: boolean;
  /** Its rules text: "a spell with devoid". */
  text?: string;
  /** The seat's commander, cast from the command zone. */
  commander?: boolean;
  from?: 'hand' | 'command' | 'graveyard' | 'exile';
  /** Cast with a kicker paid. */
  kicked?: boolean;
  /** An equip ability. */
  equip?: boolean;
}

const COLOR_OF: Record<string, ManaColor> = { W: 'W', U: 'U', B: 'B', R: 'R', G: 'G' };

/** The colors a mana cost gives a card: every colored symbol, both halves of a hybrid. */
function costColors(manaCost: string): ManaColor[] {
  const out: ManaColor[] = [];
  for (const [, symbol] of manaCost.matchAll(/\{([^}]+)\}/g))
    for (const part of symbol.split('/')) {
      const c = COLOR_OF[part];
      if (c && !out.includes(c)) out.push(c);
    }
  return out;
}

function manaValueOf(manaCost: string): number {
  let n = 0;
  for (const [, symbol] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    if (/^\d+$/.test(symbol)) n += Number(symbol);
    else if (/^\d+\//.test(symbol)) n += Number(symbol.split('/')[0]); // {2/W}
    else if (!symbol.includes('X')) n += 1;
  }
  return n;
}

type Read = Pick<CardRecord, 'typeLine' | 'manaCost'> & Partial<Pick<CardRecord, 'oracleText' | 'colors'>>;

/** One face of a card, as a payment for it reads it: its type line, colors
 * (devoid makes it colorless) and mana value. `face` is the half cast. */
export function spendOnCard(record: Read, act: SpendOn['act'], face = 0, more: Partial<SpendOn> = {}): SpendOn {
  const pick = (s: string, sep: string) => {
    const parts = s.split(sep);
    return parts[face] ?? parts[0];
  };
  const typeLine = pick(record.typeLine, ' // ');
  const manaCost = pick(record.manaCost, ' // ');
  const text = pick(record.oracleText ?? '', '\n//\n');
  const colors = /^Devoid\b/im.test(text)
    ? []
    : manaCost !== ''
      ? costColors(manaCost)
      : ((record.colors ?? []).filter((c) => c in COLOR_OF) as ManaColor[]);
  return {
    act,
    typeLine,
    colors,
    manaValue: manaValueOf(manaCost),
    ...(/\{X\}/.test(manaCost) ? { x: true } : {}),
    text,
    ...more,
  };
}

type Judged = boolean | null;

/** Any yes is a yes; failing that, anything unread leaves it unread. */
function anyOf(all: Judged[]): Judged {
  return all.includes(true) ? true : all.includes(null) ? null : false;
}
/** Any no is a no; failing that, anything unread leaves it unread. */
function allOf(all: Judged[]): Judged {
  return all.includes(false) ? false : all.includes(null) ? null : true;
}

const TYPES = new Set([
  'artifact',
  'creature',
  'enchantment',
  'instant',
  'sorcery',
  'planeswalker',
  'land',
  'battle',
  'kindred',
  'tribal',
  'legendary',
  'snow',
  'basic',
]);
const COLOR_WORDS: Record<string, ManaColor> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

const has = (typeLine: string, word: string) =>
  new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(typeLine);

/** One word of "colorless Eldrazi", "Dragon creature", "multicolored". */
function word(w: string, on: SpendOn): Judged {
  const lower = w.toLowerCase();
  const one = lower.replace(/s$/, '');
  if (TYPES.has(lower) || TYPES.has(one)) return has(on.typeLine, TYPES.has(lower) ? lower : one);
  const non = lower.match(/^non-?(\w+?)s?$/);
  if (non && TYPES.has(non[1])) return !has(on.typeLine, non[1]);
  if (lower in COLOR_WORDS) return on.colors.includes(COLOR_WORDS[lower]);
  if (lower === 'colorless') return on.colors.length === 0;
  if (lower === 'multicolored') return on.colors.length >= 2;
  if (lower === 'monocolored') return on.colors.length === 1;
  if (lower === 'kicked') return !!on.kicked;
  // "an ability of a colorless permanent"; a permanent spell is no instant or sorcery.
  if (one === 'permanent') return !has(on.typeLine, 'instant') && !has(on.typeLine, 'sorcery');
  if (lower === 'face-down') return false; // never cast face down here
  // A capitalized word is a subtype: "Dragon", "Eldrazi", "Equipment", "Dragons".
  if (/^[A-Z]/.test(w)) return has(on.typeLine, w) || (w.endsWith('s') && has(on.typeLine, w.slice(0, -1)));
  return null;
}

/** What a few words after "spell" ask of it. Words the app has no reading
 * for leave the whole thing unread. */
const QUALIFIERS: [RegExp, (on: SpendOn, m: RegExpMatchArray) => Judged][] = [
  [/\bwith mana value (\d+)\+/i, (on, m) => on.manaValue >= Number(m[1])],
  [/\bwithout \{X\} in (?:their|its) mana costs?/i, (on) => !on.x],
  [/\bwith \{X\} in (?:their|its) mana costs?/i, (on) => !!on.x],
  [/\bfrom (?:your|a) graveyard\b/i, (on) => on.from === 'graveyard'],
  [/\bfrom exile\b/i, (on) => on.from === 'exile'],
  [/\bfrom anywhere other than your hand\b/i, (on) => !!on.from && on.from !== 'hand'],
  // Which type or color was chosen is not kept: maybe — such mana may pay, but last.
  [/\bof (?:the chosen types?|that colou?r)\b/i, () => null],
  [/\bthat['’]s 1\+ colou?rs\b/i, (on) => on.colors.length >= 1],
  [/\bwith exactly three colou?rs\b/i, (on) => on.colors.length === 3],
  [/\bwith devoid\b/i, (on) => /^Devoid\b/im.test(on.text ?? '')],
];

/** One kind of spell (or source): "a colorless Eldrazi spell", "creature
 * spells with mana value 4+", "artifacts". */
function kind(phrase: string, on: SpendOn): Judged {
  let rest = phrase;
  const judged: Judged[] = [];
  for (const [re, test] of QUALIFIERS) {
    const m = rest.match(re);
    if (!m) continue;
    judged.push(test(on, m));
    rest = rest.replace(re, ' ');
  }
  const words = rest
    .split(/\s+/)
    .filter((w) => w !== '' && !/^(?:a|an|the|spells?|sources?|cards?)$/i.test(w));
  // Something said after the spell that is not read: "spells you don't own".
  if (words.some((w) => /^(?:with|without|that|from|of|you|whose|which|to|in)$/i.test(w))) return null;
  return allOf([...judged, ...words.map((w) => word(w, on))]);
}

/** "an instant or sorcery spell", "Vampire, Cleric, and/or Demon spells":
 * any one of the kinds will do. */
function kinds(phrase: string, on: SpendOn): Judged {
  const text = phrase
    .replace(/\b(\d+) or (?:greater|more)\b/gi, '$1+')
    .replace(/\bone or more colou?rs\b/gi, '1+ colors');
  return anyOf(text.split(/,?\s+(?:and\/or|or|and)\s+|,\s*/i).filter((p) => p.trim() !== '').map((p) => kind(p, on)));
}

/** "activate abilities of artifacts", "an equip ability", "abilities". */
function ability(rest: string, on: SpendOn): Judged {
  if (on.act !== 'ability') return false;
  const m = rest.match(/^(?:an? )?(?:([\w-]+) )?abilit(?:y|ies)(?: of (.+))?$/i);
  if (!m) return null;
  if (m[1]) return m[1].toLowerCase() === 'equip' ? !!on.equip : false; // "power-up abilities"
  return m[2] ? kinds(m[2], on) : true;
}

const VERB = /\b(cast|activate|pay|turn|foretell|unlock|gain)\b/gi;

function judge(words: string, on: SpendOn): Judged {
  const text = words
    .replace(/,? and that spell can['’]t be countered/i, '')
    .replace(/\.$/, '')
    .trim();
  // Rosheen: "on costs that contain {X}".
  if (/^on costs that contain \{X\}$/i.test(text)) return !!on.x;
  const starts = [...text.matchAll(VERB)].map((m) => m.index ?? 0);
  if (starts.length === 0) return null;
  return anyOf(
    starts.map((at, i) => {
      const clause = text
        .slice(at, starts[i + 1] ?? text.length)
        .replace(/[,\s]*(?:\b(?:and\/or|or|and)\b)?[,\s]*(?:\bto\b)?\s*$/i, '')
        .trim();
      const [, verb, rest = ''] = clause.match(/^(\w+)\s*(.*)$/) ?? [];
      switch (verb.toLowerCase()) {
        case 'cast':
          if (on.act !== 'cast') return false;
          if (/^your commander$/i.test(rest)) return !!on.commander;
          return kinds(rest, on);
        case 'activate':
          return ability(rest, on);
        case 'pay':
          return /cumulative upkeep/i.test(rest) ? on.act === 'upkeep' : false;
        default:
          return false; // turning a card face up, unlocking a door: never a payment here
      }
    }),
  );
}

/** The words for the screen: "to cast a creature spell of the chosen type"
 * (that the spell can't be countered is the players' business). */
export function spendWords(words: string): string {
  return words.replace(/,? and that spell can['’]t be countered/i, '').trim();
}

/** May mana kept by these words (what follows "Spend this mana only") pay
 * for it? true or false as the words say; null where the app cannot read
 * them ("a spell that shares a watermark with this land"). */
export function spendAllows(words: string, on: SpendOn): boolean | null {
  return judge(words, on);
}
