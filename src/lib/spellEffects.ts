import { hostName } from './attach';
import { boostCard, boostStack, boostWords } from './boost';
import { keywordList } from './keywords';
import { changeCount, computedPT, removeItem, setCounter } from './board';
import { holdInExile, hostIsThere, moveCard, setCardCounter, stealCard, tapCard, type Holder, type Host } from './cards';
import { hasKeyword, readSeat, readUnit, type CardRecords, type UnitRead } from './combatEngine';
import { tokensMadeBy, type TokenWant } from './deckTokens';
import { godsOf, notCreature, notHeldBack } from './gods';
import { isPlaneswalker } from './entering';
import { adjustLife } from './game';
import { counterWords, readCounter, type CounterRead } from './counterspells';
import { searchAsk, type SearchAsk } from './search';
import { isCreatureCard, shelfOf } from './shelf';
import type { CardRecord, GameState } from './types';

/** What a spell does, as far as its rules text says it in the usual words.
 * The cast banner offers each as a button: nothing here is ever applied
 * without a tap, and a spell this does not understand simply has none —
 * the players carry it out by hand, as they always could.
 *
 * Three parts: the reader (`spellPrompts`), the rows a prompt lets its
 * player pick from (`spellChoices`), and what a picked effect does to the
 * table, with its line for the feed (`planEffect`). */

type Read = Pick<CardRecord, 'typeLine' | 'oracleText'> | null | undefined;

const frontType = (record: Read) => (record?.typeLine ?? '').split(' // ')[0];
const frontText = (record: Read) => (record?.oracleText ?? '').split('\n//\n')[0];

/** A kind of permanent a spell can point at. 'nonland' is "nonland permanent". */
export type PermKind = 'creature' | 'artifact' | 'enchantment' | 'land' | 'planeswalker' | 'permanent' | 'nonland';

/** What a prompt's list offers. `players`: every player, only the caster's
 * opponents, or none. `kinds`: the permanents (any one of them fits). */
export interface PickFrom {
  players: 'any' | 'opponents' | null;
  kinds: PermKind[];
}

export type SpellPrompt = {
  /** The same for the same effect of the same card, every time it is read. */
  key: string;
  /** What the button says; it ends in "…" when it opens a list. */
  label: string;
  /** The list it opens; null when one tap does it. */
  pick: PickFrom | null;
  /** Which option of a modal spell it belongs to (its "•" lines, counted
   * from 0); left out for an effect that is not one of a spell's options. */
  mode?: number;
} & (
  | { kind: 'damage'; n: number }
  | { kind: 'life'; n: number; gain: boolean; who: 'you' | 'opponents' | 'target' }
  | { kind: 'draw'; n: number; who: 'you' | 'target' }
  | { kind: 'tokens'; n: number; want: TokenWant }
  | { kind: 'remove'; how: 'destroy' | 'exile' | 'bounce' }
  // "Destroy all creatures"; an overloaded spell's "Return each nonland
  // permanent you don't control to its owner's hand" (`kinds`, `theirs`).
  | { kind: 'sweep'; how: 'destroy' | 'exile' | 'bounce'; kinds?: PermKind[]; theirs?: boolean }
  | { kind: 'counters'; n: number }
  // "Until end of turn": one creature (picked) or all of its caster's
  // (`team`; `other`: but the card that said so).
  | { kind: 'pump'; power: number; toughness: number; keywords: string[]; team: boolean; other: boolean }
  // "Search your library for…": a list of its own, carried out by its player.
  | { kind: 'search'; ask: SearchAsk }
  // "Discover 4": a sheet of its own (components/DiscoverSheet.tsx), which
  // turns the cards over and asks: cast the one it finds, or take it. `n`
  // null: "discover X, where X is…" — its player says how much X is.
  | { kind: 'discover'; n: number | null }
  // "Gain control of target creature (until end of turn)": Act of Treason,
  // Threaten (untapped, with haste, for the turn), Confiscate (for good).
  | { kind: 'steal'; until: boolean }
  // "Counter target noncreature spell unless its controller pays {2}": a
  // list of its own (components/CounterSheet.tsx) of the spells cast this
  // turn (lib/counterspells.ts).
  | ({ kind: 'counter' } & CounterRead)
);

/** No more buttons than this under one spell. */
const PROMPT_CAP = 4;

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const N = '(an?|one|two|three|four|five|six|seven|eight|nine|ten|X|\\d+)';

