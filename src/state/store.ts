import { create } from 'zustand';
import { getDb, kvDelete, kvGet, kvSet } from '../data/db';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from '../data/settings';
import * as boardLib from '../lib/board';
import * as gameLib from '../lib/game';
import type { BoardItem, GameConfig, GameState, PlayerProfile } from '../lib/types';

export interface AppStore {
  setupDone: boolean;
  game: GameState | null;
  profiles: PlayerProfile[];
  settings: Settings;
  updateSettings(settings: Settings): void;
  init(): Promise<void>;
  completeSetup(): void;
  startGame(config: GameConfig): void;
  endGame(): void;
  adjustLife(playerIdx: number, delta: number): void;
  applyCommanderDamage(defenderIdx: number, attackerProfileId: string, delta: number): void;
  passTurn(): void;
  addItem(playerIdx: number, item: BoardItem): void;
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

export function createAppStore() {
  return create<AppStore>()((set, get) => {
    const mutateGame = (fn: (g: GameState) => GameState) => {
      const game = get().game;
      if (!game) return;
      const next = fn(game);
      set({ game: next });
      persistGame(next);
    };

    return {
      setupDone: false,
      game: null,
      profiles: [],
      settings: DEFAULT_SETTINGS,

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
            if (isValidGame(saved)) {
              // Migrate saves from before the lands feature: items default to board.
              game = {
                ...saved,
                players: saved.players.map((p) => ({
                  ...p,
                  board: p.board.map((item) => ({ ...item, zone: item.zone ?? 'board' })),
                })),
              };
            } else await kvDelete('activeGame');
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
        set({ game });
        persistGame(game);
      },

      endGame() {
        set({ game: null });
        persistGame(null);
      },

      adjustLife(playerIdx, delta) {
        mutateGame((g) => gameLib.adjustLife(g, playerIdx, delta));
      },
      applyCommanderDamage(defenderIdx, attackerProfileId, delta) {
        mutateGame((g) => gameLib.applyCommanderDamage(g, defenderIdx, attackerProfileId, delta));
      },
      passTurn() {
        mutateGame((g) => gameLib.passTurn(g));
      },
      addItem(playerIdx, item) {
        mutateGame((g) => boardLib.addItem(g, playerIdx, item));
      },
      changeCount(playerIdx, itemId, delta) {
        mutateGame((g) => boardLib.changeCount(g, playerIdx, itemId, delta));
      },
      splitItem(playerIdx, itemId, moveCount) {
        mutateGame((g) => boardLib.splitItem(g, playerIdx, itemId, moveCount));
      },
      setCounter(playerIdx, itemId, counterName, value) {
        mutateGame((g) => boardLib.setCounter(g, playerIdx, itemId, counterName, value));
      },
      removeItem(playerIdx, itemId) {
        mutateGame((g) => boardLib.removeItem(g, playerIdx, itemId));
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
