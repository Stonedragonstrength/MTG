import { boostWords } from './boost';
import { isCommander, type Host } from './cards';
import { cascadeGrants, reboundTurn, spellManaValue, type CascadePlan } from './cascade';
import { liveCombat } from './combat';
import { readUnit } from './combatEngine';
import { counterName, countersWords, isSaga } from './entering';
import { godsOf, notCreature, notHeldBack } from './gods';
import { keywordAmount, keywordCount, keywordList, keywordsOf } from './keywords';
import { spellPrompts, type SpellPrompt } from './spellEffects';
import type { BoardItem, CardRecord, CardZone, GameState } from './types';

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
  /** A card that died: the counters it had on it then (Undying, Persist). */
  counters?: Record<string, number>;
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
  /** A spell cast — from its owner's hand unless `from` says otherwise (a
   * commander from the command zone, a card from exile, the card a cascade
   * found in the library). `x`: what was paid for X. */
  | { kind: 'cast'; seat: number; spell: Thing; from?: CardZone; x?: number }
  /** A turn passed: `ended`'s end step was behind it, `began`'s upkeep ahead. */
  | { kind: 'turn'; ended: number; began: number; turn: number }
  /** A fight began on `seat`'s turn. */
  | { kind: 'combat'; seat: number; combat: string }
  /** Every defender has blocked: these blocked. */
  | { kind: 'blocks'; combat: string; things: Thing[] }
  /** …and these attackers became blocked (a paper blocker counts). */
  | { kind: 'blocked'; combat: string; things: Thing[] }
  /** Lore counters were added to a card (a Saga): from so many to so many. */
  | { kind: 'lore'; thing: Thing; from: number; to: number }
  /** A fight's result was applied: these attackers got through to a
   * player who took damage (the store says so — the table alone cannot). */
  | { kind: 'damage'; combat: string; things: Thing[] }
  /** A creature became monstrous (Monstrosity was activated: the store says so). */
  | { kind: 'monstrous'; thing: Thing }
  /** A planeswalker's loyalty ability was activated (the store says so):
   * `text` as the banner says it ("+1: Create a 3/2 … token."), `effect`
   * what it does with the card's name as "~" and X as paid. `feed`: the
   * feed line it was told in — taken back by an Undo, and the ability with it. */
  | { kind: 'activated'; thing: Thing; text: string; effect: string; feed?: string }
  /** Cards that left a battlefield, for anywhere (deaths are among them). */
  | { kind: 'leaves'; things: Thing[] }
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
        out.push({ seat, kind: 'card', id: c.iid, cardId: c.cardId, name: c.name, n: 1, ...(c.counters ? { counters: c.counters } : {}) });
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

/** Cards that left a battlefield between two states, for any zone. */
export function leftBetween(prev: GameState, next: GameState): Thing[] {
  const out: Thing[] = [];
  next.players.forEach((player, seat) => {
    const now = new Set((player.cards?.battlefield ?? []).map((c) => c.iid));
    for (const c of prev.players[seat]?.cards?.battlefield ?? [])
      if (!now.has(c.iid)) out.push({ seat, kind: 'card', id: c.iid, cardId: c.cardId, name: c.name, n: 1 });
  });
  return out;
}

/** Does this card hold what it exiles until it leaves the battlefield?
 * "…until this enchantment leaves the battlefield" (Banishing Light),
 * "When this leaves the battlefield, return the exiled card…" (Oblivion Ring). */
