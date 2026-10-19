import { keywordsGiven } from './attach';
import { isSummoningSick, permanentTexts, sickCopies, tapsAsThoughHasty } from './keywords';
import { tapManaByUse, tapManaFromText, type ManaColor } from './mana';
import { spendAllows, spendOnCard, type SpendOn } from './spendOnly';
import { godsFrom, notHeldBack } from './gods';
import { manaTable, manaTextHere, type TableRead } from './manaHere';
import { countersTaken, storedHere, type StoredDraw, type Taken } from './storedMana';
import { isLandCard } from './turnRules';
import type { BoardItem, CardInstance, CardRecord } from './types';

/** A cost split for payment: generic count plus one entry per colored
 * pip, each listing the colors that satisfy it (hybrids list two). */
export interface PayCost {
  generic: number;
  pips: ManaColor[][];
  /** How many {X} the face holds. Left out when it holds none. X costs
   * nothing until the caster names it — see withX. */
  x?: number;
  /** What it pays for — a creature spell, an Equipment's equip — where
   * mana kept for some things ("Spend this mana only…") asks. Left out:
   * not known, and such mana pays, last. */
  on?: SpendOn;
}

/** One thing a seat can draw mana from right now: a virtual card (key =
 * iid) or one copy of a board stack (key = item id; copies repeat it). */
export interface ManaSource {
  key: string;
  kind: 'virtual' | 'board';
  produces: (ManaColor | 'any')[];
  /** Units on offer: a fresh Sol Ring has 2, a tapped one whatever is left. */
  amount: number;
  /** Already tapped by hand — its unspent mana is sitting in the pool. */
  floating?: boolean;
  /** Creatures pay last (they may be needed to attack). One that is
   * summoning sick is not on offer at all: sourcesFrom leaves it out. */
  creature?: boolean;
  /** Its mana is kept for some things: the words after "Spend this mana
   * only" (Ancient Ziggurat: "to cast a creature spell"). `produces` and
   * `amount` are then what it makes for those, and `free` what it makes
   * for anything else (Cavern of Souls' {C}); left out, nothing. */
  only?: string;
  free?: { produces: (ManaColor | 'any')[]; amount: number };
  /** Some of its mana comes off the card's own counters (lib/storedMana.ts):
   * what a payment drawing on it takes off them. A source of only that —
   * Pentad Prism, a tapped Dreadship Reef — has a key of its own and is not
   * tapped (`stored.iid` is the card). */
  stored?: StoredDraw;
  /** Not mana at all, but what a spell's own words let pay for it
   * (lib/costs.ts helperSources): a creature tapped for convoke, an
   * artifact tapped for improvise, a card exiled from the graveyard for
   * delve. Improvise and delve pay generic mana only (`produces` is empty). */
  helps?: 'convoke' | 'improvise' | 'delve';
}

/** What the payment does: units to draw from each virtual card (tapping it
 * if it is not already), and copies to tap per board stack. */
export interface PaymentPlan {
  spend: Record<string, number>;
  boardTaps: Record<string, number>;
  /** Counters the payment takes off cards that keep mana in them. Left out: none. */
  taken?: Taken[];
}

const COLOR_SET = new Set(['W', 'U', 'B', 'R', 'G', 'C']);

/** One cost per castable face. Adventure, split, omen and Room cards
 * carry "front // back" in a single mana-cost string; a cast pays ONE of
 * them, never both added together. */
export function parseCosts(manaCost: string): PayCost[] {
  return manaCost.split(' // ').map(parseFace);
}

/** The front face's cost: what the card costs as a permanent, and what
 * a commander costs from the command zone. */
export function parseCost(manaCost: string): PayCost {
  return parseFace(manaCost.split(' // ')[0]);
}

/** {3}{G}{G} → 3 generic + two G pips. {X} is counted, not priced (the
 * caster names it: see withX); hybrid {G/W} accepts either side; {2/W}
 * and phyrexian {G/P} approximate to their color; {C} stays strict (an
 * any-color source cannot make colorless). */
