import { describe, expect, test } from 'vitest';
import { adjustLife, applyCommanderDamage, createGame, passTurn } from './game';
import {
  commanderStandings,
  deckTally,
  hitLine,
  lasted,
  playerStandings,
  recapRows,
  recordOf,
  winsOf,
} from './history';
import { beginStory, withStory } from './story';
import type { GameConfig, GameRecord, GameState, PlayerProfile } from './types';

const profile = (i: number, over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  id: `p${i}`,
  name: ['Nathan', 'Sam', 'Alex', 'Jo'][i],
  avatarUrl: `avatar${i}`,
  commanderName: ['Ashaya, Soul of the Wild', 'Vilis, Broker of Blood', 'Tana, the Bloodsower', 'Atraxa'][i],
  commanderImage: `img${i}`,
  commanderColors: [['G'], ['B'], ['R', 'G'], ['W', 'U', 'B', 'G']][i],
  ...over,
});
const config = (n = 3, over: Record<number, Partial<PlayerProfile>> = {}): GameConfig => ({
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: Array.from({ length: n }, (_, i) => profile(i, over[i])),
});
const move = (g: GameState, fn: (g: GameState) => GameState, t: number) => withStory(g, fn(g), t);

/** Nathan beats Sam (commander damage, Nathan's turn) then Alex (life, on Alex's own turn). */
function played(): GameState {
  let g = beginStory(createGame(config(), 1000), 1000, 'g1');
  g = move(g, (x) => adjustLife(x, 2, -14), 5000);
  g = move(g, (x) => applyCommanderDamage(x, 1, 'p0', 21), 60_000);
  g = move(g, (x) => passTurn(x, 70_000), 70_000); // Alex's turn (Sam is out)
  g = move(g, (x) => adjustLife(x, 2, -30), 80_000);
  return g;
}

describe('recordOf', () => {
  test('a decided game: who won, how long it took, everyone at the table', () => {
    const rec = recordOf(played(), { now: 99_000, online: false });
    expect(rec).toMatchObject({
      id: 'g1',
      startedAt: 1000,
      endedAt: 80_000,
      turns: 1,
      format: 'commander',
      mode: 'tracker',
      online: false,
      winner: 0,
      hit: { seat: 2, n: 30, turn: 1, active: 2 },
    });
    expect(rec.players.map((p) => [p.name, p.life, p.commanderName])).toEqual([
      ['Nathan', 40, 'Ashaya, Soul of the Wild'],
      ['Sam', 19, 'Vilis, Broker of Blood'],
      ['Alex', -4, 'Tana, the Bloodsower'],
    ]);
    expect(rec.outs).toEqual([
      { seat: 1, turn: 1, active: 0, t: 60_000, how: 'commander', by: 'p0', n: 21 },
      { seat: 2, turn: 1, active: 2, t: 80_000, how: 'life' },
    ]);
    // The turns as they began, and where everyone ended.
    expect(rec.lives).toEqual([
      { turn: 1, active: 0, life: [40, 40, 40] },
      { turn: 1, active: 2, life: [40, 19, 26] },
      { turn: 1, active: 2, life: [40, 19, -4] },
    ]);
  });

  test('a winner named at the end: everyone else still in conceded then', () => {
    let g = beginStory(createGame(config(), 1000), 1000, 'g2');
    g = move(g, (x) => adjustLife(x, 1, -40), 5000);
    const rec = recordOf(g, { now: 9000, online: true, winner: 2 });
    expect(rec.winner).toBe(2);
    expect(rec.endedAt).toBe(9000);
    expect(rec.online).toBe(true);
    expect(rec.outs).toEqual([
      { seat: 1, turn: 1, active: 0, t: 5000, how: 'life' },
      { seat: 0, turn: 1, active: 0, t: 9000, how: 'conceded' },
    ]);
  });

  test('a draw has no winner', () => {
    let g = beginStory(createGame(config(2), 1000), 1000, 'g3');
    g = move(
      g,
      (x) => ({ ...x, players: x.players.map((p) => ({ ...p, life: 0, eliminated: true })) }),
      5000,
    );
    expect(recordOf(g, { now: 6000, online: false }).winner).toBeNull();
  });

  test('the deck each seat played: a dealt seat names its own, a chosen one is looked up', () => {
    const g = beginStory(createGame(config(2, { 0: { deckId: 'd1' }, 1: { deckId: 'd2' } }), 1000), 1000, 'g4');
    const dealt: GameState = {
      ...g,
      players: g.players.map((p, i) =>
        i === 0
          ? { ...p, cards: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'Stompy' } }
          : p,
      ),
    };
    const rec = recordOf(dealt, { now: 2000, online: false, winner: 0, deckNames: { d1: 'Old name', d2: 'Vilis Pain' } });
    expect(rec.players.map((p) => [p.deckId, p.deckName])).toEqual([
      ['d1', 'Stompy'],
      ['d2', 'Vilis Pain'],
    ]);
  });

  test('a game with no story still makes a record', () => {
    let g = createGame(config(2), 1000);
    g = { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, life: 0, eliminated: true } : p)) };
    const rec = recordOf(g, { now: 5000, online: false });
    expect(rec.winner).toBe(0);
    expect(rec.startedAt).toBeNull();
    expect(rec.endedAt).toBe(5000);
    expect(rec.id).toMatch(/^g/);
    expect(rec.outs).toEqual([{ seat: 1, turn: 1, active: 0, t: 5000, how: 'life' }]);
  });
});

