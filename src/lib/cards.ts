import type {
  CardInstance,
  CardZone,
  Deck,
  FeedEntry,
  GameState,
  Reveal,
  SeatCards,
} from './types';
import { backId, frontId, isBackId } from './faces';

/** Per-game instance id: 10 chars of base36 randomness. */
export function newIid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = '';
  for (const b of bytes) out += (b % 36).toString(36);
  return (out + newSuffix()).slice(0, 10);
}
function newSuffix(): string {
  return crypto.getRandomValues(new Uint8Array(2))[0].toString(36) + crypto.getRandomValues(new Uint8Array(2))[0].toString(36);
}

/** Tiny seeded PRNG — the originating device's replay of a shuffle is
 * bit-identical (the protocol pushes state, so no one else replays it). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A new list in a random order that depends only on the seed. */
export function shuffled<T>(arr: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Explode a saved deck into fresh instances: commander to the command
 * zone, a seeded shuffle, top seven to hand. Seeding snapshots — later
 * deck edits never touch a live game. */
export function buildSeatCards(deck: Deck, seed: number): SeatCards {
  const pile: CardInstance[] = [];
  for (const c of deck.cards) {
    for (let i = 0; i < c.count; i++) pile.push({ iid: newIid(), cardId: c.cardId, name: c.name });
  }
  const order = shuffled(pile, seed);
  // One commander, or a pair (partner, Background, the Doctor's companion).
  const command: CardInstance[] = [deck.commander, deck.partner ?? null]
    .filter((c) => c !== null)
    .map((c) => ({ iid: newIid(), cardId: c.cardId, name: c.name }));
  return {
    library: order.slice(7),
    hand: order.slice(0, 7),
    battlefield: [],
    graveyard: [],
    exile: [],
    command,
    mulligans: 0,
    deckName: deck.name,
    cmd: Object.fromEntries(command.map((c) => [c.iid, 0])),
  };
}

/** Is this instance one of the seat's commanders? null when the seat
 * predates per-commander tracking — callers fall back to the old rule
 * (an empty command zone takes whatever is sent to it). */
export function isCommander(cards: SeatCards, iid: string): boolean | null {
  return cards.cmd ? iid in cards.cmd : null;
}

/** What this commander's next cast costs on top: two per time it has
 * gone back to the command zone. Partners each carry their own. */
export function commanderTax(
  player: { cards?: SeatCards; commanderDeaths: number },
  iid: string,
): number {
  return (player.cards?.cmd?.[iid] ?? player.commanderDeaths) * 2;
}

function updateSeat(
  g: GameState,
  seat: number,
  fn: (cards: SeatCards) => SeatCards | null,
): GameState {
  const player = g.players[seat];
  if (!player?.cards) return g;
  const next = fn(player.cards);
  if (next === null || next === player.cards) return g;
  return {
    ...g,
    players: g.players.map((p, i) => (i === seat ? { ...p, cards: next } : p)),
  };
}

/** Installs a seat's cards exactly once — a seeded seat never reseeds
 * (the sync guard mirrors this so replays can't either). */
export function seedSeat(g: GameState, seat: number, cards: SeatCards): GameState {
  const player = g.players[seat];
  if (!player || player.cards) return g;
  return { ...g, players: g.players.map((p, i) => (i === seat ? { ...p, cards } : p)) };
}

/** Battlefield-only fields never travel to other zones — and neither does
 * the face that was up: a card that leaves is its front face again. */
function stripped(c: CardInstance): CardInstance {
  const { tapped: _t, counters: _c, row: _r, spent: _s, sick: _k, on: _o, boost: _b, held: _h, ...rest } = c;
  return isBackId(rest.cardId) ? { ...rest, cardId: frontId(rest.cardId) } : rest;
}

function takeFrom(
  zone: CardInstance[],
  iids: string[],
): { taken: CardInstance[]; rest: CardInstance[] } | null {
  const want = new Set(iids);
  const taken = zone.filter((c) => want.has(c.iid));
  if (taken.length !== iids.length) return null; // something left the zone: whole op is off
  const byId = new Map(taken.map((c) => [c.iid, c]));
  return { taken: iids.map((i) => byId.get(i)!), rest: zone.filter((c) => !want.has(c.iid)) };
}

/** Draw the exact captured iids — replay onto a moved base re-moves the
 * same cards or (via the sync guard) drops cleanly. */
export function draw(g: GameState, seat: number, iids: string[]): GameState {
  return updateSeat(g, seat, (cards) => {
    const t = takeFrom(cards.library, iids);
    if (!t) return null;
    return { ...cards, library: t.rest, hand: [...cards.hand, ...t.taken.map(stripped)] };
  });
}

export function millN(g: GameState, seat: number, iids: string[]): GameState {
  return updateSeat(g, seat, (cards) => {
    const t = takeFrom(cards.library, iids);
    if (!t) return null;
    return { ...cards, library: t.rest, graveyard: [...cards.graveyard, ...t.taken.map(stripped)] };
  });
}

/** "Exile the top N": a mill that lands in exile. */
export function exileN(g: GameState, seat: number, iids: string[]): GameState {
  return updateSeat(g, seat, (cards) => {
    const t = takeFrom(cards.library, iids);
    if (!t) return null;
    return { ...cards, library: t.rest, exile: [...cards.exile, ...t.taken.map(stripped)] };
  });
}

export function bottomCards(g: GameState, seat: number, iids: string[]): GameState {
  return updateSeat(g, seat, (cards) => {
    const t = takeFrom(cards.hand, iids);
    if (!t) return null;
    return { ...cards, hand: t.rest, library: [...cards.library, ...t.taken.map(stripped)] };
  });
}

/** Where each card looked at from the top of a library ends up. */
export interface TopPlan {
  /** Back on top, in this order (first = new top card). */
  top: string[];
  bottom: string[];
  graveyard: string[];
  hand: string[];
  /** Left out when nothing is exiled, and by plans older than the option. */
  exile?: string[];
}

/** Scry, surveil, "look at the top N and put one in your hand": the cards
 * looked at leave the top of the library and go where the plan says. The
 * plan must account for exactly those cards, and they must still BE the
 * top of the library — a draw or a shuffle in between calls it off.
 * `mark` names this look on the seat. The caller mints it, like a
 * shuffle's seed: a replay has to leave the same one. */
export function arrangeTop(
  g: GameState,
  seat: number,
  looked: string[],
  plan: TopPlan,
  mark?: string,
): GameState {
  return updateSeat(g, seat, (cards) => {
    const exiled = plan.exile ?? [];
    const planned = [...plan.top, ...plan.bottom, ...plan.graveyard, ...plan.hand, ...exiled];
    if (
      planned.length !== looked.length ||
      new Set(planned).size !== planned.length ||
      !looked.every((iid) => planned.includes(iid))
    )
      return null;
    const onTop = new Set(cards.library.slice(0, looked.length).map((c) => c.iid));
    if (!looked.every((iid) => onTop.has(iid))) return null;
    const t = takeFrom(cards.library, looked);
    if (!t) return null;
    const byId = new Map(t.taken.map((c) => [c.iid, c]));
    const pick = (iids: string[]) => iids.map((iid) => byId.get(iid)!);
    return {
      ...cards,
      library: [...pick(plan.top), ...t.rest, ...pick(plan.bottom)],
      graveyard: [...cards.graveyard, ...pick(plan.graveyard)],
      hand: [...cards.hand, ...pick(plan.hand)],
      exile: [...cards.exile, ...pick(exiled)],
      ...(mark ? { stacked: mark } : {}),
    };
  });
}

/** The keep step is terminal: bottom the picks (if any) and mark the hand
 * kept, so a replay or a second press can never bottom twice. */
export function keepHand(g: GameState, seat: number, iids: string[]): GameState {
  if (g.players[seat]?.cards?.kept) return g;
  const bottomed = iids.length > 0 ? bottomCards(g, seat, iids) : g;
  if (iids.length > 0 && bottomed === g) return g; // picks left the hand: whole keep is off
  return updateSeat(bottomed, seat, (cards) => ({ ...cards, kept: true }));
}

export function moveCard(
  g: GameState,
  seat: number,
  iid: string,
  from: CardZone,
  to: CardZone,
  opts?: { pos?: 'top' | 'bottom'; row?: CardInstance['row'] },
): GameState {
  const moved = moveWithinSeat(g, seat, iid, from, to, opts);
  if (moved === g || from !== 'battlefield' || to === 'battlefield') return moved;
  // It left the battlefield: what it was attached to, and what was attached
  // to it, is settled in the same move.
  const left = g.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
  return left ? afterLeaving(moved, seat, left) : moved;
}

function moveWithinSeat(
  g: GameState,
  seat: number,
  iid: string,
  from: CardZone,
  to: CardZone,
  opts?: { pos?: 'top' | 'bottom'; row?: CardInstance['row'] },
): GameState {
  return updateSeat(g, seat, (cards) => {
    const source = cards[from];
    const card = source.find((c) => c.iid === iid);
    if (!card) return null; // identity rule: the SOURCE zone must hold it
    // A same-zone move is a shelf/position change, not a zone exit: the
    // card keeps its tapped state and counters (review finding). Anything
    // that reaches the battlefield from elsewhere has only just arrived.
    const moved: CardInstance =
      from === to
        ? { ...card, ...(opts?.row ? { row: opts.row } : {}) }
        : to === 'battlefield'
          ? { ...stripped(card), ...(opts?.row ? { row: opts.row } : {}), sick: true }
          : stripped(card);
    const without = source.filter((c) => c.iid !== iid);
    const dest = to === from ? without : cards[to];
    const placed =
      to === 'library'
        ? opts?.pos === 'bottom'
          ? [...dest, moved]
          : [moved, ...dest]
        : [...dest, moved];
    return { ...cards, [from]: without, [to]: placed };
  });
}

// ---- held in exile: "until it leaves the battlefield" ----

/** A permanent that holds cards in exile: its seat and instance. */
export interface Holder {
  seat: number;
  iid: string;
}

/** Marks a card in its owner's exile as held there by that permanent. */
export function holdInExile(g: GameState, seat: number, iid: string, by: Holder): GameState {
  return updateSeat(g, seat, (cards) => {
    if (!cards.exile.some((c) => c.iid === iid)) return null;
    return { ...cards, exile: cards.exile.map((c) => (c.iid === iid ? { ...c, held: { seat: by.seat, iid: by.iid } } : c)) };
  });
}

/** The cards that permanent holds in exile, on every seat. */
export function heldBy(g: GameState, by: Holder): { seat: number; card: CardInstance }[] {
  return g.players.flatMap((p, seat) =>
    (p.cards?.exile ?? [])
      .filter((c) => c.held?.seat === by.seat && c.held.iid === by.iid)
      .map((card) => ({ seat, card })),
  );
}

/** It left: what it held comes back to the battlefield, each card to its
 * owner's side. The same game when it held nothing. */
export function releaseHeldBy(g: GameState, by: Holder): GameState {
  return heldBy(g, by).reduce(
    (next, { seat, card }) => moveCard(next, seat, card.iid, 'exile', 'battlefield', { row: 'front' }),
    g,
  );
}

// ---- attachments: an Aura or an Equipment on its host ----

/** What a card can be attached to: a real card on some seat's battlefield,
 * or a stack on some seat's board. */
export interface Host {
  seat: number;
  kind: 'card' | 'stack';
  id: string;
}

/** Is that host on the table (still)? */
export function hostIsThere(g: GameState, host: Host): boolean {
  const player = g.players[host.seat];
  if (!player) return false;
  return host.kind === 'card'
    ? (player.cards?.battlefield.some((c) => c.iid === host.id) ?? false)
    : player.board.some((it) => it.id === host.id);
}

/** Changes one battlefield card of one seat; the same game when it is not
 * there or `fn` hands the same card back. */
function mapBattlefieldCard(
  g: GameState,
  seat: number,
  iid: string,
  fn: (c: CardInstance) => CardInstance,
): GameState {
  return updateSeat(g, seat, (cards) => {
    const card = cards.battlefield.find((c) => c.iid === iid);
    if (!card) return null;
    const next = fn(card);
    if (next === card) return null;
    return { ...cards, battlefield: cards.battlefield.map((c) => (c.iid === iid ? next : c)) };
  });
}

/** Adds (or, below zero, takes off) +1/+1 counters on a battlefield card,
 * never below none. */
function shiftP1p1(g: GameState, seat: number, iid: string, delta: number): GameState {
  if (delta === 0) return g;
  return mapBattlefieldCard(g, seat, iid, (c) => {
    const now = c.counters?.p1p1 ?? 0;
    const next = Math.max(0, now + delta);
    if (next === now) return c;
    const counters = { ...c.counters };
    if (next === 0) delete counters.p1p1;
    else counters.p1p1 = next;
    if (Object.keys(counters).length === 0) {
      const { counters: _x, ...rest } = c;
      return rest;
    }
    return { ...c, counters };
  });
}

/** The +1/+1 counters an attachment put on its host come off again. */
function dropBoost(g: GameState, on: CardInstance['on']): GameState {
  if (!on || on.kind !== 'card' || !on.plus) return g;
  return shiftP1p1(g, on.seat, on.id, -on.plus);
}

/** Attaches a battlefield card of `seat` to `host` (null: unattaches it).
 * The host must be on the table, and not the card itself; whatever it was
 * attached to before lets go of it, and of the counters it had put there.
 * `plus` is how many +1/+1 counters the attachment gives a card host (the
 * "+2/+2" of the Aura, as the table shows it): they go on with it and come
 * off with it. Asking for what is already so changes nothing. */
export function attachCard(
  g: GameState,
  seat: number,
  iid: string,
  host: Host | null,
  plus = 0,
): GameState {
  const card = g.players[seat]?.cards?.battlefield.find((c) => c.iid === iid);
  if (!card) return g;
  const boost = host && host.kind === 'card' && Number.isFinite(plus) ? Math.max(0, Math.floor(plus)) : 0;
  if (host) {
    if (!hostIsThere(g, host)) return g;
    if (host.kind === 'card' && host.seat === seat && host.id === iid) return g;
    const same =
      card.on?.seat === host.seat && card.on.kind === host.kind && card.on.id === host.id;
    if (same && (card.on?.plus ?? 0) === boost) return g;
  } else if (!card.on) {
    return g;
  }
  let next = dropBoost(g, card.on);
  next = mapBattlefieldCard(next, seat, iid, (c) => {
    const { on: _was, ...rest } = c;
    if (!host) return rest;
    return {
      ...rest,
      on: { seat: host.seat, kind: host.kind, id: host.id, ...(boost > 0 ? { plus: boost } : {}) },
    };
  });
  return host && boost > 0 ? shiftP1p1(next, host.seat, host.id, boost) : next;
}

/** A card has left the battlefield. The counters it had put on its host
 * come off; and everything that was attached to IT, on any seat, is
 * unattached now — said outright, so a card that comes back later (its
 * instance keeps its id) does not find its old Equipment still on it. */
function afterLeaving(g: GameState, seat: number, left: CardInstance): GameState {
  let next = dropBoost(g, left.on);
  next.players.forEach((p, s) => {
    for (const c of p.cards?.battlefield ?? []) {
      if (c.on?.kind === 'card' && c.on.seat === seat && c.on.id === left.iid) {
        next = mapBattlefieldCard(next, s, c.iid, (card) => {
          const { on: _was, ...rest } = card;
          return rest;
        });
      }
    }
  });
  return next;
}

/** Direction is explicit (never a toggle): a replay onto a base that
 * already holds the desired state is a clean no-op, so a rebase can
 * never invert a tap (review finding). */
export function tapCard(g: GameState, seat: number, iid: string, tapped: boolean): GameState {
  return updateSeat(g, seat, (cards) => {
    const card = cards.battlefield.find((c) => c.iid === iid);
    if (!card) return null;
    if ((card.tapped ?? false) === tapped) return null; // already there
    const battlefield = cards.battlefield.map((c) => {
      if (c.iid !== iid) return c;
      // Either direction starts the card's mana over: an untap forgets
      // what was spent, and a tap by hand floats the whole yield.
      const { tapped: _t, spent: _s, ...rest } = c; // omit, never write false
      return tapped ? { ...rest, tapped: true } : rest;
    });
    return { ...cards, battlefield };
  });
}

/** Turns a double-faced card on the battlefield onto its back face, or
 * back onto its front. Which face is up lives in its `cardId` (lib/faces.ts),
 * so everything that reads the card reads that face. The direction is
 * explicit, like a tap's: a replay onto a card already lying that way
 * changes nothing. Tapped, counters, what is attached: all as they were. */
export function flipCard(g: GameState, seat: number, iid: string, back: boolean): GameState {
  return mapBattlefieldCard(g, seat, iid, (c) => {
    const cardId = back ? backId(c.cardId) : frontId(c.cardId);
    return cardId === c.cardId ? c : { ...c, cardId };
  });
}

/** A payment draws `units` of mana from this card, tapping it if it is
 * not already. Whatever the card yields beyond `spent` keeps floating. */
export function spendMana(g: GameState, seat: number, iid: string, units: number): GameState {
  return updateSeat(g, seat, (cards) => {
    const card = cards.battlefield.find((c) => c.iid === iid);
    if (!card || units <= 0) return null;
    const spent = (card.tapped ? (card.spent ?? 0) : 0) + units;
    return {
      ...cards,
      battlefield: cards.battlefield.map((c) =>
        c.iid === iid ? { ...c, tapped: true, spent } : c,
      ),
    };
  });
}

/** More mana than any card yields: what `spent` holds on a card that was
 * tapped for something other than mana. */
const USED_UP = 999;

/** Tapped, nothing floating: the card was tapped to attack, not for mana.
 * A plain tapCard would leave an attacking Llanowar Elves' {G} in the pool
 * to pay for the next spell. A card that is already tapped is left as it
 * is — whatever it floated was floated on purpose. */
export function tapSpent(g: GameState, seat: number, iid: string): GameState {
  return updateSeat(g, seat, (cards) => {
    const card = cards.battlefield.find((c) => c.iid === iid);
    if (!card || card.tapped) return null;
    return {
      ...cards,
      battlefield: cards.battlefield.map((c) =>
        c.iid === iid ? { ...c, tapped: true, spent: USED_UP } : c,
      ),
    };
  });
}

/** A card the player turned sideways by hand turns out to be attacking:
 * whatever mana its tap was floating is gone (a Llanowar Elves that
 * attacks pays for nothing). Only a tapped card with nothing spent yet;
 * anything else is left exactly as it is. */
export function useUpTap(g: GameState, seat: number, iid: string): GameState {
  return updateSeat(g, seat, (cards) => {
    const card = cards.battlefield.find((c) => c.iid === iid);
    if (!card || !card.tapped || (card.spent ?? 0) > 0) return null;
    return {
      ...cards,
      battlefield: cards.battlefield.map((c) => (c.iid === iid ? { ...c, spent: USED_UP } : c)),
    };
  });
}

export function setCardCounter(
  g: GameState,
  seat: number,
  iid: string,
  name: string,
  value: number,
): GameState {
  return updateSeat(g, seat, (cards) => {
    const idx = cards.battlefield.findIndex((c) => c.iid === iid);
    if (idx === -1) return null;
    const battlefield = cards.battlefield.map((c) => {
      if (c.iid !== iid) return c;
      const counters = { ...c.counters };
      if (value <= 0) delete counters[name];
      else counters[name] = value;
      if (Object.keys(counters).length === 0) {
        const { counters: _x, ...rest } = c;
        return rest;
      }
      return { ...c, counters };
    });
    return { ...cards, battlefield };
  });
}

export function shuffleLibrary(g: GameState, seat: number, seed: number): GameState {
  return updateSeat(g, seat, (cards) => ({ ...cards, library: shuffled(cards.library, seed) }));
}

/** Where a card found in a library goes: onto the battlefield (tapped or
 * not), into its owner's hand or graveyard, or back on top once the rest
 * is shuffled. */
export type FoundTo = 'tapped' | 'battlefield' | 'hand' | 'top' | 'graveyard';
export interface Found {
  iid: string;
  to: FoundTo;
  /** The shelf a card that lands on the battlefield is put on. */
  row?: CardInstance['row'];
}

/** "Search your library for…, then shuffle", in one move: the cards found
 * leave the library for where they are going, what is left is shuffled,
 * and a card kept "on top" goes back on it afterwards (first found = top).
 * A found card that has left the library meanwhile is passed over; a search
 * that finds nothing still shuffles. */
export function searchLibrary(g: GameState, seat: number, found: Found[], seed: number): GameState {
  return updateSeat(g, seat, (cards) => {
    const want = new Map(found.map((f) => [f.iid, f]));
    const taken = cards.library.filter((c) => want.has(c.iid));
    const byId = new Map(taken.map((c) => [c.iid, c]));
    const going = (to: FoundTo[]) =>
      found.flatMap((f) => (to.includes(f.to) && byId.has(f.iid) ? [{ f, card: stripped(byId.get(f.iid)!) }] : []));
    const rest = shuffled(cards.library.filter((c) => !want.has(c.iid)), seed);
    return {
      ...cards,
      library: [...going(['top']).map(({ card }) => card), ...rest],
      hand: [...cards.hand, ...going(['hand']).map(({ card }) => card)],
      graveyard: [...cards.graveyard, ...going(['graveyard']).map(({ card }) => card)],
      battlefield: [
        ...cards.battlefield,
        ...going(['tapped', 'battlefield']).map(
          ({ f, card }): CardInstance => ({
            ...card,
            ...(f.row ? { row: f.row } : {}),
            ...(f.to === 'tapped' ? { tapped: true } : {}),
            sick: true, // it has only just arrived, like anything else that lands there
          }),
        ),
      ],
    };
  });
}

/** London mulligan: everything back, reshuffle, draw seven, count up —
 * the Keep step bottoms `mulligans` cards via bottomCards. */
export function mulligan(g: GameState, seat: number, seed: number): GameState {
  return updateSeat(g, seat, (cards) => {
    const pool = shuffled([...cards.hand.map(stripped), ...cards.library], seed);
    return {
      ...cards,
      hand: pool.slice(0, 7),
      library: pool.slice(7),
      mulligans: cards.mulligans + 1,
    };
  });
}

/** CR 903.9: the commander goes back to the command zone from wherever it
 * landed (battlefield death, board-wiped graveyard, Path'd exile); the app
 * counts every return toward the next cast's tax. */
export function commanderDied(
  g: GameState,
  seat: number,
  iid: string,
  from: CardZone = 'battlefield',
): GameState {
  const moved = moveCard(g, seat, iid, from, 'command');
  if (moved === g) return g;
  return {
    ...moved,
    players: moved.players.map((p, i) => {
      if (i !== seat) return p;
      const cmd = p.cards?.cmd;
      return {
        ...p,
        commanderDeaths: p.commanderDeaths + 1, // the seat's running total
        ...(p.cards && cmd && iid in cmd
          ? { cards: { ...p.cards, cmd: { ...cmd, [iid]: cmd[iid] + 1 } } }
          : {}),
      };
    }),
  };
}

/** Puts a wrongly counted trip home right: sets how many times this
 * commander has gone back to the command zone (its tax ÷ 2). The seat's
 * running total moves by the same amount, so the two stay in step. Only
 * for seats that track their commanders per card. */
export function setCommanderReturns(g: GameState, seat: number, iid: string, n: number): GameState {
  const player = g.players[seat];
  const cmd = player?.cards?.cmd;
  if (!player?.cards || !cmd || !(iid in cmd) || !Number.isFinite(n)) return g;
  const returns = Math.max(0, Math.floor(n));
  if (returns === cmd[iid]) return g;
  return {
    ...g,
    players: g.players.map((p, i) =>
      i === seat
        ? {
            ...p,
            commanderDeaths: Math.max(0, p.commanderDeaths + returns - cmd[iid]),
            cards: { ...player.cards!, cmd: { ...cmd, [iid]: returns } },
          }
        : p,
    ),
  };
}

/** A phone claimed this hand: shared tables collapse its tray to a hint.
 * Direction is explicit, so a replay can never flip it back. */
export function setHandHeld(g: GameState, seat: number, held: boolean): GameState {
  return updateSeat(g, seat, (cards) => {
    if ((cards.handHeld ?? false) === held) return null;
    if (!held) {
      const { handHeld: _h, ...rest } = cards; // omit, never write false
      return rest;
    }
    return { ...cards, handHeld: true };
  });
}

export function untapAllCards(g: GameState, seat: number): GameState {
  return updateSeat(g, seat, (cards) => {
    if (!cards.battlefield.some((c) => c.tapped)) return null;
    return {
      ...cards,
      battlefield: cards.battlefield.map((c) => {
        if (!c.tapped) return c;
        const { tapped: _t, spent: _s, ...rest } = c;
        return rest;
      }),
    };
  });
}

/** A seat's turn begins: what arrived since its last one has now been
 * there all along. The untap BUTTON never calls this — tapping lands back
 * up mid-turn does not cure summoning sickness. */
export function readyCards(g: GameState, seat: number): GameState {
  return updateSeat(g, seat, (cards) => {
    if (!cards.battlefield.some((c) => c.sick)) return null;
    return {
      ...cards,
      battlefield: cards.battlefield.map((c) => {
        if (!c.sick) return c;
        const { sick: _k, ...rest } = c; // omit, never write false
        return rest;
      }),
    };
  });
}

/** Lands this seat has played from hand in the turn the game is in now.
 * A stamp left by any other turn is stale and reads zero. */
export function landsPlayed(g: GameState, seat: number): number {
  const stamp = g.players[seat]?.cards?.landPlays;
  return stamp && stamp.turn === g.turnNumber && stamp.active === g.activePlayerIndex
    ? stamp.n
    : 0;
}

/** One more land played from hand this turn. The caller runs it in the
 * same op that moves the card, so undo and a rebase take both or neither. */
export function countLandPlay(g: GameState, seat: number): GameState {
  return updateSeat(g, seat, (cards) => ({
    ...cards,
    landPlays: { turn: g.turnNumber, active: g.activePlayerIndex, n: landsPlayed(g, seat) + 1 },
  }));
}

/** Has this seat drawn from its library in the turn the game is in now?
 * A stamp left by any other turn is stale and reads no. */
export function hasDrawn(g: GameState, seat: number): boolean {
  const stamp = g.players[seat]?.cards?.drew;
  return !!stamp && stamp.turn === g.turnNumber && stamp.active === g.activePlayerIndex;
}

/** The seat has drawn this turn. The caller runs it in the same op that
 * moves the cards, so undo and a rebase take both or neither. */
export function markDrew(g: GameState, seat: number): GameState {
  if (hasDrawn(g, seat)) return g;
  return updateSeat(g, seat, (cards) => ({
    ...cards,
    drew: { turn: g.turnNumber, active: g.activePlayerIndex },
  }));
}

/** Is the table waiting for this seat's draw for the turn? Its own turn,
 * a library to draw from, and no draw yet — except the very first turn of
 * a two-player game, whose player skips it (CR 103.8a; in a pod everyone
 * draws). The game opens on seat 0 (createGame). */
export function owesDraw(g: GameState, seat: number): boolean {
  const cards = g.players[seat]?.cards;
  if (!cards || g.activePlayerIndex !== seat || g.players[seat].eliminated) return false;
  if (cards.library.length === 0 || hasDrawn(g, seat)) return false;
  if (g.turnNumber === 1 && seat === 0 && g.players.length === 2) return false;
  return true;
}

/** The synced announcement ring: dedup by id (rebases re-append), cap 30. */
export function appendFeed(g: GameState, entry: FeedEntry): GameState {
  const feed = g.feed ?? [];
  if (feed.some((e) => e.id === entry.id)) return g;
  return { ...g, feed: [...feed, entry].slice(-30) };
}

/** How long a reveal is news. Past it no device shows the reveal (so a
 * reload or a saved game picked up later never brings an old one back),
 * and one still waiting to reach the table is dropped, not replayed. */
export const REVEAL_FRESH_MS = 2 * 60_000;

/** Shows cards to the whole table. Nothing moves; only the latest reveal
 * is kept, so the next one replaces this. The same reveal landing again
 * (a replay) changes nothing — each device puts a reveal away by its id. */
export function setReveal(g: GameState, reveal: Reveal): GameState {
  if (!g.players[reveal.seat]?.cards || reveal.cards.length === 0) return g;
  if (g.reveal?.id === reveal.id) return g;
  return { ...g, reveal };
}
