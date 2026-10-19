export type Format = 'commander' | 'standard';

export interface PlayerProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  commanderName: string | null;
  /** Second commander of a partner pair (set when a partner deck is
   * chosen for the game): commander damage is tracked per commander. */
  partnerName?: string | null;
  commanderColors?: string[] | null; // WUBRG identity, for zone theming
  commanderImage?: string | null; // card image for the home-screen tile
  commanderHistory?: CommanderEntry[]; // recently used commanders, newest first
  /** The saved deck this player last sat down with; pre-filled on New Game.
   * May name a deck that has since been deleted: then it counts as none. */
  deckId?: string | null;
  /** ms epoch of the last save; last-write-wins across devices. Absent on
   * profiles saved before players synced: those count as the oldest. */
  updatedAt?: number;
}

export interface CommanderEntry {
  name: string;
  image: string | null;
  colors: string[] | null;
}

export interface GameConfig {
  format: Format;
  startingLife: number;
  commanderDamageThreshold: number;
  profiles: PlayerProfile[];
  mode?: 'tracker' | 'cards'; // absent = 'tracker' (every pre-cards save)
}

export type CardZone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command';

/** One physical card from a deck. It lives in exactly one SeatCards array —
 * the array IS the zone, the index IS the pile order (0 = top). Reducers
 * delete tapped/counters/row on zone exit and never write defaults (wire size). */
export interface CardInstance {
  iid: string; // per-game instance id
  /** Local card-DB id; resolved via getCardById. On the battlefield it may
   * be a back id (lib/faces.ts): the card lies on its back face. */
  cardId: string;
  name: string; // feed text + findCardByName fallback (printing drift)
  tapped?: boolean; // battlefield only; omitted = untapped (per CARD)
  counters?: Record<string, number>; // battlefield only
  /** Battlefield only. 'lands' keeps a card on the lands shelf and out of
   * combat. 'front' (and no value) is an ordinary permanent: lib/shelf.ts
   * says where it is drawn, by its type. 'side' and 'field' are a place
   * the player chose by hand, and builds that do not know them treat them
   * as 'front'. */
  row?: 'front' | 'lands' | 'side' | 'field';
  /** Battlefield only, meaningful only while tapped: mana units a payment
   * has drawn from this tap. A tapped card with nothing spent is floating
   * its whole yield (the player tapped it by hand). */
  spent?: number;
  /** Battlefield only: what this card is attached to — an Aura's enchanted
   * permanent, an Equipment's creature. The host may be on ANOTHER seat's
   * side of the table (a hostile Aura): the one place a card points across
   * seats. `plus` is how many +1/+1 counters the attachment put on its
   * host, taken off again when it leaves it. A host that has left simply
   * leaves the card unattached — read it through lib/attach.ts, never
   * directly. Builds that do not know the field ignore it and keep it. */
  on?: { seat: number; kind: 'card' | 'stack'; id: string; plus?: number };
  /** Battlefield only: a permanent that changed control. It lies on its
   * new controller's battlefield; `owner` is the seat whose card it is —
   * where it goes when it leaves the battlefield, and where it goes back.
   * `until`: taken "until end of turn" in that turn (it goes back when the
   * turn passes). `by`: the instance on the same side that holds it (Control
   * Magic) — when that leaves, it goes back. */
  stolen?: { owner: number; until?: { turn: number; active: number }; by?: string };
  /** Battlefield only: the turn this planeswalker last used a loyalty
   * ability, named by turnNumber and activePlayerIndex (like landPlays). A
   * stamp from any other turn means none used yet; nothing clears it. */
  loyaltyUsed?: { turn: number; active: number };
  /** Battlefield only: the turn this Vehicle was crewed, named like
   * loyaltyUsed — through that turn it is an artifact creature
   * (lib/vehicles.ts). A stamp from any other turn means not crewed. */
  crewed?: { turn: number; active: number };
  /** Battlefield only: the card arrived since its controller's last turn
   * began. Every card gets it, whatever its type — the reducers do not
   * read cards. Whether it means summoning sickness is for the table and
   * the mana engine to say (lib/keywords.ts). */
  sick?: true;
  /** Exile only: the permanent it is exiled by "until it leaves the
   * battlefield" (Oblivion Ring, Banishing Light, Banisher Priest). When
   * that one leaves, this one comes back (lib/cards.ts releaseHeldBy). Gone
   * as soon as the card moves on, like every zone's own fields. */
  held?: { seat: number; iid: string };
  /** Exile only: the card was cast from its owner's hand with rebound, in
   * the turn named here (the game's turnNumber and activePlayerIndex, as
   * land drops are stamped). As its owner's next turn begins it may be cast
   * from exile (lib/cascade.ts reboundTurn). Gone as soon as it moves on. */
  rebound?: { turn: number; active: number };
  /** Battlefield only: what "until end of turn" effects did to it this turn
   * (lib/boost.ts — read it through boostOf: a stamp from another turn is
   * no boost at all). */
  boost?: Boost;
}

