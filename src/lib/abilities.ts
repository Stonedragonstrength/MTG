import { attachedTo, type Size } from './attach';
import { boostWords } from './boost';
import type { Host } from './cards';
import { counterName, countersWords } from './entering';
import { keywordList } from './keywords';
import { parseCost, type PayCost } from './pay';
import type { CardRecord, GameState } from './types';

/** The abilities a permanent activates, as far as the table can carry them
 * out: a creature growing itself — Monstrosity, Adapt, Outlast, "{2}{G}: Put
 * a +1/+1 counter on this creature", and "{R}: This creature gets +1/+0
 * until end of turn" (firebreathing, shades) or "…gains flying until end of
 * turn" — and Discover from anything: a Hidden cave sacrificed, Long-Range
 * Sensor's charge counters, Quintorius Kand's −3, Buried Treasure from the
 * graveyard. The store pays the whole cost and does it in one move
 * (activateAbility).
 *
 * Read strictly, off the face that is up: a cost the table cannot pay in full
 * (discard, life, sacrificing another permanent) is left to the players, so
 * the table never pays half a cost; so is an effect it does not know.
 * "Activate only once each turn / as a sorcery / during your turn" is taken
 * on trust. */

export type AbilityEffect =
  /** So many +1/+1 counters ('X': what was paid for X). `once`: Monstrosity —
   * only while it is not monstrous yet, and it becomes so. `ifNone`: Adapt —
   * only while it has no +1/+1 counters. */
  | { kind: 'counters'; n: number | 'X'; once?: 'monstrous'; ifNone?: true }
  /** Until end of turn (lib/boost.ts). */
  | { kind: 'boost'; power: number; toughness: number; keywords: string[] }
  /** Level up: one more level counter. */
  | { kind: 'level' }
  /** Discover N; 'exiled': X is the mana value of the card exiled to pay for it. */
  | { kind: 'discover'; n: number | 'exiled' };

export interface Ability {
  /** The same for the same ability of the same card: its line, and what it is. */
  key: string;
  /** "Monstrosity 3", "Adapt 2", "Outlast", "+1/+1 counter", "+1/+0 until end of turn", "Discover 4". */
  label: string;
  /** Its mana; an {X} is counted in `cost.x`. */
  cost: PayCost;
  /** {T} is part of the cost. */
  tap: boolean;
  /** "Sacrifice this land" is part of the cost. */
  sacrifice?: true;
  /** "Remove two charge counters from this artifact" is part of the cost. */
  remove?: { kind: string; n: number };
  /** A planeswalker's: +1 puts a loyalty counter on it, −3 takes three off. */
  loyalty?: number;
  /** "Exile a creature card from your graveyard": its player picks which. */
  exiles?: 'creature';
  /** Activated from the graveyard — "{5}, Exile this card from your
   * graveyard: …" — and the card is exiled to pay for it. */
  graveyard?: true;
  effect: AbilityEffect;
}

type Read = (Pick<CardRecord, 'name' | 'oracleText'> & { typeLine?: string | null }) | null | undefined;

