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
import { hostName, hostOf } from '../lib/attach';
import { opponentsOf, tappedToAttack } from '../lib/attackDraft';
import * as boardLib from '../lib/board';
import { abilitiesOf, abilityBlocked } from '../lib/abilities';
import { boostCard, boostWords } from '../lib/boost';
import { equipHost, equipWay } from '../lib/equip';
import { backView, faceNames, frontId, isBackId, turnsOver } from '../lib/faces';
import * as gameLib from '../lib/game';
import * as payLib from '../lib/pay';
import * as payWithLib from '../lib/payWith';
import { planEffect, type SpellEffect } from '../lib/spellEffects';
import { happeningsBetween, unitThing, type Happening } from '../lib/triggers';
import { isLandCard } from '../lib/turnRules';
import { playDefeat, playLifeTick, playTurnChime } from '../lib/sound';
import type {
  BoardItem,
  CardInstance,
  CardRecord,
  CardZone,
  CombatAttack,
  CombatUnit,
  Deck,
  FeedEntry,
  GameConfig,
  GameState,
  GarageCard,
  PlayerProfile,
  Reveal,
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
  /** What the last move made ON THIS DEVICE did that cards may be waiting
   * for (not an Undo, not another device's move): something entered or
   * died, an attack, a cast, a turn passed. The cards that trigger by
   * themselves are set off from it (components/useTriggers.ts). It is not
   * part of the game — never saved, never sent to the table. */
  happened: { id: number; events: Happening[] } | null;
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
  /** `extra`: a card's effect draws, not the draw step — the turn's
   * draw is still owed ("has drawn this turn" is not stamped). */
  drawCards(seat: number, n: number, opts?: { extra?: boolean }): void;
  /** `x`: the value chosen for a card with {X} in its cost (the X sheet asks).
   * `asLand`: play the land on the card's back face instead of casting it. */
  /** `extras`: how often each optional extra cost of the card is paid, in
   * the order `pay.extraCosts` reads them (kicker, multikicker, buyback…). */
  /** `using`: the mana sources the player chose to pay with ("Pay with…"),
   * source key → how many (lib/payWith.ts). Left out, the table chooses. */
  playCard(
    seat: number,
    iid: string,
    opts?: { x?: number; asLand?: true; extras?: number[]; using?: Record<string, number> },
  ): Promise<void>;
  tapVirtualCard(seat: number, iid: string, wantTapped?: boolean): void;
  /** Turns a double-faced card on the battlefield over, onto whichever
   * face is down, and tells the table what it has become. */
  transformCard(seat: number, iid: string): Promise<void>;
  setVirtualCounter(seat: number, iid: string, name: string, value: number): void;
  moveVirtualCard(
    seat: number,
    iid: string,
    from: CardZone,
    to: CardZone,
    opts?: { pos?: 'top' | 'bottom'; row?: CardInstance['row'] },
  ): void;
  /** A permanent goes back to its owner's hand, and the table is told
   * which: it was in plain sight, unlike a card put there from a library. */
  returnToHand(seat: number, iid: string): void;
  /** One of a creature's own growing abilities (lib/abilities.ts, by its
   * key): its mana is paid in the same move — `free`: not paid — and its
   * {T} taps it. Monstrosity makes it monstrous and sets off "when it
   * becomes monstrous". `x`: what was paid for X. */
  activateAbility(seat: number, iid: string, key: string, opts?: { x?: number; free?: boolean }): Promise<void>;
  /** So many +1/+1 counters on a card, and maybe a mark it now wears
   * ('renowned'): one move. */
  growCard(seat: number, iid: string, n: number, mark?: string): void;
  /** What that permanent held in exile ("until it leaves the battlefield")
   * comes back to the battlefield, each card to its owner's side. `why`:
   * the holder's name, for the feed. */
  releaseHeld(seat: number, iid: string, why: string): void;
  millCards(seat: number, n: number): void;
  exileCards(seat: number, n: number): void;
  lookNotice(seat: number, n: number): void;
  arrangeTop(seat: number, looked: string[], plan: cardsLib.TopPlan): void;
  shuffleSeat(seat: number): void;
  /** A search of the seat's library, carried out: the cards found go where
   * they are sent and the rest is shuffled — one move at the table. `why`
   * is the card that asked for it, for the feed. */
  searchLibrary(seat: number, found: cardsLib.Found[], why?: string): void;
  mulliganSeat(seat: number): void;
  keepHand(seat: number, bottomIids: string[]): void;
  castCommander(
    seat: number,
    iid?: string,
    opts?: { x?: number; using?: Record<string, number> },
  ): void;
  commanderDiedAction(seat: number, iid: string): void;
  commanderReturned(seat: number, iid: string, from: 'graveyard' | 'exile'): void;
  peekNotice(seat: number): void;
  /** Shows cards to the whole table, by name. They stay where they are. */
  revealCards(seat: number, iids: string[], from: 'hand' | 'library'): void;
  setHandHeld(seat: number, held: boolean): void;
  // ---- combat on the cards (lib/combat.ts; read the fight with liveCombat) ----
  /** Opens a fight for the active seat. */
  startCombat(): void;
  /** Declares the active player's tapped creatures as the attack (lib/attackDraft.ts). */
  attackWithTapped(): Promise<void>;
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
  /** `hits`: the attackers whose damage reached a player (combatReview
   * hitsOf), for the cards waiting for combat damage to a player. Left out,
   * every attacker nobody blocked is taken to have hit. */
  applyCombat(outcome: CombatOutcome, hits?: CombatUnit[]): void;
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
  /** A real card on the battlefield is sacrificed: to the graveyard, and the table is told so. */
  sacrificeCard(seat: number, iid: string): void;
  /** One copy of a stack is sacrificed, and the table is told so. */
  sacrificeToken(seat: number, itemId: string): void;
  /** Puts an Aura or Equipment on a host (any seat's), or takes it off
   * (null). `plus`: +1/+1 counters it shows on a card host while it is there. */
  attachVirtualCard(seat: number, iid: string, host: cardsLib.Host | null, plus?: number): void;
  /** Puts an Equipment on a creature and pays its equip cost in the same
   * move (lib/equip.ts). `free`: it goes on without paying — "Equip anyway",
   * or an Equipment that attaches itself as it enters. */
  equipCard(seat: number, iid: string, host: cardsLib.Host, opts?: { free?: boolean }): Promise<void>;
  /** One effect of a spell that seat cast, picked off the cast banner
   * (lib/spellEffects.ts): damage, life, removal, counters. One move, one Undo. */
  castEffect(seat: number, spellName: string, effect: SpellEffect): Promise<void>;
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
    const byName = byId ? undefined : await m.findCardByName(c.name).catch(() => undefined);
    // Found by name, the card is its front: one lying on its back still
    // has to read as its back face (lib/faces.ts).
    records[c.cardId] = byId ?? (byName && isBackId(c.cardId) ? backView(byName) : byName);
  }
  return records;
}

