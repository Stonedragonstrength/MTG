import { create } from 'zustand';
import type { SpellTarget } from '../lib/spellEffects';
import { heldBy } from '../lib/cards';
import { planCascade, type CascadePlan } from '../lib/cascade';
import { countersWords, entryCounters, missingCounters } from '../lib/entering';
import {
  actsHere,
  actsOf,
  evolveCount,
  firedBy,
  holdsExiled,
  isKeywordEffect,
  stillHappened,
  trainingFires,
  type Happening,
  type Thing,
  type TriggerAct,
} from '../lib/triggers';
import type { CardRecord, GameState } from '../lib/types';
import { tableRecords, useAppStore } from '../state/store';
import { carryOutPrompt, findTokenCard } from './spellActs';

/** Cards that trigger by themselves (lib/triggers.ts reads them). Whenever
 * a move made on this device does something cards wait for — something
 * enters or dies, an attack, a cast, a turn passing — the cards that were
 * waiting for it go off here: what needs no choice is carried
 * out at once — the Dragonstorm goes back to hand, the life is gained, the
 * card is drawn — and everything else gets a button on the trigger banner.
 *
 * Like the combat aim it is not part of the game: never synced, never
 * saved. Only the device that made the move sets triggers off (another
 * device sees the same cards arrive, and must not do it all a second
 * time); what they do then travels to the table as ordinary moves, each
 * with its own line in the feed and its own Undo. */

/** One thing a shown trigger does, and whether it has been done. */
export type ShownAct = TriggerAct & {
  done: boolean;
  token?: CardRecord;
  /** An exile by a card that holds it until it leaves (Oblivion Ring). */
  holds?: boolean;
};

/** A trigger that has gone off, as the banner shows it. */
export interface ShownTrigger {
  key: string;
  /** The seat that controls the card. */
  seat: number;
  source: { iid: string; name: string; art: string | null };
  /** That seat's player, by name. */
  who: string;
  /** The ability, as printed. */
  text: string;
  /** What it does, as lib/triggers.ts reads it ('prowess' for the keyword). */
  effect: string;
  /** What set it off: "Shivan Dragon entered", "It died", "Sam’s turn began". */
  because: string;
  acts: ShownAct[];
  /** What set it off, on the table: once it is no longer so (an Undo),
   * the trigger is off. */
  happening: Happening;
}

interface TriggerState {
  shown: ShownTrigger[];
  /** Does one thing a shown trigger offers (with its target, where it
   * asks for one) and marks it done. */
  carryOut(key: string, actKey: string, target?: SpellTarget): void;
  /** Marks one done that was carried out elsewhere (a library search). */
  markDone(key: string, actKey: string): void;
  /** Puts these away; all of them when none are named. */
  putAway(keys?: string[]): void;
}

/** No more rows than this on the banner: the oldest make room. */
const SHOWN_CAP = 5;
/** A trigger set off by a trigger set off by a trigger…: past this depth
 * nothing more happens by itself — it waits behind its button. (A card that
 * makes a token whenever a creature enters would otherwise never stop.) */
const MAX_CHAIN = 4;

/** How deep in such a chain the move being made right now is: 0 for a
 * move made by hand. Read when the store notes what a move did. */
let chain = 0;
let serial = 0;

