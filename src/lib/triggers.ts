import { liveCombat } from './combat';
import { spellPrompts, type SpellPrompt } from './spellEffects';
import type { BoardItem, CardRecord, GameState } from './types';

/** Cards that trigger by themselves. A permanent that waits for something
 * the table can see happen — something entering ("When a Dragon you control
 * enters, return this enchantment to its owner's hand"), a creature dying,
 * an attack, a spell being cast, a turn beginning or ending — is read here,
 * and so is what has just happened. The table then carries out what needs
 * no choosing and puts a button up for the rest (components/useTriggers.ts).
 *
 * Three parts: what happened between two states of the table
 * (`happeningsBetween`; a cast is told by the store, which alone knows a
 * card left the hand to be cast), what a card waits for and does
 * (`readTriggers`, `actsOf`), and which cards it sets off (`firedBy`).
 * Everything is read strictly: a condition the table cannot check is never
 * guessed — the card then simply waits for its player, as it always did. */

type Records = Record<string, CardRecord | null | undefined>;

// ---- what happened ----

/** One thing an event is about: one card, or so many copies of a stack. */
export interface Thing {
  seat: number;
  kind: 'card' | 'stack';
  /** The card's instance id, or the stack's item id. */
  id: string;
  cardId: string | null;
  name: string;
  /** How many: a card is one, a stack as many copies as it concerns. */
  n: number;
  /** A stack carries its own type line; a card's is on its record. */
  typeLine?: string;
}
/** Something that has just entered a battlefield. */
export type Arrival = Thing;

/** Something the table saw happen, that cards may be waiting for. */
export type Happening =
  | { kind: 'enters'; things: Thing[] }
  /** Creatures put into a graveyard from the battlefield (a commander
   * sent to the command zone too: it died on its way there). */
  | { kind: 'dies'; things: Thing[] }
  /** An attack declared: these attacked, for `seat`, in fight `combat`. */
  | { kind: 'attacks'; seat: number; combat: string; things: Thing[] }
  | { kind: 'cast'; seat: number; spell: Thing }
  /** A turn passed: `ended`'s end step was behind it, `began`'s upkeep ahead. */
  | { kind: 'turn'; ended: number; began: number; turn: number }
  /** A fight began on `seat`'s turn. */
  | { kind: 'combat'; seat: number; combat: string }
  /** Every defender has blocked: these blocked. */
  | { kind: 'blocks'; combat: string; things: Thing[] }
  /** A fight's result was applied: these attackers got through to a
   * player who took damage (the store says so — the table alone cannot). */
  | { kind: 'damage'; combat: string; things: Thing[] }
  /** A seat's life changed by `n` (the trigger engine adds a burst of
   * taps on + up into one gain before anything is set off). */
  | { kind: 'life'; seat: number; n: number };

const sameThing = (it: { cardId: string | null; name: string }) => `${it.cardId ?? ''}|${it.name}`;

/** A seat's copies of each thing, added up: a stack split in two is the
 * same copies, and is neither an arrival nor a death. */
function totals(board: BoardItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of board) out.set(sameThing(it), (out.get(sameThing(it)) ?? 0) + it.count);
  return out;
}

/** What entered a battlefield between two states of the table: cards that
 * were not on their seat's battlefield before, and copies a stack gained. */
