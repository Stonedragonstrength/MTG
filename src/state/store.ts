import { create } from 'zustand';
import { pokeOnResume, pokeSync } from '../data/cloud';
import { getDb, kvDelete, kvGet, kvSet } from '../data/db';
import { bare, type DeckRow, type ProfileRow, type Synced } from '../lib/sync';
import * as tableSync from '../data/onlineTable';
import type { SyncOpts, TableStatus } from '../data/onlineTable';
import * as cardsLib from '../lib/cards';
import * as combatLib from '../lib/combat';
import type { CombatOutcome } from '../lib/combat';
import { hasKeyword, readSeat, readUnit } from '../lib/combatEngine';
import { attackerLabel } from '../lib/commanders';
import { isValidGame, migrateGame } from '../lib/migrate';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from '../data/settings';
import * as boardLib from '../lib/board';
import * as gameLib from '../lib/game';
import * as payLib from '../lib/pay';
import { isLandCard } from '../lib/turnRules';
import { playDefeat, playLifeTick, playTurnChime } from '../lib/sound';
import type {
  BoardItem,
  CardRecord,
  CardZone,
  CombatUnit,
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

/** Seats drawn turned around on this device: seat index → true, others left out. */
export type SeatFlips = Record<number, true>;

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
  /** Both resolve to an error line or null. `stillWanted` is asked once the
   * table answers: false (the player backed out meanwhile) undoes it. */
  hostOnlineGame(config: GameConfig, stillWanted?: () => boolean): Promise<string | null>;
  /** Lands the table on this device WITHOUT entering it — see enterGame. */
  joinOnlineGame(code: string, stillWanted?: () => boolean): Promise<string | null>;
  leaveOnlineTable(): void;
  setMySeat(seat: number | null): void;
  /** "Flip this side": where people really sit at THIS screen. It is not part
   * of the game — never in GameState, never sent to the table. */
  seatFlips: SeatFlips;
  setSeatFlip(seat: number, flipped: boolean): void;
  // ---- cards mode ----
  seedSeatFromDeck(seat: number, deck: Deck, seed?: number): void;
  drawCards(seat: number, n: number): void;
  /** `x`: the value chosen for a card with {X} in its cost (the X sheet asks).
   * `asLand`: play the land on the card's back face instead of casting it. */
  playCard(seat: number, iid: string, opts?: { x?: number; asLand?: true }): Promise<void>;
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
  exileCards(seat: number, n: number): void;
  lookNotice(seat: number, n: number): void;
  arrangeTop(seat: number, looked: string[], plan: cardsLib.TopPlan): void;
  shuffleSeat(seat: number): void;
  mulliganSeat(seat: number): void;
  keepHand(seat: number, bottomIids: string[]): void;
  castCommander(seat: number, iid?: string, opts?: { x?: number }): void;
  commanderDiedAction(seat: number, iid: string): void;
  commanderReturned(seat: number, iid: string, from: 'graveyard' | 'exile'): void;
  peekNotice(seat: number): void;
  /** Shows cards to the whole table, by name. They stay where they are. */
  revealCards(seat: number, iids: string[], from: 'hand' | 'library'): void;
  setHandHeld(seat: number, held: boolean): void;
  // ---- combat on the cards (lib/combat.ts; read the fight with liveCombat) ----
  /** Opens a fight for the active seat. */
  startCombat(): void;
  /** Attackers step: `n` copies of `unit` attack `target` (a card: 1 or 0; 0 takes it back). */
  setAttacker(unit: CombatUnit, target: number, n: number): void;
  /** Several of those picks made by one press ("All attack"): one move, one Undo. */
  setAttackers(picks: { unit: CombatUnit; target: number; n: number }[]): void;
  /** Declares the attack: taps the attackers without vigilance, then the first defender is up. */
  confirmAttackers(): Promise<void>;
  /** Blockers step: `n` copies of the defender's `blocker` stand in `attacker`'s way (0 takes it back). */
  setBlocker(defender: number, attacker: CombatUnit, blocker: CombatUnit, n: number): void;
  /** The paper-blocker mark: `attacker` is stopped by something that is not on the tablet. */
  setAttackBlocked(defender: number, attacker: CombatUnit, blocked: boolean): void;
  /** That seat has finished blocking: the next defender is up, or damage. */
  finishBlocks(defender: number): void;
  /** Damage step: writes the outcome the table confirmed and ends the fight. */
  applyCombat(outcome: CombatOutcome): void;
  /** Calls the fight off: no damage, and what the declaration tapped stands back up. */
  cancelCombat(): void;
  /** A correction: how many times that commander has gone home (its tax ÷ 2). */
  setCommanderReturns(seat: number, iid: string, n: number): void;
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
  // Decks and players follow their owner to other devices (data/cloud.ts).
  // These four are where that bookkeeping lives: every save is stamped and
  // marked as waiting to go up, every delete leaves a tombstone. The lists
  // hold live rows only, without the bookkeeping.
  saveProfile(p: PlayerProfile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  decks: Deck[];
  saveDeck(deck: Deck): Promise<void>;
  deleteDeck(id: string): Promise<void>;
  /** The last few deleted decks, newest first: the "Recently deleted" shelf. */
  removedDecks(): Promise<Deck[]>;
  restoreDeck(id: string): Promise<void>;
  /** Reads decks, players and the Curation again from the database: a sync
   * writes there, not here. */
  refreshSynced(): Promise<void>;
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

function persistSeatFlips(flips: SeatFlips): void {
  pending = pending
    .then(() => (Object.keys(flips).length > 0 ? kvSet('seatFlips', flips) : kvDelete('seatFlips')))
    .catch((err) => console.error('Failed to persist seat flips', err));
}

/** The saved flips, as far as they can be trusted: seat numbers marked true. */
function readSeatFlips(saved: unknown): SeatFlips {
  const flips: SeatFlips = {};
  if (saved && typeof saved === 'object')
    for (const [seat, on] of Object.entries(saved))
      if (on === true && /^\d+$/.test(seat)) flips[Number(seat)] = true;
  return flips;
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

/** The turn an action was made in. A replay that lands in another one
 * (a rebase past a Pass turn) must not charge that later turn for it. */
interface TurnStamp {
  turn: number;
  active: number;
}
const isTurn = (g: GameState, at: TurnStamp) =>
  g.turnNumber === at.turn && g.activePlayerIndex === at.active;

/** The X a cast was made for: a whole number, never below zero. */
const wholeX = (x: number | undefined) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;

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
  castIn: TurnStamp,
): (moved: GameState) => GameState {
  const sameTurn = isTurn(base, castIn);
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

/** Replay guard for a draw or a mill: `iids` are the cards the acting
 * device saw on top, `known` the marks it knew the seat's library by.
 * As long as the library's mark is one of those, the cards are taken
 * wherever they now sit — "drew first" has to survive a shuffle. Any
 * other mark is a look that device had not heard of: then they are taken
 * only if they are still the top, so a tap aimed at a card that has
 * since been scried to the bottom does not dig it back out. */
function takeGuard(
  seat: number,
  iids: string[],
  known: (string | undefined)[],
): (base: GameState) => boolean {
  return (base) => {
    const cards = base.players[seat]?.cards;
    if (!cards || !iids.every((i) => cards.library.some((c) => c.iid === i))) return false;
    if (known.includes(cards.stacked)) return true;
    const top = cards.library.slice(0, iids.length);
    return iids.every((i) => top.some((c) => c.iid === i));
  };
}

// ---- decks and players that follow their owner (lib/sync.ts, data/cloud.ts) ----

/** The stamp for a save made now. Across devices the newest stamp wins, so
 * it is this device's clock — never the same reading twice, so that two
 * saves in one millisecond still have an order — and in any case newer than
 * the copy the save replaces: a tablet whose clock runs behind must not
 * lose its edit to the very copy it edited. */
let lastTick = 0;
function freshStamp(replaces?: { updatedAt?: number }): number {
  lastTick = Math.max(Date.now(), lastTick + 1);
  const replaced = replaces?.updatedAt;
  const floor = typeof replaced === 'number' && Number.isFinite(replaced) ? replaced + 1 : 0;
  return Math.max(lastTick, floor);
}

const newestFirst = (a: Deck, b: Deck) => b.updatedAt - a.updatedAt;

/** Stored rows as the app sees them: no tombstones, no bookkeeping. */
function liveContent<T>(rows: Synced<T>[]): T[] {
  return rows.filter((row) => !row.deleted).map((row) => bare<T>(row));
}

/** `fresh` in the order the screen already shows: rows that were listed
 * keep their places, arrivals go to the end. */
function keepPlaces<T extends { id: string }>(current: T[], fresh: T[]): T[] {
  const byId = new Map(fresh.map((row) => [row.id, row]));
  const listed = new Set(current.map((row) => row.id));
  return [
    ...current.flatMap((row) => byId.get(row.id) ?? []),
    ...fresh.filter((row) => !listed.has(row.id)),
  ];
}

/** The list a re-read leaves in the store: every row that is still what
 * the store holds stays the same object, and a re-read that changed
 * nothing hands back `current` itself — most syncs bring nothing new, and
 * must not redraw every screen. The stamp alone does not say "the same":
 * two devices can stamp two different edits alike (the cloud's then wins),
 * and a screen left showing the copy that lost would save it back over
 * the winner at the next tap. So a row with the same stamp is compared. */
function reread<T extends { id: string; updatedAt?: number }>(current: T[], fresh: T[]): T[] {
  const held = new Map(current.map((row) => [row.id, row]));
  const next = fresh.map((row) => {
    const mine = held.get(row.id);
    const same =
      !!mine && mine.updatedAt === row.updatedAt && JSON.stringify(mine) === JSON.stringify(row);
    return same ? mine : row;
  });
  return next.length === current.length && next.every((row, i) => row === current[i])
    ? current
    : next;
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

    // Which way a seat faces belongs to one sitting at this screen: a different
    // game, or the end of this one, puts every zone back where the layout draws it.
    const resetSeatFlips = () => {
      if (Object.keys(get().seatFlips).length > 0) set({ seatFlips: {} });
      persistSeatFlips({});
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

    // A look made on this device is not news to it: when the table calls
    // one off (someone shuffled first), the draw made after it has to
    // stand all the same. So each mark minted here remembers the marks
    // this device already knew that library by, and a draw carries them all.
    const ownLooks = new Map<string | undefined, (string | undefined)[]>();
    const knownMarks = (stacked: string | undefined) => ownLooks.get(stacked) ?? [stacked];

    return {
      setupDone: false,
      game: null,
      inGame: false,
      profiles: [],
      decks: [],
      garage: [],
      online: null,
      seatFlips: {},
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
        const profiles = liveContent(await getDb().profiles.toArray());
        const decks = liveContent(await getDb().decks.toArray()).sort(newestFirst);
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
        // A reload keeps the table as it was turned. Only a look: it never stops the app starting.
        set({ seatFlips: readSeatFlips(await kvGet('seatFlips').catch(() => undefined)) });
        pokeSync(() => void get().refreshSynced());
        // The tablet's app is rarely launched: it is brought back to the front.
        pokeOnResume(() => void get().refreshSynced());

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
        resetSeatFlips();
        set({ game, inGame: true, log: [{ t: Date.now(), text: 'Game started' }] });
        persistGame(game);
      },

      enterGame() {
        if (get().game) set({ inGame: true });
      },

      exitToHome() {
        set({ inGame: false }); // the game stays saved; home offers Pick up
      },

      async hostOnlineGame(config, stillWanted = () => true) {
        const game = gameLib.createGame(config);
        const r = await tableSync.hostTable(game);
        if ('error' in r) return r.error;
        if (!stillWanted()) {
          // They backed out while it was being set up: close the table we
          // just made rather than dropping them into a game they left.
          await tableSync.endTableForEveryone();
          return null;
        }
        history = [];
        resetSeatFlips();
        set({
          game,
          inGame: true,
          online: { code: r.code, status: { kind: 'connecting' }, mySeat: null },
          log: [{ t: Date.now(), text: `Online table ${r.code}` }],
        });
        persistGame(game);
        return null;
      },

      async joinOnlineGame(code, stillWanted = () => true) {
        const r = await tableSync.joinTable(code);
        if ('error' in r) return r.error;
        if (!stillWanted()) {
          await tableSync.leaveTable(); // backed out mid-join: the saved game stays
          return null;
        }
        const game = migrateGame(r.state);
        history = [];
        resetSeatFlips();
        // Not entered yet: the join sheet still asks for a seat (and a deck),
        // and it lives on the home screen. It enters the game when it is done.
        set({
          game,
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

      setSeatFlip(seat, flipped) {
        const flips = get().seatFlips;
        if ((flips[seat] === true) === flipped) return;
        const next = { ...flips };
        if (flipped) next[seat] = true;
        else delete next[seat]; // left out rather than written as false
        set({ seatFlips: next });
        persistSeatFlips(next);
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
          takeGuard(seat, iids, knownMarks(g.players[seat]?.cards?.stacked)),
        );
      },

      async playCard(seat, iid, opts) {
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
        // The front face says what a tap plays: a spell with a land on its
        // back (Growing Rites of Itlimoc, Valakut Awakening) is cast, paid
        // for and uses no land drop — unless the hold asked for the land.
        const isLand = opts?.asLand === true || isLandCard(typeLine);
        const row: 'front' | 'lands' = isLand ? 'lands' : 'front';
        const isSpell = !isLand && /Instant|Sorcery/.test(typeLine) && !/Creature/.test(typeLine);
        const verb = isSpell ? 'casts' : 'plays';
        // Auto-payment: the table pays the cost as the card lands. No plan
        // (cost-reducers, treasures, bare trust) = play, tap nothing.
        const costs = isLand ? [] : payLib.castCosts(record, 'hand'); // a land has none
        // A card with {X} is paid for the X it was cast for (zero when no
        // one asked), and its feed line says which.
        const asksX = payLib.hasX(costs);
        const x = asksX ? wholeX(opts?.x) : 0;
        const priced = payLib.priceX(costs, x);
        const counters = !isSpell && x > 0 && payLib.entersWithX(record?.oracleText ?? '');
        const records = await seatRecords(g, seat);
        const castIn = { turn: g.turnNumber, active: g.activePlayerIndex };
        cardMutate(
          (base) => {
            const pay = payFrom(base, seat, priced, records, castIn);
            let moved = isSpell
              ? cardsLib.moveCard(base, seat, iid, 'hand', 'graveyard')
              : cardsLib.moveCard(base, seat, iid, 'hand', 'battlefield', { row });
            if (moved === base) return base;
            // The land drop is counted in the same op as the move, so undo
            // and a rebase take both or neither — and only for the turn it
            // was made in: arriving a round late, it is not this turn's land.
            if (isLand && isTurn(base, castIn)) moved = cardsLib.countLandPlay(moved, seat);
            // "Enters with X +1/+1 counters on it": X belongs to the cast,
            // so the counters arrive even where the mana no longer does.
            if (counters) moved = cardsLib.setCardCounter(moved, seat, iid, 'p1p1', x);
            return pay(moved);
          },
          `${seatName(g, seat)} ${verb} ${card.name}${asksX ? ` (X=${x})` : ''}`,
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
          takeGuard(seat, iids, knownMarks(g.players[seat]?.cards?.stacked)),
        );
      },

      exileCards(seat, n) {
        const g = get().game;
        const lib = g?.players[seat]?.cards?.library;
        if (!g || !lib || lib.length === 0) return;
        const iids = lib.slice(0, Math.min(n, lib.length)).map((c) => c.iid);
        cardMutate(
          (base) => cardsLib.exileN(base, seat, iids),
          `${seatName(g, seat)} exiles the top ${iids.length}`,
          takeGuard(seat, iids, knownMarks(g.players[seat]?.cards?.stacked)),
        );
      },

      lookNotice(seat, n) {
        const g = get().game;
        if (!g) return;
        // Looking is a game action the table gets to know about, even if
        // the looker then changes nothing.
        cardMutate(
          (base) => ({ ...base }), // feed-only op: the entry is the payload
          `${seatName(g, seat)} looks at the top ${n} of their library`,
        );
      },

      arrangeTop(seat, looked, plan) {
        const g = get().game;
        if (!g) return;
        // Counts only: where the cards went is public, which ones is not.
        const parts = [
          plan.top.length > 0 && `${plan.top.length} back on top`,
          plan.bottom.length > 0 && `${plan.bottom.length} on the bottom`,
          plan.graveyard.length > 0 && `${plan.graveyard.length} in the graveyard`,
          plan.hand.length > 0 && `${plan.hand.length} in hand`,
          !!plan.exile?.length && `${plan.exile.length} exiled`,
        ].filter(Boolean);
        if (parts.length === 0) return;
        const mark = cardsLib.newIid(); // minted at act time: a replay leaves the same mark
        ownLooks.set(mark, [mark, ...knownMarks(g.players[seat]?.cards?.stacked)]);
        cardMutate(
          (base) => cardsLib.arrangeTop(base, seat, looked, plan, mark),
          `${seatName(g, seat)} puts ${parts.join(', ')}`,
          (base) => {
            const top = base.players[seat]?.cards?.library.slice(0, looked.length);
            return !!top && looked.every((i) => top.some((c) => c.iid === i));
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

      castCommander(seat, iid, opts) {
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
          const costs = payLib.castCosts(record, 'command', tax);
          const asksX = payLib.hasX(costs);
          const x = asksX ? wholeX(opts?.x) : 0;
          const priced = payLib.priceX(costs, x);
          const counters = x > 0 && payLib.entersWithX(record?.oracleText ?? '');
          const records = await seatRecords(g, seat);
          const castIn = { turn: g.turnNumber, active: g.activePlayerIndex };
          cardMutate(
            (base) => {
              const pay = payFrom(base, seat, priced, records, castIn);
              let moved = cardsLib.moveCard(base, seat, cmd.iid, 'command', 'battlefield', {
                row: 'front',
              });
              if (moved === base) return base;
              if (counters) moved = cardsLib.setCardCounter(moved, seat, cmd.iid, 'p1p1', x);
              return pay(moved);
            },
            `${seatName(g, seat)} casts ${cmd.name}${tax > 0 ? ` (tax +${tax})` : ''}${asksX ? ` (X=${x})` : ''}`,
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

      revealCards(seat, iids, from) {
        const g = get().game;
        const zone = g?.players[seat]?.cards?.[from];
        if (!g || !zone || iids.length === 0) return;
        const shown = iids.flatMap((iid) => zone.find((c) => c.iid === iid) ?? []);
        if (shown.length !== iids.length) return; // only what is really there can be shown
        // "The top of the library" is a block that starts at its top card:
        // this many cards down is as deep as the revealed ones sat.
        const depth = Math.max(...shown.map((c) => zone.indexOf(c))) + 1;
        const stillThere = (base: GameState) => {
          const cards = base.players[seat]?.cards;
          if (!cards) return false;
          const where = from === 'hand' ? cards.hand : cards.library.slice(0, depth);
          return iids.every((i) => where.some((c) => c.iid === i));
        };
        const reveal = {
          id: `r${cardsLib.newIid()}`, // minted at act time: a replay is the same reveal
          seat,
          from,
          cards: shown.map((c) => ({ cardId: c.cardId, name: c.name })),
          t: Date.now(),
        };
        // A reveal is public by definition: unlike a look, the line names the cards.
        // Nothing moved, so one that cannot reach the table while it is still
        // news is dropped: replayed late it would only push a newer reveal off.
        cardMutate(
          (base) => (stillThere(base) ? cardsLib.setReveal(base, reveal) : base),
          `${seatName(g, seat)} reveals ${shown.map((c) => c.name).join(', ')} from ${
            from === 'hand' ? 'their hand' : 'the top of their library'
          }`,
          stillThere,
          cardsLib.REVEAL_FRESH_MS,
        );
      },

      setHandHeld(seat, held) {
        // A hint, not an announcement: no feed line, no guard needed —
        // the reducer no-ops when the flag already matches.
        cardMutate((base) => cardsLib.setHandHeld(base, seat, held), null);
      },

      // ---- combat on the cards ----
      // The fight is shared table state (lib/combat.ts). Every action names
      // the fight it was pressed in, and every guard compares the table
      // with the state the press was made on (`orig`) — "same id, expected
      // step" is not enough: Undo brings an id back, so a napping phone's
      // Done could land on a different attack than the one it saw.

      startCombat() {
        const g = get().game;
        if (!g) return;
        // Minted at press time, like a look's mark: a replay starts this
        // very fight, in the turn it was meant for, or nothing.
        const stamp = { id: cardsLib.newIid(), turn: g.turnNumber, active: g.activePlayerIndex };
        cardMutate(
          (base) => combatLib.startCombat(base, stamp),
          null,
          // The table's combat record must still be the one this device
          // saw: a start replayed after its own fight finished meets the
          // 'done' marker and is dropped.
          (base, orig) => isTurn(base, stamp) && combatLib.sameRecord(base, orig),
        );
      },

      setAttacker(unit, target, n) {
        const g = get().game;
        const fight = g && combatLib.liveCombat(g);
        if (!fight) return;
        cardMutate(
          (base) => combatLib.setAttack(base, fight.id, unit, target, n),
          null,
          combatLib.sameStep,
        );
      },

      setAttackers(picks) {
        const g = get().game;
        const fight = g && combatLib.liveCombat(g);
        if (!fight || picks.length === 0) return;
        // One op for the whole press, so one Undo takes "All attack" back.
        // Each pick is judged by the reducer on the table it lands on.
        cardMutate(
          (base) =>
            picks.reduce((s, p) => combatLib.setAttack(s, fight.id, p.unit, p.target, p.n), base),
          null,
          combatLib.sameStep,
        );
      },

      async confirmAttackers() {
        const seen = get().game;
        const opened = seen && combatLib.liveCombat(seen);
        if (!seen || !opened || opened.step !== 'attackers') return;
        // Vigilance is on the cards: read them first, like playCard does.
        const records = await seatRecords(seen, opened.active);
        const g = get().game;
        const fight = g && combatLib.liveCombat(g);
        if (!g || !fight || fight.id !== opened.id || fight.step !== 'attackers') return;
        const attacks = fight.attacks ?? [];
        const seat = readSeat(g, fight.active, records);
        const taps: combatLib.AttackTaps = { cards: [], stacks: {} };
        for (const a of attacks) {
          // What cannot be read is tapped like any attacker: standing a
          // creature back up by hand is one tap, a missed tap is a free block.
          const read = readUnit(g, fight.active, a.unit, records, seat);
          if (!read || hasKeyword(read, 'vigilance')) continue;
          if (a.unit.kind === 'card') taps.cards.push(a.unit.id);
          else taps.stacks[a.unit.id] = (taps.stacks[a.unit.id] ?? 0) + combatLib.copiesOf(a);
        }
        cardMutate(
          (base) => combatLib.confirmAttackers(base, fight.id, taps),
          attacks.length > 0 ? combatLib.attackLine(g, fight) : null, // nobody attacks: it just ends
          combatLib.sameAttacks, // the declaration this device confirmed, not one changed since
        );
      },

      setBlocker(defender, attacker, blocker, n) {
        const g = get().game;
        const fight = g && combatLib.liveCombat(g);
        if (!fight) return;
        cardMutate(
          (base) => combatLib.setBlock(base, fight.id, defender, attacker, blocker, n),
          null,
          (base, orig) => combatLib.sameAttacks(base, orig) && combatLib.sameDefender(base, orig),
        );
      },

      setAttackBlocked(defender, attacker, blocked) {
        const g = get().game;
        const fight = g && combatLib.liveCombat(g);
        if (!fight) return;
        cardMutate(
          (base) => combatLib.setBlocked(base, fight.id, defender, attacker, blocked),
          null,
          (base, orig) => combatLib.sameAttacks(base, orig) && combatLib.sameDefender(base, orig),
        );
      },

      finishBlocks(defender) {
        const g = get().game;
        const fight = g && combatLib.liveCombat(g);
        if (!g || !fight) return;
        cardMutate(
          (base) => combatLib.finishBlocks(base, fight.id, defender),
          combatLib.blockLine(g, fight, defender),
          // Two devices pressing Done for the same player: the second one
          // meets a table where somebody else is up, and is dropped.
          (base, orig) => combatLib.sameAttacks(base, orig) && combatLib.sameDefender(base, orig),
        );
      },

      applyCombat(outcome) {
        const g = get().game;
        const fight = g && combatLib.liveCombat(g);
        if (!g || !fight) return;
        cardMutate(
          (base) => combatLib.applyCombat(base, fight.id, outcome),
          combatLib.outcomeLine(g, outcome),
          // The result was worked out from these attacks and these blocks:
          // if either changed since, it is the result of another fight.
          (base, orig) => combatLib.sameAttacks(base, orig) && combatLib.sameBlocks(base, orig),
        );
      },

      cancelCombat() {
        const g = get().game;
        const fight = g && combatLib.liveCombat(g);
        if (!g || !fight) return;
        cardMutate(
          (base) => combatLib.cancelCombat(base, fight.id),
          // Before the attack is confirmed nobody else has acted on it: silent.
          fight.step === 'attackers' ? null : `${seatName(g, fight.active)} calls off the attack`,
          combatLib.sameAttacks, // the same fight, at the step it was called off in
        );
      },

      setCommanderReturns(seat, iid, n) {
        const g = get().game;
        const cards = g?.players[seat]?.cards;
        const before = cards?.cmd?.[iid];
        if (!g || !cards || before === undefined || !Number.isFinite(n)) return;
        const zones = [cards.command, cards.battlefield, cards.graveyard, cards.exile, cards.hand, cards.library];
        const name = zones.flat().find((c) => c.iid === iid)?.name ?? 'Commander';
        const returns = Math.max(0, Math.floor(n));
        cardMutate(
          (base) => cardsLib.setCommanderReturns(base, seat, iid, returns),
          `${seatName(g, seat)}: ${name} has gone home ${returns === 1 ? 'once' : `${returns} times`} (tax +${returns * 2})`,
          // A correction of the count this device saw: if the commander
          // has gone home again since, it no longer stands.
          (base) => base.players[seat]?.cards?.cmd?.[iid] === before,
        );
      },

      endGame() {
        // Online: ending on any device ends it for everyone (shared-tablet model).
        if (get().online) {
          void tableSync.endTableForEveryone();
          set({ online: null });
        }
        history = [];
        resetSeatFlips();
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
            // The key is a commander, not always a player: a partner pair has two.
            const dmg = next.players[defenderIdx].commanderDamage[attackerProfileId] ?? 0;
            return `${playerName(prev, defenderIdx)}: ${dmg} cmdr dmg from ${attackerLabel(prev, attackerProfileId)} (life ${next.players[defenderIdx].life})`;
          },
        );
      },

      passTurn() {
        if (get().settings.soundOn) playTurnChime();
        mutateGame(
          (g) => {
            const next = gameLib.passTurn(g);
            const incoming = next.activePlayerIndex;
            // The incoming player's untap step readies all their permanents —
            // token stacks and virtual cards alike.
            const untapped = cardsLib.untapAllCards(boardLib.untapAll(next, incoming), incoming);
            // Their turn begins: what arrived since their last one is no
            // longer summoning sick. Only theirs — and only here, never on
            // the untap button.
            const readied = boardLib.readyItems(cardsLib.readyCards(untapped, incoming), incoming);
            // The turn is over, and so is whatever fight there was in it.
            return combatLib.dropCombat(readied);
          },
          (_prev, next) => `Turn ${next.turnNumber}: ${playerName(next, next.activePlayerIndex)}`,
          {
            // Online: if someone else already passed, don't double-advance.
            // And the fight on the table must be the one this device saw
            // (or none on both sides): a phone that had not heard of the
            // combat must not erase it with a Pass turn.
            guard: (base, orig) =>
              base.activePlayerIndex === orig.activePlayerIndex &&
              base.turnNumber === orig.turnNumber &&
              combatLib.sameLiveCombat(base, orig),
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
        const db = getDb();
        // Stamped on EVERY save, whatever came in: the stamp decides which
        // device's copy wins, and an old one would lose to the other device.
        const row: ProfileRow = {
          ...bare(p),
          updatedAt: freshStamp(await db.profiles.get(p.id)),
          dirty: 1,
        };
        await db.profiles.put(row);
        const saved = bare(row);
        set({ profiles: [...get().profiles.filter((x) => x.id !== saved.id), saved] });
        pokeSync(() => void get().refreshSynced());
      },

      async deleteProfile(id) {
        const db = getDb();
        const row = await db.profiles.get(id);
        // A tombstone, not a hole: the other devices have to hear of it.
        const gone = !!row && !row.deleted;
        if (gone)
          await db.profiles.put({ ...row, deleted: true, updatedAt: freshStamp(row), dirty: 1 });
        if (get().profiles.some((x) => x.id === id))
          set({ profiles: get().profiles.filter((x) => x.id !== id) });
        if (gone) pokeSync(() => void get().refreshSynced());
      },

      async saveDeck(deck) {
        const db = getDb();
        // Stamped on EVERY save: a rename or the "I own these" switch never
        // went through touched(), and a stale stamp loses to the other device.
        const row: DeckRow = {
          ...bare(deck),
          updatedAt: freshStamp(await db.decks.get(deck.id)),
          dirty: 1,
        };
        await db.decks.put(row);
        const saved = bare(row);
        set({ decks: [saved, ...get().decks.filter((d) => d.id !== saved.id)].sort(newestFirst) });
        pokeSync(() => void get().refreshSynced());
      },

      async deleteDeck(id) {
        const db = getDb();
        const row = await db.decks.get(id);
        // A tombstone, not a hole: the deletion travels to every device, and
        // the row keeps the whole deck so that it can be brought back —
        // and how old that list is, for a device that holds a newer one.
        const gone = !!row && !row.deleted;
        if (gone)
          await db.decks.put({
            ...row,
            deleted: true,
            contentAt: row.updatedAt,
            updatedAt: freshStamp(row),
            dirty: 1,
          });
        if (get().decks.some((d) => d.id === id))
          set({ decks: get().decks.filter((d) => d.id !== id) });
        if (gone) pokeSync(() => void get().refreshSynced());
      },

      async removedDecks() {
        const rows = await getDb().decks.toArray();
        return rows
          .filter((d) => d.deleted)
          .sort(newestFirst)
          .slice(0, 6)
          .map((d) => bare<Deck>(d));
      },

      async restoreDeck(id) {
        const row = await getDb().decks.get(id);
        // A restore is a save: its fresh stamp outranks the tombstone on
        // every device.
        if (row?.deleted) await get().saveDeck(bare<Deck>(row));
      },

      async refreshSynced() {
        const db = getDb();
        // One read of both tables, and the lists are set in the same breath
        // (no await in between). The database runs a save's write after this
        // read or this read after the save's write, never in the middle — so
        // a save made while a sync was finishing cannot be set back by a
        // list that was read just before it.
        const [deckRows, profileRows] = await db.transaction('r', db.decks, db.profiles, () =>
          Promise.all([db.decks.toArray(), db.profiles.toArray()]),
        );
        const was = get();
        const decks = reread(was.decks, liveContent(deckRows).sort(newestFirst));
        const profiles = reread(was.profiles, keepPlaces(was.profiles, liveContent(profileRows)));
        if (decks !== was.decks || profiles !== was.profiles) set({ decks, profiles });
        await get().refreshGarage();
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
        pokeSync(() => void get().refreshSynced());
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
        pokeSync(() => void get().refreshSynced());
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
        pokeSync(() => void get().refreshSynced());
      },
    };
  });
}

export const useAppStore = createAppStore();