function run(key: string, actKey: string, target: SpellTarget | undefined, depth: number): void {
  const trigger = useTriggers.getState().shown.find((t) => t.key === key);
  const act = trigger?.acts.find((a) => a.key === actKey);
  const store = useAppStore.getState();
  if (!trigger || !act || act.done || !store.game) return;
  const cards = store.game.players[trigger.seat]?.cards;
  const card = cards?.battlefield.find((c) => c.iid === trigger.source.iid);
  // A card that has just died goes back to hand from its graveyard.
  const dead = !card && !!cards?.graveyard.some((c) => c.iid === trigger.source.iid);
  let did = false;
  chain = depth;
  try {
    if (act.kind === 'return') {
      if (card || dead) store.returnToHand(trigger.seat, trigger.source.iid);
      did = !!card || dead;
    } else if (act.kind === 'grow') {
      if (card) store.setVirtualCounter(trigger.seat, card.iid, 'p1p1', (card.counters?.p1p1 ?? 0) + act.n);
      did = !!card;
    } else if (act.kind === 'comeback') {
      did = !!cards?.graveyard.some((c) => c.iid === trigger.source.iid);
      if (did) store.returnFromGraveyard(trigger.seat, trigger.source.iid, act.counter);
    } else if (act.kind === 'evolve' || act.kind === 'training') {
      did = !!card;
      if (card) store.growCard(trigger.seat, card.iid, act.n);
    } else if (act.kind === 'renown') {
      did = !!card && !((card.counters?.renowned ?? 0) > 0);
      if (did) store.growCard(trigger.seat, trigger.source.iid, act.n, 'renowned');
    } else if (act.kind === 'release') {
      did = heldBy(store.game, { seat: trigger.seat, iid: trigger.source.iid }).length > 0;
      if (did) store.releaseHeld(trigger.seat, trigger.source.iid, trigger.source.name);
    } else if (act.kind === 'boost') {
      did = (act.hosts ?? []).length > 0;
      const why = isKeywordEffect(trigger.effect) ? trigger.text.toLowerCase() : trigger.source.name;
      if (did) store.boostUntilEndOfTurn(act.hosts ?? [], { power: act.power, toughness: act.toughness, keywords: act.keywords }, why);
    } else if (act.kind === 'counters') {
      did = !!card;
      if (card) store.addCounters(trigger.seat, card.iid, act.add, `${trigger.source.name}: ${act.label.charAt(0).toLowerCase()}${act.label.slice(1)}`);
    } else if (act.kind === 'lose') {
      did = act.seat !== undefined;
      if (act.seat !== undefined) void store.castEffect(trigger.seat, trigger.source.name, { kind: 'life', n: act.n, gain: false, on: act.seat });
    } else if (act.kind === 'upkeep') {
      did = !!card;
      if (card) void store.payUpkeep(trigger.seat, card.iid, act.cost);
    } else if (act.kind === 'sacrifice') {
      did = !!card;
      if (card) store.sacrificeCard(trigger.seat, card.iid);
    } else if (act.kind === 'transform') {
      did = !!card;
      if (card) void store.returnTransformed(trigger.seat, card.iid);
    } else if (act.kind === 'cascade') {
      // Carried out only while the library is as it was read: did it land?
      const before = store.game;
      if (act.plan) store.cascade(trigger.seat, act.plan, act.cast === true, trigger.source.name);
      did = useAppStore.getState().game !== before;
    } else if (act.kind === 'recast') {
      did = !!cards?.exile.some((c) => c.iid === trigger.source.iid);
      if (did) void store.castFromExile(trigger.seat, trigger.source.iid, 'rebound');
    } else if (act.kind === 'prompt')
      did = carryOutPrompt(trigger.seat, trigger.source.name, act.prompt, act.token, target, {
        sourceIid: trigger.source.iid,
        holds: act.holds,
      });
  } finally {
    chain = 0;
  }
  if (did) useTriggers.getState().markDone(key, actKey);
  if (did && act.kind === 'cascade') settleCascade(key, act, depth);
}

/** What a cascade comes to, read off the seat's library as it lies now, as
 * the buttons it is offered as: cast the card it finds, or put that one on
 * the bottom with the rest — and when it finds none, the one thing it does
 * (by itself). Null when a card in the library cannot be read. */
async function cascadeActs(
  seat: number,
  act: Extract<TriggerAct, { kind: 'cascade' }>,
): Promise<{ acts: ShownAct[]; plan: CascadePlan } | null> {
  const library = useAppStore.getState().game?.players[seat]?.cards?.library ?? [];
  const m = await import('../data/scryfall');
  const read = async (c: { cardId: string; name: string }) =>
    (await m.getCardById(c.cardId).catch(() => undefined)) ?? (await m.findCardByName(c.name).catch(() => undefined));
  const plan = await planCascade(library, act.below, read);
  if (!plan) return null;
  const step = `cascade-${act.step}`;
  const { found } = plan;
  if (!found)
    return plan.exiled.length === 0
      ? { plan, acts: [] }
      : { plan, acts: [{ ...act, key: `${step}-none`, plan, cast: false, label: 'Nothing to cast: the library is shuffled', auto: true, done: false }] };
  return {
    plan,
    acts: [
      { ...act, key: `${step}-cast`, plan, cast: true, label: `Cast ${found.name}`, auto: false, done: false },
      { ...act, key: `${step}-bottom`, plan, cast: false, label: `Put ${found.name} on the bottom`, auto: false, done: false },
    ],
  };
}

