import type { Host } from './cards';
import { spellPrompts, type SpellPrompt } from './spellEffects';
import type { CardRecord, GameState } from './types';

/** Cards that trigger by themselves. A permanent that waits for something
 * to enter the battlefield — itself ("When this creature enters, draw a
 * card") or something else ("When a Dragon you control enters, return this
 * enchantment to its owner's hand") — is read here, and so is what has just
 * entered. The table then carries out what needs no choosing and puts a
 * button up for the rest (components/useTriggers.ts).
 *
 * Three parts: what entered between two states of the table
 * (`arrivalsBetween`), what a card waits for and does (`entersTriggers`,
 * `actsOf`), and which cards on the table an arrival sets off (`firedBy`).
 * Everything is read strictly: a condition the table cannot check is never
 * guessed — the card then simply waits for its player, as it always did. */

type Records = Record<string, CardRecord | null | undefined>;

// ---- what has entered ----

/** Something that has just entered a battlefield: one card, or so many
 * more copies of a stack. */
export interface Arrival {
  seat: number;
  kind: 'card' | 'stack';
  /** The card's instance id, or the stack's item id. */
  id: string;
  cardId: string | null;
  name: string;
  /** How many: a card is one, a stack as many copies as it grew by. */
  n: number;
  /** A stack carries its own type line; a card's is on its record. */
  typeLine?: string;
}

/** What entered a battlefield between two states of the table: cards that
 * were not on their seat's battlefield before, and copies a stack gained.
 * A stack that was only split in two has gained nothing — a seat's copies
 * of one thing are counted together. */
export function arrivalsBetween(prev: GameState, next: GameState): Arrival[] {
  const out: Arrival[] = [];
  next.players.forEach((player, seat) => {
    const before = prev.players[seat];
    if (!before) return;
    const was = new Set((before.cards?.battlefield ?? []).map((c) => c.iid));
    for (const c of player.cards?.battlefield ?? [])
      if (!was.has(c.iid)) out.push({ seat, kind: 'card', id: c.iid, cardId: c.cardId, name: c.name, n: 1 });

    const sameThing = (it: { cardId: string | null; name: string }) => `${it.cardId ?? ''}|${it.name}`;
    const grew = new Map<string, number>();
    for (const it of player.board) grew.set(sameThing(it), (grew.get(sameThing(it)) ?? 0) + it.count);
    for (const it of before.board) grew.set(sameThing(it), (grew.get(sameThing(it)) ?? 0) - it.count);
    for (const it of player.board) {
      const more = it.count - (before.board.find((b) => b.id === it.id)?.count ?? 0);
      const n = Math.min(more, grew.get(sameThing(it)) ?? 0);
      if (n <= 0) continue;
      grew.set(sameThing(it), (grew.get(sameThing(it)) ?? 0) - n);
      out.push({ seat, kind: 'stack', id: it.id, cardId: it.cardId, name: it.name, n, typeLine: it.typeLine });
    }
  });
  return out;
}

// ---- what a card waits for ----

