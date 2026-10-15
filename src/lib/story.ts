import type { GameState, GameStory, StoryBurst, StoryHit, StoryOut, StoryTurn } from './types';

/** Life changes on one player this close together are one hit: a player
 * counting damage down by taps, or taking a correction straight back. */
export const BURST_MS = 2500;
/** A very long game stops writing turns down rather than growing forever. */
const TURNS_CAP = 400;
const LETHAL_POISON = 10;

const point = (g: GameState): StoryTurn => ({
  turn: g.turnNumber,
  active: g.activePlayerIndex,
  life: g.players.map((p) => p.life),
});

const mint = (now: number) => `g${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A new game's story: its name, when it began, the opening life totals. */
export function beginStory(g: GameState, now = Date.now(), id = mint(now)): GameState {
  return { ...g, story: { id, startedAt: now, turns: [point(g)], outs: [] } };
}

/** Who the game went to: the one player still in, 'draw' when nobody is
 * left, null while two or more are still playing (or there was only one). */
export function decided(g: GameState): number | 'draw' | null {
  if (g.players.length < 2) return null;
  const left = g.players.flatMap((p, i) => (p.eliminated ? [] : [i]));
  if (left.length === 1) return left[0];
  return left.length === 0 ? 'draw' : null;
}

const hitOf = (b: StoryBurst): StoryHit | undefined =>
  b.net < 0 ? { seat: b.seat, n: -b.net, turn: b.turn, active: b.active } : undefined;

const bigger = (a: StoryHit | undefined, b: StoryHit | undefined) => (!b ? a : !a || b.n > a.n ? b : a);

/** The biggest single hit of the game so far, the one still being added up included. */
export function biggestHit(story: GameStory): StoryHit | null {
  let best = story.best;
  for (const b of story.open ?? []) best = bigger(best, hitOf(b));
  return best ?? null;
}

function addLife(story: GameStory, deltas: number[], g: GameState, now: number): GameStory {
  let best = story.best;
  const open: StoryBurst[] = [];
  for (const b of story.open ?? []) {
    if (now - b.t >= BURST_MS) best = bigger(best, hitOf(b));
    else open.push(b);
  }
  deltas.forEach((d, seat) => {
    if (d === 0) return;
    const i = open.findIndex((b) => b.seat === seat);
    if (i >= 0) open[i] = { ...open[i], net: open[i].net + d, t: now };
    else open.push({ seat, net: d, t: now, turn: g.turnNumber, active: g.activePlayerIndex });
  });
  const { best: _b, open: _o, ...rest } = story;
  return { ...rest, ...(best ? { best } : {}), ...(open.length > 0 ? { open } : {}) };
}

/** How a player who has just gone out did: the commander that reached the
 * limit, ten poison, no life left — or none of those, and they conceded. */
export function outOf(g: GameState, seat: number, t: number): StoryOut {
  const p = g.players[seat];
  const at = { seat, turn: g.turnNumber, active: g.activePlayerIndex, t };
  const limit = g.config.commanderDamageThreshold;
  const gauge = Object.entries(p.commanderDamage)
    .filter(([, n]) => n >= limit)
    .sort((a, b) => b[1] - a[1])[0];
  if (gauge) return { ...at, how: 'commander', by: gauge[0], n: gauge[1] };
  if ((p.counters['poison'] ?? 0) >= LETHAL_POISON) return { ...at, how: 'poison' };
  if (p.life <= 0) return { ...at, how: 'life' };
  return { ...at, how: 'conceded' };
}

/** `next` with what `prev` → `next` adds to the story: hits, players
 * going out, turns beginning, the game being decided. The store runs every
 * local move through this inside the move itself, so a replayed move
 * replays its part of the story too. A move the story has nothing to say
 * about comes back as the very object it was. */
export function withStory(prev: GameState, next: GameState, now = Date.now()): GameState {
  if (next === prev) return prev;
  const had = next.story ?? prev.story;
  let story: GameStory = had ?? { id: mint(now), turns: [point(prev)], outs: [] };
  let changed = !had;

  const deltas = next.players.map((p, i) => p.life - (prev.players[i]?.life ?? p.life));
  if (deltas.some((d) => d !== 0)) {
    story = addLife(story, deltas, next, now);
    changed = true;
  }

  const gone = next.players.flatMap((p, i) => (p.eliminated && prev.players[i] && !prev.players[i].eliminated ? [i] : []));
  if (gone.length > 0) {
    story = { ...story, outs: [...story.outs, ...gone.map((seat) => outOf(next, seat, now))] };
    changed = true;
  }

  if (next.turnNumber !== prev.turnNumber || next.activePlayerIndex !== prev.activePlayerIndex) {
    story = { ...story, turns: [...story.turns, point(next)].slice(-TURNS_CAP) };
    changed = true;
  }

  if (story.endedAt === undefined && decided(next) !== null && decided(prev) === null) {
    story = { ...story, endedAt: now };
    changed = true;
  }

  return changed ? { ...next, story } : next;
}

const HOWS = ['life', 'commander', 'poison', 'conceded'];

/** Can the recap read this without tripping? (A malformed one is dropped.) */
export function validStory(v: unknown, seats: number): v is GameStory {
  const s = v as GameStory | null;
  const int = (n: unknown) => Number.isInteger(n);
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const seat = (n: unknown) => int(n) && (n as number) >= 0 && (n as number) < seats;
  const turnOk = (t: StoryTurn) =>
    !!t && int(t.turn) && seat(t.active) && Array.isArray(t.life) && t.life.length === seats && t.life.every(num);
  const outOk = (o: StoryOut) =>
    !!o &&
    seat(o.seat) &&
    int(o.turn) &&
    seat(o.active) &&
    num(o.t) &&
    HOWS.includes(o.how) &&
    (o.by === undefined || typeof o.by === 'string') &&
    (o.n === undefined || num(o.n));
  const hitOk = (h: StoryHit) => !!h && seat(h.seat) && num(h.n) && int(h.turn) && seat(h.active);
  const burstOk = (b: StoryBurst) => !!b && seat(b.seat) && num(b.net) && num(b.t) && int(b.turn) && seat(b.active);
  return (
    !!s &&
    typeof s === 'object' &&
    typeof s.id === 'string' &&
    (s.startedAt === undefined || num(s.startedAt)) &&
    Array.isArray(s.turns) &&
    s.turns.every(turnOk) &&
    Array.isArray(s.outs) &&
    s.outs.every(outOk) &&
    (s.best === undefined || hitOk(s.best)) &&
    (s.open === undefined || (Array.isArray(s.open) && s.open.every(burstOk))) &&
    (s.endedAt === undefined || num(s.endedAt))
  );
}
