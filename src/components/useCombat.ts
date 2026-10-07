import { useMemo } from 'react';
import { create } from 'zustand';
import { actingSeat, liveCombat } from '../lib/combat';
import {
  cardsRead,
  readSeat,
  readUnit,
  resolveCombat,
  type CardRecords,
  type CombatResult,
  type UnitRead,
} from '../lib/combatEngine';
import {
  attackAnyway,
  attackLess,
  attackNone,
  attackTap,
  attackingCopies,
  blockAnyway,
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
// zones ask (every seat marks its own dying creatures).
let worked: { game: GameState; records: CardRecords; result: CombatResult | null } | null = null;

/** The fight's result while it waits at the damage step and every card in
 * it has been read on this device; otherwise null. */
export function damageResult(game: GameState, fight: CombatState, records: CardRecords): CombatResult | null {
  if (fight.step !== 'damage') return null;
  if (worked && worked.game === game && worked.records === records) return worked.result;
  const result = cardsRead(game, fight, records) ? resolveCombat(game, fight, records) : null;
  worked = { game, records, result };
  return result;
}

type PickMode = 'attack' | 'block' | null;

/** One card or stack as a fight shows it and as a tap treats it. */
export interface UnitLook {
  /** The pick mode its seat is in, if any. */
  mode: PickMode;
  /** A tap on it is a pick (or is ignored) instead of an ordinary tap:
   * a creature, while its seat picks. Nothing else changes meaning. */
  picks: boolean;
  /** It cannot be picked by a tap and is not picked: drawn dimmed. */
  dim: boolean;
  /** Copies of it attacking, or blocking, in all. */
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
    const death = damageResult(game!, fight, records)?.outcome.deaths.find(
      (d) => d.seat === playerIdx && unitKey(d.unit) === unitKey(unit),
    );
    const base = {
      mode,
      attacking: attacking.at,
      blocking: blocking.at,
      dying: death ? (death.n ?? 1) : 0,
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
      const free = freeToStand(fight, playerIdx, r);
      const force = blockAnyway(fight, playerIdx, r, lit);
      // A card stands in one place: one pick takes it out of the way.
      const out = unit.kind === 'card' && blocking.total > 0 ? blockLess(fight, playerIdx, r, lit) : null;
      return {
        ...base,
        picks: r.creature,
        picked: blocking.total,
        free,
        dim: r.creature && blocking.total === 0 && free === 0,
        tap: () => stand(blockTap(fight, playerIdx, r, lit)),
        less: () => stand(blockLess(fight, playerIdx, r, lit)),
        anyway: force ? () => stand(force) : null,
        stop: out ? () => stand(out) : null,
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
