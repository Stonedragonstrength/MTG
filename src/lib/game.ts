import type { CardRecord, GameConfig, GameState, PlayerState } from './types';

/** Commander legality: a legendary creature, or a card whose text allows it
 * (planeswalker commanders say "can be your commander"). */
export function isCommanderLegal(card: CardRecord): boolean {
  const type = card.typeLine.toLowerCase();
  if (type.includes('legendary') && type.includes('creature')) return true;
  return card.oracleText.toLowerCase().includes('can be your commander');
}

export function createGame(config: GameConfig, now = Date.now()): GameState {
  return {
    config,
    players: config.profiles.map((profile) => ({
      profileId: profile.id,
      life: config.startingLife,
      commanderDamage: {},
      eliminated: false,
      board: [],
      counters: {},
      commanderDeaths: 0,
    })),
    activePlayerIndex: 0,
    turnNumber: 1,
    monarchIdx: null,
    initiativeIdx: null,
    turnStartedAt: now,
  };
}

const LETHAL_POISON = 10;

function withElimination(player: PlayerState, threshold: number): PlayerState {
  if (player.eliminated) return player; // sticky
  const byCommander = Object.values(player.commanderDamage).some((d) => d >= threshold);
  const byPoison = (player.counters['poison'] ?? 0) >= LETHAL_POISON;
  return player.life <= 0 || byCommander || byPoison ? { ...player, eliminated: true } : player;
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

/** Everything one fight does to one player. Changes, never totals: a
 * proliferate another device landed in between has to survive. */
export interface PlayerChange {
  /** Net life change: every point of damage once, minus life gained. */
  life?: number;
  /** Damage ADDED per commander-damage key. It moves the gauge only —
   * the life it cost is already inside `life`. */
  commander?: Record<string, number>;
  /** Poison counters ADDED. */
  poison?: number;
}

const amount = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Writes a fight's life change, commander damage and poison in ONE
 * update, so the player is judged once, on the result. Never chain
 * adjustLife, applyCommanderDamage and setPlayerCounter for this: a player
 * at 3 who takes 4 and gains 2 ends at 1 and alive, but the chain defeats
 * him on the way down (and nothing revives a player), and
 * applyCommanderDamage takes its damage off the life total a second time.
 * The same state comes back when nothing changes. */
export function settlePlayer(s: GameState, playerIdx: number, change: PlayerChange): GameState {
  const player = s.players[playerIdx];
  if (!player) return s;
  const life = amount(change.life);
  const poison = Math.max(0, (player.counters['poison'] ?? 0) + amount(change.poison));
  const gauges: [string, number][] = [];
  for (const [key, added] of Object.entries(change.commander ?? {})) {
    const now = player.commanderDamage[key] ?? 0;
    const next = Math.max(0, now + amount(added));
    if (next !== now) gauges.push([key, next]);
  }
  if (life === 0 && gauges.length === 0 && poison === (player.counters['poison'] ?? 0)) return s;
  return updatePlayer(s, playerIdx, (p) => {
    const counters = { ...p.counters };
    if (poison <= 0) delete counters['poison'];
    else counters['poison'] = poison;
    return {
      ...p,
      life: p.life + life,
      commanderDamage: { ...p.commanderDamage, ...Object.fromEntries(gauges) },
      counters,
    };
  });
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

export function setPlayerCounter(
  s: GameState,
  playerIdx: number,
  counterName: string,
  value: number,
): GameState {
  return updatePlayer(s, playerIdx, (p) => {
    const counters = { ...p.counters };
    if (value <= 0) delete counters[counterName];
    else counters[counterName] = value;
    return { ...p, counters };
  });
}

export function setCommanderDeaths(s: GameState, playerIdx: number, deaths: number): GameState {
  return updatePlayer(s, playerIdx, (p) => ({ ...p, commanderDeaths: Math.max(0, deaths) }));
}

export function claimMonarch(s: GameState, playerIdx: number): GameState {
  return { ...s, monarchIdx: s.monarchIdx === playerIdx ? null : playerIdx };
}

export function claimInitiative(s: GameState, playerIdx: number): GameState {
  return { ...s, initiativeIdx: s.initiativeIdx === playerIdx ? null : playerIdx };
}

export function passTurn(s: GameState, now = Date.now()): GameState {
  const n = s.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (s.activePlayerIndex + step) % n;
    if (!s.players[idx].eliminated) {
      const wrapped = idx <= s.activePlayerIndex;
      return {
        ...s,
        activePlayerIndex: idx,
        turnNumber: wrapped ? s.turnNumber + 1 : s.turnNumber,
        turnStartedAt: now,
      };
    }
  }
  return s;
}