/** One "when … enters" ability of a card. */
export interface EntersTrigger {
  /** The ability as the card prints it, without its reminder text. */
  text: string;
  /** It waits for the card itself to enter. */
  self: boolean;
  /** It waits for something else: whose it has to be, and what — any one
   * of `kinds`, each a list of words that all have to fit ("nontoken
   * creature"). `another`: never the card itself. `once`: "one or more
   * … enter" goes off once however many entered together. */
  other: { whose: 'you' | 'opponent' | 'any'; kinds: string[][]; another: boolean; once: boolean } | null;
  /** Part of it is beyond the table ("with power 4 or greater", "if you
   * control…"): it is offered, never carried out unasked. */
  unsure: boolean;
  /** "You may": its player decides. */
  may: boolean;
  /** What it does, with the card's own name written "~". */
  effect: string;
}

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Landfall — Whenever a land you control enters, …": an ability word may
// lead; the subject holds no comma; "enters or attacks" is an entering too.
const ENTERS =
  /^(?:[A-Z][A-Za-z' -]*? — )?When(?:ever)? ([^,.]+?) enters?(?: the battlefield)?( under your control)?(?: or [a-z ]+)?, (.+)$/i;
const ITSELF_OR = /^(.+?) or (another .+)$/;
const SOMETHING = /^(an?|another|one or more|each) (.+)$/;
/** Where the description of what enters stops being a list of kinds. */
const BEYOND = /\b(?:with|that|of|named|from|during|if|while|and|other than|for the first time)\b/;
/** It depends on something, or happens later ("at the beginning of the next
 * upkeep"): the table does not carry it out unasked. */
const CONDITION = /\b(?:if|unless|instead|as long as|only|at the beginning of|the next)\b/i;

function readOther(det: string, rest: string, underYourControl: boolean): EntersTrigger['other'] & { unsure: boolean } | null {
  let what = rest;
  let whose: 'you' | 'opponent' | 'any' = underYourControl ? 'you' : 'any';
  if (/\byou control\b/.test(what)) whose = 'you';
  else if (/\b(?:an opponent|your opponents?|another player) controls?\b/.test(what)) whose = 'opponent';
  what = what.replace(/\b(?:you control|(?:an opponent|your opponents?|another player) controls?)\b/g, ' ');
  const cut = what.search(BEYOND);
  const unsure = cut >= 0;
  if (unsure) what = what.slice(0, cut);
  const kinds = what
    .split(/\s+or\s+/)
    .map((kind) => kind.trim().split(/\s+/).filter((word) => word !== ''))
    .filter((words) => words.length > 0);
  if (kinds.length === 0) return null;
  return { whose, kinds, another: det === 'another', once: det === 'one or more', unsure };
}

/** The "when … enters" abilities on a card's FRONT face (the face that is
 * up: a card on its back is read as its back), in the order printed. */
export function entersTriggers(
  record: Pick<CardRecord, 'name' | 'oracleText'> | null | undefined,
): EntersTrigger[] {
  if (!record) return [];
  const name = record.name.split(' // ')[0];
  // A legendary card speaks of itself by its first name: "When Kenrith enters".
  const short = name.includes(',') ? name.split(',')[0].trim() : null;
  // …or by the start of it: "When Rosie Cotton enters" (Rosie Cotton of South Lane).
  const itself = (subject: string) =>
    subject === '~' ||
    /^this [a-z]+$/.test(subject) ||
    (subject.length >= 3 && !/^(?:an?|another|one|each|this|the) /.test(subject) && `${name.toLowerCase()} `.startsWith(`${subject} `));
  const out: EntersTrigger[] = [];
  for (const raw of record.oracleText.split('\n//\n')[0].split('\n')) {
    const text = raw.replace(/\s*\([^)]*\)/g, '').trim();
    let line = text.split(name).join('~');
    if (short) line = line.replace(new RegExp(`\\b${escaped(short)}\\b`, 'g'), '~');
    const m = line.match(ENTERS);
    if (!m) continue;
    const subject = m[1].toLowerCase();
    const effect = m[3];
    let self = false;
    let other: ReturnType<typeof readOther> = null;
    const both = subject.match(ITSELF_OR);
    if (itself(subject)) self = true;
    else if (both && itself(both[1])) {
      self = true;
      const some = both[2].match(SOMETHING);
      other = some ? readOther(some[1], some[2], !!m[2]) : null;
      if (!other) continue;
    } else {
      const some = subject.match(SOMETHING);
      other = some ? readOther(some[1], some[2], !!m[2]) : null;
      if (!other) continue; // not an entering the table knows how to watch for
    }
    out.push({
      text,
      self,
      other: other ? { whose: other.whose, kinds: other.kinds, another: other.another, once: other.once } : null,
      unsure: (other?.unsure ?? false) || CONDITION.test(effect),
      may: /\byou may\b/i.test(effect),
      effect,
    });
  }
  return out;
}

// ---- what it does ----

/** One thing a trigger does that the table can carry out. `auto`: it needs
 * no choice and no judgement, so it happens by itself. */
export type TriggerAct = { key: string; label: string; auto: boolean } & (
  /** The card goes back to its owner's hand. */
  | { kind: 'return' }
  /** So many +1/+1 counters on the card itself. */
  | { kind: 'grow'; n: number }
  /** An effect a spell could have too (lib/spellEffects.ts). */
  | { kind: 'prompt'; prompt: SpellPrompt }
);

const NUMBER: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const RETURNS = /\breturn (?:~|this [a-z]+) to its owner['’]s hand\b/i;
const RETURNS_IT = /\breturn it to its owner['’]s hand\b/i;
const GROWS = /\bput (an?|one|two|three|four|five|\d+) \+1\/\+1 counters? on (?:~|this [a-z]+)(?![a-z])/i;
const WORKED_OUT = /\bfor each\b|\bequal to\b|\bwhere X is\b/i;
/** A draw the card's own player makes: one that starts its clause ("draw a
 * card", "then draw two cards", "you draw a card") — not "target opponents
 * each draw a card". */
const OWN_DRAW = /(?:^|[,.;] |\band |\bthen )(?:you )?draw /i;
/** Effects that touch nothing but numbers and the seat's own things. */
const BY_ITSELF = new Set<SpellPrompt['kind']>(['life', 'draw', 'tokens', 'damage']);

/** A prompt for a trigger that went off `times` times at once (three
 * tokens entered together): what has a number is that many times as much. */
function manyTimes(prompt: SpellPrompt, times: number): SpellPrompt {
  if (times <= 1 || prompt.pick !== null) return prompt;
  switch (prompt.kind) {
    case 'life': {
      const n = prompt.n * times;
      const label = prompt.who === 'opponents' ? `Each opponent loses ${n}` : prompt.gain ? `Gain ${n} life` : `Lose ${n} life`;
      return { ...prompt, n, label };
    }
    case 'draw':
      return { ...prompt, n: prompt.n * times, label: `Draw ${prompt.n * times}` };
    case 'damage':
      return { ...prompt, n: prompt.n * times, label: `Deal ${prompt.n * times} to each opponent` };
    case 'tokens':
      return { ...prompt, n: prompt.n * times, label: `${prompt.label} ×${times}` };
    default:
      return prompt;
  }
}

/** What a trigger does, as far as the table can do it: the card returning
 * to hand, counters on the card, and the effects spells have (life, cards,
 * tokens, damage, removal). A search the card makes as it enters is not
 * here: its list already comes up by itself when the card is played. */
export function actsOf(trigger: EntersTrigger, times = 1): TriggerAct[] {
  const plain = !trigger.may && !trigger.unsure;
  const own = trigger.self && !trigger.other;
  const out: TriggerAct[] = [];
  if (RETURNS.test(trigger.effect) || (own && RETURNS_IT.test(trigger.effect)))
    out.push({ key: 'return', label: 'Return it to hand', kind: 'return', auto: plain });
  // Counters whose number is worked out ("for each creature card in your
  // graveyard") are left to the players, sentence by sentence.
  const grows = trigger.effect
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !WORKED_OUT.test(sentence))
    .map((sentence) => sentence.match(GROWS))
    .find((m) => m !== null);
  if (grows) {
    const n = (NUMBER[grows[1].toLowerCase()] ?? Number(grows[1])) * times;
    if (Number.isFinite(n) && n >= 1)
      out.push({
        key: 'grow',
        label: n === 1 ? 'Put a +1/+1 counter on it' : `Put ${n} +1/+1 counters on it`,
        kind: 'grow',
        n,
        auto: plain,
      });
  }
  // "You may gain 1 life" is, once its player says yes, "you gain 1 life".
  const said = trigger.effect.replace(/\byou may\b/gi, 'you');
  for (const read of spellPrompts({ typeLine: '', oracleText: said })) {
    if (read.kind === 'search' && own) continue;
    const prompt = manyTimes(read, times);
    out.push({
      key: prompt.key,
      label: prompt.label,
      kind: 'prompt',
      prompt,
      auto:
        plain &&
        prompt.pick === null &&
        BY_ITSELF.has(prompt.kind) &&
        (prompt.kind !== 'draw' || (prompt.who === 'you' && OWN_DRAW.test(trigger.effect))),
    });
  }
  return out;
}

// ---- which cards an arrival sets off ----

/** A trigger that has gone off. */
export interface Fired {
  /** The seat that controls the card: "you" in its text. */
  seat: number;
  source: { iid: string; cardId: string; name: string };
  trigger: EntersTrigger;
  /** How many things entered that it was waiting for. */
  times: number;
  /** What entered, as the banner says it: "Shivan Dragon", "Soldier ×3". */
  because: string[];
  /** The same, on the table: when none of them is there any more (an
   * Undo), the trigger is off. */
  arrived: Host[];
  /** Only its own entering set it off. */
  own: boolean;
}

const COLOR: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

interface Entering {
  typeLine: string;
  token: boolean;
  colors: string[] | null;
}

/** What the table knows of an arrival; null when it cannot read it. */
function entering(a: Arrival, records: Records): Entering | null {
  const record = a.cardId ? records[a.cardId] : null;
  const typeLine = (a.kind === 'stack' ? a.typeLine : record?.typeLine)?.split(' // ')[0];
  if (!typeLine) return null;
  return {
    typeLine,
    token: record?.isToken === true || (a.kind === 'stack' && /\bToken\b/i.test(typeLine)),
    colors: record?.colors ?? null,
  };
}

function wordFits(word: string, e: Entering): boolean {
  const has = (type: string) => new RegExp(`\\b${escaped(type)}\\b`, 'i').test(e.typeLine);
  if (word === 'permanent' || word === 'permanents') return true;
  if (word === 'token' || word === 'tokens') return e.token;
  if (word === 'nontoken') return !e.token;
  if (COLOR[word]) return e.colors?.includes(COLOR[word]) ?? false;
  if (word === 'colorless') return e.colors !== null && e.colors.length === 0;
  if (/^non-?[a-z]/.test(word)) return !has(word.replace(/^non-?/, ''));
  return has(word) || (word.endsWith('s') && has(word.slice(0, -1)));
}

function otherFits(other: NonNullable<EntersTrigger['other']>, seat: number, a: Arrival, e: Entering): boolean {
  if (other.whose === 'you' && a.seat !== seat) return false;
  if (other.whose === 'opponent' && a.seat === seat) return false;
  return other.kinds.some((words) => words.every((word) => wordFits(word, e)));
}

/** The triggers these arrivals set off, on every seat's side: each card on
 * a battlefield whose text was waiting for one of them, once per ability,
 * with how many arrivals it counts. Cards the device cannot read wait for
 * nothing, and an arrival it cannot read sets nothing off but itself. */
export function firedBy(g: GameState, arrivals: Arrival[], records: Records): Fired[] {
  const out: Fired[] = [];
  g.players.forEach((player, seat) => {
    for (const card of player.cards?.battlefield ?? []) {
      for (const trigger of entersTriggers(records[card.cardId])) {
        let times = 0;
        let own = true;
        const because: string[] = [];
        const arrived: Host[] = [];
        for (const a of arrivals) {
          const itself = a.kind === 'card' && a.seat === seat && a.id === card.iid;
          const e = entering(a, records);
          const fits = itself
            ? trigger.self || (!!trigger.other && !trigger.other.another && !!e && otherFits(trigger.other, seat, a, e))
            : !!trigger.other && !!e && otherFits(trigger.other, seat, a, e);
          if (!fits) continue;
          times += a.n;
          own &&= itself;
          because.push(a.n > 1 ? `${a.name} ×${a.n}` : a.name);
          arrived.push({ seat: a.seat, kind: a.kind, id: a.id });
        }
        // "One or more … enter": once, however many came in together.
        if (times > 1 && trigger.other?.once) times = 1;
        if (times > 0)
          out.push({ seat, source: { iid: card.iid, cardId: card.cardId, name: card.name }, trigger, times, because, arrived, own });
      }
    }
  });
  return out;
}
