import type { CardInstance, FeedEntry, GameState, SeatCards } from './types';

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

/** Fill in fields added after a save was written (or sent by an older build). */
export function migrateGame(saved: GameState): GameState {
  return {
    ...saved,
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