export function holdsExiled(record: Pick<CardRecord, 'name' | 'oracleText'> | null | undefined): boolean {
  if (!record) return false;
  const name = record.name.split(' // ')[0];
  const text = record.oracleText.split('\n//\n')[0].split(name).join('~');
  return (
    /\buntil (?:~|this [a-z]+) leaves the battlefield\b/i.test(text) ||
    /\bleaves the battlefield, return the exiled\b/i.test(text)
  );
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
    const blocked = (after.attacks ?? []).flatMap((a) =>
      a.blocked || (a.blockers?.length ?? 0) > 0 ? (unitThing(next, after.active, a.unit, a.n ?? 1) ?? []) : [],
    );
    if (blocked.length > 0) out.push({ kind: 'blocked', combat: after.id, things: blocked });
  }
  next.players.forEach((p, seat) => {
    const was = prev.players[seat]?.life;
    if (was !== undefined && p.life !== was) out.push({ kind: 'life', seat, n: p.life - was });
  });
  const dead = departuresBetween(prev, next);
  if (dead.length > 0) out.push({ kind: 'dies', things: dead });
  const left = leftBetween(prev, next);
  if (left.length > 0) out.push({ kind: 'leaves', things: left });
  const arrived = arrivalsBetween(prev, next);
  if (arrived.length > 0) out.push({ kind: 'enters', things: arrived });
  // Lore counters put on a card — a Saga as it enters, as its player's turn
  // begins, or by hand: its chapters.
  next.players.forEach((player, seat) => {
    const had = new Map((prev.players[seat]?.cards?.battlefield ?? []).map((c) => [c.iid, c.counters?.lore ?? 0]));
    for (const c of player.cards?.battlefield ?? []) {
      const from = had.get(c.iid) ?? 0;
      const to = c.counters?.lore ?? 0;
      if (to > from) out.push({ kind: 'lore', thing: { seat, kind: 'card', id: c.iid, cardId: c.cardId, name: c.name, n: 1 }, from, to });
    }
  });
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
    case 'monstrous':
      return (g.players[h.thing.seat]?.cards?.battlefield.find((c) => c.iid === h.thing.id)?.counters?.monstrous ?? 0) > 0;
    case 'activated':
      return !h.feed || !!g.feed?.some((e) => e.id === h.feed);
    case 'dies':
    case 'leaves':
      return h.things.some((t) => t.kind === 'stack' || !onField(t));
    case 'attacks':
      return g.combat?.id === h.combat && g.combat.step !== 'attackers';
    case 'combat':
      return g.combat?.id === h.combat;
    // Taken back to choosing blockers, or to the result not yet applied: off.
    case 'blocks':
    case 'blocked':
      return !(g.combat?.id === h.combat && (g.combat.step === 'attackers' || g.combat.step === 'blockers'));
    case 'lore': {
      const cards = g.players[h.thing.seat]?.cards;
      const c = cards?.battlefield.find((x) => x.iid === h.thing.id);
      // Taken back: as many as before. Sacrificed after its last chapter, or
      // gone to come back transformed: still so.
      if (c) return (c.counters?.lore ?? 0) !== h.from;
      return !!cards && [...cards.graveyard, ...cards.exile].some((x) => x.iid === h.thing.id);
    }
    case 'damage':
      return !(g.combat?.id === h.combat && g.combat.step !== 'done');
    case 'life':
      return true;
    case 'cast':
      return !g.players[h.seat]?.cards?.[h.from ?? 'hand'].some((c) => c.iid === h.spell.id);
    case 'turn':
      return g.turnNumber === h.turn && g.activePlayerIndex === h.began;
  }
}

// ---- what a card waits for ----

/** What a trigger waits for. 'upkeep' stands for the start of a turn (its
 * upkeep, draw step, first main phase), 'end' for its end step; 'blocked'
 * for "becomes blocked", 'lore' for a Saga's chapter. */
