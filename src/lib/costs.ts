import { isCommander } from './cards';
import { conditionHolds, countWith, landContext } from './lands';
import { type ManaColor } from './mana';
import {
  castCosts,
  extraCosts,
  extraTimes,
  parseCost,
  priceExtras,
  priceX,
  type ManaSource,
  type PayCost,
} from './pay';
import { seatSources, tableRead } from './seatMana';
import { spendAllows, spendOnCard, type SpendOn } from './spendOnly';
import { isLandCard } from './turnRules';
import type { CardInstance, CardRecord, GameState } from './types';

// ---- what a spell costs on this table ----
// A spell's price is not always what is printed on it. Its own words can
// make it cheaper ("This spell costs {1} less to cast for each creature on
// the battlefield", affinity for artifacts) or free ("If you control a
// commander, you may cast this spell without paying its mana cost"); the
// permanents on the table can make it cheaper (Ruby Medallion) or dearer
// (Thalia, Sphere of Resistance); it may be cast another way altogether
// (overload, flashback); and convoke, improvise and delve let creatures,
// artifacts and the graveyard pay part of it. Everything that prices a
// cast — the hand's gate, the cast sheet, Pay with, the store — reads it
// from here, so they cannot disagree.

type Records = Record<string, CardRecord | null | undefined>;

/** A permanent's rules text and its name, for the screen. */
export interface Named {
  name: string;
  text: string;
}

/** What a spell's price looks at on the table, as its caster sees it. */
export interface CostTable {
  /** The permanents the caster controls (face-up text). */
  own: Named[];
  /** Everybody else's. */
  others: Named[];
  /** How many of something there are: "creature on the battlefield",
   * "artifact you control", "instant and sorcery card in your graveyard",
   * "the total power of creatures you control". null: not read. */
  count(thing: string): number | null;
  /** Does "you control a Wizard" hold? null: cannot tell. */
  holds(cond: string): boolean | null;
  /** The caster controls a commander. */
  commander: boolean;
}

/** One thing that changes a spell's price: generic mana on top (`n` > 0) or
 * off (`n` < 0). */
export interface CostChange {
  n: number;
  /** For the screen: "Ruby Medallion", "4 artifacts", "Thalia, Guardian of Thraben". */
  why: string;
}

/** "Elves" → "Elf", "artifacts" → "artifact": what a type line says. */
function singular(noun: string): string {
  const n = noun.trim();
  if (/elves$/i.test(n)) return n.replace(/elves$/i, 'Elf');
  if (/(?:ss|us)$/i.test(n)) return n;
  if (/ies$/i.test(n)) return n.replace(/ies$/i, 'y');
  if (/(?:ches|shes|xes)$/i.test(n)) return n.replace(/es$/i, '');
  return n.replace(/s$/i, '');
}

/** Does this type line fit "instant and sorcery", "creature", "permanent", "land"? Any one of the kinds will do. */
function typeFits(typeLine: string, kinds: string): boolean {
  const front = typeLine.split(' // ')[0];
  return kinds
    .split(/\s*(?:,|\band\/or\b|\band\b|\bor\b)\s*/i)
    .filter((k) => k.trim() !== '')
    .some((k) => {
      const word = singular(k.trim().toLowerCase());
      if (word === 'permanent') return !/\b(?:Instant|Sorcery)\b/.test(front);
      if (word === 'nonland') return !/\bLand\b/.test(front);
      return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(front);
    });
}

const PARTY = ['Cleric', 'Rogue', 'Warrior', 'Wizard'];

const CARD_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'];

/** The table as the caster at `seat` sees it. `records`: every battlefield's
 * cards, the board stacks' tokens and the seat's graveyard, as far as known. */