/** The number a text gives; null for an X nobody named (or cast for zero). */
function numberOf(word: string, x: number | undefined): number | null {
  const w = word.toLowerCase();
  if (w === 'x') return typeof x === 'number' && Number.isFinite(x) && x >= 1 ? Math.floor(x) : null;
  const n = NUMBER_WORDS[w] ?? Number(w);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

const KIND = '(creature|artifact|enchantment|land|planeswalker|permanent)';
// "target nonblack creature", "target artifact or enchantment". Not one of
// the caster's own ("you control"): that is a flicker or a cost, not removal.
const THING = `((?:non[a-z]+,? )*)${KIND}(?: or ${KIND})?\\b(?! you control)`;

const DAMAGE = new RegExp(
  `\\bdeals ${N} damage to (any target|target creature or planeswalker|target creature|target player or planeswalker|target player|target opponent|each opponent)\\b`,
  'gi',
);
const GAIN = new RegExp(`\\byou gain ${N} life\\b`, 'gi');
const LOSE = new RegExp(`\\byou lose ${N} life\\b`, 'gi');
const DRAIN = new RegExp(`\\beach opponent loses ${N} life\\b`, 'gi');
const TARGET_LOSES = new RegExp(`\\btarget (player|opponent) loses ${N} life\\b`, 'gi');
const TARGET_DRAWS = new RegExp(`\\btarget (player|opponent) draws ${N} cards?\\b`, 'gi');
// "Draw two cards", "you may draw a card": the caster. "Draws" is somebody
// else, and so is a "may draw" that follows another player.
const DRAW = new RegExp(`\\b(?:(player|opponent|controller|owner|they) may )?draw ${N} cards?\\b`, 'gi');
// "Create" is the caster; "its controller creates" is not.
const CREATE = new RegExp(`\\bcreate ${N} `, 'i');
// "Exile another target nonland permanent" (Oblivion Ring), "up to one target…".
const REMOVE = new RegExp(`\\b(destroy|exile) (?:up to one )?(?:another )?target ${THING}`, 'gi');
const BOUNCE = new RegExp(`\\breturn (?:up to one )?(?:another )?target ${THING} to (?:its|their) owner['’]s hand\\b`, 'gi');
const SWEEP = /\b(destroy|exile) all creatures(?=\s*(?:,|$))/gi;
// What an overloaded spell says (lib/costs.ts overloaded): "Destroy each
// artifact you don't control", "Return each nonland permanent you don't
// control to its owner's hand". Nothing but "nonland" may narrow it.
const EACH = new RegExp(
  `\\b(destroy|exile|return) each (nonland )?${KIND}(?: or ${KIND})?( you don['’]t control)?(?: to (?:its|their) owner['’]s hand)?(?=\\s*(?:,|$))`,
  'gi',
);
const COUNTERS = new RegExp(`\\bput ${N} \\+1\\/\\+1 counters? on target creature\\b`, 'gi');
// "Gain control of target creature until end of turn" (Act of Treason),
// "Untap target creature and gain control of it until end of turn" (Threaten),
// "Gain control of target artifact" (for good).
const STEAL = new RegExp(`\\bgain control of (?:up to one )?target ${THING}(?: an opponent controls)?( until end of turn)?`, 'gi');
const STEAL_UNTAP = new RegExp(`\\buntap target ${THING}(?: an opponent controls)? and gain control of it( until end of turn)?`, 'gi');
// "Discover 4", "…, discover 3": the caster's ("that player discovers X" is not).
const DISCOVER = new RegExp(`\\bdiscover ${N}\\b`, 'gi');
// "Discover X, where X is that spell's mana value": X is the players' to work out.
const DISCOVER_X = /\bdiscover X, where X is\b/gi;
// "Target creature gets +3/+3 until end of turn", "…gets +2/+0 and gains
// first strike until end of turn", "Target creature gains indestructible
// until end of turn"; and for the team, "Creatures you control get +3/+3
// and gain trample until end of turn".
const SIGNED = '([+-](?:\\d+|X))\\/([+-](?:\\d+|X))';
const GAINED = '([a-z][a-z ,]*?)';
const PUMP_ONE = new RegExp(
  `\\b(?:up to one )?target creature(?: you control)? (?:gets ${SIGNED}(?: and gains ${GAINED})?|gains ${GAINED}) until end of turn\\b`,
  'gi',
);
const PUMP_TEAM = new RegExp(
  `\\b(other )?creatures you control (?:get ${SIGNED}(?: and gain ${GAINED})?|gain ${GAINED}) until end of turn\\b`,
  'gi',
);

/** One option of a modal spell: a line that starts with a bullet. */
const OPTION = /^[ \t]*•[^\n]*/gm;
const CHOOSE = /\bchoose (up to )?(one|two|three|four|five)\b( or (?:both|more)\b)?/i;
/** Ways a "choose one" turns into more: left open, the players know. */
const CHOOSE_MORE = /\bchoose (?:both|any number)\b|\bentwine\b|\bescalate\b/i;

/** How many of a modal spell's options its caster takes: 1 for "Choose
 * one —", 2 for "Choose two —" (and for "one or both", "up to two"). Null
 * for a card with no list of options, and for one that lets its caster take
 * as many as they like ("one or more", "you may choose both instead"). */
export function modesToChoose(record: Read): number | null {
  const text = frontText(record).replace(/\([^)]*\)/g, '');
  const first = text.search(OPTION);
  if (first < 0) return null;
  const head = text.slice(0, first);
  const m = head.match(CHOOSE);
  if (!m || CHOOSE_MORE.test(text)) return null;
  if (m[3]) return /both/i.test(m[3]) ? 2 : null;
  return NUMBER_WORDS[m[2].toLowerCase()] ?? null;
}

/** Sentences whose number is worked out, not printed: left to the players. */
const WORKED_OUT = /\bfor each\b|\bequal to\b|\bwhere X is\b/i;

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

function plural(name: string): string {
  if (/(?:[^aeiou])y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(?:lf|rf)$/i.test(name)) return `${name.slice(0, -1)}ves`; // Elf, Wolf, Dwarf
  if (/(?:s|x|ch|sh)$/i.test(name)) return `${name}es`;
  return `${name}s`;
}

function kindsOf(adjectives: string, first: string, second: string | undefined): PermKind[] {
  const a = first.toLowerCase() as PermKind;
  if (a === 'permanent' && /\bnonland\b/i.test(adjectives)) return ['nonland'];
  return second ? [a, second.toLowerCase() as PermKind] : [a];
}

const kindWords = (kinds: PermKind[]) => {
  const words = kinds.map((k) => (k === 'nonland' ? 'nonland permanent' : k));
  return `${article(words[0])} ${words.join(' or ')}`;
};