function parseFace(manaCost: string): PayCost {
  let generic = 0;
  let x = 0;
  const pips: ManaColor[][] = [];
  for (const [, symbol] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    if (/^\d+$/.test(symbol)) {
      generic += Number(symbol);
      continue;
    }
    if (symbol.includes('X')) {
      x += 1; // chosen at cast
      continue;
    }
    const colors = symbol.split('/').filter((part) => COLOR_SET.has(part)) as ManaColor[];
    if (colors.length > 0) pips.push(colors);
    else generic += 1; // snow and friends: close enough to generic
  }
  return x > 0 ? { generic, pips, x } : { generic, pips };
}

/** The cost of each face a cast from this zone could pay: every castable
 * face from hand, the front face with its tax from the command zone. A
 * land is played, not cast, so from hand it has no cost at all (a spell
 * with a land on its back is still a spell: isLandCard) — and an
 * unread card costs nothing, as always. The store and the table both
 * price from here, so they cannot disagree about what a card asks. */
export function castCosts(
  record: (Pick<CardRecord, 'typeLine' | 'manaCost'> & Partial<Pick<CardRecord, 'oracleText' | 'colors'>>) | null | undefined,
  from: 'hand' | 'command',
  tax = 0,
): PayCost[] {
  // What each face is, for mana that may only pay for some spells.
  const on = (face: number): { on?: SpendOn } =>
    record ? { on: spendOnCard(record, 'cast', face, { from, ...(from === 'command' ? { commander: true } : {}) }) } : {};
  if (from === 'command') {
    const cost = parseCost(record?.manaCost ?? '');
    return [{ ...cost, generic: cost.generic + tax, ...on(0) }];
  }
  if (isLandCard(record?.typeLine ?? '')) return [];
  return parseCosts(record?.manaCost ?? '').map((cost, face) => ({ ...cost, ...on(face) }));
}

/** Does any of these faces hold an {X}? Then the cast has to ask for it. */
export function hasX(costs: PayCost[]): boolean {
  return costs.some((cost) => (cost.x ?? 0) > 0);
}

/** The cost with X named: `value` more generic mana for every {X} in it. */
export function withX(cost: PayCost, value: number): PayCost {
  if (!cost.x || !(value > 0)) return cost;
  return { ...cost, generic: cost.generic + cost.x * value };
}

/** What a cast for this X can be paying. A value above zero can only mean
 * a face with an X to put it in (Expansion // Explosion for 3 is Explosion,
 * never the cheaper half); zero leaves every face open, like any other
 * card. A card without X costs what it costs. */
export function priceX(costs: PayCost[], x: number): PayCost[] {
  const open = costs.filter((cost) => cost.x);
  return (x > 0 && open.length > 0 ? open : costs).map((cost) => withX(cost, x));
}

// ---- optional extra costs: kicker and its relatives ----

/** A cost a spell MAY be cast with on top of its own, as the rules text
 * prints it: "Kicker {U}", "Multikicker {1}{G}", "Buyback {3}". Only the
 * paying is the table's business — what the spell then does differently
 * stays with the players, like every spell effect. */
export interface ExtraCost {
  kind: 'kicker' | 'multikicker' | 'buyback' | 'entwine' | 'replicate' | 'escalate' | 'squad';
  /** As printed, for the screen: "Kicker {U}". */
  label: string;
  cost: PayCost;
  /** May be paid any number of times (multikicker, replicate, squad; escalate once per extra mode). */
  many: boolean;
}

const EXTRA_LINE =
  /^(Kicker|Multikicker|Buyback|Entwine|Replicate|Escalate|Squad) ((?:\{[^}]+\})+)(?: and\/or ((?:\{[^}]+\})+))?/i;
const MANY = new Set(['multikicker', 'replicate', 'escalate', 'squad']);

/** The optional extra costs printed on a card's FRONT face, in the order
 * printed. A land has none. One the table cannot price is left out — a
 * cost with {X} in it, or one that is not mana at all ("Kicker—Sacrifice
 * a land"): the card then simply casts as it always did. "Kicker {1}{G}
 * and/or {2}{U}" is two kickers. */
export function extraCosts(
  record: Pick<CardRecord, 'typeLine' | 'oracleText'> | null | undefined,
): ExtraCost[] {
  if (!record || isLandCard(record.typeLine)) return [];
  const out: ExtraCost[] = [];
  for (const line of record.oracleText.split('\n//\n')[0].split('\n')) {
    const m = line.match(EXTRA_LINE);
    if (!m) continue;
    const kind = m[1].toLowerCase() as ExtraCost['kind'];
    for (const printed of [m[2], m[3]]) {
      if (!printed) continue;
      const cost = parseCost(printed);
      if (cost.x) continue; // nobody has said what X is
      out.push({ kind, label: `${m[1]} ${printed}`, cost, many: MANY.has(kind) });
    }
  }
  return out;
}