/** "Until end of turn": so much power and toughness, and some keywords, for
 * the turn named by its stamp only (the game's turnNumber and
 * activePlayerIndex, as land drops are stamped). */
export interface Boost {
  turn: number;
  active: number;
  power: number;
  toughness: number;
  keywords?: string[];
}

export interface SeatCards {
  library: CardInstance[]; // hidden by UI contract; index 0 = top
  hand: CardInstance[]; // hidden by UI contract; rendered for claimed seats
  battlefield: CardInstance[]; // public; order = play order
  graveyard: CardInstance[]; // public; last = top
  exile: CardInstance[]; // public
  command: CardInstance[]; // public; commander starts here
  mulligans: number; // London bottoming count
  deckName: string; // provenance label
  handHeld?: boolean; // synced hint: a phone holds this hand
  kept?: boolean; // the keep step ran — mulligan window is closed
  /** The seat's commanders (one, or a partner pair): instance id → times
   * it has gone back to the command zone, i.e. its own tax ÷ 2. Absent on
   * seats dealt before commanders were tracked per card. */
  cmd?: Record<string, number>;
  /** Id of the last look that arranged the top of the library (scry,
   * surveil): a draw or mill made before it cannot trust the top it saw.
   * A shuffle leaves it alone. Absent until the first such look. */
  stacked?: string;
  /** Lands PLAYED from hand during one turn, named by the game's
   * turnNumber and activePlayerIndex. Nothing ever resets it: a stamp from
   * any other turn simply counts as zero. Absent until the first land. */
  landPlays?: { turn: number; active: number; n: number };
  /** The turn in which this seat last drew from its library, named the
   * same way. Like landPlays, nothing resets it: a stamp from any other
   * turn means "has not drawn yet". Absent until the first draw. */
  drew?: { turn: number; active: number };
}

/** Synced announcement ring — the trust model's deterrent. Cap 30. */
export interface FeedEntry {
  id: string;
  t: number;
  text: string;
}

/** Cards a player is showing the whole table. Public by definition, so
 * unlike a look it names them. The cards themselves do not move. */
export interface Reveal {
  id: string; // minted when it is made: each device puts a reveal away by id
  seat: number;
  /** Where the cards are shown from. 'cast' is a spell on its way to the
   * graveyard: an instant or sorcery pauses in front of the table, so
   * everyone sees what was cast and can answer it. (A build that does not
   * know 'cast' drops such a reveal, which is harmless.) */
  from: 'hand' | 'library' | 'cast';
  cards: { cardId: string; name: string }[];
  t: number; // when it was made, by the revealing device's clock
  /** 'cast' only: the X the spell was cast for, when its cost has one. The
   * effects the banner offers are read with it (lib/spellEffects.ts). */
  x?: number;
  /** 'cast' only: it was overloaded — its "target" reads "each" (lib/costs.ts). */
  overload?: true;
}

export interface BoardItem {
  id: string;
  cardId: string | null;
  name: string;
  imageNormal: string | null;
  imageArtCrop: string | null;
  typeLine: string;
  oracleText: string;
  basePower: number | null;
  baseToughness: number | null;
  count: number;
  counters: Record<string, number>; // key 'p1p1' = +1/+1 counters
  color: string | null; // custom tokens only
  zone: 'board' | 'lands';
  tapped?: number; // mana sources marked used this turn (≤ count)
  /** Of the tapped copies, how many a payment tapped (mana, convoke): those
   * are not attacking. Omitted when none; the untap step clears it. */
  spent?: number;
  /** Copies that arrived since their controller's turn began (≤ count).
   * Omitted when none did. */
  sick?: number;
  /** What "until end of turn" effects did to every copy of it this turn (lib/boost.ts). */
  boost?: Boost;
  // Mana override: a color/'any' makes this stack a mana source (Ashaya,
  // Cryptolith Rite…), 'none' silences a real dork, unset = read oracle text.
  manaMode?: 'W' | 'U' | 'B' | 'R' | 'G' | 'C' | 'any' | 'none';
}

