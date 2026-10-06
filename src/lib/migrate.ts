import type { GameState } from './types';

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
    typeof g.turnNumber === 'number'
  );
}

/** Fill in fields added after a save was written (or sent by an older build). */
export function migrateGame(saved: GameState): GameState {
  return {
    ...saved,
    monarchIdx: saved.monarchIdx ?? null,
    initiativeIdx: saved.initiativeIdx ?? null,
    turnStartedAt: saved.turnStartedAt ?? Date.now(),
    players: saved.players.map((p) => ({
      ...p,
      counters: p.counters ?? {},
      commanderDeaths: p.commanderDeaths ?? 0,
      board: p.board.map((item) => ({ ...item, zone: item.zone ?? 'board' })),
    })),
  };
}
