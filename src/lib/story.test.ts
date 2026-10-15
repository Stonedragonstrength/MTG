import { describe, expect, test } from 'vitest';
import { adjustLife, applyCommanderDamage, createGame, passTurn, setPlayerCounter, settlePlayer } from './game';
import { beginStory, biggestHit, decided, validStory, withStory } from './story';
import type { GameConfig, GameState } from './types';

const NAMES = ['Nathan', 'Sam', 'Alex', 'Jo'];
const config = (n = 3): GameConfig => ({
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: NAMES[i], avatarUrl: null, commanderName: null })),
});
const start = (n = 3) => beginStory(createGame(config(n), 1000), 1000, 'g1');
/** One move, the way the store makes it: the story rides along. */
const move = (g: GameState, fn: (g: GameState) => GameState, t: number) => withStory(g, fn(g), t);
const knockOut = (g: GameState, seat: number): GameState => ({
  ...g,
  players: g.players.map((p, i) => (i === seat ? { ...p, eliminated: true } : p)),
});

describe('beginStory', () => {
  test('names the game, stamps its start and writes down the opening life totals', () => {
    expect(start().story).toEqual({
      id: 'g1',
      startedAt: 1000,
      turns: [{ turn: 1, active: 0, life: [40, 40, 40] }],
      outs: [],
    });
  });

  test('mints a fresh name when none is given', () => {
    const a = beginStory(createGame(config(), 1000), 1000);
    const b = beginStory(createGame(config(), 1000), 1000);
    expect(a.story!.id).not.toBe(b.story!.id);
  });
});

describe('withStory', () => {
  test('a move that changes nothing comes back as it was', () => {
    const g = start();
    expect(withStory(g, g, 2000)).toBe(g);
  });

  test('a move the story has nothing to say about keeps its own state object', () => {
    const g = start();
    const next = { ...g, monarchIdx: 1 };
    expect(withStory(g, next, 2000)).toBe(next);
  });

  test('a game begun before stories gets one at its first move, without a start time', () => {
    const g = createGame(config(), 1000);
    const next = move(g, (x) => adjustLife(x, 1, -3), 5000);
    expect(next.story!.id).toMatch(/^g/);
    expect(next.story!.startedAt).toBeUndefined();
    expect(next.story!.turns).toEqual([{ turn: 1, active: 0, life: [40, 40, 40] }]);
  });

  test('each turn that begins writes down every life total', () => {
    let g = start();
    g = move(g, (x) => adjustLife(x, 1, -5), 2000);
    g = move(g, (x) => passTurn(x, 3000), 3000);
    g = move(g, (x) => passTurn(x, 4000), 4000);
    g = move(g, (x) => passTurn(x, 5000), 5000);
    expect(g.story!.turns).toEqual([
      { turn: 1, active: 0, life: [40, 40, 40] },
      { turn: 1, active: 1, life: [40, 35, 40] },
      { turn: 1, active: 2, life: [40, 35, 40] },
      { turn: 2, active: 0, life: [40, 35, 40] },
    ]);
  });

  test('taps a moment apart add up to one hit', () => {
    let g = start();
    for (let i = 0; i < 5; i++) g = move(g, (x) => adjustLife(x, 1, -1), 2000 + i * 300);
    expect(biggestHit(g.story!)).toEqual({ seat: 1, n: 5, turn: 1, active: 0 });
  });

  test('a correction inside the burst takes the hit back', () => {
    let g = start();
    g = move(g, (x) => adjustLife(x, 1, -3), 2000);
    g = move(g, (x) => adjustLife(x, 1, 3), 2600);
    expect(biggestHit(g.story!)).toBeNull();
  });

  test('hits apart in time are separate, and the biggest one is kept', () => {
    let g = start();
    g = move(g, (x) => adjustLife(x, 1, -3), 2000);
    g = move(g, (x) => adjustLife(x, 2, -7), 9000);
    g = move(g, (x) => adjustLife(x, 1, -2), 20000);
    g = move(g, (x) => adjustLife(x, 1, -1), 21000);
    expect(biggestHit(g.story!)).toEqual({ seat: 2, n: 7, turn: 1, active: 0 });
  });

  test('a hit remembers the turn it began in', () => {
    let g = start();
    g = move(g, (x) => passTurn(x, 1500), 1500);
    g = move(g, (x) => adjustLife(x, 0, -9), 2000);
    expect(biggestHit(g.story!)).toEqual({ seat: 0, n: 9, turn: 1, active: 1 });
  });

  test('one move that hits two players is a hit on each', () => {
    let g = start();
    g = move(g, (x) => settlePlayer(settlePlayer(x, 1, { life: -4 }), 2, { life: -6 }), 2000);
    expect(g.story!.open).toEqual([
      { seat: 1, net: -4, t: 2000, turn: 1, active: 0 },
      { seat: 2, net: -6, t: 2000, turn: 1, active: 0 },
    ]);
    expect(biggestHit(g.story!)).toEqual({ seat: 2, n: 6, turn: 1, active: 0 });
  });

  test('life gained is no hit', () => {
    let g = start();
    g = move(g, (x) => adjustLife(x, 1, 6), 2000);
    expect(biggestHit(g.story!)).toBeNull();
  });

  test('a player who goes out is written down with how, the turn and whose turn it was', () => {
    let g = start();
    g = move(g, (x) => passTurn(x, 1500), 1500);
    g = move(g, (x) => adjustLife(x, 2, -40), 3000);
    expect(g.story!.outs).toEqual([{ seat: 2, turn: 1, active: 1, t: 3000, how: 'life' }]);
  });

  test('commander damage names the commander that reached the limit, and its total', () => {
    let g = start();
    g = move(g, (x) => applyCommanderDamage(x, 1, 'p0', 15), 2000);
    g = move(g, (x) => applyCommanderDamage(x, 1, 'p0', 9), 9000);
    expect(g.story!.outs).toEqual([{ seat: 1, turn: 1, active: 0, t: 9000, how: 'commander', by: 'p0', n: 24 }]);
  });

  test('ten poison', () => {
    let g = start();
    g = move(g, (x) => setPlayerCounter(x, 2, 'poison', 10), 2000);
    expect(g.story!.outs).toEqual([{ seat: 2, turn: 1, active: 0, t: 2000, how: 'poison' }]);
  });

  test('a player taken out without a lethal total conceded', () => {
    let g = start();
    g = move(g, (x) => knockOut(x, 2), 2000);
    expect(g.story!.outs).toEqual([{ seat: 2, turn: 1, active: 0, t: 2000, how: 'conceded' }]);
  });

  test('the last player standing decides the game, and the moment is written down once', () => {
    let g = start(2);
    g = move(g, (x) => adjustLife(x, 1, -40), 7000);
    expect(decided(g)).toBe(0);
    expect(g.story!.endedAt).toBe(7000);
    g = move(g, (x) => adjustLife(x, 0, 2), 9000);
    expect(g.story!.endedAt).toBe(7000);
  });

  test('everyone falling at once is a draw', () => {
    let g = start(2);
    g = move(g, (x) => settlePlayer(settlePlayer(x, 0, { life: -40 }), 1, { life: -40 }), 7000);
    expect(decided(g)).toBe('draw');
    expect(g.story!.endedAt).toBe(7000);
    expect(g.story!.outs.map((o) => o.seat)).toEqual([0, 1]);
  });
});

