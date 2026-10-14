import { create } from 'zustand';
import { hostIsThere, type Host } from '../lib/cards';
import type { SpellTarget } from '../lib/spellEffects';
import { actsOf, firedBy, type Arrival, type TriggerAct } from '../lib/triggers';
import type { CardRecord, GameState } from '../lib/types';
import { tableRecords, useAppStore } from '../state/store';
import { carryOutPrompt, findTokenCard } from './spellActs';

/** Cards that trigger by themselves (lib/triggers.ts reads them). Whenever
 * a move made on this device puts something onto a battlefield, the cards
 * that were waiting for it go off here: what needs no choice is carried
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
  /** What set it off: "Shivan Dragon entered", "It entered". */
  because: string;
  acts: ShownAct[];
  /** What entered: once none of it is on the table any more (an Undo),
   * the trigger is off. */
  arrived: Host[];
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
 * move made by hand. Read when the store notes an arrival. */
let chain = 0;
let serial = 0;

function run(key: string, actKey: string, target: SpellTarget | undefined, depth: number): void {
  const trigger = useTriggers.getState().shown.find((t) => t.key === key);
  const act = trigger?.acts.find((a) => a.key === actKey);
  const store = useAppStore.getState();
  if (!trigger || !act || act.done || !store.game) return;
  const card = store.game.players[trigger.seat]?.cards?.battlefield.find((c) => c.iid === trigger.source.iid);
  let did = false;
  chain = depth;
  try {
    if (act.kind === 'return') {
      if (card) store.returnToHand(trigger.seat, card.iid);
      did = !!card;
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

/** The records the triggers are read with: every card on a battlefield,
 * and the cards behind the stacks that arrived. */
async function recordsFor(g: GameState, arrivals: Arrival[]): Promise<Record<string, CardRecord | undefined>> {
  const records = await tableRecords(g);
  const { getCardById } = await import('../data/scryfall');
  for (const a of arrivals) {
    if (!a.cardId || a.cardId in records) continue;
    records[a.cardId] = await getCardById(a.cardId).catch(() => undefined);
  }
  return records;
}

/** Sets off whatever was waiting for these arrivals. `depth`: how deep in
 * a chain of triggers the move that brought them was. */
async function raise(arrivals: Arrival[], depth: number): Promise<void> {
  const seen = useAppStore.getState().game;
  if (!seen) return;
  const records = await recordsFor(seen, arrivals);
  // The table as it stands now: a card that left meanwhile waits for nothing.
  const g = useAppStore.getState().game;
  if (!g) return;
  const fresh: ShownTrigger[] = [];
  for (const fired of firedBy(g, arrivals, records)) {
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
    // ELSE is shown either way — that is the trigger people forget.
    if (fired.own && acts.length === 0) continue;
    fresh.push({
      key: `t${++serial}`,
      seat: fired.seat,
      source: { iid: fired.source.iid, name: fired.source.name, art: records[fired.source.cardId]?.imageNormal ?? null },
      text: fired.trigger.text,
      who: g.config.profiles[fired.seat]?.name ?? '?',
      because: fired.own ? 'It entered' : `${fired.because.join(', ')} entered`,
      acts,
      arrived: fired.arrived,
    });
  }
  if (fresh.length === 0) return;
  useTriggers.setState({ shown: [...useTriggers.getState().shown, ...fresh].slice(-SHOWN_CAP) });
  if (depth >= MAX_CHAIN) return;
  for (const trigger of fresh)
    for (const act of trigger.acts) if (act.auto) run(trigger.key, act.key, undefined, depth + 1);
}

useAppStore.subscribe((state, prev) => {
  if (state.entered && state.entered !== prev.entered) {
    // A failed read sets nothing off, nothing worse.
    void raise(state.entered.arrivals, chain).catch(() => {});
  }
  if (state.game !== prev.game && useTriggers.getState().shown.length > 0) {
    const g = state.game;
    const shown = useTriggers.getState().shown;
    // What set it off is gone again (an Undo, a new game): so is the trigger.
    const still = g ? shown.filter((t) => t.arrived.some((host) => hostIsThere(g, host))) : [];
    if (still.length !== shown.length) useTriggers.setState({ shown: still });
  }
});

/** Test hook: nothing shown, nothing in flight counted. */
export function _resetTriggers(): void {
  chain = 0;
  useTriggers.setState({ shown: [] });
}