/** What the banner says a cascade exiled: "Cascade: Forest, Island, Lightning Bolt". */
function cascadeText(act: Extract<TriggerAct, { kind: 'cascade' }>, plan: CascadePlan | null): string {
  const all = act.step + act.left;
  const head = all > 1 ? `Cascade ${act.step} of ${all}` : 'Cascade';
  if (!plan) return `${head}: a card in the library could not be read — cascade by hand`;
  if (!plan.found) return `${head}: no nonland card with mana value less than ${act.below} in the library`;
  return `${head}: ${plan.exiled.map((c) => c.name).join(', ')}`;
}

/** One cascade answered: the other way it was offered goes, and the next of
 * the spell's cascades (Maelstrom Wanderer has two) is read off the library
 * as it now lies, and offered on the same row. */
function settleCascade(key: string, act: Extract<TriggerAct, { kind: 'cascade' }>, depth: number): void {
  const row = useTriggers.getState().shown.find((t) => t.key === key);
  if (!row) return;
  const kept = row.acts.filter((a) => !(a.kind === 'cascade' && a.step === act.step && a.key !== act.key));
  useTriggers.setState({ shown: useTriggers.getState().shown.map((t) => (t.key === key ? { ...t, acts: kept } : t)) });
  if (act.left <= 0) return;
  const next = { ...act, key: `cascade-${act.step + 1}`, step: act.step + 1, left: act.left - 1, plan: undefined, cast: undefined };
  void cascadeActs(row.seat, next)
    .then((offered) => {
      const now = useTriggers.getState().shown.find((t) => t.key === key);
      if (!now) return;
      const text = cascadeText(next, offered?.plan ?? null);
      const acts = [...now.acts, ...(offered?.acts ?? [])];
      useTriggers.setState({ shown: useTriggers.getState().shown.map((t) => (t.key === key ? { ...t, text, acts } : t)) });
      for (const a of offered?.acts ?? []) if (a.auto) run(key, a.key, undefined, depth);
    })
    .catch(() => {});
}

export const useTriggers = create<TriggerState>()((set, get) => ({
  shown: [],
  carryOut(key, actKey, target) {
    run(key, actKey, target, 1);
  },
  markDone(key, actKey) {
    set({
      shown: get().shown.map((t) =>
        t.key !== key ? t : { ...t, acts: t.acts.map((a) => (a.key === actKey ? { ...a, done: true } : a)) },
      ),
    });
  },
  putAway(keys) {
    set({ shown: keys ? get().shown.filter((t) => !keys.includes(t.key)) : [] });
  },
}));

/** What a happening is about: what entered, died or attacked, the spell. */
const thingsOf = (h: Happening): Thing[] =>
  h.kind === 'cast'
    ? [h.spell]
    : h.kind === 'monstrous' || h.kind === 'lore' || h.kind === 'activated'
      ? [h.thing]
      : h.kind === 'turn' || h.kind === 'combat' || h.kind === 'life'
        ? []
        : h.things;

/** The records the triggers are read with: every card on a battlefield,
 * and every card and stack the happenings are about (one that died is in a
 * graveyard now). */
async function recordsFor(g: GameState, events: Happening[]): Promise<Record<string, CardRecord | undefined>> {
  const records = await tableRecords(g);
  const { getCardById } = await import('../data/scryfall');
  // …and, as a turn begins, the cards in exile waiting to rebound.
  const rebounding = events.some((h) => h.kind === 'turn')
    ? g.players.flatMap((p) => (p.cards?.exile ?? []).filter((c) => c.rebound))
    : [];
  for (const a of [...events.flatMap(thingsOf), ...rebounding]) {
    if (!a.cardId || a.cardId in records) continue;
    records[a.cardId] = await getCardById(a.cardId).catch(() => undefined);
  }
  return records;
}

/** A move a trigger makes by itself, `depth` deep in a chain of them. */
function asTrigger(depth: number, move: () => void): void {
  chain = depth;
  try {
    move();
  } finally {
    chain = 0;
  }
}

/** Cards that arrived without the counters they enter with ("enters with two
 * +1/+1 counters", a Saga's first lore counter): those go on now, each card
 * in one move. Only kinds it has none of — what it came with stands. */
function settleArrivals(things: Thing[], records: Record<string, CardRecord | undefined>, depth: number): void {
  for (const t of things) {
    if (t.kind !== 'card' || !t.cardId) continue;
    const store = useAppStore.getState();
    const card = store.game?.players[t.seat]?.cards?.battlefield.find((c) => c.iid === t.id);
    if (!card) continue;
    const add = missingCounters(entryCounters(records[t.cardId]), card.counters);
    if (Object.keys(add).length === 0) continue;
    asTrigger(depth + 1, () => store.addCounters(t.seat, t.id, add, `${t.name} enters with ${countersWords(add)}`));
  }
}