describe('decided', () => {
  test('nobody while two or more players are still in', () => {
    expect(decided(start())).toBeNull();
    expect(decided(knockOut(start(), 1))).toBeNull();
  });

  test('the one player left', () => {
    expect(decided(knockOut(knockOut(start(), 0), 2))).toBe(1);
  });

  test('a draw when nobody is left', () => {
    expect(decided(knockOut(knockOut(start(2), 0), 1))).toBe('draw');
  });

  test('a game of one player is never decided', () => {
    expect(decided(beginStory(createGame(config(1), 1000), 1000))).toBeNull();
  });
});

describe('validStory', () => {
  test('a story the app wrote is valid', () => {
    let g = start();
    g = move(g, (x) => adjustLife(x, 1, -40), 2000);
    expect(validStory(g.story, 3)).toBe(true);
  });

  test('a mangled one is not', () => {
    expect(validStory(null, 3)).toBe(false);
    expect(validStory({ id: 'g', turns: 'x', outs: [] }, 3)).toBe(false);
    expect(validStory({ id: 'g', turns: [], outs: [{ seat: 9, turn: 1, active: 0, t: 1, how: 'life' }] }, 3)).toBe(false);
    expect(validStory({ id: 'g', turns: [], outs: [{ seat: 1, turn: 1, active: 0, how: 'life' }] }, 3)).toBe(false);
    expect(validStory({ id: 'g', turns: [{ turn: 1, active: 0, life: [40] }], outs: [] }, 3)).toBe(false);
    expect(validStory({ id: 'g', turns: [], outs: [], best: { seat: 0, n: 'x', turn: 1, active: 0 } }, 3)).toBe(false);
  });
});
