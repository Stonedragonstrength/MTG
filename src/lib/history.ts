import { biggestHit, decided, outOf } from './story';
import type { GameRecord, GameState, StoryOut, StoryTurn } from './types';

export interface RecordOpts {
  now: number;
  online: boolean;
  /** Named by hand as the game is ended (the others conceded). Left out:
   * the game's own result — the one player left, or nobody. */
  winner?: number | null;
  /** Saved decks' names by id, for seats that chose a deck without being dealt it. */
  deckNames?: Record<string, string>;
}

const mint = (now: number) => `g${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The history's copy of a finished game. */
export function recordOf(g: GameState, opts: RecordOpts): GameRecord {
  const story = g.story;
  const result = decided(g);
  const named = opts.winner !== undefined;
  const winner = named ? (opts.winner ?? null) : typeof result === 'number' ? result : null;
  let outs: StoryOut[] = story
    ? story.outs
    : g.players.flatMap((p, i) => (p.eliminated ? [outOf(g, i, opts.now)] : []));
  if (named) {
    // Whoever was still in when the winner was named conceded then.
    const still = g.players.flatMap((p, i) => (!p.eliminated && i !== winner ? [i] : []));
    outs = [
      ...outs,
      ...still.map((seat) => ({
        seat,
        turn: g.turnNumber,
        active: g.activePlayerIndex,
        t: opts.now,
        how: 'conceded' as const,
      })),
    ];
  }
  const end: StoryTurn = { turn: g.turnNumber, active: g.activePlayerIndex, life: g.players.map((p) => p.life) };
  const turns = story?.turns ?? [];
  const last = turns[turns.length - 1];
  const same =
    !!last && last.turn === end.turn && last.active === end.active && last.life.every((n, i) => n === end.life[i]);
  return {
    id: story?.id ?? mint(opts.now),
    startedAt: story?.startedAt ?? null,
    endedAt: named ? opts.now : (story?.endedAt ?? opts.now),
    turns: g.turnNumber,
    format: g.config.format,
    mode: g.config.mode ?? 'tracker',
    online: opts.online,
    winner,
    players: g.config.profiles.map((p, i) => ({
      profileId: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl ?? null,
      commanderName: p.commanderName ?? null,
      partnerName: p.partnerName ?? null,
      commanderImage: p.commanderImage ?? null,
      colors: p.commanderColors ?? [],
      deckId: p.deckId ?? null,
      deckName: g.players[i]?.cards?.deckName || (p.deckId ? (opts.deckNames?.[p.deckId] ?? null) : null),
      life: g.players[i]?.life ?? 0,
    })),
    outs,
    hit: story ? biggestHit(story) : null,
    lives: same ? turns : [...turns, end],
  };
}

/** How long the game took ("47 min", "1 h 5 min"), or null when its start is not known. */
export function lasted(rec: GameRecord): string | null {
  if (rec.startedAt === null) return null;
  const min = Math.max(1, Math.round((rec.endedAt - rec.startedAt) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** "Ashaya, Soul of the Wild" → "Ashaya": what players call a commander. */
export const shortName = (name: string) => name.split(' // ')[0].split(',')[0].trim();

/** The commander behind a commander-damage key (a profile id, `id#2` for a partner). */
function commanderOf(rec: GameRecord, key: string): string {
  const [profileId, n] = key.split('#');
  const seat = rec.players.find((p) => p.profileId === profileId);
  if (!seat) return 'a commander';
  const name = n ? seat.partnerName : seat.commanderName;
  return name ? shortName(name) : `${seat.name}'s commander`;
}

const whose = (rec: GameRecord, seat: number, active: number) =>
  active === seat ? 'their own turn' : `${rec.players[active]?.name ?? '?'}'s turn`;

function whatOf(rec: GameRecord, out: StoryOut): string {
  switch (out.how) {
    case 'commander':
      return `${out.n !== undefined ? `${out.n} commander damage` : 'Commander damage'} from ${commanderOf(rec, out.by ?? '')}`;
    case 'poison':
      return 'Ten poison counters';
    case 'conceded':
      return 'Conceded';
    default:
      return 'Out of life';
  }
}

export interface RecapRow {
  seat: number;
  name: string;
  /** 1 for the winner, then by when they went out (last out = 2nd). Players
   * who went out in the same move share a place; in a draw the last ones share 1st. */
  place: number;
  what: string;
  when: string | null;
}

