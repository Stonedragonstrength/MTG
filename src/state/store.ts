import { create } from 'zustand';
import { pokeSync } from '../data/cloud';
import { getDb, kvDelete, kvGet, kvSet } from '../data/db';
import * as tableSync from '../data/onlineTable';
import type { SyncOpts, TableStatus } from '../data/onlineTable';
import * as cardsLib from '../lib/cards';
import { isValidGame, migrateGame } from '../lib/migrate';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from '../data/settings';
import * as boardLib from '../lib/board';
import * as gameLib from '../lib/game';
import * as payLib from '../lib/pay';
import { playDefeat, playLifeTick, playTurnChime } from '../lib/sound';
import type {
  BoardItem,
  CardRecord,
  CardZone,
  Deck,
  FeedEntry,
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
  // ---- cards mode ----
  seedSeatFromDeck(seat: number, deck: Deck, seed?: number): void;
  drawCards(seat: number, n: number): void;
  playCard(seat: number, iid: string): Promise<void>;
  tapVirtualCard(seat: number, iid: string, wantTapped?: boolean): void;
  setVirtualCounter(seat: number, iid: string, name: string, value: number): void;
  moveVirtualCard(
    seat: number,
    iid: string,
    from: CardZone,
    to: CardZone,
    opts?: { pos?: 'top' | 'bottom'; row?: 'front' | 'lands' },
  ): void;
  millCards(seat: number, n: number): void;
  shuffleSeat(seat: number): void;
  mulliganSeat(seat: number): void;
  keepHand(seat: number, bottomIids: string[]): void;
  castCommander(seat: number, iid?: string): void;
  commanderDiedAction(seat: number, iid: string): void;
  commanderReturned(seat: number, iid: string, from: 'graveyard' | 'exile'): void;
  peekNotice(seat: number): void;
  setHandHeld(seat: number, held: boolean): void;
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
  removedGarage(): Promise<GarageCard[]>;
  restoreGarage(cardId: string): Promise<void>;
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

type SeatRecords = Record<string, CardRecord | undefined>;

/** Card records for everything on a seat's battlefield, resolved through
 * the same id→name chain the UI uses. Card text is static, so this is the
 * one part of a payment that can safely be read before the op runs. */
async function seatRecords(g: GameState, seat: number): Promise<SeatRecords> {
  const m = await import('../data/scryfall');
  const records: SeatRecords = {};
  for (const c of g.players[seat]?.cards?.battlefield ?? []) {
    if (c.cardId in records) continue;
    const byId = await m.getCardById(c.cardId).catch(() => undefined);
    records[c.cardId] = byId ?? (await m.findCardByName(c.name).catch(() => undefined));
  }
  return records;
}

/** Pays for a cast against the state the op actually lands on — never a
 * tap list frozen earlier — so two casts fired together cannot spend the
 * same lands, and undo and rebase treat the card and its mana as one
 * move. A cast that arrives in a different turn from the one it was made
 * in (a rebase past a Pass turn) only moves the card: tapping that later
 * turn's lands for it would leave the player short for no reason. `base`
 * is the state BEFORE the card moves, so it cannot pay for itself. */
function payFrom(
  base: GameState,
  seat: number,
  costs: payLib.PayCost[],
  records: SeatRecords,
  castIn: { turn: number; active: number },
): (moved: GameState) => GameState {
  const sameTurn = base.turnNumber === castIn.turn && base.activePlayerIndex === castIn.active;
  const player = base.players[seat];
  const plan = sameTurn
    ? payLib.planAnyFace(
        costs,
        payLib.sourcesFrom(player?.cards?.battlefield ?? [], records, player?.board ?? []),
      )
    : null;
  return (moved) => {
    if (!plan) return moved; // nothing can pay it (or it was forced): tap nothing
    let next = moved;
    for (const [iid, units] of Object.entries(plan.spend))
      next = cardsLib.spendMana(next, seat, iid, units);
    for (const [itemId, copies] of Object.entries(plan.boardTaps))
      next = boardLib.tapItem(next, seat, itemId, copies);
    return next;
  };
}

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

    // Feed entries reach the local log exactly once, whether they were
    // authored here or arrived from a peer.
    const seenFeedIds = new Set<string>();
    const mergeFeedToLog = (g: GameState) => {
      const lines: string[] = [];
      for (const e of g.feed ?? []) {
        if (seenFeedIds.has(e.id)) continue;
        seenFeedIds.add(e.id);
        lines.push(e.text);
      }
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
      // Tripwire: the server refuses >512KB; refuse earlier and louder.
      if (next.config.mode === 'cards' && JSON.stringify(next).length > 400_000) {
        appendLog(['That change was too large to sync and was refused']);
        return;
      }
      history = [...history.slice(-(HISTORY_CAP - 1)), game];
      set({ game: next });
      persistGame(next);
      tableSync.onLocalMutation(fn, game, sync); // no-op without a session

      const described = describe?.(game, next);
      if (described) appendLog([described]);
      mergeFeedToLog(next);
      announceDefeats(game, next);
    };

    /** Card ops: feed line composed at act time, replay-safe, nap-proof. */
    const DAY_MS = 24 * 3600_000;
    const seatName = (g: GameState, seat: number) => g.config.profiles[seat]?.name ?? '?';
    const feedEntry = (text: string): FeedEntry => ({
      id: `f${cardsLib.newIid()}`,
      t: Date.now(),
      text,
    });
    const cardMutate = (
      reducer: (g: GameState) => GameState,
      feedText: string | null,
      guard?: SyncOpts['guard'],
      maxAgeMs: number = DAY_MS,
    ) => {
      const entry = feedText ? feedEntry(feedText) : null;
      const fn = (g: GameState) => {
        const after = reducer(g);
        if (after === g) return g;
        return entry ? cardsLib.appendFeed(after, entry) : after;
      };
      mutateGame(fn, undefined, { guard: guard ?? (() => true), maxAgeMs });
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
            mergeFeedToLog(g); // peers' card actions reach this device's log
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

      seedSeatFromDeck(seat, deck, seed = Math.floor(Math.random() * 2 ** 31)) {
        const g = get().game;
        if (!g) return;
        const cards = cardsLib.buildSeatCards(deck, seed);
        cardMutate(
          (base) => cardsLib.seedSeat(base, seat, cards),
          `${seatName(g, seat)} sits down with ${deck.name} (${cards.library.length + cards.hand.length} cards)`,
          (base) => !base.players[seat]?.cards, // a seated seat never reseeds
        );
      },

      drawCards(seat, n) {
        const g = get().game;
        const lib = g?.players[seat]?.cards?.library;
        if (!g || !lib || lib.length === 0) return;
        const iids = lib.slice(0, Math.min(n, lib.length)).map((c) => c.iid);
        const actor = seatName(g, get().online?.mySeat ?? seat);
        const owner = seatName(g, seat);
        const text =
          actor === owner
            ? `${owner} draws ${iids.length}`
            : `${actor} drew ${iids.length} for ${owner}`;
        cardMutate(
          (base) => cardsLib.draw(base, seat, iids),
          text,
          (base) => {
            const baseLib = base.players[seat]?.cards?.library;
            return !!baseLib && iids.every((i) => baseLib.some((c) => c.iid === i));
          },
        );
      },

      async playCard(seat, iid) {
        const g = get().game;
        const card = g?.players[seat]?.cards?.hand.find((c) => c.iid === iid);
        if (!g || !card) return;
        // Route by type: lands to the shelf, instants/sorceries straight to
        // the graveyard ("cast"), everything else to the front row. The id
        // chain matches useCardRecords: printing drift falls back to name.
        const record = await import('../data/scryfall').then(async (m) => {
          const byId = await m.getCardById(card.cardId).catch(() => undefined);
          if (byId) return byId;
          return m.findCardByName(card.name).catch(() => undefined);
        });
        const typeLine = record?.typeLine ?? '';
        const isLand = /Land/.test(typeLine);
        const row: 'front' | 'lands' = isLand ? 'lands' : 'front';
        const isSpell = /Instant|Sorcery/.test(typeLine) && !/Land|Creature/.test(typeLine);
        const verb = isSpell ? 'casts' : 'plays';
        // Auto-payment: the table pays the cost as the card lands. No plan
        // (cost-reducers, treasures, bare trust) = play, tap nothing.
        const costs = isLand ? [] : payLib.parseCosts(record?.manaCost ?? '');
        const records = await seatRecords(g, seat);
        const castIn = { turn: g.turnNumber, active: g.activePlayerIndex };
        cardMutate(
          (base) => {
            const pay = payFrom(base, seat, costs, records, castIn);
            const moved = isSpell
              ? cardsLib.moveCard(base, seat, iid, 'hand', 'graveyard')
              : cardsLib.moveCard(base, seat, iid, 'hand', 'battlefield', { row });
            return moved === base ? base : pay(moved);
          },
          `${seatName(g, seat)} ${verb} ${card.name}`,
          (base) => !!base.players[seat]?.cards?.hand.some((c) => c.iid === iid),
        );
      },

      tapVirtualCard(seat, iid, wantTapped) {
        const g = get().game;
        const card = g?.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
        if (!g || !card) return;
        const wasTapped = card.tapped ?? false;
        // A directed request ("use one land") against a card already there
        // is a stale render target, not a toggle — do nothing.
        if (wantTapped !== undefined && wantTapped === wasTapped) return;
        const desired = wantTapped ?? !wasTapped;
        cardMutate(
          (base) => cardsLib.tapCard(base, seat, iid, desired),
          null,
          // Replay only onto a base still in the observed pre-state: a
          // rebase can confirm a tap but never invert one.
          (base) => {
            const baseCard = base.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
            return !!baseCard && (baseCard.tapped ?? false) === wasTapped;
          },
        );
      },

      setVirtualCounter(seat, iid, name, value) {
        cardMutate(
          (base) => cardsLib.setCardCounter(base, seat, iid, name, value),
          null,
          (base) => !!base.players[seat]?.cards?.battlefield.some((c) => c.iid === iid),
        );
      },

      moveVirtualCard(seat, iid, from, to, opts) {
        const g = get().game;
        const card = g?.players[seat]?.cards?.[from].find((c) => c.iid === iid);
        if (!g || !card) return;
        const hiddenTo = to === 'library' || to === 'hand';
        const text = hiddenTo
          ? `${seatName(g, seat)} puts a card ${to === 'hand' ? 'in hand' : opts?.pos === 'bottom' ? 'on the bottom' : 'on top'}`
          : `${seatName(g, seat)}: ${card.name} → ${to}`;
        cardMutate(
          (base) => cardsLib.moveCard(base, seat, iid, from, to, opts),
          text,
          (base) => !!base.players[seat]?.cards?.[from].some((c) => c.iid === iid),
        );
      },

      millCards(seat, n) {
        const g = get().game;
        const lib = g?.players[seat]?.cards?.library;
        if (!g || !lib || lib.length === 0) return;
        const iids = lib.slice(0, Math.min(n, lib.length)).map((c) => c.iid);
        cardMutate(
          (base) => cardsLib.millN(base, seat, iids),
          `${seatName(g, seat)} mills ${iids.length}`,
          (base) => {
            const baseLib = base.players[seat]?.cards?.library;
            return !!baseLib && iids.every((i) => baseLib.some((c) => c.iid === i));
          },
        );
      },

      shuffleSeat(seat) {
        const g = get().game;
        if (!g) return;
        const seed = Math.floor(Math.random() * 2 ** 31);
        // A stale queued shuffle must not scramble a library someone has
        // since stacked — short age, dropping it costs nothing.
        cardMutate(
          (base) => cardsLib.shuffleLibrary(base, seat, seed),
          `${seatName(g, seat)} shuffles`,
          undefined,
          120_000,
        );
      },

      mulliganSeat(seat) {
        const g = get().game;
        const origMulls = g?.players[seat]?.cards?.mulligans;
        if (!g || origMulls === undefined) return;
        const seed = Math.floor(Math.random() * 2 ** 31);
        cardMutate(
          (base) => cardsLib.mulligan(base, seat, seed),
          `${seatName(g, seat)} mulligans`,
          // Once the base has counted this mulligan, a replay would scramble
          // a hand the player already saw — drop instead.
          (base) => base.players[seat]?.cards?.mulligans === origMulls,
        );
      },

      keepHand(seat, bottomIids) {
        const g = get().game;
        if (!g || g.players[seat]?.cards?.kept) return;
        cardMutate(
          (base) => cardsLib.keepHand(base, seat, bottomIids),
          bottomIids.length > 0
            ? `${seatName(g, seat)} keeps, bottoms ${bottomIids.length}`
            : `${seatName(g, seat)} keeps`,
          (base) => {
            const cards = base.players[seat]?.cards;
            return (
              !!cards &&
              !cards.kept &&
              bottomIids.every((i) => cards.hand.some((c) => c.iid === i))
            );
          },
        );
      },

      castCommander(seat, iid) {
        const g = get().game;
        const command = g?.players[seat]?.cards?.command ?? [];
        // A partner pair casts one at a time: the caller names which.
        const cmd = (iid && command.find((c) => c.iid === iid)) || command[0];
        if (!g || !cmd) return;
        const tax = cardsLib.commanderTax(g.players[seat], cmd.iid);
        void (async () => {
          // Same auto-payment as playCard, with the tax riding as generic.
          const record = await import('../data/scryfall').then(async (m) => {
            const byId = await m.getCardById(cmd.cardId).catch(() => undefined);
            if (byId) return byId;
            return m.findCardByName(cmd.name).catch(() => undefined);
          });
          // From the command zone it is the front face that is cast.
          const cost = payLib.parseCost(record?.manaCost ?? '');
          cost.generic += tax;
          const records = await seatRecords(g, seat);
          const castIn = { turn: g.turnNumber, active: g.activePlayerIndex };
          cardMutate(
            (base) => {
              const pay = payFrom(base, seat, [cost], records, castIn);
              const moved = cardsLib.moveCard(base, seat, cmd.iid, 'command', 'battlefield', {
                row: 'front',
              });
              return moved === base ? base : pay(moved);
            },
            `${seatName(g, seat)} casts ${cmd.name}${tax > 0 ? ` (tax +${tax})` : ''}`,
            (base) => !!base.players[seat]?.cards?.command.some((c) => c.iid === cmd.iid),
          );
        })();
      },

      commanderDiedAction(seat, iid) {
        const g = get().game;
        const card = g?.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
        if (!g || !card) return;
        cardMutate(
          (base) => cardsLib.commanderDied(base, seat, iid),
          `${card.name} returns to command (+2 tax next cast)`,
          (base) => !!base.players[seat]?.cards?.battlefield.some((c) => c.iid === iid),
        );
      },

      commanderReturned(seat, iid, from) {
        const g = get().game;
        const card = g?.players[seat]?.cards?.[from].find((c) => c.iid === iid);
        if (!g || !card) return;
        cardMutate(
          (base) => cardsLib.commanderDied(base, seat, iid, from),
          `${card.name} returns to the command zone (+2 tax next cast)`,
          (base) => !!base.players[seat]?.cards?.[from].some((c) => c.iid === iid),
        );
      },

      peekNotice(seat) {
        const g = get().game;
        if (!g) return;
        const actor = seatName(g, get().online?.mySeat ?? seat);
        cardMutate(
          (base) => ({ ...base }), // feed-only op: the entry is the payload
          `${actor} looked at ${seatName(g, seat)}'s hand`,
        );
      },

      setHandHeld(seat, held) {
        // A hint, not an announcement: no feed line, no guard needed —
        // the reducer no-ops when the flag already matches.
        cardMutate((base) => cardsLib.setHandHeld(base, seat, held), null);
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
            // The incoming player's untap step readies all their permanents —
            // token stacks and virtual cards alike.
            const readied = boardLib.untapAll(next, next.activePlayerIndex);
            return cardsLib.untapAllCards(readied, readied.activePlayerIndex);
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
          (g) => cardsLib.untapAllCards(boardLib.untapAll(g, playerIdx), playerIdx),
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
          // A removal keeps its count on the tombstone so Restore can
          // bring back exactly what was lost.
          count: count <= 0 ? Math.max(1, existing.count) : count,
          deleted: count <= 0,
          updatedAt: Date.now(),
          dirty: 1,
        });
        await get().refreshGarage();
        pokeSync(() => void get().refreshGarage());
      },

      async removedGarage() {
        const rows = await getDb().garage.toArray();
        return rows
          .filter((g) => g.deleted)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 20);
      },

      async restoreGarage(cardId) {
        const db = getDb();
        const existing = await db.garage.get(cardId);
        if (!existing?.deleted) return;
        await db.garage.put({
          ...existing,
          deleted: false,
          count: Math.max(1, existing.count),
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