describe('recapRows', () => {
  test('the winner first, then the others from the last one out to the first', () => {
    const rows = recapRows(recordOf(played(), { now: 99_000, online: false }));
    expect(rows).toEqual([
      { seat: 0, name: 'Nathan', place: 1, what: 'Winner · 40 life', when: null },
      { seat: 2, name: 'Alex', place: 2, what: 'Out of life', when: 'Turn 1 · their own turn' },
      { seat: 1, name: 'Sam', place: 3, what: '21 commander damage from Ashaya', when: "Turn 1 · Nathan's turn" },
    ]);
  });

  test('poison, a concession and a partner commander', () => {
    let g = beginStory(
      createGame(config(4, { 0: { partnerName: 'Rograkh, Son of Rohgahh' } }), 1000),
      1000,
      'g5',
    );
    g = move(g, (x) => applyCommanderDamage(x, 1, 'p0#2', 21), 2000);
    g = move(g, (x) => ({ ...x, players: x.players.map((p, i) => (i === 3 ? { ...p, counters: { poison: 10 }, eliminated: true } : p)) }), 3000);
    const rows = recapRows(recordOf(g, { now: 4000, online: false, winner: 0 }));
    expect(rows.map((r) => r.what)).toEqual([
      'Winner · 40 life',
      'Conceded',
      'Ten poison counters',
      '21 commander damage from Rograkh',
    ]);
  });

  test('a draw lists everyone, in seat order, with no winner', () => {
    let g = beginStory(createGame(config(2), 1000), 1000, 'g6');
    g = move(g, (x) => ({ ...x, players: x.players.map((p) => ({ ...p, life: 0, eliminated: true })) }), 5000);
    const rows = recapRows(recordOf(g, { now: 6000, online: false }));
    expect(rows.map((r) => [r.name, r.place, r.what])).toEqual([
      ['Nathan', 1, 'Out of life'],
      ['Sam', 1, 'Out of life'],
    ]);
  });
});

describe('lasted', () => {
  const base = recordOf(played(), { now: 99_000, online: false });
  test('minutes, then hours and minutes', () => {
    expect(lasted({ ...base, startedAt: 0, endedAt: 47 * 60_000 })).toBe('47 min');
    expect(lasted({ ...base, startedAt: 0, endedAt: 65 * 60_000 })).toBe('1 h 5 min');
    expect(lasted({ ...base, startedAt: 0, endedAt: 10_000 })).toBe('1 min');
  });

  test('nothing when the start is not known', () => {
    expect(lasted({ ...base, startedAt: null })).toBeNull();
  });
});

describe('hitLine', () => {
  test('says how big, to whom and when', () => {
    expect(hitLine(recordOf(played(), { now: 99_000, online: false }))).toBe('30 to Alex · turn 1, their own turn');
  });

  test('nothing when nobody was hit', () => {
    const g = beginStory(createGame(config(2), 1000), 1000, 'g7');
    expect(hitLine(recordOf(g, { now: 2000, online: false, winner: 0 }))).toBeNull();
  });
});

const rec = (id: string, winner: number | null, seats: [string, string, string | null][], over: Partial<GameRecord> = {}): GameRecord => ({
  id,
  startedAt: 0,
  endedAt: 1,
  turns: 8,
  format: 'commander',
  mode: 'tracker',
  online: false,
  winner,
  players: seats.map(([profileId, name, deckId], i) => ({
    profileId,
    name,
    avatarUrl: null,
    commanderName: `${name}'s commander`,
    partnerName: null,
    commanderImage: `img-${name}`,
    colors: [],
    deckId,
    deckName: null,
    life: i === winner ? 20 : 0,
  })),
  outs: [],
  hit: null,
  lives: [],
  ...over,
});

const RECORDS = [
  rec('a', 0, [['p0', 'Nathan', 'd1'], ['p1', 'Sam', 'd2']]),
  rec('b', 1, [['p0', 'Nathan', 'd1'], ['p1', 'Sam', 'd2'], ['p2', 'Alex', null]]),
  rec('c', 0, [['p0', 'Nathan', 'd3'], ['p2', 'Alex', null]]),
  rec('d', null, [['p0', 'Nathan', 'd1'], ['p1', 'Sam', 'd2']]),
  rec('e', 1, [['p0', 'Nathan', 'd1'], ['p1', 'Sam', 'd2']], { removed: true }),
];

describe('standings', () => {
  test('players by wins, with how many games they sat down for (removed games count nowhere)', () => {
    expect(playerStandings(RECORDS).map((s) => [s.name, s.wins, s.games])).toEqual([
      ['Nathan', 2, 4],
      ['Sam', 1, 3],
      ['Alex', 0, 2],
    ]);
  });

  test('a player who was renamed shows their newest name', () => {
    const renamed = [...RECORDS, rec('f', 1, [['p0', 'Nathan', null], ['p1', 'Samantha', null]], { endedAt: 99 })];
    expect(playerStandings(renamed).map((s) => s.name)).toContain('Samantha');
  });

  test('commanders by wins', () => {
    expect(commanderStandings(RECORDS).map((s) => [s.name, s.wins, s.games])).toEqual([
      ["Nathan's commander", 2, 4],
      ["Sam's commander", 1, 3],
      ["Alex's commander", 0, 2],
    ]);
  });

  test('a deck: games played with it and games won', () => {
    expect(deckTally(RECORDS, 'd1')).toEqual({ games: 3, wins: 1 });
    expect(deckTally(RECORDS, 'd2')).toEqual({ games: 3, wins: 1 });
    expect(deckTally(RECORDS, 'nope')).toEqual({ games: 0, wins: 0 });
  });

  test("a player's wins", () => {
    expect(winsOf(RECORDS, 'p0')).toBe(2);
    expect(winsOf(RECORDS, 'p9')).toBe(0);
  });
});