export interface PlayerState {
  profileId: string;
  life: number;
  commanderDamage: Record<string, number>; // keyed by opposing profile id
  eliminated: boolean;
  board: BoardItem[];
  counters: Record<string, number>; // poison, energy, experience…
  commanderDeaths: number; // tax = deaths × 2
  cards?: SeatCards; // absent = tracker-style seat (mixed tables are legal)
}

export interface GameState {
  config: GameConfig;
  players: PlayerState[];
  activePlayerIndex: number;
  turnNumber: number;
  monarchIdx: number | null;
  initiativeIdx: number | null;
  turnStartedAt: number;
  feed?: FeedEntry[]; // synced announcement ring, cap 30, deduped by id
  reveal?: Reveal; // the latest reveal only: the next one replaces it
  /** The fight on the table, if any. Read it through liveCombat() in
   * lib/combat.ts, never directly: a finished or stale one stays here
   * until the turn passes. */
  combat?: CombatState;
  /** What the end-of-game recap tells. Written only by lib/story.ts (every
   * local move passes through it), so it syncs with the game and an Undo
   * takes it back with the move. Absent on games begun before it existed;
   * builds that do not know it keep it as it is. */
  story?: GameStory;
  /** Day or night (lib/dayNight.ts): absent until a daybound permanent
   * makes it day. Pass turn turns it by how many spells the player whose
   * turn ended cast in it. */
  dayNight?: 'day' | 'night';
  /** Spells the active player has cast this turn, named like landPlays: a
   * stamp from any other turn counts as none. Written inside every move. */
  casts?: { turn: number; active: number; n: number };
  /** Every spell cast this turn, by anyone, oldest first: what a
   * counterspell can answer (lib/counterspells.ts — read it through
   * stackNow: a stamp from another turn is no spell). Written inside the
   * move that casts it. Builds that do not know it keep it as it is. */
  stack?: StackSpell[];
}

/** A spell cast this turn. The card already lies where the cast put it. */
export interface StackSpell {
  /** Minted as it is cast. */
  id: string;
  /** Who cast it: its controller, and the card's owner. */
  seat: number;
  iid: string;
  cardId: string;
  name: string;
  /** Where the cast put the card: the graveyard (an instant or sorcery), the
   * battlefield (a permanent), exile (rebound), the hand (bought back). */
  to: CardZone;
  /** Where it was cast from, when not the hand: a commander's command zone,
   * exile (rebound), the library (cascade, discover). */
  from?: CardZone;
  turn: number;
  active: number;
  /** The showing its cast put up (an instant or sorcery): countered, it goes. */
  reveal?: string;
  /** Countered, by the card named. */
  countered?: string;
}

/** The story of one game, for the recap when it ends (lib/story.ts). */
export interface GameStory {
  /** Names this game in the history: a game is saved there under it. */
  id: string;
  /** ms epoch the game began; absent when the story began mid-game. */
  startedAt?: number;
  /** Every seat's life as each turn began, oldest first. */
  turns: StoryTurn[];
  /** The players who went out, in the order they did. */
  outs: StoryOut[];
  /** The biggest hit among the bursts that are over. */
  best?: StoryHit;
  /** Life changes still being added up: taps a moment apart are one hit. */
  open?: StoryBurst[];
  /** ms epoch the game was decided: one player left, or nobody. */
  endedAt?: number;
}

export interface StoryTurn {
  turn: number;
  active: number;
  life: number[];
}

export interface StoryOut {
  seat: number;
  turn: number;
  /** Whose turn it was when they went out. */
  active: number;
  /** When (ms epoch): players who went out in the same move share it. */
  t: number;
  how: 'life' | 'commander' | 'poison' | 'conceded';
  /** 'commander': the commander-damage key that reached the limit, and its total then. */
  by?: string;
  n?: number;
}

export interface StoryHit {
  seat: number;
  n: number;
  turn: number;
  active: number;
}

export interface StoryBurst {
  seat: number;
  net: number;
  t: number;
  turn: number;
  active: number;
}

/** A finished game, kept on this device for the history. */
export interface GameRecord {
  id: string; // the game's story id
  startedAt: number | null;
  endedAt: number;
  turns: number;
  format: Format;
  mode: 'tracker' | 'cards';
  online: boolean;
  /** The winner's seat; null = nobody won (everyone fell at once). */
  winner: number | null;
  players: GameRecordSeat[];
  outs: StoryOut[];
  hit: StoryHit | null;
  /** Life as each turn began, and at the end: the life chart. */
  lives: StoryTurn[];
  /** Taken out of the history by hand: kept so it can come back, counted nowhere. */
  removed?: boolean;
  /** ms epoch of the last change here (recorded, taken out, brought back):
   * last-write-wins across devices. Absent on records kept before History
   * synced: those count as the oldest, and go up at the first sync. */
  updatedAt?: number;
}