/** How often each extra is paid, as a cast may safely be asked for: whole
 * numbers, none below zero, at most once for an extra that is paid once. */
export function extraTimes(extras: ExtraCost[], asked: readonly unknown[] | undefined): number[] {
  return extras.map((extra, i) => {
    const n = asked?.[i];
    const whole = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    return extra.many ? Math.min(whole, 99) : Math.min(whole, 1);
  });
}

/** Each face's cost with the chosen extras on top. */
export function priceExtras(costs: PayCost[], extras: ExtraCost[], times: number[]): PayCost[] {
  if (!times.some((n) => n > 0)) return costs;
  // Elfhame Druid's mana is for "kicked spells".
  const kicked = extras.some((e, i) => /kicker/.test(e.kind) && (times[i] ?? 0) > 0);
  return costs.map((cost) => {
    let generic = cost.generic;
    const pips = [...cost.pips];
    extras.forEach((extra, i) => {
      for (let k = 0; k < (times[i] ?? 0); k++) {
        generic += extra.cost.generic;
        pips.push(...extra.cost.pips);
      }
    });
    return { ...cost, generic, pips, ...(kicked && cost.on ? { on: { ...cost.on, kicked: true } } : {}) };
  });
}

const PAID: Record<ExtraCost['kind'], string> = {
  kicker: 'kicked',
  multikicker: 'kicked',
  buyback: 'with buyback',
  entwine: 'entwined',
  replicate: 'replicated',
  escalate: 'escalated',
  squad: 'with squad',
};

/** What the table is told about them: ", kicked", ", kicked 3 times",
 * ", with buyback" — nothing when none was paid. */
export function extrasWords(extras: ExtraCost[], times: number[]): string {
  const said: string[] = [];
  extras.forEach((extra, i) => {
    const n = times[i] ?? 0;
    if (n <= 0) return;
    const word = PAID[extra.kind];
    const twice = extras.filter((e, k) => e.kind === extra.kind && (times[k] ?? 0) > 0).length > 1;
    // Two kickers, both paid, are said once: "kicked twice" reads as the game says it.
    if (twice && said.some((s) => s.startsWith(word))) return;
    const total = twice
      ? extras.reduce((sum, e, k) => sum + (e.kind === extra.kind ? (times[k] ?? 0) : 0), 0)
      : n;
    said.push(total === 1 ? word : total === 2 ? `${word} twice` : `${word} ${total} times`);
  });
  return said.map((s) => `, ${s}`).join('');
}

/** Does casting this card from there have something to ask first — how
 * much X is, whether an extra cost is paid, whether it is overloaded? Then
 * it opens the cast sheet instead of casting at once. (Extras and overload
 * are asked from the hand only.) */