export type TriggerEvent =
  | 'enters'
  | 'dies'
  | 'leaves'
  | 'attacks'
  | 'blocks'
  | 'blocked'
  | 'damage'
  | 'cast'
  | 'gain'
  | 'upkeep'
  | 'end'
  | 'combat'
  | 'monstrous'
  | 'lore'
  | 'activated';

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
  /** A Saga's chapter ability: the chapters it is ("I, II —" is 1 and 2). */
  chapters?: number[];
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
const MOVES = new RegExp(
  `${LEAD}When(?:ever)? ([^,.]+?) (enters?|dies|die|attacks?|blocks?|becomes? blocked|leaves the battlefield)(${TAIL})(?: or ([a-z' ]+?))?(${TAIL}), (.+)$`,
  'i',
);
/** A Saga's chapter: "I —", "II, III —". */
const CHAPTER = /^((?:I|II|III|IV|V|VI|VII)(?:, (?:I|II|III|IV|V|VI|VII))*) — (.+)$/;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
/** 2 → "II". */
export const roman = (n: number): string => ROMAN[n - 1] ?? `${n}`;
/** "Cumulative upkeep {1}", "Cumulative upkeep—Pay 1 life.": what it costs, each age counter. */
const CUMULATIVE = /^Cumulative upkeep(?: ((?:\{[^}]+\})+)|—(.+?)\.?)$/i;
// "Whenever this creature deals combat damage to a player", "Whenever one or
// more Ninja you control deal combat damage to a player".
const HITS = new RegExp(
  `${LEAD}Whenever ([^,.]+?) deals? (?:combat )?damage to (?:a player|an opponent|one or more players|a player or (?:planeswalker|battle)|an opponent or planeswalker), (.+)$`,
  'i',
);
const GAINS = new RegExp(`${LEAD}Whenever (you|an opponent|a player) gains? life, (.+)$`, 'i');
const MONSTROUS = new RegExp(`${LEAD}When(?:ever)? (?:~|this creature) becomes monstrous, (.+)$`, 'i');
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
  'leaves the battlefield': 'leaves',
  'become blocked': 'blocked',
  'becomes blocked': 'blocked',
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
export function readTriggers(
  record: (Pick<CardRecord, 'name' | 'oracleText'> & { typeLine?: string | null }) | null | undefined,
): Trigger[] {
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
    /** Part of what it waits for is beyond the table ("…becomes blocked by a white creature"). */
    beyond = false,
  ) =>
    out.push({
      text,
      event,
      self,
      other: other ? { whose: other.whose, kinds: other.kinds, another: other.another, once: other.once } : null,
      unsure: beyond || (other?.unsure ?? false) || CONDITION.test(effect),
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

  // Keywords that are triggers of their own (their reminder text is not
  // read): Undying, Persist, Evolve, Training, Prowess, Exalted, Bushido…
  const keywords = keywordsOf(record.oracleText);
  const amount = (name: string) => keywordAmount(record.oracleText, name);
  const keyword = (text: string, event: TriggerEvent, effect: string, other: Trigger['other'] = null) =>
    out.push({ text, event, self: other === null, other, unsure: false, may: false, effect });
  /** At the beginning of its controller's upkeep. */
  const yourTurn: Trigger['other'] = { whose: 'you', kinds: [[]], another: false, once: true };
  if (keywords.has('undying')) keyword('Undying', 'dies', 'undying');
  if (keywords.has('persist')) keyword('Persist', 'dies', 'persist');
  if (keywords.has('evolve'))
    keyword('Evolve', 'enters', 'evolve', { whose: 'you', kinds: [['creature']], another: true, once: false });
  if (keywords.has('training')) keyword('Training', 'attacks', 'training');
  if (keywords.has('prowess'))
    keyword('Prowess', 'cast', 'prowess', { whose: 'you', kinds: [['noncreature']], another: false, once: false });
  if (keywords.has('exalted'))
    keyword('Exalted', 'attacks', 'exalted', { whose: 'you', kinds: [['creature']], another: false, once: true });
  const bushido = amount('bushido');
  if (bushido > 0) {
    keyword(`Bushido ${bushido}`, 'blocks', `bushido ${bushido}`);
    keyword(`Bushido ${bushido}`, 'blocked', `bushido ${bushido}`);
  }
  if (keywords.has('battle cry')) keyword('Battle cry', 'attacks', 'battle cry');
  if (keywords.has('melee')) keyword('Melee', 'attacks', 'melee');
  if (keywords.has('dethrone')) keyword('Dethrone', 'attacks', 'dethrone');
  const afflict = amount('afflict');
  if (afflict > 0) keyword(`Afflict ${afflict}`, 'blocked', `afflict ${afflict}`);
  const annihilator = amount('annihilator');
  if (annihilator > 0)
    keyword(
      `Annihilator ${annihilator}: the defending player sacrifices ${annihilator === 1 ? 'a permanent' : `${annihilator} permanents`}.`,
      'attacks',
      `annihilator ${annihilator}`,
    );
  if (keywords.has('vanishing')) keyword('Vanishing', 'upkeep', 'vanishing', yourTurn);
  if (keywords.has('fading')) keyword('Fading', 'upkeep', 'fading', yourTurn);
  // A Saga gets a lore counter as its player's turn begins (its chapters
  // then go off as lore counters arrive: 'lore', below).
  const saga = isSaga(record);
  if (saga) keyword('Lore counter', 'upkeep', 'lore', yourTurn);

  for (const raw of record.oracleText.split('\n//\n')[0].split('\n')) {
    const text = raw.replace(/\s*\([^)]*\)/g, '').trim();
    let line = text.split(name).join('~');
    if (short) line = line.replace(new RegExp(`\\b${escaped(short)}\\b`, 'g'), '~');

    const chapter = saga ? text.match(CHAPTER) : null;
    if (chapter) {
      const effect = line.match(CHAPTER)?.[2] ?? chapter[2];
      out.push({
        text,
        event: 'lore',
        self: true,
        other: null,
        unsure: CONDITION.test(effect),
        may: /\bmay\b/i.test(effect),
        effect,
        chapters: chapter[1].split(/,\s*/).map((r) => ROMAN.indexOf(r) + 1),
      });
      continue;
    }

    const upkeep = text.match(CUMULATIVE);
    if (upkeep) {
      keyword(text, 'upkeep', `cumulative upkeep ${upkeep[1] ?? upkeep[2]}`, yourTurn);
      continue;
    }

    const step = line.match(STEPS);
    if (step) {
      const at = step[2].toLowerCase();
      const event: TriggerEvent = at === 'end step' ? 'end' : at.startsWith('combat') ? 'combat' : 'upkeep';
      const whose = at === 'combat on your turn' || /on your turn,/i.test(line) ? 'you' : whoseOf((step[1] ?? 'the').replace(/['’]s$/, ''));
      add(text, event, false, { whose, kinds: [[]], another: false, once: true, unsure: false }, step[3]);
      continue;
    }

    const monstrous = line.match(MONSTROUS);
    if (monstrous) {
      add(text, 'monstrous', true, null, monstrous[1]);
      continue;
    }

    // Renown N: when it deals combat damage to a player, if it is not renowned
    // yet, N +1/+1 counters and it becomes renowned (the reminder is not read).
    const renown = text.match(/^Renown (\d+)$/i);
    if (renown) {
      add(`Renown ${renown[1]}`, 'damage', true, null, `renown ${renown[1]}`);
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
    const also = m[4]?.toLowerCase().match(/^(enters?|dies|die|attacks?|blocks?|becomes? blocked|leaves the battlefield)(?: the battlefield)?$/);
    if (also && !events.includes(VERB[also[1]])) events.push(VERB[also[1]]);
    // "Blocks or becomes blocked by a white creature": the rest is a condition on both.
    const beyond = !!m[4] && !also;
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
      if (who.host && event !== 'attacks' && event !== 'blocks' && event !== 'blocked') continue;
      add(text, event, who.self, who.other, effect, who.host, beyond);
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
  /** What the card held in exile comes back (it has left the battlefield). */
  | { kind: 'release' }
  /** Renown: so many +1/+1 counters, and it becomes renowned — once. */
  | { kind: 'renown'; n: number }
  /** Undying (+1/+1) / Persist (-1/-1): back from the graveyard with that counter. */
  | { kind: 'comeback'; counter: 'p1p1' | 'm1m1' }
  /** Evolve, Training: so many +1/+1 counters on it (worked out by the engine). */
  | { kind: 'evolve' | 'training'; n: number }
  /** So much until end of turn: on the card itself, on the creature that
   * attacked alone (Exalted), or on the other attackers (Battle cry).
   * `hosts`: which creatures that is on the table, once it is known. */
  | { kind: 'boost'; power: number; toughness: number; keywords: string[]; on: BoostOn; hosts?: Host[] }
  /** Counters on the card itself, or off it (a negative number): a Saga's
   * lore counter, Vanishing's time counter, cumulative upkeep's age counter.
   * `ifTapped`: only while the card is tapped (Bottomless Vault's storage counter). */
  | { kind: 'counters'; add: Record<string, number>; ifTapped?: true }
  /** A player loses so much life: the defending player (Afflict), or the
   * card's own (an upkeep paid in life). `seat`: who, once it is known. */
  | { kind: 'lose'; n: number; who: 'defender' | 'you'; seat?: number }
  /** An upkeep paid in mana, this much ("{1}{1}"): the lands pay it. */
  | { kind: 'upkeep'; cost: string }
  /** The card is sacrificed (a Saga after its last chapter, Vanishing). */
  | { kind: 'sacrifice' }
  /** "Exile this Saga, then return it to the battlefield transformed". */
  | { kind: 'transform' }
  /** Cascade (lib/cascade.ts): exile from the top of the library until a
   * nonland card with mana value less than `below`, then cast it or not
   * (`cast`). `plan` is what that comes to, read off the library on the
   * table (components/useTriggers.ts), which offers it as two acts — the
   * one is the other's alternative. `step`: which of the spell's cascades
   * this is; `left`: how many more come after it. */
  | { kind: 'cascade'; below: number; step: number; left: number; plan?: CascadePlan; cast?: boolean }
  /** The card is cast from exile without paying its mana cost (rebound). */
  | { kind: 'recast' }
  /** An effect a spell could have too (lib/spellEffects.ts). */
  | { kind: 'prompt'; prompt: SpellPrompt }
);

/** Whose size a boost changes. */
export type BoostOn = 'self' | 'lone attacker' | 'other attackers';

const NUMBER: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const RETURNS = /\breturn (?:~|this [a-z]+) to its owner['’]s hand\b/i;
const RETURNS_IT = /\breturn it to its owner['’]s hand\b/i;
const GROWS = /\bput (an?|one|two|three|four|five|\d+) \+1\/\+1 counters? on (?:~|this [a-z]+)(?![a-z])/i;
const WORKED_OUT = /\bfor each\b|\bequal to\b|\bwhere X is\b/i;
// "~ gets +1/+1 until end of turn", "…this creature gets +2/+0 and gains
// trample until end of turn", "~ gains flying until end of turn". "It" is
// the card only in a trigger about the card alone ("Whenever ~ attacks, it gets…").
const pumpOf = (subject: string) =>
  new RegExp(
    `(?:^|[,.;] |\\band |\\bthen )(?:${subject}) (?:gets ([+-]\\d+)\\/([+-]\\d+)(?: and gains ([a-z ,]+?))?|gains ([a-z ,]+?)) until end of turn\\b`,
    'i',
  );
const PUMPS = pumpOf('~|this creature');
/** "It gets…" where the effect begins with it: past a target or another
 * creature, "it" may be that one ("gain control of target creature… It gains haste"). */
const PUMPS_IT = /^it (?:gets ([+-]\d+)\/([+-]\d+)(?: and gains ([a-z ,]+?))?|gains ([a-z ,]+?)) until end of turn\b/i;
/** "Exile this Saga, then return it to the battlefield transformed". */
const TRANSFORMS = /\bexile (?:~|this saga), then return it to the battlefield transformed\b/i;
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
  const dead = (trigger.event === 'dies' || trigger.event === 'leaves') && own;
  const out: TriggerAct[] = [];
  if (trigger.effect === 'undying')
    return [{ key: 'undying', label: 'Undying: back with a +1/+1 counter', kind: 'comeback', counter: 'p1p1', auto: true }];
  if (trigger.effect === 'persist')
    return [{ key: 'persist', label: 'Persist: back with a -1/-1 counter', kind: 'comeback', counter: 'm1m1', auto: true }];
  if (trigger.effect === 'evolve') return [{ key: 'evolve', label: 'Evolve: a +1/+1 counter', kind: 'evolve', n: 1, auto: true }];
  if (trigger.effect === 'training') return [{ key: 'training', label: 'Training: a +1/+1 counter', kind: 'training', n: 1, auto: true }];
  const renown = trigger.effect.match(/^renown (\d+)$/);
  if (renown) {
    const n = Number(renown[1]);
    return [{ key: 'renown', label: `Renown: ${n === 1 ? 'a +1/+1 counter' : `${n} +1/+1 counters`}`, kind: 'renown', n, auto: true }];
  }
  const boost = (key: string, label: string, power: number, toughness: number, on: BoostOn = 'self'): TriggerAct[] => [
    { key, label, kind: 'boost', power, toughness, keywords: [], on, auto: true },
  ];
  if (trigger.effect === 'prowess') return boost('prowess', 'Prowess: +1/+1 until end of turn', 1, 1);
  if (trigger.effect === 'exalted') return boost('exalted', 'Exalted: +1/+1 until end of turn', 1, 1, 'lone attacker');
  if (trigger.effect === 'battle cry') return boost('battle cry', 'Battle cry: the others +1/+0', 1, 0, 'other attackers');
  // Melee: +1/+1 for each opponent attacked (the engine counts them).
  if (trigger.effect === 'melee') return boost('melee', 'Melee: +1/+1 until end of turn', 1, 1);
  const bushido = trigger.effect.match(/^bushido (\d+)$/);
  if (bushido) {
    const n = Number(bushido[1]);
    return boost('bushido', `Bushido: +${n}/+${n} until end of turn`, n, n);
  }
  // Dethrone: only at the player with the most life (the engine looks).
  if (trigger.effect === 'dethrone') return [{ key: 'dethrone', label: 'Dethrone: a +1/+1 counter', kind: 'grow', n: 1, auto: true }];
  const afflict = trigger.effect.match(/^afflict (\d+)$/);
  if (afflict) {
    const n = Number(afflict[1]);
    return [{ key: 'afflict', label: `Afflict: loses ${n} life`, kind: 'lose', n, who: 'defender', auto: true }];
  }
  if (/^annihilator \d+$/.test(trigger.effect)) return [];
  // Cascade: one at a time, each read off the library as it then lies.
  if (trigger.effect === 'cascade')
    return [{ key: 'cascade-1', label: 'Cascade', kind: 'cascade', below: 0, step: 1, left: Math.max(0, times - 1), auto: false }];
  if (trigger.effect === 'rebound') return [{ key: 'rebound', label: 'Cast it from exile', kind: 'recast', auto: false }];
  if (trigger.effect === 'lore') return [{ key: 'lore', label: 'A lore counter', kind: 'counters', add: { lore: 1 }, auto: true }];
  // Vanishing, Fading: a counter off; the engine says when it is sacrificed instead.
  if (trigger.effect === 'vanishing' || trigger.effect === 'fading') {
    const kind = trigger.effect === 'vanishing' ? 'time' : 'fade';
    return [
      { key: 'tick', label: `Remove a ${kind} counter`, kind: 'counters', add: { [kind]: -1 }, auto: true },
      { key: 'sacrifice', label: 'Sacrifice it', kind: 'sacrifice', auto: true },
    ];
  }
  // Cumulative upkeep: an age counter, then pay for each one — or sacrifice
  // it. Mana is paid from the lands, life off the life total; any other
  // cost is its player's to pay.
  const cumulative = trigger.effect.match(/^cumulative upkeep (.+)$/);
  if (cumulative) {
    const cost = cumulative[1];
    const life = cost.match(/^Pay (\d+) life$/i);
    return [
      { key: 'age', label: 'An age counter', kind: 'counters', add: { age: 1 }, auto: true },
      ...(/^(?:\{[^}]+\})+$/.test(cost)
        ? [{ key: 'pay', label: `Pay ${cost}`, kind: 'upkeep' as const, cost, auto: false }]
        : life
          ? [{ key: 'pay', label: `Pay ${life[1]} life`, kind: 'lose' as const, n: Number(life[1]), who: 'you' as const, auto: false }]
          : []),
      { key: 'sacrifice', label: 'Sacrifice it', kind: 'sacrifice', auto: false },
    ];
  }
  // A Saga's last chapter may send it away to come back as its other face.
  if (trigger.event === 'lore' && TRANSFORMS.test(trigger.effect))
    return [{ key: 'transform', label: 'Return it transformed', kind: 'transform', auto: plain }];
  // What a token it makes, or a creature it gives an ability, will say
  // ("with \"Whenever you gain life, put a +1/+1 counter on this token\"")
  // is that one's, not this card's: quoted text is not read.
  const bare = trigger.effect.replace(/"[^"]*"|“[^”]*”/g, '');
  // "When this leaves the battlefield, return the exiled card to the battlefield…"
  if (trigger.event === 'leaves' && /\breturn the exiled (?:card|cards|permanent|permanents|creature|creatures)\b[^.]*\bto the battlefield\b/i.test(bare))
    out.push({ key: 'release', label: 'Return what it exiled', kind: 'release', auto: !trigger.may });
  if (RETURNS.test(bare) || (own && RETURNS_IT.test(bare)))
    out.push({ key: 'return', label: 'Return it to hand', kind: 'return', auto: plain });
  // "If this land is tapped, put a storage counter on it" (Bottomless Vault,
  // which may stay tapped through its untap step): judged as it goes off.
  const stores = bare.match(/^if (?:~|this [a-z]+) is tapped, put (an?|one|two|three|four|five) ([a-z]+) counters? on (?:it|~|this [a-z]+)\.?$/i);
  if (stores) {
    const add = { [counterName(stores[2])]: NUMBER[stores[1].toLowerCase()] ?? 1 };
    out.push({ key: 'stores', label: `Put ${countersWords(add)} on it`, kind: 'counters', add, ifTapped: true, auto: !trigger.may });
  }
  // Counters whose number is worked out ("for each creature card in your
  // graveyard") are left to the players, sentence by sentence.
  const grows = dead
    ? undefined
    : bare
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
  // "Whenever ~ attacks, it gets +2/+0 until end of turn": on the card itself.
  const pumped = dead
    ? undefined
    : bare
        .split(/(?<=\.)\s+/)
        .filter((sentence) => !WORKED_OUT.test(sentence))
        .map((sentence, i) => (own && i === 0 ? (sentence.match(PUMPS_IT) ?? sentence.match(PUMPS)) : sentence.match(PUMPS)))
        .find((m) => m !== null);
  if (pumped) {
    const power = pumped[1] ? Number(pumped[1]) : 0;
    const toughness = pumped[2] ? Number(pumped[2]) : 0;
    const keywords = keywordList(pumped[3] ?? pumped[4] ?? '');
    if (power !== 0 || toughness !== 0 || keywords.length > 0) {
      const words = boostWords({ power: power * times, toughness: toughness * times, keywords });
      out.push({
        key: 'boost',
        label: `${words.charAt(0).toUpperCase()}${words.slice(1)} until end of turn`,
        kind: 'boost',
        power: power * times,
        toughness: toughness * times,
        keywords,
        on: 'self',
        auto: plain,
      });
    }
  }
  // "You may gain 1 life" is, once its player says yes, "you gain 1 life".
  const said = bare.replace(/\byou may\b/gi, 'you');
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

/** The keyword triggers (Prowess, Exalted, Undying…): when one comes to
 * nothing this time, there is nothing to say either. (Annihilator is said
 * all the same: the defending player has something to do.) */
export const isKeywordEffect = (effect: string): boolean =>
  /^(?:renown \d+|undying|persist|evolve|training|prowess|exalted|bushido \d+|battle cry|melee|dethrone|afflict \d+|vanishing|fading)$/.test(
    effect,
  );

/** A Saga's last chapter: once it has gone off, the Saga is sacrificed. */
export function lastChapter(record: Parameters<typeof readTriggers>[0]): number {
  return Math.max(0, ...readTriggers(record).flatMap((t) => t.chapters ?? []));
}

// ---- what it comes to on the table ----

/** A trigger's acts as they come out on the table as it stands: whose
 * size a boost changes (the card, the creature that attacked alone, the
 * other attackers), how many opponents Melee counts, whether Dethrone's
 * player has the most life, whom Afflict makes lose life, whether Vanishing
 * and Fading take a counter off or sacrifice the card, what cumulative
 * upkeep costs this time — and a Saga's sacrifice after its last chapter.
 * What comes to nothing is left out; every other act passes as it is. */
export function actsHere(g: GameState, fired: Fired, h: Happening, acts: TriggerAct[], records: Records): TriggerAct[] {
  const effect = fired.trigger.effect;
  const card = g.players[fired.seat]?.cards?.battlefield.find((c) => c.iid === fired.source.iid);
  const has = (kind: string) => card?.counters?.[kind] ?? 0;
  const combat = 'combat' in h && g.combat?.id === h.combat ? g.combat : null;
  const mine = combat?.attacks?.find((a) => a.unit.kind === 'card' && a.unit.id === fired.source.iid);
  const out: TriggerAct[] = [];
  for (const act of acts) {
    if (act.kind === 'boost') {
      let hosts: Host[] = [];
      let label = act.label;
      if (act.on === 'self') hosts = card ? [{ seat: fired.seat, kind: 'card', id: card.iid }] : [];
      else if (h.kind === 'attacks') {
        const others = h.things.filter((t) => !(t.kind === 'card' && t.id === fired.source.iid && t.seat === fired.seat));
        if (act.on === 'other attackers') hosts = others.map((t) => ({ seat: t.seat, kind: t.kind, id: t.id }));
        // Exalted: one creature attacked, and only one.
        else if (h.things.reduce((n, t) => n + t.n, 0) === 1) {
          const t = h.things[0];
          hosts = [{ seat: t.seat, kind: t.kind, id: t.id }];
          label = `Exalted: ${t.name} +1/+1 until end of turn`;
        }
      }
      if (hosts.length === 0) continue;
      if (effect === 'melee') {
        // +1/+1 for each opponent attacked by its player this combat.
        const n = new Set((combat?.attacks ?? []).map((a) => a.target)).size;
        if (n === 0) continue;
        out.push({ ...act, power: n, toughness: n, hosts, label: `Melee: +${n}/+${n} until end of turn` });
        continue;
      }
      out.push({ ...act, hosts, label });
      continue;
    }
    if (act.kind === 'grow' && effect === 'dethrone') {
      // At the player with the most life, or tied for it.
      const at = mine ? g.players[mine.target] : undefined;
      const most = Math.max(...g.players.filter((p) => !p.eliminated).map((p) => p.life));
      if (at && at.life >= most) out.push(act);
      continue;
    }
    if (act.kind === 'lose') {
      const seat = act.who === 'you' ? fired.seat : mine?.target;
      if (seat === undefined || !g.players[seat]) continue;
      const who = g.config.profiles[seat]?.name ?? '?';
      const n = act.who === 'you' ? act.n * (has('age') + 1) : act.n;
      out.push({ ...act, n, seat, label: act.who === 'you' ? `Pay ${n} life` : `Afflict: ${who} loses ${n} life` });
      continue;
    }
    if (act.kind === 'upkeep') {
      // So much for each age counter, the one just put on included.
      const times = has('age') + 1;
      const cost = act.cost.repeat(times);
      out.push({ ...act, cost, label: `Pay ${cost}` });
      continue;
    }
    if (act.kind === 'counters' && (effect === 'vanishing' || effect === 'fading')) {
      const kind = effect === 'vanishing' ? 'time' : 'fade';
      if (has(kind) < 1) continue;
      out.push({ ...act, label: `Remove a ${kind} counter (${has(kind) - 1} left)` });
      continue;
    }
    // Bottomless Vault: a storage counter only while it stays tapped.
    if (act.kind === 'counters' && act.ifTapped) {
      if (card?.tapped) out.push(act);
      continue;
    }
    if (act.kind === 'cascade') {
      // Less than the spell's own mana value as it was cast, X included.
      const record = records[fired.source.cardId];
      if (!record) continue;
      out.push({ ...act, below: spellManaValue(record, h.kind === 'cast' ? h.x : 0) });
      continue;
    }
    if (act.kind === 'recast') {
      out.push({ ...act, label: `Cast ${fired.source.name}` });
      continue;
    }
    if (act.kind === 'sacrifice' && (effect === 'vanishing' || effect === 'fading')) {
      // Vanishing: as the last time counter comes off. Fading: when there is none to take off.
      if (!card) continue;
      if (effect === 'vanishing' ? has('time') === 1 : has('fade') === 0)
        out.push({ ...act, label: effect === 'vanishing' ? 'Sacrifice it (no time counters left)' : 'Sacrifice it (no fade counter to remove)' });
      continue;
    }
    out.push(act);
  }
  // A Saga is sacrificed once its last chapter has gone off — unless that
  // chapter sends it away to come back transformed.
  const chapters = fired.trigger.chapters;
  if (h.kind === 'lore' && chapters && card && !out.some((a) => a.kind === 'transform')) {
    const last = lastChapter(records[fired.source.cardId]);
    if (last > 0 && chapters.includes(last) && h.from < last && last <= h.to)
      out.push({ key: 'sacrifice', label: 'Sacrifice it (its last chapter)', kind: 'sacrifice', auto: true });
  }
  return out;
}

// ---- the keyword triggers that compare sizes ----

type ReadRecords = Parameters<typeof readUnit>[3];

/** Evolve: how many of these creatures entering under its controller are
 * bigger — in power or in toughness — than it is, each counted against
 * its size after the counters the ones before gave it. */
export function evolveCount(g: GameState, seat: number, iid: string, things: Thing[], records: ReadRecords): number {
  const me = readUnit(g, seat, { kind: 'card', id: iid }, records);
  if (!me || me.unread) return 0;
  let power = me.power;
  let toughness = me.toughness;
  let n = 0;
  for (const t of things) {
    if (t.seat !== seat || (t.kind === 'card' && t.id === iid)) continue;
    const it = readUnit(g, seat, { kind: t.kind, id: t.id }, records);
    if (!it || it.unread || !it.creature) continue;
    for (let copy = 0; copy < t.n; copy++) {
      if (it.power <= power && it.toughness <= toughness) continue;
      n += 1;
      power += 1;
      toughness += 1;
    }
  }
  return n;
}

/** Training: does it attack beside a creature with greater power? */
export function trainingFires(g: GameState, seat: number, iid: string, attackers: Thing[], records: ReadRecords): boolean {
  const me = readUnit(g, seat, { kind: 'card', id: iid }, records);
  if (!me || me.unread) return false;
  return attackers.some((t) => {
    if (t.seat !== seat || (t.kind === 'card' && t.id === iid)) return false;
    const it = readUnit(g, seat, { kind: t.kind, id: t.id }, records);
    return !!it && !it.unread && it.power > me.power;
  });
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

/** How many times a spell cascades as it is cast: as often as it has the
 * keyword itself, and as often as its player's other permanents give it to
 * a spell like it ("Sliver spells you cast have cascade" — lib/cascade.ts),
 * with the names of those that do. */
function cascadesOf(g: GameState, h: Extract<Happening, { kind: 'cast' }>, records: Records): { n: number; givers: string[] } {
  const record = h.spell.cardId ? records[h.spell.cardId] : null;
  const e = seen(h.spell, records);
  if (!record || !e) return { n: 0, givers: [] };
  let n = keywordCount(record.oracleText, 'cascade');
  const givers: string[] = [];
  const cards = g.players[h.seat]?.cards;
  const value = spellManaValue(record, h.x);
  for (const c of cards?.battlefield ?? []) {
    // A permanent spell gives nothing to itself: it was not there yet as it was cast.
    if (c.iid === h.spell.id) continue;
    for (const grant of cascadeGrants(records[c.cardId])) {
      if (grant.fromHand && (h.from ?? 'hand') !== 'hand') continue;
      if (value < grant.atLeast) continue;
      const like = grant.commander
        ? !!cards && isCommander(cards, h.spell.id) === true
        : grant.kinds.some((words) => words.every((word) => wordFits(word, e)));
      if (!like) continue;
      n += grant.times;
      if (!givers.includes(c.name)) givers.push(c.name);
    }
  }
  return { n, givers };
}

const VERBED: Partial<Record<TriggerEvent, string>> = {
  enters: 'entered',
  dies: 'died',
  attacks: 'attacked',
  blocks: 'blocked',
  blocked: 'became blocked',
  damage: 'dealt combat damage to a player',
  leaves: 'left the battlefield',
};

/** The triggers one happening sets off, on every seat's side: each card on
 * a battlefield — and, for deaths, each card that died with them: a dying
 * card still sees what dies beside it — whose text was waiting for it, once
 * per ability, with how much of it it counts. Cards the device cannot read
 * wait for nothing, and what it cannot read sets nothing off but itself. */
export function firedBy(g: GameState, h: Happening, records: Records): Fired[] {
  const out: Fired[] = [];
  const nameOf = (seat: number) => g.config.profiles[seat]?.name ?? '?';

  // A loyalty ability is read as a trigger of the card that activated it:
  // what it does is carried out the way a trigger's is. Not as its own,
  // though — "return it to its owner's hand" in a planeswalker's text is
  // about the creature it targets, never about the planeswalker.
  if (h.kind === 'activated') {
    if (!h.thing.cardId) return out;
    out.push({
      seat: h.thing.seat,
      source: { iid: h.thing.id, cardId: h.thing.cardId, name: h.thing.name },
      trigger: {
        text: h.text,
        event: 'activated',
        self: false,
        other: null,
        unsure: CONDITION.test(h.effect),
        may: /\bmay\b/i.test(h.effect),
        effect: h.effect,
      },
      times: 1,
      because: 'Loyalty ability',
      own: true,
    });
    return out;
  }

  // Cascade goes off as the spell is cast, wherever the spell has gone since
  // (an instant is in the graveyard already, a creature on the battlefield).
  if (h.kind === 'cast' && h.spell.cardId) {
    const { n, givers } = cascadesOf(g, h, records);
    if (n > 0)
      out.push({
        seat: h.seat,
        source: { iid: h.spell.id, cardId: h.spell.cardId, name: h.spell.name },
        trigger: { text: n === 1 ? 'Cascade' : `Cascade ×${n}`, event: 'cast', self: true, other: null, unsure: false, may: true, effect: 'cascade' },
        times: n,
        because: givers.length > 0 ? `It was cast (cascade from ${givers.join(', ')})` : 'It was cast',
        own: true,
      });
  }
  // Rebound: a card cast with it from its owner's hand comes back from exile
  // as that player's next turn begins.
  if (h.kind === 'turn')
    for (const c of g.players[h.began]?.cards?.exile ?? [])
      if (c.rebound && reboundTurn(h.began, c.rebound) === h.turn)
        out.push({
          seat: h.began,
          source: { iid: c.iid, cardId: c.cardId, name: c.name },
          trigger: { text: 'Rebound', event: 'upkeep', self: true, other: null, unsure: false, may: true, effect: 'rebound' },
          times: 1,
          because: `${nameOf(h.began)}’s turn began`,
          own: false,
        });

  const sources: { seat: number; iid: string; cardId: string; name: string; on?: { seat: number; kind: string; id: string } }[] = [];
  g.players.forEach((player, seat) => {
    for (const c of player.cards?.battlefield ?? [])
      sources.push({ seat, iid: c.iid, cardId: c.cardId, name: c.name, ...(c.on ? { on: c.on } : {}) });
  });
  if (h.kind === 'dies' || h.kind === 'leaves')
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

      if (h.kind === 'monstrous') {
        if (trigger.event !== 'monstrous' || h.thing.id !== source.iid || h.thing.seat !== source.seat) continue;
        push(1, 'It became monstrous', true);
        continue;
      }

      // A chapter goes off as the lore counters reach its number.
      if (h.kind === 'lore') {
        if (trigger.event !== 'lore' || h.thing.id !== source.iid || h.thing.seat !== source.seat) continue;
        const reached = (trigger.chapters ?? []).filter((n) => n > h.from && n <= h.to);
        if (reached.length === 0) continue;
        push(reached.length, `Chapter ${reached.map(roman).join(', ')}`, true);
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
        const read = seen(t, records);
        // A god that enters below its devotion enters as no creature.
        const e =
          read && h.kind === 'enters' && !notHeldBack(godsOf(g, t.seat, records), t)
            ? { ...read, typeLine: notCreature(read.typeLine) }
            : read;
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
