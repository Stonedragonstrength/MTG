import { create } from 'zustand';
import { getDb, kvDelete, kvGet, kvSet } from '../data/db';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from '../data/settings';
import * as boardLib from '../lib/board';
import * as gameLib from '../lib/game';
import { playDefeat, playLifeTick, playTurnChime } from '../lib/sound';
import type { BoardItem, GameConfig, GameState, PlayerProfile } from '../lib/types';

export interface LogEntry {
  t: number;
  text: string;
}

export interface AppStore {
  setupDone: boolean;
  game: GameState | null;
  inGame: boolean; // false with a saved game = home screen offers Pick up
  profiles: PlayerProfile[];
  settings: Settings;
  log: LogEntry[];
  updateSettings(settings: Settings): void;
  init(): Promise<void>;
  completeSetup(): void;
  startGame(config: GameConfig): void;
  enterGame(): void;
  endGame(): void;
  undo(): void;
  canUndo(): boolean;
  adjustLife(playerIdx: number, delta: number): void;
  applyCommanderDamage(defenderIdx: number, attackerProfileId: string, delta: number): void;
  passTurn(): void;
  setPlayerCounter(playerIdx: number, counterName: string, value: number): void;
  setCommanderDeaths(playerIdx: number, deaths: number): void;
  claimMonarch(playerIdx: number): void;
  claimInitiative(playerIdx: number): void;
  addItem(playerIdx: number, item: BoardItem): void;
  tapItem(playerIdx: number, itemId: string, delta: number): void;
  untapAll(playerIdx: number): void;
  changeCount(playerIdx: number, itemId: string, delta: number): void;
  splitItem(playerIdx: number, itemId: string, moveCount: number): void;
  setCounter(playerIdx: number, itemId: string, counterName: string, value: number): void;
  removeItem(playerIdx: number, itemId: string): void;
  saveProfile(p: PlayerProfile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
}

// Serialized writes so saves never interleave; flushPersistence() awaits the tail.
let pending: Promise<unknown> = Promise.resolve();

function persistGame(game: GameState | null): void {
  pending = pending
    .then(() => (game ? kvSet('activeGame', game) : kvDelete('activeGame')))
    .catch((err) => console.error('Failed to persist game state', err));
}

export function flushPersistence(): Promise<unknown> {
  return pending;
}

// Checks every field the components dereference at render time; anything
// less and a half-corrupted save becomes a crash loop on launch.
function isValidGame(v: unknown): v is GameState {
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

/** Fill in fields added after a save was written. */
function migrateGame(saved: GameState): GameState {
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

const HISTORY_CAP = 100;
const LOG_CAP = 200;

export function createAppStore() {
  return create<AppStore>()((set, get) => {
    let history: GameState[] = [];

    const playerName = (g: GameState, idx: number) => g.config.profiles[idx]?.name ?? '?';

    const appendLog = (texts: string[]) => {
      if (texts.length === 0) return;
      const entries = texts.map((text) => ({ t: Date.now(), text }));
      set({ log: [...get().log, ...entries].slice(-LOG_CAP) });
    };

    const mutateGame = (
      fn: (g: GameState) => GameState,
      describe?: (prev: GameState, next: GameState) => string | null,
    ) => {
      const game = get().game;
      if (!game) return;
      const next = fn(game);
      if (next === game) return;
      history = [...history.slice(-(HISTORY_CAP - 1)), game];
      set({ game: next });
      persistGame(next);

      const lines: string[] = [];
      const described = describe?.(game, next);
      if (described) lines.push(described);
      next.players.forEach((p, i) => {
        if (p.eliminated && !game.players[i].eliminated) {
          lines.push(`${playerName(next, i)} is defeated`);
          if (get().settings.soundOn) playDefeat();
        }
      });
      appendLog(lines);
    };

    return {
      setupDone: false,
      game: null,
      inGame: false,
      profiles: [],
      settings: DEFAULT_SETTINGS,
      log: [],

      updateSettings(settings) {
        set({ settings });
        pending = pending
          .then(() => saveSettings(settings))
          .catch((err) => console.error('Failed to persist settings', err));
      },

      async init() {
        const imported = await kvGet('cardsImportedAt');
        const profiles = await getDb().profiles.toArray();
        const settings = await getSettings();
        let game: GameState | null = null;
        try {
          const saved = await kvGet('activeGame');
          if (saved !== undefined) {
            if (isValidGame(saved)) game = migrateGame(saved);
            else await kvDelete('activeGame');
          }
        } catch (err) {
          console.error('Failed to restore saved game', err);
          await kvDelete('activeGame').catch(() => {});
        }
        set({ setupDone: imported !== undefined, profiles, game, settings });
      },

      completeSetup() {
        set({ setupDone: true });
      },

      startGame(config) {
        const game = gameLib.createGame(config);
        history = [];
        set({ game, inGame: true, log: [{ t: Date.now(), text: 'Game started' }] });
        persistGame(game);
      },

      enterGame() {
        if (get().game) set({ inGame: true });
      },

      endGame() {
        history = [];
        set({ game: null, inGame: false, log: [] });
        persistGame(null);
      },

      undo() {
        const prev = history[history.length - 1];
        if (!prev) return;
        history = history.slice(0, -1);
        set({ game: prev });
        persistGame(prev);
        appendLog(['Undo']);
      },

      canUndo() {
        return history.length > 0;
      },

      adjustLife(playerIdx, delta) {
        if (get().settings.soundOn) playLifeTick();
        mutateGame(
          (g) => gameLib.adjustLife(g, playerIdx, delta),
          (prev, next) =>
            `${playerName(prev, playerIdx)}: life ${prev.players[playerIdx].life} → ${next.players[playerIdx].life}`,
        );
      },

      applyCommanderDamage(defenderIdx, attackerProfileId, delta) {
        mutateGame(
          (g) => gameLib.applyCommanderDamage(g, defenderIdx, attackerProfileId, delta),
          (prev, next) => {
            const attacker = prev.config.profiles.find((p) => p.id === attackerProfileId);
            const dmg = next.players[defenderIdx].commanderDamage[attackerProfileId] ?? 0;
            return `${playerName(prev, defenderIdx)}: ${dmg} cmdr dmg from ${attacker?.name ?? '?'} (life ${next.players[defenderIdx].life})`;
          },
        );
      },

      passTurn() {
        if (get().settings.soundOn) playTurnChime();
        mutateGame(
          (g) => {
            const next = gameLib.passTurn(g);
            // The incoming player's untap step readies all their permanents.
            return boardLib.untapAll(next, next.activePlayerIndex);
          },
          (_prev, next) => `Turn ${next.turnNumber}: ${playerName(next, next.activePlayerIndex)}`,
        );
      },

      tapItem(playerIdx, itemId, delta) {
        mutateGame((g) => boardLib.tapItem(g, playerIdx, itemId, delta));
      },

      untapAll(playerIdx) {
        mutateGame(
          (g) => boardLib.untapAll(g, playerIdx),
          (prev) => `${playerName(prev, playerIdx)}: untaps`,
        );
      },

      setPlayerCounter(playerIdx, counterName, value) {
        mutateGame(
          (g) => gameLib.setPlayerCounter(g, playerIdx, counterName, value),
          (prev) => `${playerName(prev, playerIdx)}: ${counterName} ${Math.max(0, value)}`,
        );
      },

      setCommanderDeaths(playerIdx, deaths) {
        mutateGame(
          (g) => gameLib.setCommanderDeaths(g, playerIdx, deaths),
          (prev) =>
            `${playerName(prev, playerIdx)}: commander deaths ${Math.max(0, deaths)} (tax +${Math.max(0, deaths) * 2})`,
        );
      },

      claimMonarch(playerIdx) {
        mutateGame(
          (g) => gameLib.claimMonarch(g, playerIdx),
          (prev, next) =>
            next.monarchIdx === null
              ? 'The crown is released'
              : `${playerName(prev, playerIdx)} takes the crown`,
        );
      },

      claimInitiative(playerIdx) {
        mutateGame(
          (g) => gameLib.claimInitiative(g, playerIdx),
          (prev, next) =>
            next.initiativeIdx === null
              ? 'The initiative is released'
              : `${playerName(prev, playerIdx)} takes the initiative`,
        );
      },

      addItem(playerIdx, item) {
        mutateGame(
          (g) => boardLib.addItem(g, playerIdx, item),
          (prev) => `${playerName(prev, playerIdx)}: +${item.name}`,
        );
      },

      changeCount(playerIdx, itemId, delta) {
        mutateGame(
          (g) => boardLib.changeCount(g, playerIdx, itemId, delta),
          (prev, next) => {
            const before = prev.players[playerIdx].board.find((it) => it.id === itemId);
            if (!before) return null;
            const after = next.players[playerIdx].board.find((it) => it.id === itemId);
            return after
              ? `${playerName(prev, playerIdx)}: ${before.name} ×${after.count}`
              : `${playerName(prev, playerIdx)}: ${before.name} removed`;
          },
        );
      },

      splitItem(playerIdx, itemId, moveCount) {
        mutateGame(
          (g) => boardLib.splitItem(g, playerIdx, itemId, moveCount),
          (prev) => {
            const item = prev.players[playerIdx].board.find((it) => it.id === itemId);
            return item ? `${playerName(prev, playerIdx)}: split ${item.name}` : null;
          },
        );
      },

      setCounter(playerIdx, itemId, counterName, value) {
        mutateGame(
          (g) => boardLib.setCounter(g, playerIdx, itemId, counterName, value),
          (prev) => {
            const item = prev.players[playerIdx].board.find((it) => it.id === itemId);
            return item
              ? `${playerName(prev, playerIdx)}: ${item.name} ${counterName} ${Math.max(0, value)}`
              : null;
          },
        );
      },

      removeItem(playerIdx, itemId) {
        mutateGame(
          (g) => boardLib.removeItem(g, playerIdx, itemId),
          (prev) => {
            const item = prev.players[playerIdx].board.find((it) => it.id === itemId);
            return item ? `${playerName(prev, playerIdx)}: ${item.name} removed` : null;
          },
        );
      },

      async saveProfile(p) {
        await getDb().profiles.put(p);
        const existing = get().profiles.filter((x) => x.id !== p.id);
        set({ profiles: [...existing, p] });
      },

      async deleteProfile(id) {
        await getDb().profiles.delete(id);
        set({ profiles: get().profiles.filter((x) => x.id !== id) });
      },
    };
  });
}

export const useAppStore = createAppStore();
