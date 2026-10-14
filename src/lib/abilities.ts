import type { Size } from './attach';
import { boostWords } from './boost';
import { keywordList } from './keywords';
import { parseCost, type PayCost } from './pay';
import type { CardRecord } from './types';

/** The abilities a creature activates to grow itself, as far as the table
 * can carry them out: Monstrosity, Adapt, Outlast, "{2}{G}: Put a +1/+1
 * counter on this creature", and "{R}: This creature gets +1/+0 until end
 * of turn" (firebreathing, shades) or "…gains flying until end of turn".
 * The store pays the mana and does it in one move (activateAbility).
 *
 * Read strictly, off the face that is up: a cost that is anything but mana
 * and {T} (sacrifice, discard, life) is left to the players, so the table
 * never pays half a cost; so is an effect it does not know. "Activate only
 * once each turn / as a sorcery / during your turn" is taken on trust. */

export type AbilityEffect =
  /** So many +1/+1 counters ('X': what was paid for X). `once`: Monstrosity —
   * only while it is not monstrous yet, and it becomes so. `ifNone`: Adapt —
   * only while it has no +1/+1 counters. */
  | { kind: 'counters'; n: number | 'X'; once?: 'monstrous'; ifNone?: true }
  /** Until end of turn (lib/boost.ts). */
  | { kind: 'boost'; power: number; toughness: number; keywords: string[] }
  /** Level up: one more level counter. */
  | { kind: 'level' };

export interface Ability {
  /** The same for the same ability of the same card: its line, and what it is. */
  key: string;
  /** "Monstrosity 3", "Adapt 2", "Outlast", "+1/+1 counter", "+1/+0 until end of turn". */
  label: string;
  /** Its mana; an {X} is counted in `cost.x`. */
  cost: PayCost;
  /** {T} is part of the cost. */
  tap: boolean;
  effect: AbilityEffect;
}

type Read = Pick<CardRecord, 'name' | 'oracleText'> | null | undefined;

const MANA = /^(?:\{[^}]+\})+$/;
const RESTRICTION = /\s*Activate only (?:once each turn|as a sorcery|during your turn)\.?/gi;
const NUMBER: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };

/** "{1}{G}, {T}" → its mana and whether it taps; null for any other cost. */
function costOf(text: string): { mana: string; tap: boolean } | null {
  let mana = '';
  let tap = false;
  for (const part of text.split(/,\s*/)) {
    if (part === '{T}') tap = true;
    else if (MANA.test(part) && !/\{[TQ]\}/.test(part)) mana += part;
    else return null;
  }
  return { mana, tap };
}

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

/** The creature's own growing abilities, in the order printed — those under a
 * level only once it has reached that level (`level`: its level counters). */
export function abilitiesOf(record: Read, level = 0): Ability[] {
  if (!record) return [];
  const name = record.name.split(' // ')[0];
  const out: Ability[] = [];
  const blocks = levelsOf(record);
  const current = blocks.find((b) => level >= b.min && level <= b.max) ?? null;
  record.oracleText
    .split('\n//\n')[0]
    .split('\n')
    .forEach((raw, i) => {
      // A line under a level the creature has not reached is not on it.
      const inBlock = blocks.find((b) => i >= b.from && i < b.to);
      if (inBlock && inBlock !== current) return;
      const line = raw.replace(/\s*\([^)]*\)/g, '').replace(RESTRICTION, '').trim().split(name).join('~');
      const add = (ability: Omit<Ability, 'key'>, kind: string) => out.push({ key: `${i}:${kind}`, ...ability });

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
      const colon = line.indexOf(': ');
      if (colon < 0) return;
      const paid = costOf(line.slice(0, colon));
      if (!paid) return;
      const cost = parseCost(paid.mana);
      const what = line.slice(colon + 2).replace(/\.$/, '').trim();
      let m: RegExpMatchArray | null;
      if ((m = what.match(/^Monstrosity (\d+|X)$/i))) {
        const n = m[1].toUpperCase() === 'X' ? 'X' : Number(m[1]);
        add({ label: `Monstrosity ${m[1].toUpperCase()}`, cost, tap: paid.tap, effect: { kind: 'counters', n, once: 'monstrous' } }, 'monstrosity');
      } else if ((m = what.match(/^Adapt (\d+)$/i))) {
        add({ label: `Adapt ${m[1]}`, cost, tap: paid.tap, effect: { kind: 'counters', n: Number(m[1]), ifNone: true } }, 'adapt');
      } else if ((m = what.match(/^Put (an?|one|two|three|four|five|\d+) \+1\/\+1 counters? on (?:this creature|~)$/i))) {
        const n = NUMBER[m[1].toLowerCase()] ?? Number(m[1]);
        add({ label: n === 1 ? '+1/+1 counter' : `${n} +1/+1 counters`, cost, tap: paid.tap, effect: { kind: 'counters', n } }, 'counters');
      } else if ((m = what.match(/^(?:this creature|~) gets ([+-]\d+)\/([+-]\d+)(?: and gains (.+?))? until end of turn$/i))) {
        const boost = { power: Number(m[1]), toughness: Number(m[2]), keywords: keywordList(m[3] ?? '') };
        add({ label: `${boostWords(boost)} until end of turn`, cost, tap: paid.tap, effect: { kind: 'boost', ...boost } }, 'boost');
      } else if ((m = what.match(/^(?:this creature|~) gains (.+?) until end of turn$/i))) {
        const keywords = keywordList(m[1]);
        if (keywords.length === 0) return;
        const boost = { power: 0, toughness: 0, keywords };
        add({ label: `${boostWords(boost)} until end of turn`, cost, tap: paid.tap, effect: { kind: 'boost', ...boost } }, 'gains');
      }
    });
  return out;
}

/** Why the ability would do nothing on that creature right now, or null:
 * Monstrosity on one that is monstrous already, Adapt on one with +1/+1
 * counters, a {T} cost on one that is tapped. */
export function abilityBlocked(
  ability: Ability,
  card: { tapped?: boolean; counters?: Record<string, number> },
): string | null {
  if (ability.tap && card.tapped) return 'It is tapped.';
  if (ability.effect.kind === 'counters' && ability.effect.once === 'monstrous' && (card.counters?.monstrous ?? 0) > 0)
    return 'It is monstrous already.';
  if (ability.effect.kind === 'counters' && ability.effect.ifNone && (card.counters?.p1p1 ?? 0) > 0)
    return 'It has +1/+1 counters already.';
  return null;
}