/** The recap, a line per player: the winner, then the others from the last one out to the first. */
export function recapRows(rec: GameRecord): RecapRow[] {
  const rows: RecapRow[] = [];
  const w = rec.winner;
  if (w !== null && rec.players[w])
    rows.push({ seat: w, name: rec.players[w].name, place: 1, what: `Winner · ${rec.players[w].life} life`, when: null });
  const outs = rec.outs
    .filter((o) => o.seat !== w && rec.players[o.seat])
    .sort((a, b) => b.t - a.t || a.seat - b.seat);
  let place = rows.length + 1;
  for (let i = 0; i < outs.length; ) {
    const group = outs.filter((o) => o.t === outs[i].t);
    for (const o of group)
      rows.push({
        seat: o.seat,
        name: rec.players[o.seat].name,
        place,
        what: whatOf(rec, o),
        when: `Turn ${o.turn} · ${whose(rec, o.seat, o.active)}`,
      });
    place += group.length;
    i += group.length;
  }
  // Anyone the story never saw go out (a game from before stories).
  rec.players.forEach((p, seat) => {
    if (!rows.some((r) => r.seat === seat)) rows.push({ seat, name: p.name, place, what: `${p.life} life`, when: null });
  });
  return rows;
}

/** "14 to Alex · turn 8, Nathan's turn" — the game's biggest hit, or null. */
export function hitLine(rec: GameRecord): string | null {
  const h = rec.hit;
  if (!h || !rec.players[h.seat]) return null;
  return `${h.n} to ${rec.players[h.seat].name} · turn ${h.turn}, ${whose(rec, h.seat, h.active)}`;
}

export interface Standing {
  key: string;
  name: string;
  image: string | null;
  games: number;
  wins: number;
}

const counted = (records: GameRecord[]) => records.filter((r) => !r.removed);

const ranked = (list: Standing[]) =>
  list.sort(
    (a, b) =>
      b.wins - a.wins || b.wins / b.games - a.wins / a.games || b.games - a.games || a.name.localeCompare(b.name),
  );

/** Tallies everyone (or every commander) by `keyOf`, the newest game naming them. */
function tally(
  records: GameRecord[],
  keyOf: (p: GameRecord['players'][number]) => { key: string; name: string; image: string | null } | null,
): Standing[] {
  const by = new Map<string, Standing & { at: number }>();
  for (const r of counted(records))
    r.players.forEach((p, seat) => {
      const k = keyOf(p);
      if (!k) return;
      const was = by.get(k.key);
      const newer = !was || r.endedAt >= was.at;
      by.set(k.key, {
        key: k.key,
        name: newer ? k.name : was.name,
        image: newer ? (k.image ?? was?.image ?? null) : was.image,
        games: (was?.games ?? 0) + 1,
        wins: (was?.wins ?? 0) + (r.winner === seat ? 1 : 0),
        at: newer ? r.endedAt : was.at,
      });
    });
  return ranked([...by.values()].map(({ at: _at, ...s }) => s));
}

/** Every player who has sat down, by wins. */
export function playerStandings(records: GameRecord[]): Standing[] {
  return tally(records, (p) => ({ key: p.profileId, name: p.name, image: p.avatarUrl }));
}

/** Every commander that has been played (a partner pair as one), by wins. */
export function commanderStandings(records: GameRecord[]): Standing[] {
  return tally(records, (p) =>
    p.commanderName
      ? {
          key: `${p.commanderName}|${p.partnerName ?? ''}`.toLowerCase(),
          name: p.partnerName ? `${shortName(p.commanderName)} & ${shortName(p.partnerName)}` : p.commanderName,
          image: p.commanderImage,
        }
      : null,
  );
}

/** Games played with a deck, and games it won. */
export function deckTally(records: GameRecord[], deckId: string): { games: number; wins: number } {
  let games = 0;
  let wins = 0;
  for (const r of counted(records)) {
    if (!r.players.some((p) => p.deckId === deckId)) continue;
    games++;
    if (r.winner !== null && r.players[r.winner]?.deckId === deckId) wins++;
  }
  return { games, wins };
}

/** How many games a player has won. */
export function winsOf(records: GameRecord[], profileId: string): number {
  return counted(records).filter((r) => r.winner !== null && r.players[r.winner]?.profileId === profileId).length;
}