/** The same for every battlefield on the table: what a spell reads when it
 * hits somebody else's creature, or all of them. */
export async function tableRecords(g: GameState): Promise<SeatRecords> {
  const records: SeatRecords = {};
  for (let seat = 0; seat < g.players.length; seat++) Object.assign(records, await seatRecords(g, seat));
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
 * is the state BEFORE the card moves, so it cannot pay for itself.
 *
 * `using` is a payment the player chose ("Pay with…"): source key → how
 * many. Those sources pay, as far as they are still there, and nothing
 * else is touched — see payWith for what happens to each of them. */
function payFrom(
  base: GameState,
  seat: number,
  costs: payLib.PayCost[],
  records: SeatRecords,
  castIn: TurnStamp,
  using?: Record<string, number>,
): (moved: GameState) => GameState {
  const sameTurn = isTurn(base, castIn);
  const player = base.players[seat];
  const sources = sameTurn
    ? payLib.sourcesFrom(player?.cards?.battlefield ?? [], records, player?.board ?? [])
    : [];
  if (using) {
    const chosen = payWithLib.payWith(costs, payWithLib.sourcesUsing(sources, using));
    return (moved) => {
      let next = moved;
      for (const [iid, units] of Object.entries(chosen.spend))
        next = cardsLib.spendMana(next, seat, iid, units);
      for (const iid of chosen.tap) next = cardsLib.tapCard(next, seat, iid, true);
      for (const [itemId, copies] of Object.entries(chosen.boardTaps))
        next = boardLib.tapItem(next, seat, itemId, copies);
      return next;
    };
  }
  const plan = sameTurn ? payLib.planAnyFace(costs, sources) : null;
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
    let happenedSeq = 0;

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
      also: Happening[] = [],
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
      // What this move did is noted beside the game, in the same breath:
      // cards that trigger by themselves are set off by it. A cast is said
      // by the move that made it (`also`); the rest is read off the table.
      const events = [...also, ...happeningsBetween(game, next)];
      if (events.length > 0) set({ game: next, happened: { id: ++happenedSeq, events } });
      else set({ game: next });
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
      also?: Happening[],
    ) => {
      const entry = feedText ? feedEntry(feedText) : null;
      const fn = (g: GameState) => {
        const after = reducer(g);
        if (after === g) return g;
        return entry ? cardsLib.appendFeed(after, entry) : after;
      };
      mutateGame(fn, undefined, { guard: guard ?? (() => true), maxAgeMs }, also);
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
      happened: null,

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

      drawCards(seat, n, opts) {
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
        // "Has drawn this turn" is stamped in the same op as the draw, and
        // only for the turn the draw was made in: one that arrives a turn
        // late (a rebase past a Pass turn) is not that later turn's draw.
        const drawnIn = { turn: g.turnNumber, active: g.activePlayerIndex };
        cardMutate(
          (base) => {
            const drawn = cardsLib.draw(base, seat, iids);
            if (drawn === base) return base;
            return seat === drawnIn.active && isTurn(base, drawnIn) && !opts?.extra
              ? cardsLib.markDrew(drawn, seat)
              : drawn;
          },
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
        // Kicker and its relatives: what the cast was made with goes on top
        // of the cost, and into the feed line. Only the paying is done here —
        // what a kicked spell does differently stays with the players.
        const extras = isLand ? [] : payLib.extraCosts(record);
        const times = payLib.extraTimes(extras, opts?.extras);
        const priced = payLib.priceExtras(payLib.priceX(costs, x), extras, times);
        // Bought back, a spell returns to its owner's hand instead of going
        // to the graveyard: it simply never leaves.
        const boughtBack = isSpell && extras.some((e, i) => e.kind === 'buyback' && times[i] > 0);
        const counters = !isSpell && x > 0 && payLib.entersWithX(record?.oracleText ?? '');
        const records = await seatRecords(g, seat);
        const castIn = { turn: g.turnNumber, active: g.activePlayerIndex };
        // An instant or sorcery is gone to the graveyard the moment it is
        // cast, and used to vanish there unseen. So the cast is SHOWN to the
        // table the way a reveal is — on every device, until it is tapped
        // away — while the card itself already lies where it ends up. (The
        // app carries out no spell effects: answering it, and what it does,
        // stay with the players.) Minted here: a replay is the same showing,
        // and one that lands long after is too old to come up at all.
        const shown: Reveal | null = isSpell
          ? {
              id: `r${cardsLib.newIid()}`,
              seat,
              from: 'cast',
              cards: [{ cardId: card.cardId, name: card.name }],
              t: Date.now(),
              // What it was cast for: the banner reads "deals X damage" with it.
              ...(asksX ? { x } : {}),
            }
          : null;
        cardMutate(
          (base) => {
            const pay = payFrom(base, seat, priced, records, castIn, opts?.using);
            if (!base.players[seat]?.cards?.hand.some((c) => c.iid === iid)) return base;
            let moved = boughtBack
              ? base
              : isSpell
                ? cardsLib.moveCard(base, seat, iid, 'hand', 'graveyard')
                : cardsLib.moveCard(base, seat, iid, 'hand', 'battlefield', { row });
            if (moved === base && !boughtBack) return base;
            // The land on the back of a spell lands back face up: it reads as the land it is.
            if (opts?.asLand && turnsOver(record)) moved = cardsLib.flipCard(moved, seat, iid, true);
            if (shown) moved = cardsLib.setReveal(moved, shown);
            // The land drop is counted in the same op as the move, so undo
            // and a rebase take both or neither — and only for the turn it
            // was made in: arriving a round late, it is not this turn's land.
            if (isLand && isTurn(base, castIn)) moved = cardsLib.countLandPlay(moved, seat);
            // "Enters with X +1/+1 counters on it": X belongs to the cast,
            // so the counters arrive even where the mana no longer does.
            if (counters) moved = cardsLib.setCardCounter(moved, seat, iid, 'p1p1', x);
            return pay(moved);
          },
          `${seatName(g, seat)} ${verb} ${card.name}${asksX ? ` (X=${x})` : ''}${payLib.extrasWords(extras, times)}`,
          (base) => !!base.players[seat]?.cards?.hand.some((c) => c.iid === iid),
          undefined,
          // Cast, not played: cards waiting for a spell are set off by it.
          isLand ? [] : [{ kind: 'cast', seat, spell: { seat, kind: 'card', id: iid, cardId: card.cardId, name: card.name, n: 1 } }],
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

      // Which face is up is read off the card as it lies now, and the op
      // says the direction outright: a replay can confirm a turn but never
      // turn the card back. The names of the faces come off the card's
      // record (its front one: the names are the same either way up), or
      // off the "Front // Back" the instance carries. A card that cannot
      // be read turns all the same.
      async transformCard(seat, iid) {
        const g = get().game;
        const card = g?.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
        if (!g || !card) return;
        const wasBack = isBackId(card.cardId);
        const record = await import('../data/scryfall').then(async (m) => {
          const byId = await m.getCardById(frontId(card.cardId)).catch(() => undefined);
          if (byId) return byId;
          return m.findCardByName(card.name).catch(() => undefined);
        });
        const { front, back } = faceNames(record, card.name);
        const text = wasBack
          ? `${back ?? card.name} turns back into ${front}`
          : back
            ? `${front} becomes ${back}`
            : `${front} is turned over`;
        cardMutate(
          (base) => cardsLib.flipCard(base, seat, iid, !wasBack),
          `${seatName(g, seat)}: ${text}`,
          (base) => {
            const baseCard = base.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
            return !!baseCard && isBackId(baseCard.cardId) === wasBack;
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

      returnToHand(seat, iid) {
        const g = get().game;
        const cards = g?.players[seat]?.cards;
        // From the battlefield, or from the graveyard it has just died into
        // ("When this creature dies, return it to its owner's hand").
        const from = cards?.battlefield.some((c) => c.iid === iid)
          ? 'battlefield'
          : cards?.graveyard.some((c) => c.iid === iid)
            ? 'graveyard'
            : null;
        const card = from && cards?.[from].find((c) => c.iid === iid);
        if (!g || !from || !card) return;
        cardMutate(
          (base) => cardsLib.moveCard(base, seat, iid, from, 'hand'),
          `${card.name} returns to ${seatName(g, seat)}’s hand`,
          (base) => !!base.players[seat]?.cards?.[from].some((c) => c.iid === iid),
        );
      },

      async activateAbility(seat, iid, key, opts) {
        const g = get().game;
        const card = g?.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
        if (!g || !card) return;
        const records = await seatRecords(g, seat);
        const ability = abilitiesOf(records[card.cardId]).find((a) => a.key === key);
        if (!ability || abilityBlocked(ability, card)) return;
        const x = ability.cost.x ? wholeX(opts?.x) : 0;
        const effect = ability.effect;
        const n = effect.kind === 'counters' ? (effect.n === 'X' ? x : effect.n) : 0;
        const monstrous = effect.kind === 'counters' && effect.once === 'monstrous';
        const paidIn = { turn: g.turnNumber, active: g.activePlayerIndex };
        const who = seatName(g, seat);
        const text =
          effect.kind === 'boost'
            ? `${who}: ${card.name} gets ${boostWords(effect)} until end of turn`
            : monstrous
              ? `${who}: ${card.name} becomes monstrous (${n} +1/+1 counter${n === 1 ? '' : 's'})`
              : effect.ifNone
                ? `${who}: ${card.name} adapts (${n} +1/+1 counter${n === 1 ? '' : 's'})`
                : `${who}: ${card.name} gets ${n} +1/+1 counter${n === 1 ? '' : 's'}`;
        cardMutate(
          (base) => {
            const now = base.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
            // Gone, or it would do nothing now (monstrous already, tapped…): nothing is paid either.
            if (!now || abilityBlocked(ability, now)) return base;
            const pay = opts?.free ? null : payFrom(base, seat, [payLib.withX(ability.cost, x)], records, paidIn);
            let next = ability.tap ? cardsLib.tapSpent(base, seat, iid) : base;
            if (effect.kind === 'boost') next = boostCard(next, seat, iid, effect);
            else {
              next = cardsLib.setCardCounter(next, seat, iid, 'p1p1', (now.counters?.p1p1 ?? 0) + n);
              if (monstrous) next = cardsLib.setCardCounter(next, seat, iid, 'monstrous', 1);
            }
            return pay ? pay(next) : next;
          },
          text,
          (base) => !!base.players[seat]?.cards?.battlefield.some((c) => c.iid === iid),
          undefined,
          monstrous ? [{ kind: 'monstrous', thing: { seat, kind: 'card', id: iid, cardId: card.cardId, name: card.name, n: 1 } }] : [],
        );
      },

      growCard(seat, iid, n, mark) {
        const g = get().game;
        const card = g?.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
        if (!g || !card || !(n > 0)) return;
        cardMutate(
          (base) => {
            const now = base.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
            if (!now || (mark && (now.counters?.[mark] ?? 0) > 0)) return base;
            const grown = cardsLib.setCardCounter(base, seat, iid, 'p1p1', (now.counters?.p1p1 ?? 0) + n);
            return mark ? cardsLib.setCardCounter(grown, seat, iid, mark, 1) : grown;
          },
          `${card.name} gets ${n} +1/+1 counter${n === 1 ? '' : 's'}${mark ? ` and becomes ${mark}` : ''}`,
          (base) => !!base.players[seat]?.cards?.battlefield.some((c) => c.iid === iid),
        );
      },

      releaseHeld(seat, iid, why) {
        const g = get().game;
        if (!g) return;
        const by = { seat, iid };
        const held = cardsLib.heldBy(g, by);
        if (held.length === 0) return;
        const names = held.map((h) => h.card.name).join(', ');
        cardMutate(
          (base) => cardsLib.releaseHeldBy(base, by),
          `${names} return${held.length === 1 ? 's' : ''} to the battlefield (${why} left)`,
          (base) => cardsLib.heldBy(base, by).length > 0,
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

      searchLibrary(seat, found, why) {
        const g = get().game;
        const library = g?.players[seat]?.cards?.library;
        if (!g || !library) return;
        const here = found.filter((f) => library.some((c) => c.iid === f.iid));
        const seed = Math.floor(Math.random() * 2 ** 31);
        // Where a card went is public. Which card it was, only where it now
        // lies in plain sight: the battlefield and the graveyard.
        const names = (to: cardsLib.FoundTo) =>
          here.filter((f) => f.to === to).map((f) => library.find((c) => c.iid === f.iid)!.name);
        const cards = (n: number) => (n === 1 ? 'a card' : `${n} cards`);
        const moves = [
          names('tapped').length > 0 && `puts ${names('tapped').join(', ')} onto the battlefield tapped`,
          names('battlefield').length > 0 && `puts ${names('battlefield').join(', ')} onto the battlefield`,
          names('graveyard').length > 0 && `puts ${names('graveyard').join(', ')} into the graveyard`,
          names('hand').length > 0 && `puts ${cards(names('hand').length)} in hand`,
        ].filter(Boolean);
        const top = names('top').length;
        const text =
          [`${seatName(g, seat)} searches their library${why ? ` (${why})` : ''}`, ...moves].join(', ') +
          (top > 0 ? `, shuffles and puts ${cards(top)} on top` : ' and shuffles');
        // As a shuffle: a stale one must not scramble a library someone has
        // since stacked. And every card found has to be there still.
        cardMutate(
          (base) => cardsLib.searchLibrary(base, seat, here, seed),
          text,
          (base) => {
            const now = base.players[seat]?.cards?.library;
            return !!now && here.every((f) => now.some((c) => c.iid === f.iid));
          },
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
              const pay = payFrom(base, seat, priced, records, castIn, opts?.using);
              let moved = cardsLib.moveCard(base, seat, cmd.iid, 'command', 'battlefield', {
                row: 'front',
              });
              if (moved === base) return base;
              if (counters) moved = cardsLib.setCardCounter(moved, seat, cmd.iid, 'p1p1', x);
              return pay(moved);
            },
            `${seatName(g, seat)} casts ${cmd.name}${tax > 0 ? ` (tax +${tax})` : ''}${asksX ? ` (X=${x})` : ''}`,
            (base) => !!base.players[seat]?.cards?.command.some((c) => c.iid === cmd.iid),
            undefined,
            [{ kind: 'cast', seat, spell: { seat, kind: 'card', id: cmd.iid, cardId: cmd.cardId, name: cmd.name, n: 1 } }],
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

      // Attacking the way it is done at a table: the creatures the active
      // player has turned sideways ARE the attack (lib/attackDraft.ts reads
      // them off the board). One press declares them, in one op — one Undo
      // takes the whole declaration back. With a single opponent there is
      // nothing left to choose and it goes straight on to their blocks; in
      // a pod it stops at the attackers step with every one of them picked
      // and pointed at the first opponent, to be re-pointed there.
      async attackWithTapped() {
        const seen = get().game;
        if (!seen || combatLib.liveCombat(seen)) return;
        const stamp = {
          id: cardsLib.newIid(),
          turn: seen.turnNumber,
          active: seen.activePlayerIndex,
        };
        // Who is a creature, and who only just arrived, is on the cards.
        const records = await seatRecords(seen, stamp.active);
        const g = get().game;
        if (!g || !isTurn(g, stamp) || combatLib.liveCombat(g)) return;
        const picks = tappedToAttack(g, records);
        const targets = opponentsOf(g);
        if (picks.length === 0 || targets.length === 0) return;
        const declare = (base: GameState) => {
          let next = combatLib.startCombat(base, stamp);
          if (next === base) return base;
          for (const pick of picks) {
            next = combatLib.setAttack(next, stamp.id, pick.unit, targets[0], pick.n);
            // Tapped to attack, not for mana: nothing of it is left floating.
            if (pick.unit.kind === 'card') next = cardsLib.useUpTap(next, stamp.active, pick.unit.id);
          }
          // Everything it was aimed at has left meanwhile: no fight at all.
          if (!combatLib.liveCombat(next)?.attacks?.length) return base;
          // They are tapped already: the declaration itself taps nothing.
          return targets.length === 1
            ? combatLib.confirmAttackers(next, stamp.id, { cards: [], stacks: {} })
            : next;
        };
        const after = combatLib.liveCombat(declare(g));
        cardMutate(
          declare,
          targets.length === 1 && after ? combatLib.attackLine(g, after) : null,
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

      applyCombat(outcome, hits) {
        const g = get().game;
        const fight = g && combatLib.liveCombat(g);
        if (!g || !fight) return;
        // Who got through, for the cards waiting for combat damage to a
        // player: an attacker nobody blocked, at a player the result has
        // losing life, or taking poison or commander damage.
        const hurt = new Set(
          (outcome?.players ?? [])
            .filter((p) => p.life < 0 || (p.poison ?? 0) > 0 || Object.values(p.commander ?? {}).some((n) => n > 0))
            .map((p) => p.seat),
        );
        const hit = (a: CombatAttack) =>
          hits
            ? hits.some((u) => u.kind === a.unit.kind && u.id === a.unit.id)
            : !a.blocked && (a.blockers?.length ?? 0) === 0;
        const through = (fight.attacks ?? []).flatMap((a) =>
          hit(a) && hurt.has(a.target) ? (unitThing(g, fight.active, a.unit, a.n ?? 1) ?? []) : [],
        );
        cardMutate(
          (base) => combatLib.applyCombat(base, fight.id, outcome),
          combatLib.outcomeLine(g, outcome),
          // The result was worked out from these attacks and these blocks:
          // if either changed since, it is the result of another fight.
          (base, orig) => combatLib.sameAttacks(base, orig) && combatLib.sameBlocks(base, orig),
          undefined,
          through.length > 0 ? [{ kind: 'damage', combat: fight.id, things: through }] : [],
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

      // A sacrifice ends where a death does, but it is said as what it was:
      // the table has to see that a permanent was given up, not killed
      // (Innocent Traveler asks every opponent for one at each upkeep). Any
      // device may make it for any seat, as with every card move.
      sacrificeCard(seat, iid) {
        const g = get().game;
        const card = g?.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
        if (!g || !card) return;
        cardMutate(
          // To the graveyard: a commander may go home from there afterwards.
          (base) => cardsLib.moveCard(base, seat, iid, 'battlefield', 'graveyard'),
          `${seatName(g, seat)} sacrifices ${card.name}`,
          (base) => !!base.players[seat]?.cards?.battlefield.some((c) => c.iid === iid),
        );
      },

      // An Aura or an Equipment goes onto a host (null: comes off it). The
      // host may be another seat's card — a hostile Aura — so the guard
      // looks for both on the table the op lands on.
      attachVirtualCard(seat, iid, host, plus = 0) {
        const g = get().game;
        const card = g?.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
        if (!g || !card) return;
        if (host && !cardsLib.hostIsThere(g, host)) return;
        const was = hostOf(g, card);
        if (!host && !was) return; // nothing to take off
        const whose = (h: cardsLib.Host) => (h.seat === seat ? '' : `${seatName(g, h.seat)}’s `);
        const text = host
          ? `${seatName(g, seat)} puts ${card.name} on ${whose(host)}${hostName(g, host)}`
          : `${seatName(g, seat)} takes ${card.name} off ${whose(was!)}${hostName(g, was!)}`;
        cardMutate(
          (base) => cardsLib.attachCard(base, seat, iid, host, plus),
          text,
          (base) =>
            !!base.players[seat]?.cards?.battlefield.some((c) => c.iid === iid) &&
            (!host || cardsLib.hostIsThere(base, host)),
        );
      },

      // An Equipment goes onto a creature, and what the card asks for that
      // ("Equip {2}") is paid as it does: the lands are tapped inside the
      // same op, against the table it lands on, so one Undo takes both back
      // and two equips fired together cannot spend the same land. The way
      // the host pays is read here as the screen reads it (lib/equip.ts).
      // Where nothing can pay, it goes on all the same and nothing is
      // tapped — the screen is the gate, as it is for a spell.
      async equipCard(seat, iid, host, opts) {
        const g = get().game;
        const card = g?.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
        if (!g || !card || !cardsLib.hostIsThere(g, host)) return;
        const was = hostOf(g, card);
        // On it already: nothing moves, so nothing is owed.
        if (was && was.seat === host.seat && was.kind === host.kind && was.id === host.id) return;
        const records = host.seat === seat ? await seatRecords(g, seat) : await tableRecords(g);
        const way = opts?.free ? null : equipWay(records[card.cardId], equipHost(g, host, records));
        const paidIn = { turn: g.turnNumber, active: g.activePlayerIndex };
        const whose = host.seat === seat ? '' : `${seatName(g, host.seat)}’s `;
        cardMutate(
          (base) => {
            const pay = way ? payFrom(base, seat, [way.cost], records, paidIn) : null;
            const moved = cardsLib.attachCard(base, seat, iid, host);
            return moved === base || !pay ? moved : pay(moved);
          },
          `${seatName(g, seat)} puts ${card.name} on ${whose}${hostName(g, host)}`,
          (base) =>
            !!base.players[seat]?.cards?.battlefield.some((c) => c.iid === iid) &&
            cardsLib.hostIsThere(base, host),
        );
      },

      // What a spell does, once its player has said so with a tap on the
      // cast banner. Who dies and how many are swept is settled here,
      // against the table that player was looking at, so the feed line and
      // the table agree; a replay only asks that the targets are still there.
      async castEffect(seat, spellName, effect) {
        const seen = get().game;
        if (!seen) return;
        // Sizes and types are on the cards; life is not.
        const reads =
          effect.kind === 'sweep' ||
          effect.kind === 'pump' ||
          (effect.kind === 'damage' && effect.on !== 'opponents' && effect.on.kind !== 'player');
        const records = reads ? await tableRecords(seen) : {};
        const g = get().game;
        if (!g) return;
        const plan = planEffect(g, seat, spellName, effect, records);
        if (!plan) return;
        cardMutate(plan.apply, plan.text, plan.guard);
      },

      sacrificeToken(seat, itemId) {
        const g = get().game;
        const item = g?.players[seat]?.board.find((it) => it.id === itemId);
        if (!g || !item || item.count < 1) return;
        const article = /^[aeiou]/i.test(item.name) ? 'an' : 'a';
        cardMutate(
          // One copy leaves its stack; the last one takes the stack with it.
          (base) => boardLib.changeCount(base, seat, itemId, -1),
          `${seatName(g, seat)} sacrifices ${article} ${item.name}`,
          (base) => (base.players[seat]?.board.find((it) => it.id === itemId)?.count ?? 0) >= 1,
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
