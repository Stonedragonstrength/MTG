import { useMemo } from 'react';
import { create } from 'zustand';
import { actingSeat, liveCombat } from '../lib/combat';
import { cardsRead, readSeat, readUnit, type CardRecords, type UnitRead } from '../lib/combatEngine';
import {
  NO_EDITS,
  lifeAfter,
  nextDeath,
  nudgeDamage,
  nudgeGain,
  reviewCombat,
  reviewId,
  setDeaths,
  type Review,
  type ReviewEdits,
} from '../lib/combatReview';
import {
  attackAnyway,
  attackLess,
  attackNone,
  attackTap,
  attackingCopies,
  blockAnyway,
  blockLegal,
  blockLess,
  blockTap,
  blockingCopies,
  freeToSend,
  freeToStand,
  litAttack,
  litTarget,
  unitKey,
  type AttackPick,
  type BlockPick,
} from '../lib/combatView';
import type { CombatState, CombatUnit, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import { useCardRecords } from './useCardRecords';

/** Where this device's next pick goes: the lit opponent while attackers
 * are picked, the lit attacker while blockers are. It is not part of the
 * game — never synced, never saved: two devices may light different
 * things — and it belongs to one fight (a light left over from another
 * fight, or from the defender before, simply falls back to the first). */
interface CombatAim {
  combatId: string | null;
  target: number | null;
  attack: number | null;
  /** Lights an opponent's chip. */
  aimAt(combatId: string, target: number): void;
  /** Lights an attacker's tile, by its place in the combat's list. */
  light(combatId: string, attack: number): void;
}

export const useCombatAim = create<CombatAim>()((set, get) => ({
  combatId: null,
  target: null,
  attack: null,
  aimAt(combatId, target) {
    set({ combatId, target, attack: get().combatId === combatId ? get().attack : null });
  },
  light(combatId, attack) {
    set({ combatId, attack, target: get().combatId === combatId ? get().target : null });
  },
}));

/** What the players at this device changed about a fight's result before
 * applying it: a death added or taken away on the cards, a number moved
 * beside a life total or in Details. Like the aim it is not part of the
 * game — never synced, never saved — and it belongs to one wait at the
 * damage step. */
interface CombatEdits {
  combatId: string | null;
  edits: ReviewEdits;
  change(combatId: string, fn: (was: ReviewEdits) => ReviewEdits): void;
  clear(): void;
}

export const useCombatEdits = create<CombatEdits>()((set, get) => ({
  combatId: null,
  edits: NO_EDITS,
  change(combatId, fn) {
    const was = get().combatId === combatId ? get().edits : NO_EDITS;
    const edits = fn(was);
    if (edits !== was || get().combatId !== combatId) set({ combatId, edits });
  },
  clear() {
    if (get().combatId !== null) set({ combatId: null, edits: NO_EDITS });
  },
}));

/** The changes that belong to this fight: another fight's are not its. */
export const editsFor = (s: Pick<CombatEdits, 'combatId' | 'edits'>, fight: CombatState): ReviewEdits =>
  s.combatId === fight.id ? s.edits : NO_EDITS;

// Applied, called off, or taken back to the blockers by an Undo: what was
// changed about that result is gone with it.
useAppStore.subscribe((s) => {
  if (useCombatEdits.getState().combatId === null) return;
  const fight = s.game ? liveCombat(s.game) : null;
  if (fight?.step !== 'damage') useCombatEdits.getState().clear();
});

/** One colour per seat for whatever a fight pins on a card: the opponent's
 * chip on the bar and the mark an attacker pointed at them wears. Initials
 * alone cannot tell Sam from Sal. */
const SEAT_TINTS = ['#e0a458', '#6fb1e0', '#7fc98f', '#d98bc0'];
export const seatTint = (seat: number): string => SEAT_TINTS[seat % SEAT_TINTS.length];

// Every zone asks for the same records: they all get the same object, so
// what is worked out from it (the damage) is worked out once.
let tableRecords: { answered: string; records: CardRecords } | null = null;

/** The card records of every battlefield on the table, in the shape the
 * combat engine reads: a card with no entry has not been answered yet.
 * The same object comes back — to every component — until an answer
 * arrives. */
export function useTableRecords(retry = 0): CardRecords {
  const players = useAppStore((s) => s.game?.players);
  const records = useCardRecords(
    (players ?? []).flatMap((p) => p.cards?.battlefield ?? []),
    retry,
  );
  const answered = Object.keys(records)
    .sort()
    .map((id) => (records[id] ? id : `${id}!`))
    .join(',');
  return useMemo(() => {
    if (tableRecords?.answered !== answered) tableRecords = { answered, records };
    return tableRecords.records;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered]);
}

// The damage is worked out once per state of the table, however many
// zones ask (every seat marks its own dying creatures, every life total
// shows what it comes to).
let worked: { game: GameState; records: CardRecords; edits: ReviewEdits; review: Review | null } | null = null;

/** The fight's result as Apply would carry it — the engine's, with what
 * this device's players changed — while it waits at the damage step and
 * every card in it has been read here; otherwise null. */
export function damageReview(
  game: GameState,
  fight: CombatState,
  records: CardRecords,
  edits: ReviewEdits = NO_EDITS,
): Review | null {
  if (fight.step !== 'damage') return null;
  if (worked && worked.game === game && worked.records === records && worked.edits === edits) return worked.review;
  const review = cardsRead(game, fight, records) ? reviewCombat(game, fight, records, edits) : null;
  worked = { game, records, edits, review };
  return review;
}

/** The art of a card or a stack as this device has it. */
export function unitArt(game: GameState, seat: number, unit: CombatUnit, records: CardRecords): string | null {
  const player = game.players[seat];
  if (unit.kind === 'stack') return player?.board.find((it) => it.id === unit.id)?.imageNormal ?? null;
  const card = player?.cards?.battlefield.find((c) => c.iid === unit.id);
  return (card && records[card.cardId]?.imageNormal) || null;
}

type PickMode = 'attack' | 'block' | null;

/** One card or stack as a fight shows it and as a tap treats it. */
export interface UnitLook {
  /** The pick mode its seat is in, if any — or 'damage': it fought, the
   * result is waiting, and a tap says whether it dies. */
  mode: PickMode | 'damage';
  /** A tap on it is a pick (or is ignored) instead of an ordinary tap:
   * a creature, while its seat picks; anything that fought, while the
   * result waits. Nothing else changes meaning. */
  picks: boolean;
  /** It cannot be picked by a tap and is not picked: drawn dimmed. */
  dim: boolean;
  /** Copies of it attacking, or blocking, in all; at the damage step,
   * the copies that die. */
  picked: number;
  /** Copies a tap may still add. */
  free: number;
  /** Where its copies are pointed: [seat, copies]. */
  attacking: [target: number, n: number][];
  /** Which numbered attackers its copies stand in front of: [number, copies]. */
  blocking: [no: number, n: number][];
  /** How many of its copies the result kills (damage step). */
  dying: number;
  /** What a tap does in a pick mode. */
  tap(): void;
  /** The stack stepper's minus. */
  less(): void;
  /** "Attack anyway" / "Block anyway"; null when there is nothing to force. */
  anyway: (() => void) | null;
  /** Stands it down entirely (the hold sheet); null when it is not picked. */
  stop: (() => void) | null;
}

export interface SeatCombat {
  fight: CombatState;
  /** What a tap on this seat's creatures does on this device right now. */
  mode: PickMode;
  /** How this seat's card or stack stands in the fight; null when it is
   * not on this seat's side of the table. */
  look(unit: CombatUnit): UnitLook | null;
}

const NOWHERE = { total: 0, at: [] };

/** The fight as one seat's zone needs it: which pick mode its creatures
 * are in, what each of them wears, and what a tap on each one asks the
 * store for. Null when no fight is live (or `on` is false: the phone's
 * hand view does no picking). It never throws — a fight this cannot read
 * leaves the zone as it always is, and the bar offers the way out. */
export function useSeatCombat(playerIdx: number, on = true): SeatCombat | null {
  const game = useAppStore((s) => s.game);
  const setAttacker = useAppStore((s) => s.setAttacker);
  const setAttackers = useAppStore((s) => s.setAttackers);
  const setBlocker = useAppStore((s) => s.setBlocker);
  const aim = useCombatAim();
  const changed = useCombatEdits();
  const records = useTableRecords();
  const fight = game && on ? liveCombat(game) : null;
  if (!game || !fight) return null;

  const acting = actingSeat(fight) === playerIdx;
  const mode: PickMode = !acting
    ? null
    : fight.step === 'attackers'
      ? 'attack'
      : fight.step === 'blockers'
        ? 'block'
        : null;
  const mine = aim.combatId === fight.id;
  const send = (pick: AttackPick | null) => {
    if (pick) setAttacker(pick.unit, pick.target, pick.n);
  };
  const stand = (pick: BlockPick | null) => {
    if (pick) setBlocker(playerIdx, pick.attacker, pick.blocker, pick.n);
  };

  // Gathered once per render, on the first card that asks.
  let seat: ReturnType<typeof readSeat> | null = null;
  const reads = new Map<string, UnitRead | null>();
  const read = (unit: CombatUnit) => {
    const key = unitKey(unit);
    if (!reads.has(key)) {
      seat ??= readSeat(game, playerIdx, records);
      reads.set(key, readUnit(game, playerIdx, unit, records, seat));
    }
    return reads.get(key) ?? null;
  };

  function lookAt(fight: CombatState, unit: CombatUnit): UnitLook | null {
    const r = read(unit);
    if (!r) return null;
    const attacker = playerIdx === fight.active;
    const attacking = attacker ? attackingCopies(fight, unit) : NOWHERE;
    const blocking = attacker ? NOWHERE : blockingCopies(fight, playerIdx, unit);
    // At the damage step: how it comes out of the fight, if it was in it.
    const judged =
      damageReview(game!, fight, records, editsFor(changed, fight))?.units.find(
        (u) => u.id === reviewId(playerIdx, unit),
      ) ?? null;
    const base = {
      mode,
      attacking: attacking.at,
      blocking: blocking.at,
      dying: judged?.dies ?? 0,
    };
    if (mode === 'attack') {
      const target = litTarget(game!, fight, mine ? aim.target : null);
      const free = freeToSend(fight, r);
      const force = target === null ? null : attackAnyway(fight, r, target);
      const none = attackNone(fight, unit);
      return {
        ...base,
        picks: r.creature,
        picked: attacking.total,
        free,
        dim: r.creature && attacking.total === 0 && free === 0,
        tap: () => target !== null && send(attackTap(fight, r, target)),
        less: () => target !== null && send(attackLess(fight, r, target)),
        anyway: force ? () => send(force) : null,
        stop: none.length > 0 ? () => setAttackers(none) : null,
      };
    }
    if (mode === 'block') {
      const lit = litAttack(fight, playerIdx, mine ? aim.attack : null);
      // The lit attacker as the table reads it: a flier, one that can't be blocked.
      const litRead = lit ? readUnit(game!, fight.active, lit.attack.unit, records) : null;
      const legal = blockLegal(litRead, r);
      const free = freeToStand(fight, playerIdx, r);
      const force = blockAnyway(fight, playerIdx, r, lit);
      // A card stands in one place: one pick takes it out of the way.
      const out = unit.kind === 'card' && blocking.total > 0 ? blockLess(fight, playerIdx, r, lit) : null;
      return {
        ...base,
        picks: r.creature,
        picked: blocking.total,
        free,
        dim: r.creature && blocking.total === 0 && (free === 0 || !legal),
        tap: () => stand(blockTap(fight, playerIdx, r, lit, litRead)),
        less: () => stand(blockLess(fight, playerIdx, r, lit)),
        anyway: force ? () => stand(force) : null,
        stop: out ? () => stand(out) : null,
      };
    }
    if (judged) {
      // The result is on the cards, and is put right there: a tap on
      // anything that fought says whether it dies — on every seat's side,
      // whoever's move it is. Kept on this device until Apply carries it.
      return {
        ...base,
        mode: 'damage',
        picks: true,
        picked: judged.dies,
        free: judged.n - judged.dies,
        dim: false,
        tap: () => changed.change(fight.id, (e) => nextDeath(e, judged)),
        less: () => changed.change(fight.id, (e) => setDeaths(e, judged, judged.dies - 1)),
        anyway: null,
        stop: null,
      };
    }
    return {
      ...base,
      picks: false,
      picked: attacking.total + blocking.total,
      free: 0,
      dim: false,
      tap: () => {},
      less: () => {},
      anyway: null,
      stop: null,
    };
  }

  return {
    fight,
    mode,
    look(unit) {
      try {
        return lookAt(fight, unit);
      } catch (err) {
        console.error('Combat could not be read for', unit, err);
        return null;
      }
    },
  };
}

/** What the fight waiting at its damage step is about to do to one seat's
 * life, and the press that puts the number right. */
export interface LifeAtStake {
  /** Their life once the result is applied. */
  after: number;
  /** They were attacked: the press moves the damage. Otherwise they only
   * gain (lifelink), and it moves that. */
  defending: boolean;
  /** `by` as a life counter says it: +1 is one more life afterwards. */
  nudge(by: number): void;
}

/** A seat's life total while a result waits: null when no fight is at its
 * damage step, its cards are not read yet, or it leaves this seat alone. */
export function useLifeAtStake(playerIdx: number): LifeAtStake | null {
  const game = useAppStore((s) => s.game);
  const changed = useCombatEdits();
  const records = useTableRecords();
  const fight = game ? liveCombat(game) : null;
  if (!game || !fight) return null;
  // The zone header asks, outside the combat bar's boundary: a fight that
  // cannot be read leaves the life total as it always is.
  let review: Review | null = null;
  try {
    review = damageReview(game, fight, records, editsFor(changed, fight));
  } catch (err) {
    console.error('The fight could not be read for a life total', err);
  }
  const result = review;
  const after = result ? lifeAfter(game, result, playerIdx) : null;
  if (!result || after === null) return null;
  const defending = result.defenders.some((d) => d.seat === playerIdx);
  return {
    after,
    defending,
    nudge: (by) =>
      changed.change(fight.id, (e) =>
        defending ? nudgeDamage(result, e, playerIdx, -by) : nudgeGain(result, e, playerIdx, by),
      ),
  };
}
