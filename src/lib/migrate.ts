import type { CardInstance, FeedEntry, GameState, Reveal, SeatCards } from './types';
import type { CombatBlock, CombatState } from './types';

function validInstance(c: unknown): c is CardInstance {
  const i = c as CardInstance | null;
  return (
    !!i && typeof i.iid === 'string' && typeof i.cardId === 'string' && typeof i.name === 'string'
  );
}

const ZONES: (keyof Pick<
  SeatCards,
  'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command'
>)[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];

function validSeatCards(v: unknown): boolean {
  const s = v as SeatCards | null;
  if (!s || typeof s !== 'object') return false;
  if (typeof s.mulligans !== 'number' && s.mulligans !== undefined) return false;
  return ZONES.every((z) => {
    const arr = (s as unknown as Record<string, unknown>)[z];
    return arr === undefined || (Array.isArray(arr) && arr.every(validInstance));
  });
}

function validFeed(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.every(
      (e: FeedEntry) =>
        !!e && typeof e.id === 'string' && typeof e.t === 'number' && typeof e.text === 'string',
    )
  );
}

/** A reveal is a passing notice, so it is not part of what makes a game
 * valid: a broken one is dropped by migrateGame instead of failing a save
 * that loaded fine before reveals existed. */
function validReveal(v: unknown, seats: number): v is Reveal {
  const r = v as Reveal | null;
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.id === 'string' &&
    Number.isInteger(r.seat) &&
    r.seat >= 0 &&
    r.seat < seats &&
    (r.from === 'hand' || r.from === 'library') &&
    typeof r.t === 'number' &&
    Array.isArray(r.cards) &&
    r.cards.length > 0 &&
    r.cards.every((c) => !!c && typeof c.cardId === 'string' && typeof c.name === 'string')
  );
}

/** Checks every field the components dereference at render time; anything
 * less and a half-corrupted save (or a malformed remote state) becomes a
 * crash loop. Shared by the local restore path and online sync. */
export function isValidGame(v: unknown): v is GameState {
  const g = v as GameState | null;
  return (
    !!g &&
    Array.isArray(g.players) &&
    g.players.length > 0 &&
    g.players.every(
      (p) =>
        typeof p?.life === 'number' &&
        Array.isArray(p.board) &&
        typeof p.commanderDamage === 'object' &&
        p.commanderDamage !== null &&
        typeof p.eliminated === 'boolean',
    ) &&
    typeof g.config?.startingLife === 'number' &&
    typeof g.config.commanderDamageThreshold === 'number' &&
    (g.config.format === 'commander' || g.config.format === 'standard') &&
    Array.isArray(g.config.profiles) &&
    g.config.profiles.length === g.players.length &&
    g.config.profiles.every((p) => typeof p?.id === 'string' && typeof p.name === 'string') &&
    Number.isInteger(g.activePlayerIndex) &&
    g.activePlayerIndex >= 0 &&
    g.activePlayerIndex < g.players.length &&
    typeof g.turnNumber === 'number' &&
    g.players.every((p) => p.cards === undefined || validSeatCards(p.cards)) &&
    (g.feed === undefined || validFeed(g.feed))
  );
}

const COMBAT_STEPS = ['attackers', 'blockers', 'damage', 'done'];

/** Is this a combat the app can read without tripping? Its SHAPE only:
 * the types, a step from the list, seats that exist at this table. It
 * never asks whether a creature in it still exists — creatures die and
 * leave in the middle of a fight, and that must not call the fight off
 * (the engine skips them). */
function validCombat(v: unknown, seats: number): v is CombatState {
  const seat = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < seats;
  const count = (n: unknown) => n === undefined || (Number.isInteger(n) && (n as number) >= 1);
  const unit = (u: unknown) => {
    const x = u as CombatBlock | null;
    return (
      !!x && (x.kind === 'card' || x.kind === 'stack') && typeof x.id === 'string' && count(x.n)
    );
  };
  const c = v as CombatState | null;
  return (
    !!c &&
    typeof c === 'object' &&
    typeof c.id === 'string' &&
    typeof c.turn === 'number' &&
    seat(c.active) &&
    COMBAT_STEPS.includes(c.step) &&
    (c.defender === undefined || seat(c.defender)) &&
    (c.attacks === undefined ||
      (Array.isArray(c.attacks) &&
        c.attacks.every(
          (a) =>
            !!a &&
            unit(a.unit) &&
            count(a.n) &&
            seat(a.target) &&
            (a.blocked === undefined || a.blocked === true) &&
            (a.tapped === undefined || (Number.isInteger(a.tapped) && a.tapped >= 0)) &&
            (a.blockers === undefined || (Array.isArray(a.blockers) && a.blockers.every(unit))),
        )))
  );
}

/** A combat that cannot be read, or that belongs to a turn that is over,
 * is taken out of the state — left out, not written as undefined — so no
 * reader ever meets one. Never fatal: the game itself always loads. */
function soundCombat(saved: GameState): GameState {
  if (!('combat' in saved)) return saved;
  const { combat, ...rest } = saved;
  const keep =
    validCombat(combat, saved.players.length) &&
    combat.turn === saved.turnNumber &&
    combat.active === saved.activePlayerIndex;
  return keep ? saved : rest;
}

/** Fill in fields added after a save was written (or sent by an older build). */
export function migrateGame(saved: GameState): GameState {
  saved = soundCombat(saved); // before the spread below copies it along
  const { reveal, ...rest } = saved;
  return {
    ...rest,
    // Kept only when well-formed; otherwise the key is gone, not nulled.
    ...(validReveal(reveal, saved.players.length) ? { reveal } : {}),
    monarchIdx: saved.monarchIdx ?? null,
    initiativeIdx: saved.initiativeIdx ?? null,
    turnStartedAt: saved.turnStartedAt ?? Date.now(),
    config: { ...saved.config, mode: saved.config.mode ?? 'tracker' },
    players: saved.players.map((p) => ({
      ...p,
      counters: p.counters ?? {},
      commanderDeaths: p.commanderDeaths ?? 0,
      board: p.board.map((item) => ({ ...item, zone: item.zone ?? 'board' })),
      cards:
        p.cards === undefined
          ? undefined // a tracker seat STAYS a tracker seat
          : {
              ...p.cards,
              // After the spread: a partial seat's undefineds must not win.
              mulligans: p.cards.mulligans ?? 0,
              deckName: p.cards.deckName ?? '',
              library: p.cards.library ?? [],
              hand: p.cards.hand ?? [],
              battlefield: p.cards.battlefield ?? [],
              graveyard: p.cards.graveyard ?? [],
              exile: p.cards.exile ?? [],
              command: p.cards.command ?? [],
            },
    })),
  };
}