export function asksAtCast(
  record: Pick<CardRecord, 'typeLine' | 'manaCost' | 'oracleText'> | null | undefined,
  from: 'hand' | 'command',
  tax = 0,
): boolean {
  return (
    hasX(castCosts(record, from, tax)) ||
    (from === 'hand' && (extraCosts(record).length > 0 || /^Overload \{/im.test(record?.oracleText.split('\n//\n')[0] ?? '')))
  );
}

/** "Hydra enters with X +1/+1 counters on it": the one consequence of X
 * the table carries out by itself. (Older card data says "enters the
 * battlefield with".) */
export function entersWithX(oracleText: string): boolean {
  return /\benters (?:the battlefield )?with X \+1\/\+1 counters on it\b/i.test(oracleText);
}

/** Can this source pay that colored pip? */
export function canPay(s: ManaSource, pip: ManaColor[]): boolean {
  if (s.produces.includes('any') && pip.some((c) => c !== 'C')) return true; // any color ≠ colorless
  return s.produces.some((p) => p !== 'any' && pip.includes(p));
}

/** May this source's kept mana pay for it? Unknown purpose or unread
 * words: null — it may, generously, but it pays last. */
function keptFor(s: ManaSource, on: SpendOn | undefined): boolean | null {
  return s.only && on ? spendAllows(s.only, on) : null;
}

/** The sources as they stand for this payment. Mana kept for other things
 * ("Spend this mana only to cast creature spells") is not there for a
 * Lightning Bolt: the source makes what it makes for anything else
 * (Cavern of Souls' {C}), or nothing. */
export function sourcesFor(sources: ManaSource[], on: SpendOn | undefined): ManaSource[] {
  if (!sources.some((s) => s.only)) return sources;
  const out: ManaSource[] = [];
  for (const s of sources) {
    if (!s.only || keptFor(s, on) !== false) {
      out.push(s);
      continue;
    }
    // Tapped by hand: which of its abilities it was is not known — at most what the free one makes.
    const amount = Math.min(s.amount, s.free?.amount ?? 0);
    if (!s.free || amount <= 0) continue;
    const { only: _o, free: _f, ...rest } = s;
    out.push({ ...rest, produces: s.free.produces, amount });
  }
  return out;
}

/** Lower pays first: mana already floating, then mana kept for just this
 * kind of spell (it pays for nothing else), then colorless-only sources
 * (they can never cover a colored pip), then the least flexible — so duals
 * and any-color lands stay open. Creatures go late, mana saved up as
 * counters later, and mana whose "only…" the app cannot read last of all. */
function rank(s: ManaSource, on: SpendOn | undefined): number {
  // Delve: the graveyard pays before a land is tapped, as players delve.
  if (s.helps === 'delve') return 50;
  const flexibility = s.produces.includes('any') ? 9 : s.produces.length;
  const onlyColorless = s.produces.length === 1 && s.produces[0] === 'C';
  const kept = s.only ? keptFor(s, on) : undefined;
  return (
    (s.floating ? 0 : kept === true ? 500 : 1000) +
    (kept === null ? 300 : 0) +
    (s.stored ? 200 : 0) +
    (s.creature ? 100 : 0) +
    (s.helps === 'improvise' ? 150 : 0) +
    (onlyColorless ? 0 : 10) +
    flexibility
  );
}

/** Colored pips are matched with augmenting paths, so an assignment is
 * found whenever one exists; generic then fills from what is left,
 * preferring to drain a source whole over leaving it half-used. Null
 * when the seat cannot pay. */
export function planPayment(cost: PayCost, sources: ManaSource[]): PaymentPlan | null {
  const pool = [...sourcesFor(sources, cost.on)].sort((a, b) => rank(a, cost.on) - rank(b, cost.on));
  const left = pool.map((s) => s.amount);
  const used = pool.map(() => 0);

  // pip index held by each unit of each source
  const holder: number[][] = pool.map((s) => new Array<number>(s.amount).fill(-1));
  const tryPip = (pip: number, seen: Set<string>): boolean => {
    for (let s = 0; s < pool.length; s++) {
      if (!canPay(pool[s], cost.pips[pip])) continue;
      for (let u = 0; u < holder[s].length; u++) {
        const id = `${s}:${u}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (holder[s][u] === -1 || tryPip(holder[s][u], seen)) {
          holder[s][u] = pip;
          return true;
        }
      }
    }
    return false;
  };
  for (let pip = 0; pip < cost.pips.length; pip++) {
    if (!tryPip(pip, new Set())) return null;
  }
  holder.forEach((units, s) => {
    used[s] = units.filter((p) => p !== -1).length;
    left[s] -= used[s];
  });

  let generic = cost.generic;
  const take = (s: number, n: number) => {
    used[s] += n;
    left[s] -= n;
    generic -= n;
  };
  // Mana saved up as counters pays generic only once nothing else can (step 4).
  const open = (s: number) => left[s] > 0 && !pool[s].stored;
  // 1) mana that is spent or lost anyway: floating, or left on a source a pip opened
  for (let s = 0; s < pool.length && generic > 0; s++) {
    if (open(s) && (pool[s].floating || used[s] > 0)) take(s, Math.min(left[s], generic));
  }
  // 2) fresh sources that the remaining cost drains completely
  for (let s = 0; s < pool.length && generic > 0; s++) {
    if (open(s) && left[s] <= generic) take(s, left[s]);
  }
  // 3) whatever is left breaks open one more source
  for (let s = 0; s < pool.length && generic > 0; s++) {
    if (open(s)) take(s, Math.min(left[s], generic));
  }
  // 4) one mana at a time from the card it costs the fewest counters: a
  // Dreadship Reef's own {C} before a counter off Pentad Prism, the Prism's
  // one counter before the Reef's next two.
  const held = (s: number) => holder[s].filter((p) => p !== -1).map((p) => cost.pips[p]);
  while (generic > 0) {
    let best = -1;
    let fewest = Infinity;
    for (let s = 0; s < pool.length; s++) {
      const stored = pool[s].stored;
      if (!stored || left[s] <= 0) continue;
      const more = countersTaken(stored, used[s] + 1, held(s)) - countersTaken(stored, used[s], held(s));
      if (more < fewest) {
        best = s;
        fewest = more;
      }
    }
    if (best < 0) break;
    take(best, 1);
  }
  if (generic > 0) return null;

  const plan: PaymentPlan = { spend: {}, boardTaps: {} };
  const taken: Taken[] = [];
  pool.forEach((s, i) => {
    if (used[i] === 0) return;
    if (s.kind === 'virtual') plan.spend[s.key] = (plan.spend[s.key] ?? 0) + used[i];
    else plan.boardTaps[s.key] = (plan.boardTaps[s.key] ?? 0) + 1;
    // Counters come off for what the card's tap alone does not make: the
    // colored pips its units paid say which that is.
    if (!s.stored) return;
    const pips = holder[i].filter((p) => p !== -1).map((p) => cost.pips[p]);
    const n = countersTaken(s.stored, used[i], pips);
    if (n > 0) taken.push({ iid: s.stored.iid, kind: s.stored.kind, n, ...(s.stored.goes ? { goes: true as const } : {}) });
  });
  if (taken.length > 0) plan.taken = taken;
  return plan;
}

export function affordable(cost: PayCost, sources: ManaSource[]): boolean {
  return planPayment(cost, sources) !== null;
}

/** Pays the first face the seat can afford, front face first — so a
 * creature with an adventure costs its own cost when that is payable,
 * and a split card needs only one half's colors. Null when no face is. */
export function planAnyFace(costs: PayCost[], sources: ManaSource[]): PaymentPlan | null {
  for (const cost of costs) {
    const plan = planPayment(cost, sources);
    if (plan) return plan;
  }
  return null;
}

/** Every unit the seat could spend right now — the number the table reads. */
export function availableMana(sources: ManaSource[]): number {
  return sources.reduce((sum, s) => sum + s.amount, 0);
}

/** The largest X the seat can still pay for: 0 when it cannot even pay
 * for X = 0, or the cost has no X. Nobody taps for more than 40, so the
 * search stops there. */
export function maxX(cost: PayCost, sources: ManaSource[]): number {
  if (!cost.x) return 0;
  // Every point of X is `cost.x` more mana than the rest of the cost:
  // nothing above this ceiling can be payable, whatever the colors.
  const spare = availableMana(sourcesFor(sources, cost.on)) - cost.generic - cost.pips.length;
  for (let value = Math.min(40, Math.floor(spare / cost.x)); value > 0; value--) {
    if (affordable(withX(cost, value), sources)) return value;
  }
  return 0;
}

const BASIC_COLOR: Record<string, ManaColor> = {
  plains: 'W',
  island: 'U',
  swamp: 'B',
  mountain: 'R',
  forest: 'G',
};

type Colors = (ManaColor | 'any')[];

interface Grants {
  /** every creature you control, tokens included */
  creatures: Colors;
  /** nontoken creatures only (plus everything in `creatures`) */
  nontoken: Colors;
  lands: Colors;
}

/** Mana abilities other permanents hand out. To creatures: Cryptolith
 * Rite's quoted `{T}: Add …`, Ashaya making them Forests. To lands:
 * Urborg and Yavimaya making every land a Swamp or Forest, Chromatic
 * Lantern's quoted ability, Prismatic Omen's every basic land type. */
function grantsFrom(texts: string[]): Grants {
  const creatures: Colors = [];
  const nontoken: Colors = [];
  const lands: Colors = [];
  const add = (into: Colors, colors: Colors) => {
    for (const c of colors) if (!into.includes(c)) into.push(c);
  };
  for (const text of texts) {
    const quoted = text.match(/creatures you control have "([^"]*)"/i);
    if (quoted) add(creatures, tapManaFromText(quoted[1]).produces);
    const landed = text.match(
      /(nontoken )?creatures you control are (plains|island|swamp|mountain|forest) lands/i,
    );
    if (landed) add(landed[1] ? nontoken : creatures, [BASIC_COLOR[landed[2].toLowerCase()]]);

    const eachLand = text.match(/each land is an? (plains|island|swamp|mountain|forest)\b/i);
    if (eachLand) add(lands, [BASIC_COLOR[eachLand[1].toLowerCase()]]);
    const landsHave = text.match(/lands you control have "([^"]*)"/i);
    if (landsHave) add(lands, tapManaFromText(landsHave[1]).produces);
    if (/lands you control are every basic land type/i.test(text)) add(lands, ['any']);
  }
  add(nontoken, creatures);
  return { creatures, nontoken, lands };
}

/** The rules text of the face that is up (a card on its back reads as its
 * back already: lib/faces.ts backView). */
const frontText = (record: Pick<CardRecord, 'oracleText'> | null | undefined) => (record?.oracleText ?? '').split('\n//\n')[0];

/** "Any color in your commander's color identity": the commander's colors,
 * where they are known. A colorless commander's Command Tower makes nothing
 * (its other abilities, Opal Palace's {C}, still do). */
function inIdentity(produces: Colors, text: string, identity: ManaColor[] | null): Colors {
  if (!identity || !/commander['’]s colou?r identity/i.test(text)) return produces;
  const out: Colors = produces.filter((p) => p !== 'any');
  for (const c of identity) if (!out.includes(c)) out.push(c);
  return out;
}

/** Mana a card keeps for some things ("Spend this mana only to cast a
 * creature spell"): those words, and what it makes for anything else — its
 * other abilities, and what another permanent gives it (Chromatic Lantern).
 * Nothing when all of its mana pays for anything. */
function keptMana(text: string, grants: Colors, own: (produces: Colors) => Colors): Pick<ManaSource, 'only' | 'free'> {
  if (!/spend this mana only/i.test(text)) return {};
  const { free, only } = tapManaByUse(text);
  if (!only) return {};
  const produces = own([...free.produces]);
  for (const g of grants) if (!produces.includes(g)) produces.push(g);
  const amount = free.amount > 0 ? free.amount : grants.length > 0 ? 1 : 0;
  return { only: only.words, ...(amount > 0 && produces.length > 0 ? { free: { produces, amount } } : {}) };
}

/** Everything a seat can draw mana from right now. Untapped mana cards
 * are fresh sources; a card you tapped by hand floats whatever nothing has
 * spent yet. Board stacks offer their untapped copies. An ability that
 * sacrifices something is never counted (tapManaFromText skips it) — a
 * payment does not eat a permanent — so Treasures stay manual. A creature
 * that arrived this turn is left out unless it has haste, or the seat may
 * use its creatures' abilities as though they had: a dork cannot pay the
 * turn it is played. Lands and rocks tap at once. */
export function sourcesFrom(
  battlefield: CardInstance[],
  records: Record<string, CardRecord | null | undefined>,
  board: BoardItem[],
  /** The seat's commander's color identity (lib/commanders.ts seatIdentity):
   * what Command Tower, Arcane Signet, Path of Ancestry make. null = not
   * known (no commander): they make any color, generously. */
  identity: ManaColor[] | null = null,
  /** What the table shows beyond these cards — the seat's creatures' sizes,
   * every seat's permanents (lib/seatMana.ts tableRead) — for Marwyn's power,
   * Priest of Titania's Elves. null: those read as printed. */
  read: TableRead | null = null,
): ManaSource[] {
  const granted = grantsFrom(battlefield.map((c) => frontText(records[c.cardId])).filter((t) => t !== ''));
  // Haste can come from any permanent of the seat, a tracked stack included.
  const texts = permanentTexts(battlefield, records, board);
  // Thousand-Year Elixir: fresh creatures still cannot attack, but they tap.
  const tapsAtOnce = tapsAsThoughHasty(texts);
  const out: ManaSource[] = [];
  const widen = (produces: Colors, extra: Colors) => {
    for (const g of extra) if (!produces.includes(g)) produces.push(g);
  };
  // What Urza's Tower, Nykthos, Gaea's Cradle and "Activate only if…" look at.
  const table = manaTable(battlefield, records, board, read);
  // A god below its devotion is no creature: not sick, and no creature's grant.
  const gods = godsFrom({ battlefield, board, graveyard: null }, records);

  // Haste from what a creature wears: an Equipment of this seat on it.
  const wears = (iid: string) =>
    new Set(
      battlefield
        .filter((a) => a.on?.kind === 'card' && a.on.id === iid)
        .flatMap((a) => keywordsGiven(records[a.cardId])),
    );
  // Mana a card's counters make without its tap: after the rest, each a source of its own.
  const apart: ManaSource[] = [];
  for (const c of battlefield) {
    const record = records[c.cardId];
    if (!record) continue; // unresolved: its text is not readable yet
    const held = !notHeldBack(gods, { kind: 'card', id: c.iid });
    // Only the face that is up: a Pathway makes the color it was played as,
    // and Kazandu Mammoth is no land while its creature face is up.
    const typeUp = record.typeLine.split(' // ')[0];
    const creature = /\bCreature\b/.test(typeUp) && !held;
    // Dreadship Reef, a Mana Battery, Pentad Prism: what their counters make now.
    const stored = storedHere(frontText(record), c, record.name);
    // No tap, so summoning sickness does not hold them back (Workhorse).
    for (const s of stored.apart)
      apart.push({
        key: `${c.iid}#${s.line}`,
        kind: 'virtual',
        produces: s.produces,
        amount: s.amount,
        ...(creature ? { creature: true } : {}),
        ...(s.only ? { only: s.only } : {}),
        stored: s.draw,
      });
    // Tapping it by hand stays legal (crew, convoke) — it just floats nothing.
    if (!tapsAtOnce && !held && isSummoningSick(c, record, texts, wears(c.iid))) continue;
    // Gaea's Cradle, Cabal Coffers, Nykthos, Marwyn: the amount as the table stands.
    const text = manaTextHere(stored.text, table, { ...c, name: record.name, typeLine: typeUp });
    const own = tapManaFromText(text);
    const grants: Colors = [];
    if (creature) widen(grants, granted.nontoken);
    if (/\bLand\b/.test(typeUp)) widen(grants, granted.lands);
    const produces = inIdentity([...own.produces], text, identity);
    widen(produces, grants);
    if (produces.length === 0) continue;
    const total = Math.max(own.amount, 1);
    const amount = c.tapped ? total - (c.spent ?? 0) : total;
    if (amount <= 0) continue;
    // What it makes without its counters, what another permanent gives it included (Chromatic Lantern).
    const plain = stored.draw?.plainColors ?? [];
    const draw = stored.draw && { ...stored.draw, plainColors: [...plain, ...grants.filter((g) => !plain.includes(g))] };
    out.push({
      key: c.iid,
      kind: 'virtual',
      produces,
      amount,
      ...(c.tapped ? { floating: true } : {}),
      ...(creature ? { creature: true } : {}),
      ...keptMana(text, grants, (p) => inIdentity(p, text, identity)),
      ...(draw ? { stored: draw } : {}),
    });
  }
  out.push(...apart);

  for (const item of board) {
    if (item.manaMode === 'none') continue; // the player silenced it
    const creature = /Creature/.test(item.typeLine);
    // A manual "Taps for" override wins; otherwise the same strict reading
    // as real cards, so a stack's sacrifice ability is never auto-spent.
    const produces: Colors = item.manaMode
      ? [item.manaMode]
      : [...tapManaFromText(item.oracleText).produces];
    const grants: Colors = [];
    if (creature) widen(grants, granted.creatures);
    if (item.zone === 'lands' || /\bLand\b/.test(item.typeLine)) widen(grants, granted.lands);
    widen(produces, grants);
    if (produces.length === 0) continue;
    const kept = item.manaMode ? {} : keptMana(item.oracleText, grants, (p) => p);
    // Which copies are tapped and which only just arrived is not tracked:
    // offer as many as could be both untapped and past their first turn.
    const sick = creature && !tapsAtOnce ? sickCopies(item, texts) : 0;
    const ready = Math.min(item.count - (item.tapped ?? 0), item.count - sick);
    for (let i = 0; i < ready; i++) {
      out.push({
        key: item.id,
        kind: 'board',
        produces,
        amount: 1,
        ...(creature ? { creature: true } : {}),
        ...kept,
      });
    }
  }
  return out;
}