export function costTable(game: GameState, seat: number, records: Records): CostTable {
  const named = (s: number): Named[] => {
    const p = game.players[s];
    const out: Named[] = [];
    for (const c of p?.cards?.battlefield ?? []) {
      const r = records[c.cardId];
      const text = r?.oracleText.split('\n//\n')[0] ?? '';
      if (text) out.push({ name: c.name.split(' // ')[0], text });
    }
    for (const it of p?.board ?? []) if (it.oracleText) out.push({ name: it.name, text: it.oracleText });
    return out;
  };
  const own = named(seat);
  const others = game.players.flatMap((_, s) => (s === seat ? [] : named(s)));
  const read = tableRead(game, seat, records);
  const lands = landContext(game, seat, records);
  const typeOf = (c: CardInstance) => records[c.cardId]?.typeLine ?? '';
  const cards = game.players[seat]?.cards;
  const graveyard = cards?.graveyard ?? [];
  // A card of the graveyard that is not read yet might be anything.
  const graveRead = () => graveyard.every((c) => !!records[c.cardId]);
  const theirs = () =>
    game.players.flatMap((p, s) =>
      s === seat ? [] : [...(p.cards?.battlefield ?? []).map(typeOf).filter(Boolean), ...p.board.flatMap((it) => new Array<string>(Math.min(it.count, 60)).fill(it.typeLine))],
    );
  const creatures = () => read.creatures().filter((k) => !k.unread);

  const count = (thing: string): number | null => {
    const q = thing.trim().replace(/’/g, "'").replace(/^the number of /i, '');
    let m: RegExpMatchArray | null;
    if ((m = q.match(/^the (total|greatest) (power|toughness) (?:of|among) creatures you control$/i))) {
      const sizes = creatures().map((k) => (m![2].toLowerCase() === 'power' ? k.power : k.toughness));
      return m[1].toLowerCase() === 'total' ? sizes.reduce((s, n) => s + Math.max(0, n), 0) : Math.max(0, ...sizes);
    }
    if ((m = q.match(/^opponents? you have$/i))) return lands.opponents;
    // A party: up to one each of Cleric, Rogue, Warrior and Wizard among my creatures.
    if (/^creatures? in your party$/i.test(q)) {
      const fills = (t: string, role: string) => new RegExp(`\\b${role}\\b`).test(t) || /\bChangeling\b/.test(t);
      // Those that fill any role; a dozen is more than a party ever needs to choose from.
      const mine = lands.mine.filter((t) => /\bCreature\b/.test(t) && PARTY.some((r) => fills(t, r))).slice(0, 12);
      let best = 0;
      const pick = (role: number, used: Set<number>, n: number) => {
        if (role === PARTY.length) {
          best = Math.max(best, n);
          return;
        }
        pick(role + 1, used, n);
        mine.forEach((t, i) => {
          if (used.has(i) || !fills(t, PARTY[role])) return;
          used.add(i);
          pick(role + 1, used, n + 1);
          used.delete(i);
        });
      };
      pick(0, new Set(), 0);
      return best;
    }
    if ((m = q.match(/^cards? in your graveyard$/i))) return graveyard.length;
    if ((m = q.match(/^card types? among cards in your graveyard$/i))) {
      if (!graveRead()) return null;
      const lines = graveyard.map(typeOf);
      return CARD_TYPES.filter((t) => lines.some((l) => new RegExp(`\\b${t}\\b`, 'i').test(l.split(' // ')[0]))).length;
    }
    if ((m = q.match(/^(.+?) cards? in your graveyard$/i))) {
      if (!graveRead() || /\b(?:with|that|named)\b/i.test(m[1])) return null;
      return graveyard.filter((c) => typeFits(typeOf(c), m![1])).length;
    }
    if ((m = q.match(/^(.+?) on the battlefield$/i))) {
      if (/\b(?:with|that|named)\b/i.test(m[1])) return null;
      return countWith(read.everyone(), singular(m[1]));
    }
    if ((m = q.match(/^(.+?) your opponents control$/i))) {
      if (/\b(?:with|that|named)\b/i.test(m[1])) return null;
      return countWith(theirs(), singular(m[1]));
    }
    if ((m = q.match(/^(other )?(.+?) you control$/i))) {
      if (/\b(?:with|that|named|among)\b/i.test(m[2])) return null;
      return countWith(lands.mine, singular(m[2]));
    }
    return null;
  };

  // "If you control a commander": one of the commanders of the table on the caster's side.
  const commander = (cards?.battlefield ?? []).some((c) => {
    const owner = c.stolen ? game.players[c.stolen.owner]?.cards : cards;
    return !!owner && isCommander(owner, c.iid) === true;
  });

  return {
    own,
    others,
    count,
    holds: (cond) => conditionHolds(cond, { ...lands, creatures: read.creatures() }),
    commander,
  };
}

// ---- the spell's own words ----

