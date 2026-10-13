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
  /** Battlefield only: the card arrived since its controller's last turn
   * began. Every card gets it, whatever its type — the reducers do not
   * read cards. Whether it means summoning sickness is for the table and
   * the mana engine to say (lib/keywords.ts). */
  sick?: true;
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
  /** Copies that arrived since their controller's turn began (≤ count).
   * Omitted when none did. */
  sick?: number;
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
