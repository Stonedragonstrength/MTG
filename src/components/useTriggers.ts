import { create } from 'zustand';
import type { SpellTarget } from '../lib/spellEffects';
import { actsOf, firedBy, stillHappened, type Happening, type Thing, type TriggerAct } from '../lib/triggers';
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
export type ShownAct = TriggerAct & { done: boolean; token?: CardRecord };

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
    } else did = carryOutPrompt(trigger.seat, trigger.source.name, act.prompt, act.token, target);
  } finally {
    chain = 0;
  }
  if (did) useTriggers.getState().markDone(key, actKey);
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
  h.kind === 'cast' ? [h.spell] : h.kind === 'turn' || h.kind === 'combat' || h.kind === 'life' ? [] : h.things;

/** The records the triggers are read with: every card on a battlefield,
 * and every card and stack the happenings are about (one that died is in a
 * graveyard now). */
async function recordsFor(g: GameState, events: Happening[]): Promise<Record<string, CardRecord | undefined>> {
  const records = await tableRecords(g);
  const { getCardById } = await import('../data/scryfall');
  for (const a of events.flatMap(thingsOf)) {
    if (!a.cardId || a.cardId in records) continue;
    records[a.cardId] = await getCardById(a.cardId).catch(() => undefined);
  }
  return records;
}

/** Sets off whatever was waiting for what a move did. `depth`: how deep in
 * a chain of triggers that move was. */
async function raise(events: Happening[], depth: number): Promise<void> {
  const seen = useAppStore.getState().game;
  if (!seen) return;
  const records = await recordsFor(seen, events);
  // The table as it stands now: a card that left meanwhile waits for nothing.
  const g = useAppStore.getState().game;
  if (!g) return;
  const fresh: ShownTrigger[] = [];
  for (const fired of events.flatMap((h) => firedBy(g, h, records).map((f) => ({ ...f, happening: h })))) {
    const acts: ShownAct[] = [];
    for (const act of actsOf(fired.trigger, fired.times)) {
      if (act.kind !== 'prompt' || act.prompt.kind !== 'tokens') acts.push({ ...act, done: false });
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
    fresh.push({
      key: `t${++serial}`,
      seat: fired.seat,
      source: { iid: fired.source.iid, name: fired.source.name, art: records[fired.source.cardId]?.imageNormal ?? null },
      text: fired.trigger.text,
      who: g.config.profiles[fired.seat]?.name ?? '?',
      because: fired.because,
      acts,
      happening: fired.happening,
    });
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