const SELF = '(?:This spell|~)';
const SELF_EACH = new RegExp(`^${SELF} costs \\{(\\d+)\\} less to cast for each (.+?)\\.$`, 'i');
const SELF_X = new RegExp(`^${SELF} costs \\{X\\} less to cast, where X is (.+?)\\.$`, 'i');
const SELF_IF = new RegExp(`^${SELF} costs \\{(\\d+)\\} less to cast if (.+?)\\.$`, 'i');
const FREE_IF = /^If (.+?), you may cast this spell without paying its mana cost\.$/i;
const AFFINITY = /^Affinity for ([^(]+?)\s*$/i;

/** The sentences of a face's rules text, its name read as "~", reminder text gone. */
function sentences(text: string, name: string): string[] {
  const short = name.split(' // ')[0];
  return text
    .replace(/\([^)]*\)/g, '')
    .split(short ? short : '\u0000')
    .join('~')
    .split('\n')
    .flatMap((line) => line.split(/(?<=\.)\s+(?=[A-Z])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word.replace(/y$/, 'ie')}s`}`;

/** What a face's own words take off its price on this table. */
function ownChanges(text: string, name: string, table: CostTable): CostChange[] {
  const out: CostChange[] = [];
  for (const s of sentences(text, name)) {
    let m: RegExpMatchArray | null;
    if ((m = s.match(AFFINITY))) {
      const n = table.count(`${m[1]} you control`);
      if (n) out.push({ n: -n, why: `affinity: ${n} ${m[1].trim()}` });
    } else if ((m = s.match(SELF_EACH))) {
      const n = table.count(m[2]);
      if (n) out.push({ n: -Number(m[1]) * n, why: plural(n, singular(m[2].split(/\s+(?:on|you|your|in|among)\b/i)[0])) });
    } else if ((m = s.match(SELF_X))) {
      const n = table.count(m[1]);
      if (n) out.push({ n: -n, why: m[1].replace(/^the /i, '') });
    } else if ((m = s.match(SELF_IF))) {
      if (table.holds(m[2]) === true) out.push({ n: -Number(m[1]), why: m[2] });
    }
  }
  return out;
}

/** "If you control a commander, you may cast this spell without paying its
 * mana cost" (Fierce Guardianship, Deflecting Swat): why it is free on this
 * table, or null. */
export function freeBecause(record: Pick<CardRecord, 'name' | 'oracleText'> | null | undefined, table: CostTable): string | null {
  if (!record) return null;
  for (const s of sentences(record.oracleText.split('\n//\n')[0], record.name)) {
    const m = s.match(FREE_IF);
    if (!m) continue;
    const cond = m[1].trim();
    if (/^you control a commander$/i.test(cond)) {
      if (table.commander) return 'you control a commander';
    } else if (table.holds(cond) === true) return cond;
  }
  return null;
}

// ---- the permanents on the table ----

/** "Historic" is the one kind word spells are sorted by that a type line does not say. */
const kindWords = (kinds: string) => kinds.replace(/\bhistoric\b/gi, 'artifact, legendary, or Saga');

/** May "Red spells", "Instant and sorcery spells", "Noncreature spells with
 * mana value 4 or greater" mean this one? Words the app cannot read
 * ("of the chosen type", "that target ~") never do: the price stays as
 * printed, and Pay with is the way round. */
function meant(subject: string, on: SpendOn): boolean {
  return spendAllows(`to cast ${kindWords(subject)}`, on) === true;
}

const YOURS = /^(.*\bspells?)\s+you cast(.*?)\s+costs? \{(\d+)\} (less|more) to cast\.$/i;
const THEIRS = /^(.*\bspells?)\s+your opponents cast(.*?)\s+costs? \{(\d+)\} (less|more) to cast\.$/i;
const EVERYONE = /^(.*\bspells?)(.*?)\s+costs? \{(\d+)\} (less|more) to cast\.$/i;

/** What one permanent's words do to the price of a spell its controller
 * (`mine`) or somebody else casts. */
function staticChanges(one: Named, mine: boolean, on: SpendOn): CostChange[] {
  const out: CostChange[] = [];
  for (const s of sentences(one.text, one.name)) {
    // A quoted ability is the creature's it is given to; "This spell" is the spell's own.
    if (s.includes('"') || /^(?:This spell|~)\b/i.test(s)) continue;
    let m = s.match(YOURS);
    let whose: 'you' | 'they' | 'all' = 'you';
    if (!m && (m = s.match(THEIRS))) whose = 'they';
    if (!m && (m = s.match(EVERYONE))) whose = 'all';
    if (!m) continue;
    if ((whose === 'you' && !mine) || (whose === 'they' && mine)) continue;
    // "Blue spells and red spells", then what follows "you cast" ("from your
    // graveyard"): the kinds, and the words that hold for every one of them.
    const kinds = m[1].replace(/\bspells?\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const tail = m[2].trim();
    if (whose === 'all' && /\b(?:you|your|they|their|player|enchanted)\b/i.test(`${kinds} ${tail}`)) continue;
    if (!meant(`${kinds} spells`.trim(), on) || (tail !== '' && !meant(`spells ${tail}`, on))) continue;
    const n = Number(m[3]);
    out.push({ n: m[4].toLowerCase() === 'less' ? -n : n, why: one.name });
  }
  return out;
}

/** Everything that changes what this face costs on this table: its own
 * words, then every permanent's. */
export function costChanges(
  record: Pick<CardRecord, 'name' | 'oracleText'>,
  face: number,
  on: SpendOn,
  table: CostTable,
): CostChange[] {
  const text = record.oracleText.split('\n//\n')[face] ?? record.oracleText.split('\n//\n')[0];
  return [
    ...ownChanges(text, record.name.split(' // ')[face] ?? record.name, table),
    ...table.own.flatMap((one) => staticChanges(one, true, on)),
    ...table.others.flatMap((one) => staticChanges(one, false, on)),
  ];
}

/** The cost with its changes made: what costs more is added first, then
 * what costs less comes off — the generic part only, never below none. */
export function changedCost(cost: PayCost, changes: CostChange[]): PayCost {
  if (changes.length === 0) return cost;
  const more = changes.reduce((s, c) => s + Math.max(0, c.n), 0);
  const less = changes.reduce((s, c) => s - Math.min(0, c.n), 0);
  return { ...cost, generic: Math.max(0, cost.generic + more - less) };
}

// ---- other ways to cast it ----

/** A way of casting a card for another cost: overload (from the hand, the
 * spell's "target" becomes "each"), flashback (from the graveyard, and it is
 * exiled after). */
export interface CastWay {
  kind: 'overload' | 'flashback';
  /** As printed: "Overload {6}{U}". */
  label: string;
  cost: PayCost;
}

const WAY = /^(Overload|Flashback) ((?:\{[^}]+\})+)\s*$/i;

/** The ways printed on a card's front face that cost mana (a flashback
 * that is not mana — "Flashback—Sacrifice a creature" — is left out). */
export function castWays(record: Pick<CardRecord, 'typeLine' | 'oracleText'> | null | undefined): CastWay[] {
  if (!record || isLandCard(record.typeLine)) return [];
  const out: CastWay[] = [];
  for (const line of record.oracleText.split('\n//\n')[0].replace(/\([^)]*\)/g, '').split('\n')) {
    const m = line.trim().match(WAY);
    if (!m) continue;
    const cost = parseCost(m[2]);
    out.push({ kind: m[1].toLowerCase() as CastWay['kind'], label: `${m[1]} ${m[2]}`, cost });
  }
  return out;
}

export const wayOf = (record: Parameters<typeof castWays>[0], kind: CastWay['kind']): CastWay | null =>
  castWays(record).find((w) => w.kind === kind) ?? null;

/** An overloaded spell's words: every "target" becomes "each" (CR 702.96b). */
export function overloaded(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^Overload\b/i.test(line.trim()))
    .join('\n')
    .replace(/\bup to (?:one|two|three|X) target\b/gi, 'each')
    .replace(/\b(?:any|one|two|three) target\b/gi, 'each')
    .replace(/\btarget\b/gi, 'each');
}