/** Sets off whatever was waiting for what a move did. `depth`: how deep in
 * a chain of triggers that move was. */
async function raise(events: Happening[], depth: number): Promise<void> {
  const seen = useAppStore.getState().game;
  if (!seen) return;
  const records = await recordsFor(seen, events);
  // What arrived without what it enters with (put there by hand, back from
  // a graveyard): it gets it now. A played card already has it.
  for (const h of events) if (h.kind === 'enters') settleArrivals(h.things, records, depth);
  // The table as it stands now: a card that left meanwhile waits for nothing.
  const g = useAppStore.getState().game;
  if (!g) return;
  const fresh: ShownTrigger[] = [];
  for (const fired of events.flatMap((h) => firedBy(g, h, records).map((f) => ({ ...f, happening: h })))) {
    // A Saga's lore counter as its player's turn begins says nothing
    // itself: the chapter it reaches does.
    if (fired.trigger.effect === 'lore') {
      const { seat, source } = fired;
      asTrigger(depth + 1, () => useAppStore.getState().addCounters(seat, source.iid, { lore: 1 }, `${source.name} gets a lore counter`));
      continue;
    }
    const acts: ShownAct[] = [];
    const holder = { seat: fired.seat, iid: fired.source.iid };
    const planned = actsOf(fired.trigger, fired.times);
    const placed = actsHere(g, fired, fired.happening, planned, records);
    // All it would do comes to nothing here (its +2/+2 on itself, and it has
    // died): nothing to say either.
    if (planned.length > 0 && placed.length === 0) continue;
    let text = fired.trigger.text;
    let silent = false;
    for (const act of placed) {
      const h = fired.happening;
      // Cascade: the library is read now, and the cascade offered as what it comes to.
      if (act.kind === 'cascade') {
        const offered = await cascadeActs(fired.seat, act);
        text = cascadeText(act, offered?.plan ?? null);
        // An empty library: nothing to exile, nothing to say.
        if (offered && offered.plan.exiled.length === 0) silent = true;
        acts.push(...(offered?.acts ?? []));
        continue;
      }
      // Undying / Persist: only if it had no such counter as it died, and it is in its graveyard.
      if (act.kind === 'comeback') {
        const died = h.kind === 'dies' ? h.things.find((t) => t.kind === 'card' && t.id === fired.source.iid && t.seat === fired.seat) : undefined;
        const inGrave = !!g.players[fired.seat]?.cards?.graveyard.some((c) => c.iid === fired.source.iid);
        if (died && inGrave && !((died.counters?.[act.counter] ?? 0) > 0)) acts.push({ ...act, done: false });
        continue;
      }
      // Evolve: one counter for each creature that came in bigger than it.
      if (act.kind === 'evolve') {
        const n = h.kind === 'enters' ? evolveCount(g, fired.seat, fired.source.iid, h.things, records) : 0;
        if (n > 0) acts.push({ ...act, n, label: n === 1 ? 'Evolve: a +1/+1 counter' : `Evolve: ${n} +1/+1 counters`, done: false });
        continue;
      }
      // Training: it attacked beside a creature with greater power.
      if (act.kind === 'training') {
        if (h.kind === 'attacks' && trainingFires(g, fired.seat, fired.source.iid, h.things, records)) acts.push({ ...act, done: false });
        continue;
      }
      // Renowned already: Renown does nothing more.
      if (act.kind === 'renown') {
        const it = g.players[fired.seat]?.cards?.battlefield.find((c) => c.iid === fired.source.iid);
        if (it && !((it.counters?.renowned ?? 0) > 0)) acts.push({ ...act, done: false });
        continue;
      }
      // Nothing held in exile by it (exiled by hand, or already back): no button.
      if (act.kind === 'release') {
        const held = heldBy(g, holder);
        if (held.length > 0) acts.push({ ...act, label: `Return ${held.map((h) => h.card.name).join(', ')}`, done: false });
      } else if (act.kind === 'prompt' && act.prompt.kind === 'remove' && act.prompt.how === 'exile')
        acts.push({ ...act, done: false, holds: holdsExiled(records[fired.source.cardId]) });
      else if (act.kind !== 'prompt' || act.prompt.kind !== 'tokens') acts.push({ ...act, done: false });
      else {
        // No token card for it on this device: no button, as under a spell.
        const token = await findTokenCard(act.prompt.want).catch(() => undefined);
        if (token) acts.push({ ...act, done: false, token });
      }
    }
    // Its own entering, and nothing the table can do about it: its player
    // has the card in front of them. A card that was waiting for something
    // else — a death, an attack, a turn — is shown either way: those are
    // the triggers people forget.
    if (fired.own && fired.happening.kind === 'enters' && acts.length === 0) continue;
    // A keyword that did not go off this time (renowned already, had its
    // counter, nothing bigger came in…): nothing to say.
    if ((isKeywordEffect(fired.trigger.effect) && acts.length === 0) || silent) continue;
    fresh.push({
      key: `t${++serial}`,
      seat: fired.seat,
      source: { iid: fired.source.iid, name: fired.source.name, art: records[fired.source.cardId]?.imageNormal ?? null },
      text,
      effect: fired.trigger.effect,
      who: g.config.profiles[fired.seat]?.name ?? '?',
      because: fired.because,
      acts,
      happening: fired.happening,
    });
  }
  // "…until this leaves the battlefield" says no more than that: the card
  // that held something in exile lets it go as it leaves, by the rules.
  for (const h of events) {
    if (h.kind !== 'leaves') continue;
    for (const t of h.things) {
      const held = heldBy(g, { seat: t.seat, iid: t.id });
      if (held.length === 0) continue;
      if (fresh.some((row) => row.source.iid === t.id && row.acts.some((a) => a.kind === 'release'))) continue;
      const names = held.map((x) => x.card.name).join(', ');
      fresh.push({
        key: `t${++serial}`,
        seat: t.seat,
        source: { iid: t.id, name: t.name, art: (t.cardId && records[t.cardId]?.imageNormal) || null },
        text: `It held ${names} in exile until it left the battlefield.`,
        effect: 'release',
        who: g.config.profiles[t.seat]?.name ?? '?',
        because: 'It left the battlefield',
        acts: [{ key: 'release', label: `Return ${names}`, kind: 'release', auto: true, done: false }],
        happening: h,
      });
    }
  }
  if (fresh.length === 0) return;
  useTriggers.setState({ shown: [...useTriggers.getState().shown, ...fresh].slice(-SHOWN_CAP) });
  if (depth >= MAX_CHAIN) return;
  for (const trigger of fresh)
    for (const act of trigger.acts) if (act.auto) run(trigger.key, act.key, undefined, depth + 1);
}