const MANA = /^(?:\{[^}]+\})+$/;
const RESTRICTION = /\s*Activate only (?:once each turn|as a sorcery|during your turn)\.?/gi;
const NUMBER: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const REMOVE = /^Remove (an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([a-z]+|[+-]1\/[+-]1) counters? from (?:this [a-z]+|~)$/i;
/** "+1: …", "−3: …", "0: …": a planeswalker's loyalty ability. */
const LOYALTY = /^([+−-]?)(\d+): (.+)$/;

/** What paying an ability takes, beside its mana. */
interface Paid {
  mana: string;
  tap: boolean;
  sacrifice?: true;
  remove?: { kind: string; n: number };
  loyalty?: number;
  exiles?: 'creature';
  graveyard?: true;
}

/** "{1}{G}, {T}, Sacrifice this land" → what it takes; null for a cost the
 * table cannot pay in full. */
function costOf(text: string): Paid | null {
  const paid: Paid = { mana: '', tap: false };
  for (const part of text.split(/,\s*/)) {
    let m: RegExpMatchArray | null;
    if (part === '{T}') paid.tap = true;
    else if (MANA.test(part) && !/\{[TQ]\}/.test(part)) paid.mana += part;
    else if (/^Sacrifice (?:this [a-z]+|~)$/i.test(part)) paid.sacrifice = true;
    else if ((m = part.match(REMOVE))) paid.remove = { kind: counterName(m[2]), n: NUMBER[m[1].toLowerCase()] ?? Number(m[1]) };
    else if (/^Exile (?:this card|~) from your graveyard$/i.test(part)) paid.graveyard = true;
    else if (/^Exile a creature card from your graveyard$/i.test(part)) paid.exiles = 'creature';
    else return null;
  }
  return paid;
}

/** One line of rules text, read as an ability (or not): `add` gets each one
 * found, `kind` naming what it is. `loyal`: "+1:" is a loyalty cost here (a
 * planeswalker's line; a creature's "+1:" is Spark, Alchemy's). */
function readLine(line: string, add: (ability: Omit<Ability, 'key'>, kind: string) => void, loyal: boolean): void {
  // "Level up {W}": one more level counter (as a sorcery).
  const levelUp = line.match(/^Level up ((?:\{[^}]+\})+)$/i);
  if (levelUp) {
    add({ label: 'Level up', cost: parseCost(levelUp[1]), tap: false, effect: { kind: 'level' } }, 'level');
    return;
  }

  // "Outlast {1}{W}" is "{1}{W}, {T}: Put a +1/+1 counter on this creature" (as a sorcery).
  const outlast = line.match(/^Outlast ((?:\{[^}]+\})+)$/i);
  if (outlast) {
    add({ label: 'Outlast', cost: parseCost(outlast[1]), tap: true, effect: { kind: 'counters', n: 1 } }, 'outlast');
    return;
  }
  const loyalty = loyal ? line.match(LOYALTY) : null;
  const colon = line.indexOf(': ');
  if (!loyalty && colon < 0) return;
  const paid: Paid | null = loyalty
    ? { mana: '', tap: false, loyalty: (loyalty[1] && loyalty[1] !== '+' ? -1 : 1) * Number(loyalty[2]) }
    : costOf(line.slice(0, colon));
  if (!paid) return;
  const cost = parseCost(paid.mana);
  const what = (loyalty ? loyalty[3] : line.slice(colon + 2)).replace(/\.$/, '').trim();
  // "…gains your choice of flying, first strike, or haste": its player chooses.
  const choice = (keywords?: string) => !!keywords && /\b(?:or|choice)\b/i.test(keywords);
  const { mana: _m, tap, ...more } = paid;
  // Its effect falls on the card itself: not a card it costs (sacrificed, exiled).
  const stays = !paid.sacrifice && !paid.graveyard;
  let m: RegExpMatchArray | null;
  if ((m = what.match(/^Discover (\d+)$/i))) {
    add({ label: `Discover ${m[1]}`, cost, tap, ...more, effect: { kind: 'discover', n: Number(m[1]) } }, 'discover');
  } else if (paid.exiles === 'creature' && /^Discover X, where X is the mana value of the exiled card$/i.test(what)) {
    add({ label: 'Discover X', cost, tap, ...more, effect: { kind: 'discover', n: 'exiled' } }, 'discover');
  } else if (!stays || paid.exiles) {
    return;
  } else if ((m = what.match(/^Monstrosity (\d+|X)$/i))) {
    const n = m[1].toUpperCase() === 'X' ? 'X' : Number(m[1]);
    add({ label: `Monstrosity ${m[1].toUpperCase()}`, cost, tap, ...more, effect: { kind: 'counters', n, once: 'monstrous' } }, 'monstrosity');
  } else if ((m = what.match(/^Adapt (\d+)$/i))) {
    add({ label: `Adapt ${m[1]}`, cost, tap, ...more, effect: { kind: 'counters', n: Number(m[1]), ifNone: true } }, 'adapt');
  } else if ((m = what.match(/^Put (an?|one|two|three|four|five|\d+) \+1\/\+1 counters? on (?:this creature|~)$/i))) {
    const n = NUMBER[m[1].toLowerCase()] ?? Number(m[1]);
    add({ label: n === 1 ? '+1/+1 counter' : `${n} +1/+1 counters`, cost, tap, ...more, effect: { kind: 'counters', n } }, 'counters');
  } else if ((m = what.match(/^(?:this creature|~) gets ([+-]\d+)\/([+-]\d+)(?: and gains (.+?))? until end of turn$/i))) {
    if (choice(m[3])) return;
    const boost = { power: Number(m[1]), toughness: Number(m[2]), keywords: keywordList(m[3] ?? '') };
    add({ label: `${boostWords(boost)} until end of turn`, cost, tap, ...more, effect: { kind: 'boost', ...boost } }, 'boost');
  } else if ((m = what.match(/^(?:this creature|~) gains (.+?) until end of turn$/i))) {
    if (choice(m[1])) return;
    const keywords = keywordList(m[1]);
    if (keywords.length === 0) return;
    const boost = { power: 0, toughness: 0, keywords };
    add({ label: `${boostWords(boost)} until end of turn`, cost, tap, ...more, effect: { kind: 'boost', ...boost } }, 'gains');
  }
}