/** What a card is cast with, beyond its printed cost: X, the extras
 * (kicker…), another way (overload, flashback). */
export interface CastAsk {
  from: 'hand' | 'command' | 'graveyard';
  tax?: number;
  x?: number;
  extras?: readonly number[];
  way?: CastWay['kind'];
}

/** The price of a cast on this table. */
export interface CastPrice {
  /** What each face the cast could pay costs (lib/pay.ts PayCost), every change made. */
  faces: PayCost[];
  /** What changed the first face's price, for the screen. */
  changes: CostChange[];
  /** Cast without paying its mana cost: why (only the changes that add to it remain). */
  free: string | null;
  /** The other way it is cast, when one was asked for and the card has it. */
  way: CastWay | null;
}

/** What casting this card costs right now, everything said. A card cast
 * another way (overload, flashback) pays that way's cost; one that is free
 * on this table pays nothing but what the table adds (Thalia); X and the
 * extras go on top before the reductions come off. */
export function castPrice(
  record: (Pick<CardRecord, 'name' | 'typeLine' | 'manaCost' | 'oracleText'> & Partial<Pick<CardRecord, 'colors'>>) | null | undefined,
  ask: CastAsk,
  table: CostTable | null,
): CastPrice {
  const from = ask.from === 'command' ? 'command' : 'hand';
  const way = record && ask.way ? wayOf(record, ask.way) : null;
  const more = { from: ask.from, ...(ask.from === 'command' ? { commander: true } : {}) } as const;
  let faces: PayCost[];
  if (way && record) faces = [{ ...way.cost, on: spendOnCard(record, 'cast', 0, more) }];
  else {
    faces = castCosts(record, from, ask.tax ?? 0);
    if (ask.from === 'graveyard') faces = faces.map((f) => (f.on ? { ...f, on: { ...f.on, from: 'graveyard' as const } } : f));
  }
  const free = !way && ask.from === 'hand' && table ? freeBecause(record, table) : null;
  if (free) faces = faces.map((f) => ({ generic: 0, pips: [], ...(f.on ? { on: f.on } : {}) }));
  else faces = priceX(faces, Math.max(0, ask.x ?? 0));
  // Extras are paid from the hand only (lib/pay.ts asksAtCast).
  if (ask.from === 'hand' && !way) {
    const extras = extraCosts(record);
    faces = priceExtras(faces, extras, extraTimes(extras, ask.extras));
  }
  if (!record || !table) return { faces, changes: [], free, way };
  const all = faces.map((f, i) => {
    if (!f.on) return [];
    const changes = costChanges(record, way ? 0 : i, f.on, table);
    // Free: nothing comes off a cost of nothing, but what adds to it does.
    return free ? changes.filter((c) => c.n > 0) : changes;
  });
  return { faces: faces.map((f, i) => changedCost(f, all[i])), changes: all[0] ?? [], free, way };
}