/** Life changes wait this long for the next one before they count: three
 * taps on + are one gain of 3, and a + taken back by a − is no gain at all. */
const LIFE_SETTLE_MS = 1200;
const lifeWait = new Map<number, { n: number; depth: number; timer: ReturnType<typeof setTimeout> }>();

function lifeChanged(seat: number, n: number, depth: number): void {
  const was = lifeWait.get(seat);
  if (was) clearTimeout(was.timer);
  const total = (was?.n ?? 0) + n;
  const deepest = Math.max(was?.depth ?? 0, depth);
  const timer = setTimeout(() => {
    lifeWait.delete(seat);
    if (total > 0) void raise([{ kind: 'life', seat, n: total }], deepest).catch(() => {});
  }, LIFE_SETTLE_MS);
  lifeWait.set(seat, { n: total, depth: deepest, timer });
}

useAppStore.subscribe((state, prev) => {
  if (state.happened && state.happened !== prev.happened) {
    const events = state.happened.events;
    for (const e of events) if (e.kind === 'life') lifeChanged(e.seat, e.n, chain);
    const now = events.filter((e) => e.kind !== 'life');
    // A failed read sets nothing off, nothing worse.
    if (now.length > 0) void raise(now, chain).catch(() => {});
  }
  if (state.game !== prev.game && useTriggers.getState().shown.length > 0) {
    const g = state.game;
    const shown = useTriggers.getState().shown;
    // What set it off is gone again (an Undo, a new game): so is the trigger.
    const still = g ? shown.filter((t) => stillHappened(g, t.happening)) : [];
    if (still.length !== shown.length) useTriggers.setState({ shown: still });
  }
});

/** Test hook: nothing shown, nothing in flight counted. */
export function _resetTriggers(): void {
  chain = 0;
  for (const { timer } of lifeWait.values()) clearTimeout(timer);
  lifeWait.clear();
  useTriggers.setState({ shown: [] });
}
