import type {
  CardInstance,
  CardZone,
  Deck,
  FeedEntry,
  GameState,
  SeatCards,
} from './types';

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

function shuffled<T>(arr: T[], seed: number): T[] {
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

/** Battlefield-only fields never travel to other zones. */
function stripped(c: CardInstance): CardInstance {
  const { tapped: _t, counters: _c, row: _r, spent: _s, sick: _k, ...rest } = c;
  return rest;
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
    const planned = [...plan.top, ...plan.bottom, ...plan.graveyard, ...plan.hand];
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
  opts?: { pos?: 'top' | 'bottom'; row?: 'front' | 'lands' },
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

/** The synced announcement ring: dedup by id (rebases re-append), cap 30. */
export function appendFeed(g: GameState, entry: FeedEntry): GameState {
  const feed = g.feed ?? [];
  if (feed.some((e) => e.id === entry.id)) return g;
  return { ...g, feed: [...feed, entry].slice(-30) };
}