export interface GameRecordSeat {
  profileId: string;
  name: string;
  avatarUrl: string | null;
  commanderName: string | null;
  partnerName: string | null;
  commanderImage: string | null;
  colors: string[];
  deckId: string | null;
  deckName: string | null;
  life: number;
}

export interface DeckCard {
  cardId: string;
  name: string;
  typeLine: string;
  manaCost: string;
  imageNormal: string | null;
  count: number;
  colorIdentity?: string[]; // absent on cards saved before this shipped
}

export interface Deck {
  id: string;
  name: string;
  commander: DeckCard | null;
  /** Second commander: a partner, a Background, the Doctor's companion.
   * Absent on decks saved before partners shipped. */
  partner?: DeckCard | null;
  colors: string[]; // combined color identity of the commander(s)
  cards: DeckCard[]; // everything except the commander(s)
  /** The player physically has these cards, so adding to the deck also
   * logs to the Curation. Absent or false: a planned list. */
  owned?: boolean;
  updatedAt: number; // ms epoch of the last save; last-write-wins across devices
}

export interface GarageCard {
  cardId: string;
  name: string;
  typeLine: string;
  imageNormal: string | null;
  count: number;
  updatedAt: number; // ms epoch; last-write-wins across devices
  deleted: boolean; // tombstone so other devices learn about removals
  dirty: 0 | 1; // awaiting push to the cloud
}

export interface CardRecord {
  id: string;
  colorIdentity?: string[]; // present on cards imported after this field shipped
  name: string;
  nameLower: string;
  typeLine: string;
  oracleText: string;
  manaCost: string;
  power: string | null;
  toughness: string | null;
  colors: string[];
  imageNormal: string | null;
  imageArtCrop: string | null;
  isToken: boolean;
  isBasicLand: boolean;
  priceUsd?: number | null; // present on cards imported after prices shipped
  /** A planeswalker's printed loyalty ("4"; "X" and the like are kept as
   * printed); null for a card with none. Absent on records stored before
   * loyalty was kept — data/scryfall.ts reads such a planeswalker again. */
  loyalty?: string | null;
  /** The other face of a card that turns over (transform, modal, flip, a
   * two-sided token). null: the card was looked at and has none, though its
   * type line holds two halves (split, adventure). Absent on single-faced
   * cards and on every record stored before faces were kept — read it
   * through lib/faces.ts. */
  back?: CardFace | null;
}

/** One face of a card, as far as the table reads it. */
export interface CardFace {
  name: string;
  typeLine: string;
  oracleText: string;
  manaCost: string;
  power: string | null;
  toughness: string | null;
  colors: string[];
  imageNormal: string | null;
  imageArtCrop: string | null;
  /** As on CardRecord: the face's printed loyalty, null for none. */
  loyalty?: string | null;
}

// ---- combat on the cards ----
// Any change to the shape of CombatState has to bump GAME_SCHEMA
// (data/onlineTable.ts): an older build drops a shape it does not know.

/** One creature in a fight: a real card (its instance id) or a stack (its item id). */
export interface CombatUnit {
  kind: 'card' | 'stack';
  id: string;
}

/** A blocker; for a stack, how many of its copies stand in the way (omitted = 1). */
export interface CombatBlock extends CombatUnit {
  n?: number;
}

/** One card attacking, or some copies of one stack attacking one player.
 * A stack's copies are interchangeable, so the state only says how many:
 * a stack that sends copies at two players has two of these. */
export interface CombatAttack {
  unit: CombatUnit; // belongs to the attacking seat
  n?: number; // stack copies attacking (omitted = 1; a card is always 1)
  target: number; // the defending seat
  /** A planeswalker of the defending seat (its instance id) attacked
   * instead of the player; omitted for an attack at the player. A stack's
   * copies at one seat all attack the same one. */
  walker?: string;
  blockers?: CombatBlock[]; // in the order declared; omitted when none
  blocked?: true; // stopped by something that is not on the tablet (a paper card)
  tapped?: number; // how many of these the declaration itself tapped (so a cancel can stand them back up)
}

export interface CombatState {
  id: string;
  turn: number; // GameState.turnNumber when it was declared
  active: number; // the attacking seat = activePlayerIndex when it was declared
  /** 'done' is what Apply and Cancel leave behind until the turn passes,
   * so that a start replayed late meets its own id and does nothing. */
  step: 'attackers' | 'blockers' | 'damage' | 'done';
  attacks?: CombatAttack[]; // omitted while empty; gone at 'done'
  defender?: number; // blockers step: the seat choosing now
}