/** "−1 Ruby Medallion · −3 affinity: 3 artifacts · +1 Thalia": the changes, for the screen. */
export function changesWords(changes: CostChange[]): string {
  return changes.map((c) => `${c.n > 0 ? '+' : '−'}${Math.abs(c.n)} ${c.why}`).join(' · ');
}

// ---- cycling ----

/** One way to cycle a card from the hand: pay, discard it, draw a card —
 * or, typecycling, find a card of that type in the library instead. */
export interface CycleWay {
  /** As printed: "Cycling {2}", "Swampcycling {2}", "Basic landcycling {1}". */
  label: string;
  /** The mana it costs (none for "Cycling—Pay 2 life"). */
  cost: PayCost;
  /** "Cycling—Pay 2 life". */
  life?: number;
  /** Typecycling: what it finds, as a search says it — "a Swamp card",
   * "a basic land card". Left out: it draws a card. */
  find?: string;
}

const CYCLE = /^(?:(basic land|[a-z]+)cycling|cycling)\s*(?:((?:\{[^}]+\})+)|—\s*pay (\d+) life\.?)$/i;

/** The ways to cycle printed on a card's front face, in order. One the
 * table cannot price ("Cycling {X}", "Cycling—Sacrifice a land") is left out. */
export function cycleWays(record: Pick<CardRecord, 'oracleText'> | null | undefined): CycleWay[] {
  if (!record) return [];
  const out: CycleWay[] = [];
  for (const line of record.oracleText.split('\n//\n')[0].replace(/\([^)]*\)/g, '').split('\n'))
    for (const part of line.split(/,\s*/)) {
      const m = part.trim().match(CYCLE);
      if (!m) continue;
      const label = part.trim().replace(/\.$/, '');
      const cost = m[2] ? parseCost(m[2]) : { generic: 0, pips: [] };
      if (cost.x) continue;
      const kind = m[1]?.toLowerCase();
      const type = kind ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}` : '';
      const find = !kind
        ? undefined
        : kind === 'basic land'
          ? 'a basic land card'
          : kind === 'land'
            ? 'a land card'
            : `${/^[AEIOU]/.test(type) ? 'an' : 'a'} ${type} card`;
      out.push({ label, cost, ...(m[3] ? { life: Number(m[3]) } : {}), ...(find ? { find } : {}) });
    }
  return out;
}

// ---- convoke, improvise, delve ----

/** Help a spell's own words give its payment: creatures tapped (convoke),
 * artifacts tapped (improvise), cards exiled from the graveyard (delve). */
export type Help = 'convoke' | 'improvise' | 'delve';

export function helpsOf(record: Pick<CardRecord, 'oracleText'> | null | undefined, face = 0): Help[] {
  if (!record) return [];
  const text = (record.oracleText.split('\n//\n')[face] ?? '').replace(/\([^)]*\)/g, '');
  const out: Help[] = [];
  for (const help of ['convoke', 'improvise', 'delve'] as const)
    if (new RegExp(`^(?:[A-Za-z ,]+, )?${help}\\b[ \\t]*(?:,|$)`, 'im').test(text)) out.push(help);
  return out;
}

const COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G'];

/** Everything that can pay for casting this card: the seat's mana, and
 * what the card's own words let pay besides (convoke, improvise, delve).
 * `casting`: the card being cast. `mana`: the seat's mana, when already read. */
export function castSources(
  game: GameState,
  seat: number,
  records: Records,
  record: Pick<CardRecord, 'oracleText'> | null | undefined,
  casting?: string,
  mana: ManaSource[] = seatSources(game, seat, records),
): ManaSource[] {
  const helps = helpsOf(record);
  return helps.length > 0 ? [...mana, ...helperSources(game, seat, records, mana, helps, casting)] : mana;
}

/** The key a card in the graveyard pays under (delve). */
export const graveKey = (iid: string) => `grave:${iid}`;
export const fromGraveKey = (key: string): string | null => (key.startsWith('grave:') ? key.slice(6) : null);

/** What a spell with convoke, improvise or delve can pay with beyond the
 * seat's mana (`sources`): its untapped creatures — each {1} or one mana of
 * its color, summoning sick or not —, its untapped artifacts — {1} each —,
 * the cards in its graveyard — {1} each. A permanent that makes mana is
 * offered as the mana source it is. `casting`: the card being cast (it
 * cannot pay for itself). */
export function helperSources(
  game: GameState,
  seat: number,
  records: Records,
  sources: ManaSource[],
  helps: Help[],
  casting?: string,
): ManaSource[] {
  if (helps.length === 0) return [];
  const player = game.players[seat];
  const cards = player?.cards;
  const taken = new Set(sources.map((s) => (s.stored?.iid ?? s.key)));
  const out: ManaSource[] = [];
  const typeUp = (c: CardInstance) => (records[c.cardId]?.typeLine ?? '').split(' // ')[0];
  const colorsOf = (r: Pick<CardRecord, 'colors'> | null | undefined): ManaColor[] =>
    (r?.colors ?? []).filter((c): c is ManaColor => (COLORS as string[]).includes(c));
  for (const c of cards?.battlefield ?? []) {
    if (c.tapped || c.iid === casting || taken.has(c.iid) || c.on) continue;
    const type = typeUp(c);
    if (helps.includes('convoke') && /\bCreature\b/.test(type)) {
      out.push({ key: c.iid, kind: 'virtual', produces: colorsOf(records[c.cardId]), amount: 1, creature: true, helps: 'convoke' });
    } else if (helps.includes('improvise') && /\bArtifact\b/.test(type)) {
      out.push({ key: c.iid, kind: 'virtual', produces: [], amount: 1, helps: 'improvise' });
    }
  }
  if (helps.includes('convoke') || helps.includes('improvise')) {
    for (const it of player?.board ?? []) {
      if (it.zone === 'lands') continue;
      const creature = /\bCreature\b/.test(it.typeLine);
      const help: Help | null = creature && helps.includes('convoke') ? 'convoke' : /\bArtifact\b/.test(it.typeLine) && helps.includes('improvise') ? 'improvise' : null;
      if (!help) continue;
      const offered = sources.filter((s) => s.key === it.id).length;
      const free = Math.max(0, Math.min(it.count, 60) - (it.tapped ?? 0) - offered);
      const produces = help === 'convoke' ? colorsOf(it.cardId ? records[it.cardId] : null) : [];
      for (let i = 0; i < free; i++)
        out.push({ key: it.id, kind: 'board', produces, amount: 1, ...(creature ? { creature: true } : {}), helps: help });
    }
  }
  if (helps.includes('delve'))
    for (const c of cards?.graveyard ?? []) {
      if (c.iid === casting) continue;
      out.push({ key: graveKey(c.iid), kind: 'virtual', produces: [], amount: 1, helps: 'delve' });
    }
  return out;
}
