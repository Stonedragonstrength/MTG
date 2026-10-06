import { create } from 'zustand';
import { pokeSync } from '../data/cloud';
import { getDb, kvDelete, kvGet, kvSet } from '../data/db';
import * as tableSync from '../data/onlineTable';
import type { SyncOpts, TableStatus } from '../data/onlineTable';
import { isValidGame, migrateGame } from '../lib/migrate';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from '../data/settings';
import * as boardLib from '../lib/board';
import * as gameLib from '../lib/game';
import { playDefeat, playLifeTick, playTurnChime } from '../lib/sound';
import type {
  BoardItem,
  CardRecord,
  Deck,
  GameConfig,
  GameState,
  GarageCard,
  PlayerProfile,
} from '../lib/types';

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
  exitToHome(): void;
  endGame(): void;
  online: { code: string; status: TableStatus; mySeat: number | null } | null;
  hostOnlineGame(config: GameConfig): Promise<string | null>; // error line or null
  joinOnlineGame(code: string): Promise<string | null>;
  leaveOnlineTable(): void;
  setMySeat(seat: number | null): void;
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
  setManaMode(playerIdx: number, itemId: string, mode: BoardItem['manaMode']): void;
  removeItem(playerIdx: number, itemId: string): void;
  saveProfile(p: PlayerProfile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  decks: Deck[];
  saveDeck(deck: Deck): Promise<void>;
  deleteDeck(id: string): Promise<void>;
  garage: GarageCard[]; // live (non-tombstoned) collection, name-sorted
  addToGarage(
    card: Pick<CardRecord, 'id' | 'name' | 'typeLine' | 'imageNormal'>,
    delta?: number,
  ): Promise<void>;
  setGarageCount(cardId: string, count: number): Promise<void>;
  refreshGarage(): Promise<void>;
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

// isValidGame/migrateGame moved to src/lib/migrate.ts — shared with the
// online-table sync, which must heal states sent by older builds too.

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

    // Remote eliminations must announce exactly like local ones.
    const announceDefeats = (prev: GameState, next: GameState) => {
      const lines: string[] = [];
      next.players.forEach((p, i) => {
        if (p.eliminated && !prev.players[i]?.eliminated) {
          lines.push(`${playerName(next, i)} is defeated`);
          if (get().settings.soundOn) playDefeat();
        }
      });
      appendLog(lines);
    };

    const mutateGame = (
      fn: (g: GameState) => GameState,
      describe?: (prev: GameState, next: GameState) => string | null,
      sync?: SyncOpts,
    ) => {
      const game = get().game;
      if (!game) return;
      if (get().online?.status.kind === 'stale-build') return; // refresh first
      const next = fn(game);
      if (next === game) return;
      history = [...history.slice(-(HISTORY_CAP - 1)), game];
      set({ game: next });
      persistGame(next);
      tableSync.onLocalMutation(fn, game, sync); // no-op without a session

      const described = describe?.(game, next);
      if (described) appendLog([described]);
      announceDefeats(game, next);
    };

    return {
      setupDone: false,
      game: null,
      inGame: false,
      profiles: [],
      decks: [],
      garage: [],
      online: null,
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
        const decks = (await getDb().decks.toArray()).sort((a, b) => b.updatedAt - a.updatedAt);
        const garage = (await getDb().garage.toArray())
          .filter((g) => !g.deleted)
          .sort((a, b) => a.name.localeCompare(b.name));
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
        set({ setupDone: imported !== undefined, profiles, decks, garage, game, settings });
        pokeSync(() => void get().refreshGarage());

        tableSync.bindTable({
          getGame: () => get().game,
          applyRemote: (state) => {
            if (!isValidGame(state)) {
              console.error('Ignoring malformed remote state');
              return;
            }
            const prev = get().game;
            const g = migrateGame(state);
            history = []; // undo never crosses a remote write
            set({ game: g });
            persistGame(g);
            if (prev) announceDefeats(prev, g);
          },
          onEnded: () => {
            set({ online: null });
            appendLog(['Online table closed — game kept on this device']);
          },
          setStatus: (status) => {
            const o = get().online;
            if (o) set({ online: { ...o, status } });
          },
          notice: (text) => appendLog([text]),
        });
        const resumed = await tableSync.resumeTable();
        if (resumed) {
          history = [];
          const g = migrateGame(resumed.state);
          set({
            game: g,
            online: {
              code: resumed.code,
              status: { kind: 'connecting' },
              mySeat: resumed.mySeat,
            },
          });
          persistGame(g);
        }
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

      exitToHome() {
        set({ inGame: false }); // the game stays saved; home offers Pick up
      },

      async hostOnlineGame(config) {
        const game = gameLib.createGame(config);
        const r = await tableSync.hostTable(game);
        if ('error' in r) return r.error;
        history = [];
        set({
          game,
          inGame: true,
          online: { code: r.code, status: { kind: 'connecting' }, mySeat: null },
          log: [{ t: Date.now(), text: `Online table ${r.code}` }],
        });
        persistGame(game);
        return null;
      },

      async joinOnlineGame(code) {
        const r = await tableSync.joinTable(code);
        if ('error' in r) return r.error;
        const game = migrateGame(r.state);
        history = [];
        set({
          game,
          inGame: true,
          online: { code: code.toUpperCase().trim(), status: { kind: 'connecting' }, mySeat: null },
          log: [{ t: Date.now(), text: `Joined table ${code.toUpperCase().trim()}` }],
        });
        persistGame(game);
        return null;
      },

      leaveOnlineTable() {
        void tableSync.leaveTable();
        set({ online: null });
      },

      setMySeat(seat) {
        tableSync.setMySeat(seat);
        const o = get().online;
        if (o) set({ online: { ...o, mySeat: seat } });
      },

      endGame() {
        // Online: ending on any device ends it for everyone (shared-tablet model).
        if (get().online) {
          void tableSync.endTableForEveryone();
          set({ online: null });
        }
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
        tableSync.onLocalUndo(prev); // exact-base push; dropped on conflict
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
          {
            // Online: if someone else already passed, don't double-advance.
            guard: (base, orig) =>
              base.activePlayerIndex === orig.activePlayerIndex &&
              base.turnNumber === orig.turnNumber,
          },
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
          { guard: (base, orig) => base.monarchIdx === orig.monarchIdx },
        );
      },

      claimInitiative(playerIdx) {
        mutateGame(
          (g) => gameLib.claimInitiative(g, playerIdx),
          (prev, next) =>
            next.initiativeIdx === null
              ? 'The initiative is released'
              : `${playerName(prev, playerIdx)} takes the initiative`,
          { guard: (base, orig) => base.initiativeIdx === orig.initiativeIdx },
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

      setManaMode(playerIdx, itemId, mode) {
        mutateGame(
          (g) => boardLib.setManaMode(g, playerIdx, itemId, mode),
          (prev) => {
            const item = prev.players[playerIdx].board.find((it) => it.id === itemId);
            if (!item) return null;
            const what =
              !mode || mode === 'none' ? 'stops making mana' : `taps for ${mode === 'any' ? 'any color' : `{${mode}}`}`;
            return `${playerName(prev, playerIdx)}: ${item.name} ${what}`;
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

      async saveDeck(deck) {
        await getDb().decks.put(deck);
        const others = get().decks.filter((d) => d.id !== deck.id);
        set({ decks: [deck, ...others].sort((a, b) => b.updatedAt - a.updatedAt) });
      },

      async deleteDeck(id) {
        await getDb().decks.delete(id);
        set({ decks: get().decks.filter((d) => d.id !== id) });
      },

      async refreshGarage() {
        const garage = (await getDb().garage.toArray())
          .filter((g) => !g.deleted)
          .sort((a, b) => a.name.localeCompare(b.name));
        set({ garage });
      },

      async addToGarage(card, delta = 1) {
        const db = getDb();
        const existing = await db.garage.get(card.id);
        const row: GarageCard = {
          cardId: card.id,
          name: card.name,
          typeLine: card.typeLine,
          imageNormal: card.imageNormal,
          count: Math.max(1, (existing && !existing.deleted ? existing.count : 0) + delta),
          updatedAt: Date.now(),
          deleted: false,
          dirty: 1,
        };
        await db.garage.put(row);
        await get().refreshGarage();
        pokeSync(() => void get().refreshGarage());
      },

      async setGarageCount(cardId, count) {
        const db = getDb();
        const existing = await db.garage.get(cardId);
        if (!existing) return;
        await db.garage.put({
          ...existing,
          count: Math.max(0, count),
          deleted: count <= 0,
          updatedAt: Date.now(),
          dirty: 1,
        });
        await get().refreshGarage();
        pokeSync(() => void get().refreshGarage());
      },
    };
  });
}

export const useAppStore = createAppStore();
