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
}

export interface PlayerState {
  profileId: string;
  life: number;
  commanderDamage: Record<string, number>; // keyed by opposing profile id
  eliminated: boolean;
  board: BoardItem[];
  counters: Record<string, number>; // poison, energy, experience…
  commanderDeaths: number; // tax = deaths × 2
}

export interface GameState {
  config: GameConfig;
  players: PlayerState[];
  activePlayerIndex: number;
  turnNumber: number;
  monarchIdx: number | null;
  initiativeIdx: number | null;
  turnStartedAt: number;
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
}