/** A line as the reader takes it: no reminder text, no "Activate only…", the
 * card's own name as "~". */
const plain = (raw: string, name?: string) => {
  const line = raw.replace(/\s*\([^)]*\)/g, '').replace(RESTRICTION, '').trim();
  return name ? line.split(name).join('~') : line;
};

// ---- levels ----

/** One "LEVEL 2-6" section of a leveler: from which level to which, the
 * size it has there, and the lines it has on top. */
export interface LevelBlock {
  min: number;
  max: number;
  power: number;
  toughness: number;
  /** Where its lines are, in the card's front text (first, and one past the last). */
  from: number;
  to: number;
  text: string;
}

const LEVEL = /^LEVEL (\d+)(?:-(\d+)|\+)$/i;

/** The level sections of a creature with Level up, in the order printed. */
export function levelsOf(record: Read): LevelBlock[] {
  if (!record) return [];
  const lines = record.oracleText.split('\n//\n')[0].split('\n').map((l) => l.trim());
  const out: LevelBlock[] = [];
  lines.forEach((line, i) => {
    const m = line.match(LEVEL);
    const pt = lines[i + 1]?.match(/^(\d+)\/(\d+)$/);
    if (!m || !pt) return;
    let to = i + 2;
    while (to < lines.length && !LEVEL.test(lines[to])) to += 1;
    out.push({
      min: Number(m[1]),
      max: m[2] ? Number(m[2]) : Infinity,
      power: Number(pt[1]),
      toughness: Number(pt[2]),
      from: i + 2,
      to,
      text: lines.slice(i + 2, to).join('\n'),
    });
  });
  return out;
}

/** The section a creature with that many level counters is in; null below the first. */
export function levelNow(record: Read, level: number): LevelBlock | null {
  return levelsOf(record).find((b) => level >= b.min && level <= b.max) ?? null;
}

/** How much bigger its level makes it than printed (0/0 below the first section). */
export function levelChange(record: (Read & { power?: string | null; toughness?: string | null }) | null | undefined, level: number): Size {
  const block = levelNow(record, level);
  const power = Number(record?.power);
  const toughness = Number(record?.toughness);
  if (!block || !Number.isFinite(power) || !Number.isFinite(toughness)) return { power: 0, toughness: 0 };
  return { power: block.power - power, toughness: block.toughness - toughness };
}

/** The card's own abilities, in the order printed — those under a level only
 * once it has reached that level (`level`: its level counters). Those it
 * activates from the graveyard are among them, marked `graveyard`. */