export function arrivalsBetween(prev: GameState, next: GameState): Thing[] {
  const out: Thing[] = [];
  next.players.forEach((player, seat) => {
    const before = prev.players[seat];
    if (!before) return;
    const was = new Set((before.cards?.battlefield ?? []).map((c) => c.iid));
    for (const c of player.cards?.battlefield ?? [])
      if (!was.has(c.iid)) out.push({ seat, kind: 'card', id: c.iid, cardId: c.cardId, name: c.name, n: 1 });
    const grew = totals(player.board);
    for (const [key, n] of totals(before.board)) grew.set(key, (grew.get(key) ?? 0) - n);
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

/** What left a battlefield for a graveyard (or a commander for the command
 * zone) between two states: those cards, and copies a stack lost. A copy
 * taken off a stack is gone, and the table cannot tell how — it counts as
 * having died. Whether a card was a CREATURE is for the cards waiting for
 * deaths to say ("a creature dies"). */
export function departuresBetween(prev: GameState, next: GameState): Thing[] {
  const out: Thing[] = [];
  next.players.forEach((player, seat) => {
    const before = prev.players[seat];
    if (!before) return;
    const now = new Set((player.cards?.battlefield ?? []).map((c) => c.iid));
    const went = new Set([...(player.cards?.graveyard ?? []), ...(player.cards?.command ?? [])].map((c) => c.iid));
    for (const c of before.cards?.battlefield ?? [])
      if (!now.has(c.iid) && went.has(c.iid))
        out.push({ seat, kind: 'card', id: c.iid, cardId: c.cardId, name: c.name, n: 1 });
    const shrank = totals(before.board);
    for (const [key, n] of totals(player.board)) shrank.set(key, (shrank.get(key) ?? 0) - n);
    for (const it of before.board) {
      const less = it.count - (player.board.find((b) => b.id === it.id)?.count ?? 0);
      const n = Math.min(less, shrank.get(sameThing(it)) ?? 0);
      if (n <= 0) continue;
      shrank.set(sameThing(it), (shrank.get(sameThing(it)) ?? 0) - n);
      out.push({ seat, kind: 'stack', id: it.id, cardId: it.cardId, name: it.name, n, typeLine: it.typeLine });
    }
  });
  return out;
}

/** One creature in a fight, as a thing: a card, or so many copies of a stack. */
export function unitThing(g: GameState, seat: number, unit: { kind: 'card' | 'stack'; id: string }, n = 1): Thing | null {
  const player = g.players[seat];
  if (unit.kind === 'card') {
    const c = player?.cards?.battlefield.find((x) => x.iid === unit.id);
    return c ? { seat, kind: 'card', id: c.iid, cardId: c.cardId, name: c.name, n: 1 } : null;
  }
  const it = player?.board.find((x) => x.id === unit.id);
  return it ? { seat, kind: 'stack', id: it.id, cardId: it.cardId, name: it.name, n, typeLine: it.typeLine } : null;
}

/** Everything that happened between two states of the table, in the order
 * the game has it: a turn passing, a fight beginning, an attack, deaths,
 * arrivals. (A cast is not here: the store says so itself.) */
export function happeningsBetween(prev: GameState, next: GameState): Happening[] {
  const out: Happening[] = [];
  if (prev.turnNumber !== next.turnNumber || prev.activePlayerIndex !== next.activePlayerIndex)
    out.push({ kind: 'turn', ended: prev.activePlayerIndex, began: next.activePlayerIndex, turn: next.turnNumber });
  const before = liveCombat(prev);
  const after = liveCombat(next);
  if (after && before?.id !== after.id) out.push({ kind: 'combat', seat: after.active, combat: after.id });
  const declared = after && after.step !== 'attackers' && (before?.id !== after.id || before.step === 'attackers');
  if (after && declared && (after.attacks?.length ?? 0) > 0) {
    const things = (after.attacks ?? []).flatMap((a) => unitThing(next, after.active, a.unit, a.n ?? 1) ?? []);
    if (things.length > 0) out.push({ kind: 'attacks', seat: after.active, combat: after.id, things });
  }
  // Every defender has blocked: the blocks stand.
  if (after && before?.id === after.id && before.step === 'blockers' && after.step === 'damage') {
    const things = (after.attacks ?? []).flatMap((a) =>
      (a.blockers ?? []).flatMap((b) => unitThing(next, a.target, b, b.n ?? 1) ?? []),
    );
    if (things.length > 0) out.push({ kind: 'blocks', combat: after.id, things });
  }
  next.players.forEach((p, seat) => {
    const was = prev.players[seat]?.life;
    if (was !== undefined && p.life !== was) out.push({ kind: 'life', seat, n: p.life - was });
  });
  const dead = departuresBetween(prev, next);
  if (dead.length > 0) out.push({ kind: 'dies', things: dead });
  const arrived = arrivalsBetween(prev, next);
  if (arrived.length > 0) out.push({ kind: 'enters', things: arrived });
  return out;
}

/** Is it still so? An Undo takes back what happened, and with it every
 * trigger it set off: what entered is gone again, what died is back, the
 * attack is undeclared, the spell back in hand, the turn not passed. */
export function stillHappened(g: GameState, h: Happening): boolean {
  const onField = (t: Thing) =>
    t.kind === 'card'
      ? !!g.players[t.seat]?.cards?.battlefield.some((c) => c.iid === t.id)
      : !!g.players[t.seat]?.board.some((it) => it.id === t.id);
  switch (h.kind) {
    case 'enters':
      return h.things.some(onField);
    case 'dies':
      return h.things.some((t) => t.kind === 'stack' || !onField(t));
    case 'attacks':
      return g.combat?.id === h.combat && g.combat.step !== 'attackers';
    case 'combat':
      return g.combat?.id === h.combat;
    // Taken back to choosing blockers, or to the result not yet applied: off.
    case 'blocks':
      return !(g.combat?.id === h.combat && (g.combat.step === 'attackers' || g.combat.step === 'blockers'));
    case 'damage':
      return !(g.combat?.id === h.combat && g.combat.step !== 'done');
    case 'life':
      return true;
    case 'cast':
      return !g.players[h.seat]?.cards?.hand.some((c) => c.iid === h.spell.id);
    case 'turn':
      return g.turnNumber === h.turn && g.activePlayerIndex === h.began;
  }
}

// ---- what a card waits for ----

/** What a trigger waits for. 'upkeep' stands for the start of a turn (its
 * upkeep, draw step, first main phase), 'end' for its end step. */
export type TriggerEvent = 'enters' | 'dies' | 'attacks' | 'blocks' | 'damage' | 'cast' | 'gain' | 'upkeep' | 'end' | 'combat';

/** One triggered ability of a card, for one event it waits for. */
export interface Trigger {
  /** The ability as the card prints it, without its reminder text. */
  text: string;
  event: TriggerEvent;
  /** It waits for the card itself (to enter, die, attack). */
  self: boolean;
  /** It waits for something else: whose it has to be, and what — any one
   * of `kinds`, each a list of words that all have to fit ("nontoken
   * creature"; an empty list fits anything). `another`: never the card
   * itself. `once`: "one or more … enter" goes off once however many came
   * together. For a turn's step, `whose` is whose turn it has to be. */
  other: { whose: 'you' | 'opponent' | 'any'; kinds: string[][]; another: boolean; once: boolean } | null;
  /** Part of it is beyond the table ("with power 4 or greater", "if you
   * control…"): it is offered, never carried out unasked. */
  unsure: boolean;
  /** "You may": its player decides. */
  may: boolean;
  /** What it does, with the card's own name written "~". */
  effect: string;
  /** It waits for the creature this Equipment or Aura is on ("Whenever
   * equipped creature deals combat damage to a player"). */
  host?: true;
}
/** The older name, from when only entering was read. */
export type EntersTrigger = Trigger;

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Landfall — Whenever a land you control enters, …": an ability word may lead.
const LEAD = "^(?:[A-Z][A-Za-z' -]*? — )?";
const TAIL = '(?: the battlefield)?(?: under your control)?';
// "When this creature enters", "Whenever another creature you control dies",
// "Whenever this creature enters or attacks", "Whenever you attack": the
// subject holds no comma.
const MOVES = new RegExp(`${LEAD}When(?:ever)? ([^,.]+?) (enters?|dies|die|attacks?|blocks?)(${TAIL})(?: or ([a-z' ]+?))?(${TAIL}), (.+)$`, 'i');
// "Whenever this creature deals combat damage to a player", "Whenever one or
// more Ninja you control deal combat damage to a player".
const HITS = new RegExp(
  `${LEAD}Whenever ([^,.]+?) deals? (?:combat )?damage to (?:a player|an opponent|one or more players|a player or (?:planeswalker|battle)|an opponent or planeswalker), (.+)$`,
  'i',
);
const GAINS = new RegExp(`${LEAD}Whenever (you|an opponent|a player) gains? life, (.+)$`, 'i');
const CASTS = new RegExp(
  `${LEAD}Whenever (you|an opponent|a player|another player) casts? (?:or cop(?:y|ies) )?(?:an?|another) (?:([a-z][a-z ,-]*?) )?spell, (.+)$`,
  'i',
);
const STEPS = new RegExp(
  `${LEAD}At the beginning of (?:(your|each|each opponent['’]s|each player['’]s|the) )?(upkeep|draw step|precombat main phase|first main phase|end step|combat on your turn|combat)(?: on your turn)?, (.+)$`,
  'i',
);
const ITSELF_OR = /^(.+?) or (another .+)$/;
const SOMETHING = /^(an?|another|one or more|each) (.+)$/;
/** Where the description of what it waits for stops being a list of kinds. */
const BEYOND = /\b(?:with|that|of|named|from|during|if|while|and|other than|for the first time|dealt)\b/;
/** It depends on something, or happens later ("at the beginning of the next
 * upkeep"): the table does not carry it out unasked. */
const CONDITION =
  /\b(?:if|unless|instead|as long as|only|at the beginning of|the next|at (?:the )?end of|choose|chooses|choice)\b/i;

const VERB: Record<string, TriggerEvent> = {
  enter: 'enters',
  enters: 'enters',
  die: 'dies',
  dies: 'dies',
  attack: 'attacks',
  attacks: 'attacks',
  block: 'blocks',
  blocks: 'blocks',
};
/** "Equipped creature", "enchanted creature": what the card is on. */
const ITS_HOST = /^(?:equipped|enchanted) creature$/;

type Other = NonNullable<Trigger['other']>;

/** "another nontoken creature you control", "an artifact or enchantment",
 * "one or more other creatures": whose, and of which kinds. */
function readOther(det: string, rest: string, underYourControl: boolean): (Other & { unsure: boolean }) | null {
  let what = rest;
  let whose: Other['whose'] = underYourControl ? 'you' : 'any';
  if (/\byou control\b/.test(what)) whose = 'you';
  else if (/\b(?:an opponent|your opponents?|another player) controls?\b/.test(what)) whose = 'opponent';
  what = what.replace(/\b(?:you control|(?:an opponent|your opponents?|another player) controls?)\b/g, ' ');
  const cut = what.search(BEYOND);
  const unsure = cut >= 0;
  if (unsure) what = what.slice(0, cut);
  let another = det === 'another';
  const kinds = kindsOf(what).map((words) => {
    if (!words.includes('other')) return words;
    another = true;
    return words.filter((word) => word !== 'other');
  });
  if (kinds.length === 0 || kinds.some((words) => words.length === 0)) return null;
  return { whose, kinds, another, once: det === 'one or more', unsure };
}

/** "artifact, creature, or land" → three kinds, each a list of words. */
const kindsOf = (what: string): string[][] =>
  what
    .split(/,\s*(?:or\s+)?|\s+or\s+/)
    .map((kind) => kind.trim().split(/\s+/).filter((word) => word !== ''))
    .filter((words) => words.length > 0);

const whoseOf = (word: string): Other['whose'] =>
  /^(?:you|your)$/i.test(word) ? 'you' : /opponent/i.test(word) ? 'opponent' : 'any';

/** The triggered abilities on a card's FRONT face (the face that is up: a
 * card on its back is read as its back) that the table can watch for, in
 * the order printed — one entry per event ("enters or dies" is two). */
export function readTriggers(record: Pick<CardRecord, 'name' | 'oracleText'> | null | undefined): Trigger[] {
  if (!record) return [];
  const name = record.name.split(' // ')[0];
  // A legendary card speaks of itself by its first name: "When Kenrith enters".
  const short = name.includes(',') ? name.split(',')[0].trim() : null;
  // …or by the start of it: "When Rosie Cotton enters" (Rosie Cotton of South Lane).
  const itself = (subject: string) =>
    subject === '~' ||
    /^this [a-z]+$/.test(subject) ||
    (subject.length >= 3 && !/^(?:an?|another|one|each|this|the|you) /.test(subject) && `${name.toLowerCase()} `.startsWith(`${subject} `));
  const out: Trigger[] = [];
  const add = (
    text: string,
    event: TriggerEvent,
    self: boolean,
    other: (Other & { unsure: boolean }) | null,
    effect: string,
    host = false,
  ) =>
    out.push({
      text,
      event,
      self,
      other: other ? { whose: other.whose, kinds: other.kinds, another: other.another, once: other.once } : null,
      unsure: (other?.unsure ?? false) || CONDITION.test(effect),
      // "You may", and also "its controller may": somebody decides.
      may: /\bmay\b/i.test(effect),
      effect,
      ...(host ? { host: true as const } : {}),
    });
  /** Who a subject is: the card itself, what it is on, or something else. */
  const subjectOf = (subject: string, underYou: boolean) => {
    if (itself(subject)) return { self: true, host: false, other: null };
    if (ITS_HOST.test(subject)) return { self: false, host: true, other: null };
    const both = subject.match(ITSELF_OR);
    if (both && itself(both[1])) {
      const some = both[2].match(SOMETHING);
      const other = some ? readOther(some[1], some[2], underYou) : null;
      return other ? { self: true, host: false, other } : null;
    }
    const some = subject.match(SOMETHING);
    const other = some ? readOther(some[1], some[2], underYou) : null;
    return other ? { self: false, host: false, other } : null;
  };

  for (const raw of record.oracleText.split('\n//\n')[0].split('\n')) {
    const text = raw.replace(/\s*\([^)]*\)/g, '').trim();
    let line = text.split(name).join('~');
    if (short) line = line.replace(new RegExp(`\\b${escaped(short)}\\b`, 'g'), '~');

    const step = line.match(STEPS);
    if (step) {
      const at = step[2].toLowerCase();
      const event: TriggerEvent = at === 'end step' ? 'end' : at.startsWith('combat') ? 'combat' : 'upkeep';
      const whose = at === 'combat on your turn' || /on your turn,/i.test(line) ? 'you' : whoseOf((step[1] ?? 'the').replace(/['’]s$/, ''));
      add(text, event, false, { whose, kinds: [[]], another: false, once: true, unsure: false }, step[3]);
      continue;
    }

    const gain = line.match(GAINS);
    if (gain) {
      add(text, 'gain', false, { whose: whoseOf(gain[1]), kinds: [[]], another: false, once: true, unsure: false }, gain[2]);
      continue;
    }

    const hit = line.match(HITS);
    if (hit) {
      const who = subjectOf(hit[1].toLowerCase(), false);
      if (who) add(text, 'damage', who.self, who.other, hit[2], who.host);
      continue;
    }

    const cast = line.match(CASTS);
    if (cast) {
      const kinds = cast[2] ? kindsOf(cast[2].toLowerCase()) : [[]];
      add(text, 'cast', false, { whose: whoseOf(cast[1]), kinds, another: false, once: false, unsure: false }, cast[3]);
      continue;
    }

    const m = line.match(MOVES);
    if (!m) continue;
    const subject = m[1].toLowerCase();
    const events = [VERB[m[2].toLowerCase()]];
    const also = m[4]?.toLowerCase().match(/^(enters?|dies|die|attacks?|blocks?)(?: the battlefield)?$/);
    if (also && !events.includes(VERB[also[1]])) events.push(VERB[also[1]]);
    const underYou = /under your control/i.test(`${m[3]}${m[5]}`);
    const effect = m[6];
    if (subject === 'you') {
      // "Whenever you attack": once a fight, whatever attacks.
      if (events.includes('attacks'))
        add(text, 'attacks', false, { whose: 'you', kinds: [[]], another: false, once: true, unsure: false }, effect);
      continue;
    }
    const who = subjectOf(subject, underYou);
    if (!who) continue; // not something the table knows how to watch for
    for (const event of events) {
      // What a card is on can be watched while it fights; once it has died
      // or before it arrives, the Equipment is on nothing.
      if (who.host && event !== 'attacks' && event !== 'blocks') continue;
      add(text, event, who.self, who.other, effect, who.host);
    }
  }
  return out;
}

/** The "when … enters" abilities only. */
export const entersTriggers = (record: Pick<CardRecord, 'name' | 'oracleText'> | null | undefined): Trigger[] =>
  readTriggers(record).filter((t) => t.event === 'enters');

// ---- what it does ----

/** One thing a trigger does that the table can carry out. `auto`: it needs
 * no choice and no judgement, so it happens by itself. */
export type TriggerAct = { key: string; label: string; auto: boolean } & (
  /** The card goes back to its owner's hand (from the battlefield, or
   * from the graveyard it has just died into). */
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
const BY_ITSELF = new Set<SpellPrompt['kind']>(['life', 'draw', 'tokens', 'damage', 'pump']);

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
    case 'pump':
      return { ...prompt, power: prompt.power * times, toughness: prompt.toughness * times, label: `${prompt.label} ×${times}` };
    default:
      return prompt;
  }
}

/** What a trigger does, as far as the table can do it: the card returning
 * to hand, counters on the card, and the effects spells have (life, cards,
 * tokens, damage, removal). A search the card makes as it enters is not
 * here: its list already comes up by itself when the card is played. A card
 * that has died takes no counters. */
export function actsOf(trigger: Trigger, times = 1): TriggerAct[] {
  const plain = !trigger.may && !trigger.unsure;
  const own = trigger.self && !trigger.other;
  const dead = trigger.event === 'dies' && own;
  const out: TriggerAct[] = [];
  if (RETURNS.test(trigger.effect) || (own && RETURNS_IT.test(trigger.effect)))
    out.push({ key: 'return', label: 'Return it to hand', kind: 'return', auto: plain });
  // Counters whose number is worked out ("for each creature card in your
  // graveyard") are left to the players, sentence by sentence.
  const grows = dead
    ? undefined
    : trigger.effect
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
  // What a token it makes will say ("with \"When this token dies, you gain
  // 1 life\"") is the token's, not this card's: quoted text is not read.
  const said = trigger.effect.replace(/"[^"]*"|“[^”]*”/g, '').replace(/\byou may\b/gi, 'you');
  for (const read of spellPrompts({ typeLine: '', oracleText: said })) {
    if (read.kind === 'search' && own && trigger.event === 'enters') continue;
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

// ---- which cards it sets off ----

/** A trigger that has gone off. */
export interface Fired {
  /** The seat that controls the card: "you" in its text. */
  seat: number;
  source: { iid: string; cardId: string; name: string };
  trigger: Trigger;
  /** How many of what happened it counts (three tokens died: three). */
  times: number;
  /** What set it off, as the banner says it: "Shivan Dragon entered". */
  because: string;
  /** Only the card's own entering, dying or attacking set it off. */
  own: boolean;
}

const COLOR: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

interface Seen {
  typeLine: string;
  token: boolean;
  colors: string[] | null;
}

/** What the table knows of a thing; null when it cannot read it. */
function seen(t: Thing, records: Records): Seen | null {
  const record = t.cardId ? records[t.cardId] : null;
  const typeLine = (t.kind === 'stack' ? t.typeLine : record?.typeLine)?.split(' // ')[0];
  if (!typeLine) return null;
  return {
    typeLine,
    token: record?.isToken === true || (t.kind === 'stack' && /\bToken\b/i.test(typeLine)),
    colors: record?.colors ?? null,
  };
}

function wordFits(word: string, e: Seen): boolean {
  const has = (type: string) => new RegExp(`\\b${escaped(type)}\\b`, 'i').test(e.typeLine);
  if (word === 'permanent' || word === 'permanents') return true;
  if (word === 'token' || word === 'tokens') return e.token;
  if (word === 'nontoken') return !e.token;
  if (word === 'historic') return has('artifact') || has('legendary') || has('saga');
  if (COLOR[word]) return e.colors?.includes(COLOR[word]) ?? false;
  if (word === 'colorless') return e.colors !== null && e.colors.length === 0;
  if (word === 'multicolored') return e.colors !== null && e.colors.length > 1;
  if (word === 'monocolored') return e.colors !== null && e.colors.length === 1;
  if (/^non-?[a-z]/.test(word)) return !has(word.replace(/^non-?/, ''));
  return has(word) || (word.endsWith('s') && has(word.slice(0, -1)));
}

function fits(other: Other, seat: number, t: Thing, e: Seen): boolean {
  if (other.whose === 'you' && t.seat !== seat) return false;
  if (other.whose === 'opponent' && t.seat === seat) return false;
  return other.kinds.some((words) => words.every((word) => wordFits(word, e)));
}

const VERBED: Partial<Record<TriggerEvent, string>> = {
  enters: 'entered',
  dies: 'died',
  attacks: 'attacked',
  blocks: 'blocked',
  damage: 'dealt combat damage to a player',
};

/** The triggers one happening sets off, on every seat's side: each card on
 * a battlefield — and, for deaths, each card that died with them: a dying
 * card still sees what dies beside it — whose text was waiting for it, once
 * per ability, with how much of it it counts. Cards the device cannot read
 * wait for nothing, and what it cannot read sets nothing off but itself. */
export function firedBy(g: GameState, h: Happening, records: Records): Fired[] {
  const out: Fired[] = [];
  const nameOf = (seat: number) => g.config.profiles[seat]?.name ?? '?';
  const sources: { seat: number; iid: string; cardId: string; name: string; on?: { seat: number; kind: string; id: string } }[] = [];
  g.players.forEach((player, seat) => {
    for (const c of player.cards?.battlefield ?? [])
      sources.push({ seat, iid: c.iid, cardId: c.cardId, name: c.name, ...(c.on ? { on: c.on } : {}) });
  });
  if (h.kind === 'dies')
    for (const t of h.things) if (t.kind === 'card' && t.cardId) sources.push({ seat: t.seat, iid: t.id, cardId: t.cardId, name: t.name });

  for (const source of sources) {
    for (const trigger of readTriggers(records[source.cardId])) {
      const push = (times: number, because: string, own: boolean) =>
        out.push({ seat: source.seat, source: { iid: source.iid, cardId: source.cardId, name: source.name }, trigger, times, because, own });

      if (h.kind === 'turn' || h.kind === 'combat') {
        const wanted: TriggerEvent = h.kind === 'combat' ? 'combat' : trigger.event === 'end' ? 'end' : 'upkeep';
        if (trigger.event !== wanted || !trigger.other) continue;
        const whoseTurn = h.kind === 'combat' ? h.seat : wanted === 'end' ? h.ended : h.began;
        const whose = trigger.other.whose;
        if ((whose === 'you' && whoseTurn !== source.seat) || (whose === 'opponent' && whoseTurn === source.seat)) continue;
        push(
          1,
          h.kind === 'combat'
            ? `Combat on ${nameOf(whoseTurn)}’s turn`
            : wanted === 'end'
              ? `${nameOf(whoseTurn)}’s turn ended`
              : `${nameOf(whoseTurn)}’s turn began`,
          false,
        );
        continue;
      }

      if (h.kind === 'life') {
        if (trigger.event !== 'gain' || !trigger.other || h.n <= 0) continue;
        const whose = trigger.other.whose;
        if ((whose === 'you' && h.seat !== source.seat) || (whose === 'opponent' && h.seat === source.seat)) continue;
        push(1, `${nameOf(h.seat)} gained ${h.n} life`, false);
        continue;
      }

      if (h.kind === 'cast') {
        if (trigger.event !== 'cast' || !trigger.other || h.spell.id === source.iid) continue;
        const e = seen(h.spell, records);
        if (!e || !fits(trigger.other, source.seat, h.spell, e)) continue;
        push(1, `${h.spell.name} was cast`, false);
        continue;
      }

      if (trigger.event !== h.kind) continue;
      let times = 0;
      let own = true;
      const names: string[] = [];
      for (const t of h.things) {
        const itself = t.kind === 'card' && t.seat === source.seat && t.id === source.iid;
        const e = seen(t, records);
        const ok = trigger.host
          ? !!source.on && source.on.seat === t.seat && source.on.kind === t.kind && source.on.id === t.id
          : itself
            ? trigger.self || (!!trigger.other && !trigger.other.another && !!e && fits(trigger.other, source.seat, t, e))
            : !!trigger.other && !!e && fits(trigger.other, source.seat, t, e);
        if (!ok) continue;
        times += t.n;
        own &&= itself;
        names.push(t.n > 1 ? `${t.name} ×${t.n}` : t.name);
      }
      if (times === 0) continue;
      // "One or more … enter", "whenever you attack": once, however many.
      if (trigger.other?.once && !own) times = 1;
      const verbed = VERBED[h.kind] ?? '';
      const because = own
        ? `It ${verbed}`
        : trigger.other?.kinds.every((words) => words.length === 0) && h.kind === 'attacks'
          ? `${nameOf(source.seat)} attacked`
          : `${names.join(', ')} ${verbed}`;
      push(times, because, own);
    }
  }
  return out;
}
