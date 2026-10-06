export type Format = 'commander' | 'standard';

export interface PlayerProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  commanderName: string | null;
  commanderColors?: string[] | null; // WUBRG identity, for zone theming
  commanderImage?: string | null; // card image for the home-screen tile
  commanderHistory?: CommanderEntry[]; // recently used commanders, newest first
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
  cardId: string; // local card-DB id; resolved via getCardById
  name: string; // feed text + findCardByName fallback (printing drift)
  tapped?: boolean; // battlefield only; omitted = untapped (per CARD)
  counters?: Record<string, number>; // battlefield only
  row?: 'front' | 'lands'; // battlefield shelf
  /** Battlefield only, meaningful only while tapped: mana units a payment
   * has drawn from this tap. A tapped card with nothing spent is floating
   * its whole yield (the player tapped it by hand). */
  spent?: number;
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
}

/** Synced announcement ring — the trust model's deterrent. Cap 30. */
export interface FeedEntry {
  id: string;
  t: number;
  text: string;
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
  updatedAt: number;
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
}