export function abilitiesOf(record: Read, level = 0): Ability[] {
  if (!record) return [];
  const name = record.name.split(' // ')[0];
  const out: Ability[] = [];
  const blocks = levelsOf(record);
  const current = blocks.find((b) => level >= b.min && level <= b.max) ?? null;
  // Loyalty abilities are a planeswalker's (a text without its type line is taken as one).
  const loyal = !record.typeLine || /\bPlaneswalker\b/.test(record.typeLine.split(' // ')[0]);
  record.oracleText
    .split('\n//\n')[0]
    .split('\n')
    .forEach((raw, i) => {
      // A line under a level the creature has not reached is not on it.
      const inBlock = blocks.find((b) => i >= b.from && i < b.to);
      if (inBlock && inBlock !== current) return;
      readLine(plain(raw, name), (ability, kind) => out.push({ key: `${i}:${kind}`, ...ability }), loyal);
    });
  return out;
}

// "Equipped creature has reach, "{2}, {T}: Tap target…," and "{8}, {T}: Discover 10."".
const HAS_QUOTED = /^(?:Equipped|Enchanted) (?:creature|permanent) (?:gets [+-]\d+\/[+-]\d+ and )?has\b/i;

/** The abilities an Aura or Equipment gives what it sits on, in quotes —
 * Swashbuckler's Whip's "{8}, {T}: Discover 10." — read as if printed on
 * that creature: its {T} taps the creature. */
export function abilitiesGiven(record: Read): Ability[] {
  if (!record) return [];
  const out: Ability[] = [];
  record.oracleText
    .split('\n//\n')[0]
    .split('\n')
    .forEach((raw, i) => {
      if (!HAS_QUOTED.test(raw)) return;
      [...raw.matchAll(/["“]([^"”]+)["”]/g)].forEach((quoted, j) => {
        // The quote keeps the sentence's comma or period inside it.
        const line = plain(quoted[1]).replace(/,$/, '');
        readLine(line, (ability, kind) => out.push({ key: `${i}.${j}:${kind}`, ...ability }), false);
      });
    });
  return out;
}

/** What everything attached to that host gives it to activate, whoever each
 * belongs to — each keyed by the attachment, so two Whips are two rows. */
export function abilitiesWorn(g: GameState, host: Host, records: Record<string, Read>): Ability[] {
  return attachedTo(g, host).flatMap(({ card }) =>
    abilitiesGiven(records[card.cardId]).map((ability) => ({ ...ability, key: `${card.iid}/${ability.key}` })),
  );
}

/** What it costs besides mana and {T}, in words for its row: "sacrifice it",
 * "remove two charge counters", "exile it from your graveyard". */
export function costWords(ability: Ability): string[] {
  const out: string[] = [];
  if (ability.remove) out.push(`remove ${countersWords({ [ability.remove.kind]: ability.remove.n })}`);
  if (ability.exiles === 'creature') out.push('exile a creature card from your graveyard');
  if (ability.graveyard) out.push('exile it from your graveyard');
  if (ability.sacrifice) out.push('sacrifice it');
  return out;
}

/** "−3", "+1", "0": a loyalty cost as the card prints it. */
export const loyaltyWords = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** Why the ability would do nothing on that card right now, or null:
 * Monstrosity on one that is monstrous already, Adapt on one with +1/+1
 * counters, a {T} cost on one that is tapped, counters it has too few of to
 * pay with. Loyalty is counted only on a card that keeps it as counters: one
 * that does not leaves its loyalty to its player. */
export function abilityBlocked(
  ability: Ability,
  card: { tapped?: boolean; counters?: Record<string, number> },
): string | null {
  if (ability.tap && card.tapped) return 'It is tapped.';
  if (ability.remove && (card.counters?.[ability.remove.kind] ?? 0) < ability.remove.n)
    return `Not enough ${ability.remove.kind === 'p1p1' ? '+1/+1' : ability.remove.kind} counters.`;
  if ((ability.loyalty ?? 0) < 0 && card.counters?.loyalty !== undefined && card.counters.loyalty < -ability.loyalty!)
    return 'Not enough loyalty.';
  if (ability.effect.kind === 'counters' && ability.effect.once === 'monstrous' && (card.counters?.monstrous ?? 0) > 0)
    return 'It is monstrous already.';
  if (ability.effect.kind === 'counters' && ability.effect.ifNone && (card.counters?.p1p1 ?? 0) > 0)
    return 'It has +1/+1 counters already.';
  return null;
}
