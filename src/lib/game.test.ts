import { describe, expect, test } from 'vitest';
import type { GameConfig, GameState } from './types';
import { adjustLife, applyCommanderDamage, createGame, passTurn } from './game';

function commanderConfig(playerCount = 4): GameConfig {
  return {
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    profiles: Array.from({ length: playerCount }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${i}`,
      avatarUrl: null,
      commanderName: null,
    })),
  };
}

describe('createGame', () => {
  test('seeds each player with starting life and empty state', () => {
    const game = createGame(commanderConfig());
    expect(game.players).toHaveLength(4);
    for (const p of game.players) {
      expect(p.life).toBe(40);
      expect(p.commanderDamage).toEqual({});
      expect(p.eliminated).toBe(false);
      expect(p.board).toEqual([]);
    }
    expect(game.activePlayerIndex).toBe(0);
    expect(game.turnNumber).toBe(1);
  });
});

describe('adjustLife', () => {
  test('adds and subtracts life', () => {
    let game = createGame(commanderConfig());
    game = adjustLife(game, 1, -5);
    game = adjustLife(game, 1, 2);
    expect(game.players[1].life).toBe(37);
    expect(game.players[0].life).toBe(40);
  });

  test('life reaching 0 eliminates the player', () => {
    let game = createGame(commanderConfig());
    game = adjustLife(game, 2, -40);
    expect(game.players[2].life).toBe(0);
    expect(game.players[2].eliminated).toBe(true);
  });

  test('elimination is sticky: gaining life back does not revive', () => {
    let game = createGame(commanderConfig());
    game = adjustLife(game, 2, -45);
    game = adjustLife(game, 2, 50);
    expect(game.players[2].eliminated).toBe(true);
  });
});

describe('applyCommanderDamage', () => {
  test('raises damage and lowers life together', () => {
    let game = createGame(commanderConfig());
    game = applyCommanderDamage(game, 0, 'p1', 3);
    expect(game.players[0].commanderDamage['p1']).toBe(3);
    expect(game.players[0].life).toBe(37);
  });

  test('reaching the threshold eliminates even at high life', () => {
    let game = createGame(commanderConfig());
    game = applyCommanderDamage(game, 0, 'p1', 21);
    expect(game.players[0].life).toBe(19);
    expect(game.players[0].eliminated).toBe(true);
  });

  test('negative delta clamps damage at 0 and refunds only what was dealt', () => {
    let game = createGame(commanderConfig());
    game = applyCommanderDamage(game, 0, 'p1', 2);
    game = applyCommanderDamage(game, 0, 'p1', -5);
    expect(game.players[0].commanderDamage['p1']).toBe(0);
    expect(game.players[0].life).toBe(40);
  });

  test('damage from different commanders tracks separately', () => {
    let game = createGame(commanderConfig());
    game = applyCommanderDamage(game, 0, 'p1', 10);
    game = applyCommanderDamage(game, 0, 'p2', 15);
    expect(game.players[0].commanderDamage).toEqual({ p1: 10, p2: 15 });
    expect(game.players[0].eliminated).toBe(false);
  });
});

describe('passTurn', () => {
  test('advances to the next seat', () => {
    let game = createGame(commanderConfig());
    game = passTurn(game);
    expect(game.activePlayerIndex).toBe(1);
    expect(game.turnNumber).toBe(1);
  });

  test('wrapping past seat 0 increments the turn number', () => {
    let game: GameState = { ...createGame(commanderConfig()), activePlayerIndex: 3 };
    game = passTurn(game);
    expect(game.activePlayerIndex).toBe(0);
    expect(game.turnNumber).toBe(2);
  });

  test('skips eliminated players', () => {
    let game = createGame(commanderConfig());
    game = adjustLife(game, 1, -40);
    game = passTurn(game);
    expect(game.activePlayerIndex).toBe(2);
  });

  test('with a single survivor, the seat stays put and does not hang', () => {
    let game = createGame(commanderConfig());
    game = adjustLife(game, 1, -40);
    game = adjustLife(game, 2, -40);
    game = adjustLife(game, 3, -40);
    game = passTurn(game);
    expect(game.activePlayerIndex).toBe(0);
  });

  test('with everyone eliminated, state is returned unchanged', () => {
    let game = createGame(commanderConfig());
    for (let i = 0; i < 4; i++) game = adjustLife(game, i, -40);
    const after = passTurn(game);
    expect(after.activePlayerIndex).toBe(0);
    expect(after.turnNumber).toBe(1);
  });
});