const DAMAGE_PICKS: Record<string, PickFrom | null> = {
  'any target': { players: 'any', kinds: ['creature', 'planeswalker'] },
  'target creature': { players: null, kinds: ['creature'] },
  'target creature or planeswalker': { players: null, kinds: ['creature', 'planeswalker'] },
  'target player': { players: 'any', kinds: [] },
  'target player or planeswalker': { players: 'any', kinds: ['planeswalker'] },
  'target opponent': { players: 'opponents', kinds: [] },
  'each opponent': null,
};

const playersOnly = (word: string): PickFrom => ({
  players: word.toLowerCase() === 'opponent' ? 'opponents' : 'any',
  kinds: [],
});

/** The effects this card's FRONT face spells out, in the order the text
 * gives them, each once, four at most. `x`: what the spell was cast for,
 * when it has an X — an effect that counts on an X nobody named is left out. */
export function spellPrompts(record: Read, opts?: { x?: number }): SpellPrompt[] {
  const text = frontText(record).replace(/\([^)]*\)/g, ''); // reminder text is not an effect
  const found: { at: number; prompt: SpellPrompt }[] = [];
  const num = (word: string) => numberOf(word, opts?.x);
  // A modal spell's options are its "•" lines: an effect read off one of
  // them says which (see modesToChoose).
  const options = [...text.matchAll(OPTION)].map((line) => ({
    from: line.index ?? 0,
    to: (line.index ?? 0) + line[0].length,
  }));

  for (const s of text.matchAll(/[^.\n]+/g)) {
    const sentence = s[0];
    const add = (m: RegExpMatchArray, prompt: SpellPrompt) => {
      const at = (s.index ?? 0) + (m.index ?? 0);
      const mode = options.findIndex((o) => at >= o.from && at < o.to);
      found.push({ at, prompt: mode < 0 ? prompt : { ...prompt, mode } });
    };
    if (WORKED_OUT.test(sentence)) {
      // Its sheet asks how much X is: the one number worked out that is asked for.
      for (const m of sentence.matchAll(DISCOVER_X))
        add(m, { key: 'discover:X', label: 'Discover X…', pick: null, kind: 'discover', n: null });
      continue;
    }

    for (const m of sentence.matchAll(DAMAGE)) {
      const n = num(m[1]);
      const to = m[2].toLowerCase();
      if (n === null) continue;
      const pick = DAMAGE_PICKS[to];
      add(m, {
        key: `damage:${to}:${n}`,
        label: pick ? `Deal ${n} damage…` : `Deal ${n} to each opponent`,
        pick,
        kind: 'damage',
        n,
      });
    }
    for (const m of sentence.matchAll(GAIN)) {
      const n = num(m[1]);
      if (n !== null)
        add(m, { key: `gain:${n}`, label: `Gain ${n} life`, pick: null, kind: 'life', n, gain: true, who: 'you' });
    }
    for (const m of sentence.matchAll(LOSE)) {
      const n = num(m[1]);
      if (n !== null)
        add(m, { key: `lose:${n}`, label: `Lose ${n} life`, pick: null, kind: 'life', n, gain: false, who: 'you' });
    }
    for (const m of sentence.matchAll(DRAIN)) {
      const n = num(m[1]);
      if (n !== null)
        add(m, {
          key: `drain:${n}`,
          label: `Each opponent loses ${n}`,
          pick: null,
          kind: 'life',
          n,
          gain: false,
          who: 'opponents',
        });
    }
    for (const m of sentence.matchAll(TARGET_LOSES)) {
      const n = num(m[2]);
      if (n !== null)
        add(m, {
          key: `loses:${m[1].toLowerCase()}:${n}`,
          label: `A player loses ${n}…`,
          pick: playersOnly(m[1]),
          kind: 'life',
          n,
          gain: false,
          who: 'target',
        });
    }
    for (const m of sentence.matchAll(TARGET_DRAWS)) {
      const n = num(m[2]);
      if (n !== null)
        add(m, {
          key: `draws:${m[1].toLowerCase()}:${n}`,
          label: `A player draws ${n}…`,
          pick: playersOnly(m[1]),
          kind: 'draw',
          n,
          who: 'target',
        });
    }
    for (const m of sentence.matchAll(DRAW)) {
      const n = num(m[2]);
      if (m[1] || n === null) continue;
      add(m, { key: `draw:${n}`, label: `Draw ${n}`, pick: null, kind: 'draw', n, who: 'you' });
    }
    const made = sentence.match(CREATE);
    const want = made ? tokensMadeBy([sentence])[0] : undefined;
    const howMany = made ? num(made[1]) : null;
    if (made && want && howMany !== null)
      add(made, {
        key: `tokens:${want.name}:${howMany}`,
        label: howMany === 1 ? `Make ${article(want.name)} ${want.name}` : `Make ${howMany} ${plural(want.name)}`,
        pick: null,
        kind: 'tokens',
        n: howMany,
        want,
      });
    for (const m of sentence.matchAll(REMOVE)) {
      const how = m[1].toLowerCase() as 'destroy' | 'exile';
      const kinds = kindsOf(m[2], m[3], m[4]);
      add(m, {
        key: `${how}:${kinds.join('+')}`,
        label: `${how === 'destroy' ? 'Destroy' : 'Exile'} ${kindWords(kinds)}…`,
        pick: { players: null, kinds },
        kind: 'remove',
        how,
      });
    }
    for (const m of sentence.matchAll(BOUNCE)) {
      const kinds = kindsOf(m[1], m[2], m[3]);
      add(m, {
        key: `bounce:${kinds.join('+')}`,
        label: 'Return to hand…',
        pick: { players: null, kinds },
        kind: 'remove',
        how: 'bounce',
      });
    }
    for (const m of sentence.matchAll(EACH)) {
      const verb = m[1].toLowerCase();
      // "Return each…" without "to its owner's hand" goes somewhere this does not read.
      if (verb === 'return' && !/owner['’]s hand/i.test(m[0])) continue;
      const how = verb === 'return' ? 'bounce' : (verb as 'destroy' | 'exile');
      const kinds = kindsOf(m[2] ?? '', m[3], m[4]);
      const theirs = !!m[5];
      const said = kinds.map((k) => (k === 'nonland' ? 'nonland permanent' : k)).join(' or ');
      add(m, {
        key: `sweep:${how}:${kinds.join('+')}${theirs ? ':theirs' : ''}`,
        label: `${how === 'destroy' ? 'Destroy' : how === 'exile' ? 'Exile' : 'Return'} each ${said}${theirs ? ' you don’t control' : ''}`,
        pick: null,
        kind: 'sweep',
        how,
        kinds,
        ...(theirs ? { theirs } : {}),
      });
    }
    for (const m of sentence.matchAll(SWEEP)) {
      const how = m[1].toLowerCase() as 'destroy' | 'exile';
      add(m, {
        key: `sweep:${how}`,
        label: `${how === 'destroy' ? 'Destroy' : 'Exile'} all creatures`,
        pick: null,
        kind: 'sweep',
        how,
      });
    }
    // A size change written "+3", "-2" or "+X" (X: what the spell was cast for).
    const signed = (word: string): number | null => {
      const sign = word.startsWith('-') ? -1 : 1;
      const n = word.slice(1).toUpperCase() === 'X' ? num('X') : Number(word.slice(1));
      return n === null || !Number.isFinite(n) ? null : sign * n;
    };
    const pump = (m: RegExpMatchArray, at: number, team: boolean, other: boolean) => {
      const power = m[at] ? signed(m[at]) : 0;
      const toughness = m[at + 1] ? signed(m[at + 1]) : 0;
      const keywords = keywordList(m[at + 2] ?? m[at + 3] ?? '');
      if (power === null || toughness === null || (power === 0 && toughness === 0 && keywords.length === 0)) return;
      const words = boostWords({ power, toughness, keywords });
      add(m, {
        key: `pump:${team ? 'team' : 'one'}:${words}`,
        label: team ? `Your ${other ? 'other ' : ''}creatures ${words}` : `${words.charAt(0).toUpperCase()}${words.slice(1)}…`,
        pick: team ? null : { players: null, kinds: ['creature'] },
        kind: 'pump',
        power,
        toughness,
        keywords,
        team,
        other,
      });
    };
    for (const m of sentence.matchAll(PUMP_ONE)) pump(m, 1, false, false);
    for (const m of sentence.matchAll(PUMP_TEAM)) pump(m, 2, true, !!m[1]);
    for (const m of sentence.matchAll(COUNTERS)) {
      const n = num(m[1]);
      if (n !== null)
        add(m, {
          key: `counters:${n}`,
          label: n === 1 ? 'Put a +1/+1 counter…' : `Put ${n} +1/+1 counters…`,
          pick: { players: null, kinds: ['creature'] },
          kind: 'counters',
          n,
        });
    }
    for (const m of sentence.matchAll(DISCOVER)) {
      const n = num(m[1]);
      if (n !== null) add(m, { key: `discover:${n}`, label: `Discover ${n}…`, pick: null, kind: 'discover', n });
    }
    for (const m of [...sentence.matchAll(STEAL), ...sentence.matchAll(STEAL_UNTAP)]) {
      const kinds = kindsOf(m[1], m[2], m[3]);
      const until = !!m[4];
      add(m, {
        key: `steal:${until ? 'turn' : 'keep'}:${kinds.join('+')}`,
        label: until ? `Take ${kindWords(kinds)} for the turn…` : `Take ${kindWords(kinds)}…`,
        pick: { players: null, kinds },
        kind: 'steal',
        until,
      });
    }
  }

  // A counterspell: one button, where the text has it.
  const counter = readCounter(text);
  const counterAt = counter ? text.search(/\bcounter (?:up to one )?target\b/i) : -1;
  if (counter && counterAt >= 0) {
    const mode = options.findIndex((o) => counterAt >= o.from && counterAt < o.to);
    const label = `Counter ${counterWords(counter.what)}${counter.unless ? ` unless they pay ${counter.unless}` : ''}…`;
    const prompt: SpellPrompt = { key: `counter:${counter.what}`, label, pick: null, kind: 'counter', ...counter };
    found.push({ at: counterAt, prompt: mode < 0 ? prompt : { ...prompt, mode } });
  }

  // A search of the caster's own library: one button, where the text has it.
  const ask = searchAsk(record);
  const searchAt = ask ? text.search(/\bsearch your library for\b/i) : -1;
  if (ask && searchAt >= 0) {
    const mode = options.findIndex((o) => searchAt >= o.from && searchAt < o.to);
    const prompt: SpellPrompt = { key: 'search', label: 'Search library…', pick: null, kind: 'search', ask };
    found.push({ at: searchAt, prompt: mode < 0 ? prompt : { ...prompt, mode } });
  }

  const out: SpellPrompt[] = [];
  for (const { prompt } of found.sort((a, b) => a.at - b.at)) {
    if (out.some((p) => p.key === prompt.key)) continue;
    out.push(prompt);
    if (out.length >= PROMPT_CAP) break;
  }
  return out;
}

// ---- what a prompt points at ----

/** A player, or one card or stack on some seat's side. */
export type SpellTarget = { seat: number; kind: 'player' } | Host;

/** An effect with everything chosen: what the store applies in one op.
 * Drawing and making tokens are not here — the table has those already. */
export type SpellEffect =
  | { kind: 'damage'; n: number; on: SpellTarget | 'opponents' }
  | { kind: 'life'; n: number; gain: boolean; on: number | 'opponents' }
  /** `holdFor`: exiled "until" that permanent leaves the battlefield. */
  | { kind: 'remove'; how: 'destroy' | 'exile' | 'bounce'; on: Host; holdFor?: Holder }
  | { kind: 'sweep'; how: 'destroy' | 'exile' | 'bounce'; kinds?: PermKind[]; theirs?: boolean }
  | { kind: 'counters'; n: number; on: Host }
  /** `except`: the one creature of the team that does not get it ("other"). */
  | { kind: 'pump'; power: number; toughness: number; keywords: string[]; on: Host | 'team'; except?: string }
  /** The caster gains control of it: for the turn (untapped, with haste), or for good. */
  | { kind: 'steal'; on: Host; until: boolean };

/** The effect a prompt comes to once its target (if it asks for one) is
 * picked; null when the two do not go together, and for the prompts that
 * are not the store's to apply (a draw, tokens). */
export function effectOf(
  prompt: SpellPrompt,
  caster: number,
  target?: SpellTarget,
  /** The card whose effect it is, when it is on the battlefield (a trigger): "other creatures" leaves it out. */
  sourceIid?: string,
  /** That card holds what it exiles until it leaves the battlefield (Oblivion Ring). */
  holds?: boolean,
): SpellEffect | null {
  switch (prompt.kind) {
    case 'damage':
      if (!prompt.pick) return { kind: 'damage', n: prompt.n, on: 'opponents' };
      return target ? { kind: 'damage', n: prompt.n, on: target } : null;
    case 'life':
      if (prompt.who === 'you') return { kind: 'life', n: prompt.n, gain: prompt.gain, on: caster };
      if (prompt.who === 'opponents') return { kind: 'life', n: prompt.n, gain: prompt.gain, on: 'opponents' };
      return target?.kind === 'player' ? { kind: 'life', n: prompt.n, gain: prompt.gain, on: target.seat } : null;
    case 'remove':
      if (!target || target.kind === 'player') return null;
      return {
        kind: 'remove',
        how: prompt.how,
        on: target,
        ...(holds && sourceIid && prompt.how === 'exile' ? { holdFor: { seat: caster, iid: sourceIid } } : {}),
      };
    case 'sweep':
      return { kind: 'sweep', how: prompt.how, ...(prompt.kinds ? { kinds: prompt.kinds } : {}), ...(prompt.theirs ? { theirs: true } : {}) };
    case 'counters':
      return target && target.kind !== 'player' ? { kind: 'counters', n: prompt.n, on: target } : null;
    case 'pump': {
      const size = { power: prompt.power, toughness: prompt.toughness, keywords: prompt.keywords };
      if (prompt.team) return { kind: 'pump', ...size, on: 'team', ...(prompt.other && sourceIid ? { except: sourceIid } : {}) };
      return target && target.kind !== 'player' ? { kind: 'pump', ...size, on: target } : null;
    }
    case 'steal':
      // A card only: a copy of a token stack does not cross the table.
      return target && target.kind === 'card' && target.seat !== caster ? { kind: 'steal', on: target, until: prompt.until } : null;
    default:
      return null;
  }
}

/** The caster's opponents: every other living player, in turn order after them. */
export function opponentsOf(g: GameState, caster: number): number[] {
  const seats = g.players.length;
  const out: number[] = [];
  for (let step = 1; step < seats; step++) {
    const seat = (caster + step) % seats;
    if (g.players[seat]?.eliminated === false) out.push(seat);
  }
  return out;
}

/** Would that much damage kill it? Only what the app has read can die by
 * itself: a creature whose size cannot be trusted is left to the players,
 * and an indestructible one stays. Damage is not kept on a creature, so
 * less than its toughness changes nothing. */
export function diesTo(read: Pick<UnitRead, 'unread' | 'toughness' | 'printed' | 'granted'> | null, n: number): boolean {
  return !!read && !read.unread && n >= read.toughness && !hasKeyword(read, 'indestructible');
}

/** One row of a prompt's list. */
export interface SpellChoice {
  target: SpellTarget;
  name: string;
  art: string | null;
  /** "2/2" when it has a size. */
  size: string | null;
  /** A damage prompt says what would become of a creature it can read. */
  fate: 'dies' | 'survives' | null;
}

const typeFits = (typeLine: string, kinds: PermKind[]) =>
  kinds.some((kind) =>
    kind === 'permanent'
      ? true
      : kind === 'nonland'
        ? !/\bLand\b/i.test(typeLine)
        : new RegExp(`\\b${kind}\\b`, 'i').test(typeLine),
  );

/** What `prompt`, cast by `caster`, can be pointed at on one seat's side:
 * the player (where players can be hit), then that seat's cards of the
 * right kinds, then its stacks. A card that is not read yet is offered
 * too — what the app cannot read never blocks a play. */
export function spellChoices(
  g: GameState,
  seat: number,
  prompt: SpellPrompt,
  caster: number,
  records: CardRecords,
): SpellChoice[] {
  const player = g.players[seat];
  const pick = prompt.pick;
  if (!player || !pick) return [];
  const out: SpellChoice[] = [];
  if (!player.eliminated && (pick.players === 'any' || (pick.players === 'opponents' && seat !== caster)))
    out.push({
      target: { seat, kind: 'player' },
      name: `${g.config.profiles[seat]?.name ?? '?'} · ${player.life} life`,
      art: g.config.profiles[seat]?.avatarUrl ?? null,
      size: null,
      fate: null,
    });
  if (pick.kinds.length === 0) return out;

  const seatRead = readSeat(g, seat, records);
  const fateOf = (read: UnitRead | null) =>
    !read || read.unread
      ? null
      : prompt.kind === 'damage'
        ? diesTo(read, prompt.n) ? 'dies' : 'survives'
        : // A shrink ("gets -2/-2") kills what it takes to 0 toughness.
          prompt.kind === 'pump' && prompt.toughness < 0
          ? read.toughness + prompt.toughness <= 0 ? 'dies' : 'survives'
          : null;
  const sizeOf = (read: UnitRead | null) => (read && !read.unread ? `${read.power}/${read.toughness}` : null);

  for (const c of player.cards?.battlefield ?? []) {
    const r = records[c.cardId];
    // A god below its devotion is an enchantment, not a creature, for now.
    const creature = notHeldBack(seatRead.gods, { kind: 'card', id: c.iid });
    if (r && !typeFits(creature ? frontType(r) : notCreature(frontType(r)), pick.kinds)) continue;
    const read = r && isCreatureCard(r) && creature ? readUnit(g, seat, { kind: 'card', id: c.iid }, records, seatRead) : null;
    // A planeswalker says its loyalty, and damage that takes the last of it off is the end of it.
    const loyalty = isPlaneswalker(r) ? c.counters?.loyalty : undefined;
    out.push({
      target: { seat, kind: 'card', id: c.iid },
      name: c.name,
      art: r?.imageNormal ?? null,
      size: loyalty !== undefined ? `loyalty ${loyalty}` : sizeOf(read),
      fate: loyalty !== undefined && prompt.kind === 'damage' ? (prompt.n >= loyalty ? 'dies' : 'survives') : fateOf(read),
    });
  }
  for (const it of player.board) {
    const sized = computedPT({ ...it, counters: it.counters ?? {} }) !== null;
    const isLand = it.zone === 'lands' || /\bLand\b/i.test(it.typeLine);
    const fits = pick.kinds.some((kind) =>
      kind === 'permanent'
        ? true
        : kind === 'creature'
          ? sized && it.zone !== 'lands' && notHeldBack(seatRead.gods, { kind: 'stack', id: it.id })
          : kind === 'land'
            ? isLand
            : kind === 'nonland'
              ? !isLand
              : typeFits(it.typeLine, [kind]),
    );
    if (!fits) continue;
    // Counters sit on a whole stack: only a stack of one can take them.
    if ((prompt.kind === 'counters' || prompt.kind === 'pump') && it.count !== 1) continue;
    const read = sized ? readUnit(g, seat, { kind: 'stack', id: it.id }, records, seatRead) : null;
    out.push({
      target: { seat, kind: 'stack', id: it.id },
      name: it.count > 1 ? `${it.name} ×${it.count}` : it.name,
      art: it.imageNormal,
      size: sizeOf(read),
      fate: fateOf(read),
    });
  }
  return out;
}

// ---- applying one ----

/** A chosen effect, worked out against the table as its player saw it:
 * the feed line, the reducer, and the guard a replay has to pass. */
export interface EffectPlan {
  text: string;
  /** Hands back the SAME state when there is nothing (left) to do. */
  apply: (base: GameState) => GameState;
  guard: (base: GameState) => boolean;
}

const whole = (n: number) => (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0);

/** One card leaves the battlefield, or one copy leaves its stack — a token
 * that leaves is simply gone, wherever a card would have gone. */
function leave(base: GameState, on: Host, to: 'graveyard' | 'exile' | 'hand'): GameState {
  if (!hostIsThere(base, on)) return base;
  return on.kind === 'card'
    ? moveCard(base, on.seat, on.id, 'battlefield', to)
    : changeCount(base, on.seat, on.id, -1);
}

/** What `effect` of `spell`, cast by `seat`, does to the table `g`; null
 * when it would do nothing there (its target is gone, no creature to
 * sweep). The kills and the counts are settled HERE, against what the
 * player was looking at, so the line the table reads and what happens
 * always agree; a replay onto another table only checks that the targets
 * are still on it. */
export function planEffect(
  g: GameState,
  seat: number,
  spell: string,
  effect: SpellEffect,
  records: CardRecords,
): EffectPlan | null {
  const nameOf = (s: number) => g.config.profiles[s]?.name ?? '?';
  const lead = `${nameOf(seat)}’s ${spell}`;
  const theirs = (on: Host) => `${nameOf(on.seat)}’s ${hostName(g, on)}`;
  const seatThere = (s: number) => (base: GameState) => !!base.players[s];
  const always = () => true;

  switch (effect.kind) {
    case 'damage': {
      const n = whole(effect.n);
      const on = effect.on;
      if (n === 0) return null;
      if (on === 'opponents') {
        const seats = opponentsOf(g, seat);
        if (seats.length === 0) return null;
        return {
          text: `${lead} deals ${n} to each opponent`,
          apply: (base) => seats.reduce((next, s) => (next.players[s] ? adjustLife(next, s, -n) : next), base),
          guard: always,
        };
      }
      if (on.kind === 'player') {
        if (!g.players[on.seat]) return null;
        return {
          text: `${lead} deals ${n} to ${nameOf(on.seat)}`,
          apply: (base) => (base.players[on.seat] ? adjustLife(base, on.seat, -n) : base),
          guard: seatThere(on.seat),
        };
      }
      // Damage to a planeswalker takes that much loyalty off it; with none
      // left it goes to the graveyard. One whose loyalty is not kept on the
      // table is only told about it.
      const walker = on.kind === 'card' ? g.players[on.seat]?.cards?.battlefield.find((c) => c.iid === on.id) : undefined;
      if (walker && isPlaneswalker(records[walker.cardId])) {
        const loyalty = walker.counters?.loyalty;
        const gone = loyalty !== undefined && n >= loyalty;
        return {
          text: `${lead} deals ${n} to ${theirs(on)}${loyalty === undefined ? '' : gone ? ', which goes to the graveyard' : ` (loyalty ${loyalty} → ${loyalty - n})`}`,
          apply: (base) => {
            const now = base.players[on.seat]?.cards?.battlefield.find((c) => c.iid === on.id);
            if (!now) return base;
            const left = now.counters?.loyalty;
            if (left === undefined) return { ...base }; // nothing on the table changes: the line is the whole of it
            return left - n > 0 ? setCardCounter(base, on.seat, on.id, 'loyalty', left - n) : leave(base, on, 'graveyard');
          },
          guard: (base) => hostIsThere(base, on),
        };
      }
      const read = readUnit(g, on.seat, { kind: on.kind, id: on.id }, records);
      if (!read) return null;
      const kills = diesTo(read, n);
      const size = read.unread ? '' : ` (${read.power}/${read.toughness})`;
      return {
        text: `${lead} deals ${n} to ${theirs(on)}${size}${kills ? ', which dies' : ''}`,
        apply: (base) =>
          kills
            ? leave(base, on, 'graveyard')
            : hostIsThere(base, on)
              ? { ...base } // nothing on the table changes: the line is the whole of it
              : base,
        guard: (base) => hostIsThere(base, on),
      };
    }

    case 'life': {
      const n = whole(effect.n);
      if (n === 0) return null;
      const delta = effect.gain ? n : -n;
      if (effect.on === 'opponents') {
        const seats = opponentsOf(g, seat);
        if (seats.length === 0) return null;
        return {
          text: `${lead} takes ${n} life from each opponent`,
          apply: (base) => seats.reduce((next, s) => (next.players[s] ? adjustLife(next, s, delta) : next), base),
          guard: always,
        };
      }
      const whom = effect.on;
      if (!g.players[whom]) return null;
      return {
        text:
          whom !== seat
            ? `${lead} ${effect.gain ? `gives ${n} life to` : `takes ${n} life from`} ${nameOf(whom)}`
            : effect.gain
              ? `${nameOf(seat)} gains ${n} life from ${spell}`
              : `${nameOf(seat)} loses ${n} life to ${spell}`,
        apply: (base) => (base.players[whom] ? adjustLife(base, whom, delta) : base),
        guard: seatThere(whom),
      };
    }

    case 'remove': {
      const on = effect.on;
      if (!hostIsThere(g, on)) return null;
      const to = effect.how === 'destroy' ? 'graveyard' : effect.how === 'exile' ? 'exile' : 'hand';
      // Held in exile until the card that exiled it leaves: a card only (a token is gone).
      const held = to === 'exile' && on.kind === 'card' ? effect.holdFor : undefined;
      return {
        text:
          effect.how === 'bounce'
            ? `${lead} returns ${theirs(on)} to hand`
            : `${lead} ${effect.how === 'destroy' ? 'destroys' : 'exiles'} ${theirs(on)}${held ? ' until it leaves the battlefield' : ''}`,
        apply: (base) => {
          const out = leave(base, on, to);
          return held && out !== base ? holdInExile(out, on.seat, on.id, held) : out;
        },
        guard: (base) => hostIsThere(base, on),
      };
    }

    case 'sweep': {
      // Every creature the app can see is one: a card it has read, a stack
      // with a size. What it cannot read stays, for the players to clear.
      // An overloaded spell names its kinds (every nonland permanent, every
      // artifact) and maybe only the ones its caster does not control.
      const destroy = effect.how === 'destroy';
      const kinds = effect.kinds ?? ['creature'];
      const creatures = kinds.length === 1 && kinds[0] === 'creature';
      const swept: Host[] = [];
      let count = 0;
      g.players.forEach((player, s) => {
        if (effect.theirs && s === seat) return;
        const seatRead = readSeat(g, s, records);
        const stays = (on: Host) =>
          destroy && hasKeyword(readUnit(g, s, { kind: on.kind, id: on.id }, records, seatRead), 'indestructible');
        for (const c of player.cards?.battlefield ?? []) {
          const r = records[c.cardId];
          const on: Host = { seat: s, kind: 'card', id: c.iid };
          if (!r || stays(on)) continue;
          const creature = isCreatureCard(r) && notHeldBack(seatRead.gods, on) && shelfOf(c, r) !== 'lands';
          const fits = creatures
            ? creature
            : typeFits(creature ? frontType(r) : notCreature(frontType(r)), kinds);
          if (!fits) continue;
          swept.push(on);
          count += 1;
        }
        for (const it of player.board) {
          const on: Host = { seat: s, kind: 'stack', id: it.id };
          const sized = computedPT({ ...it, counters: it.counters ?? {} }) !== null;
          const isLand = it.zone === 'lands' || /\bLand\b/i.test(it.typeLine);
          const fits = kinds.some((kind) =>
            kind === 'creature'
              ? sized && it.zone !== 'lands' && notHeldBack(seatRead.gods, on)
              : kind === 'nonland'
                ? !isLand
                : kind === 'land'
                  ? isLand
                  : typeFits(it.typeLine, [kind]),
          );
          if (!fits || stays(on)) continue;
          swept.push(on);
          count += Math.max(0, it.count);
        }
      });
      if (count === 0) return null;
      const to = destroy ? 'graveyard' : effect.how === 'exile' ? 'exile' : 'hand';
      const said = creatures && !effect.theirs
        ? 'all creatures'
        : `each ${kinds.map((k) => (k === 'nonland' ? 'nonland permanent' : k)).join(' or ')}${effect.theirs ? ` ${nameOf(seat)} doesn’t control` : ''}`;
      return {
        text: `${lead} ${destroy ? 'destroys' : effect.how === 'exile' ? 'exiles' : 'returns'} ${said}${to === 'hand' ? ' to their owners’ hands' : ''} (${count})`,
        apply: (base) =>
          swept.reduce(
            (next, on) =>
              !hostIsThere(next, on)
                ? next
                : on.kind === 'card'
                  ? moveCard(next, on.seat, on.id, 'battlefield', to)
                  : removeItem(next, on.seat, on.id),
            base,
          ),
        guard: always,
      };
    }

    case 'pump': {
      const add = { power: effect.power, toughness: effect.toughness, keywords: effect.keywords };
      const words = boostWords(add);
      if (effect.on === 'team') {
        // Every creature of the caster's the table can see is one: a card it
        // has read, a stack with a size — never what sits on the lands shelf.
        const player = g.players[seat];
        const gods = godsOf(g, seat, records);
        const cards = (player?.cards?.battlefield ?? [])
          .filter((c) => {
            const r = records[c.cardId];
            return (
              !!r &&
              isCreatureCard(r) &&
              shelfOf(c, r) !== 'lands' &&
              c.iid !== effect.except &&
              notHeldBack(gods, { kind: 'card', id: c.iid })
            );
          })
          .map((c) => c.iid);
        const stacks = (player?.board ?? [])
          .filter(
            (it) =>
              it.zone !== 'lands' &&
              computedPT({ ...it, counters: it.counters ?? {} }) !== null &&
              notHeldBack(gods, { kind: 'stack', id: it.id }),
          )
          .map((it) => it.id);
        if (cards.length + stacks.length === 0) return null;
        return {
          text: `${lead}: ${effect.except ? 'other ' : ''}creatures ${nameOf(seat)} controls get ${words} until end of turn`,
          apply: (base) =>
            stacks.reduce((next, id) => boostStack(next, seat, id, add), cards.reduce((next, iid) => boostCard(next, seat, iid, add), base)),
          guard: always,
        };
      }
      const on = effect.on;
      if (!hostIsThere(g, on)) return null;
      // A shrink to 0 toughness or less kills, whatever stands in the way of damage.
      const read = readUnit(g, on.seat, { kind: on.kind, id: on.id }, records);
      const dies = !!read && !read.unread && read.toughness + effect.toughness <= 0;
      return {
        text: `${lead} gives ${theirs(on)} ${words} until end of turn${dies ? ', which dies' : ''}`,
        apply: (base) =>
          dies
            ? leave(base, on, 'graveyard')
            : on.kind === 'card'
              ? boostCard(base, on.seat, on.id, add)
              : boostStack(base, on.seat, on.id, add),
        guard: (base) => hostIsThere(base, on),
      };
    }

    case 'counters': {
      const n = whole(effect.n);
      const on = effect.on;
      if (n === 0 || !hostIsThere(g, on)) return null;
      return {
        text: `${lead} puts ${n === 1 ? 'a +1/+1 counter' : `${n} +1/+1 counters`} on ${theirs(on)}`,
        // Added to what is there when the op lands: counters another
        // device put on meanwhile are kept.
        apply: (base) => {
          const player = base.players[on.seat];
          if (on.kind === 'card') {
            const card = player?.cards?.battlefield.find((c) => c.iid === on.id);
            return card ? setCardCounter(base, on.seat, on.id, 'p1p1', (card.counters?.['p1p1'] ?? 0) + n) : base;
          }
          const item = player?.board.find((it) => it.id === on.id);
          return item ? setCounter(base, on.seat, on.id, 'p1p1', (item.counters?.['p1p1'] ?? 0) + n) : base;
        },
        guard: (base) => hostIsThere(base, on),
      };
    }

    case 'steal': {
      const on = effect.on;
      if (on.kind !== 'card' || on.seat === seat || !hostIsThere(g, on) || !g.players[seat]?.cards) return null;
      const until = effect.until ? { turn: g.turnNumber, active: g.activePlayerIndex } : undefined;
      return {
        text: `${lead}: ${nameOf(seat)} gains control of ${theirs(on)}${until ? ' until end of turn' : ''}`,
        // For the turn: untapped, and with haste, as Threaten and Act of
        // Treason say; for good: just taken.
        apply: (base) => {
          if (!hostIsThere(base, on)) return base;
          const taken = stealCard(base, on.seat, on.id, seat, { until });
          return until ? boostCard(tapCard(taken, seat, on.id, false), seat, on.id, { power: 0, toughness: 0, keywords: ['haste'] }) : taken;
        },
        guard: (base) => hostIsThere(base, on),
      };
    }
  }
}
