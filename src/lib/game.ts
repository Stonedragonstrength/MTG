import type { GameConfig, GameState, PlayerState } from './types';

export function createGame(config: GameConfig): GameState {
  return {
    config,
    players: config.profiles.map((profile) => ({
      profileId: profile.id,
      life: config.startingLife,
      commanderDamage: {},
      eliminated: false,
      board: [],
    })),
    activePlayerIndex: 0,
    turnNumber: 1,
  };
}

function withElimination(player: PlayerState, threshold: number): PlayerState {
  if (player.eliminated) return player; // sticky
  const byCommander = Object.values(player.commanderDamage).some((d) => d >= threshold);
  return player.life <= 0 || byCommander ? { ...player, eliminated: true } : player;
}

function updatePlayer(
  s: GameState,
  playerIdx: number,
  fn: (p: PlayerState) => PlayerState,
): GameState {
  return {
    ...s,
    players: s.players.map((p, i) =>
      i === playerIdx ? withElimination(fn(p), s.config.commanderDamageThreshold) : p,
    ),
  };
}

export function adjustLife(s: GameState, playerIdx: number, delta: number): GameState {
  return updatePlayer(s, playerIdx, (p) => ({ ...p, life: p.life + delta }));
}

export function applyCommanderDamage(
  s: GameState,
  defenderIdx: number,
  attackerProfileId: string,
  delta: number,
): GameState {
  return updatePlayer(s, defenderIdx, (p) => {
    const current = p.commanderDamage[attackerProfileId] ?? 0;
    const next = Math.max(0, current + delta);
    const dealt = next - current;
    return {
      ...p,
      commanderDamage: { ...p.commanderDamage, [attackerProfileId]: next },
      life: p.life - dealt,
    };
  });
}

export function passTurn(s: GameState): GameState {
  const n = s.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (s.activePlayerIndex + step) % n;
    if (!s.players[idx].eliminated) {
      const wrapped = idx <= s.activePlayerIndex;
      return {
        ...s,
        activePlayerIndex: idx,
        turnNumber: wrapped ? s.turnNumber + 1 : s.turnNumber,
      };
    }
  }
  return s;
}
