import { describe, expect, test } from 'vitest';
import type { CardRecord, GameConfig, GameState } from './types';
import {
  adjustLife,
  applyCommanderDamage,
  claimInitiative,
  claimMonarch,
  createGame,
  isCommanderLegal,
  passTurn,
  setCommanderDeaths,
  setPlayerCounter,
  settlePlayer,
} from './game';

function card(typeLine: string, oracleText = ''): CardRecord {
  return {
    id: 'x',
    name: 'X',
    nameLower: 'x',
    typeLine,
    oracleText,
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

describe('isCommanderLegal', () => {
  test('legendary creatures qualify', () => {
    expect(isCommanderLegal(card('Legendary Creature — Dragon'))).toBe(true);
  });

  test('ordinary creatures and legendary non-creatures do not', () => {
    expect(isCommanderLegal(card('Creature — Dragon'))).toBe(false);
    expect(isCommanderLegal(card('Legendary Artifact'))).toBe(false);
    expect(isCommanderLegal(card('Basic Land — Forest'))).toBe(false);
  });

  test('cards that say they can be your commander qualify', () => {
    expect(
      isCommanderLegal(
        card('Legendary Planeswalker — Teferi', 'Teferi, Temporal Archmage can be your commander.'),
      ),
    ).toBe(true);
  });
});

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
      expect(p.counters).toEqual({});
      expect(p.commanderDeaths).toBe(0);
    }
    expect(game.activePlayerIndex).toBe(0);
    expect(game.turnNumber).toBe(1);
    expect(game.monarchIdx).toBeNull();
    expect(game.initiativeIdx).toBeNull();
    expect(typeof game.turnStartedAt).toBe('number');
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

  // ---- settlePlayer: everything one fight does to a player, in one update ----

  test('a fight is one update: a player at 3 who takes 4 and gains 2 lives at 1', () => {
    const at3 = adjustLife(createGame(commanderConfig()), 1, -37);
    const after = settlePlayer(at3, 1, { life: -2 }); // the net of −4 and +2
    expect(after.players[1].life).toBe(1);
    expect(after.players[1].eliminated).toBe(false);
    // The same two changes one after the other defeat him for good: that is why this exists.
    const chained = adjustLife(adjustLife(at3, 1, -4), 1, 2);
    expect(chained.players[1].life).toBe(1);
    expect(chained.players[1].eliminated).toBe(true);
  });

  test('a fight is one update: commander damage is written on the gauge and counted once', () => {
    const game = settlePlayer(createGame(commanderConfig()), 0, { life: -5, commander: { p1: 3 } });
    expect(game.players[0].life).toBe(35); // 5 in all, 3 of them from the commander: not 32
    expect(game.players[0].commanderDamage).toEqual({ p1: 3 });
    const again = settlePlayer(game, 0, { life: -2, commander: { p1: 2, 'p2#2': 1 } });
    expect(again.players[0].commanderDamage).toEqual({ p1: 5, 'p2#2': 1 }); // added to what is there
    expect(again.players[0].life).toBe(33);
  });

  test('a fight is one update: poison is added to what is there, never set', () => {
    let game = setPlayerCounter(createGame(commanderConfig()), 2, 'poison', 3);
    game = setPlayerCounter(game, 2, 'energy', 4);
    const after = settlePlayer(game, 2, { poison: 2 });
    expect(after.players[2].counters).toEqual({ poison: 5, energy: 4 });
    expect(after.players[2].life).toBe(40); // infect takes no life
    expect(settlePlayer(createGame(commanderConfig()), 2, { poison: 1 }).players[2].counters).toEqual({
      poison: 1,
    });
  });

  test('a fight is one update: the player is judged once, at the end, by whatever is lethal', () => {
    const fresh = createGame(commanderConfig());
    // 21 from one commander is lethal at 19 life
    const byCommander = settlePlayer(fresh, 0, { life: -21, commander: { p1: 21 } });
    expect([byCommander.players[0].life, byCommander.players[0].eliminated]).toEqual([19, true]);
    // 11 + 11 from two commanders is not
    const split = settlePlayer(fresh, 0, { life: -22, commander: { p1: 11, 'p1#2': 11 } });
    expect(split.players[0].eliminated).toBe(false);
    // the tenth poison counter is, with every life point left
    const poisoned = settlePlayer(setPlayerCounter(fresh, 0, 'poison', 8), 0, { poison: 2 });
    expect([poisoned.players[0].life, poisoned.players[0].eliminated]).toEqual([40, true]);
    // an infect commander: poison and the gauge, no life
    const infect = settlePlayer(fresh, 0, { commander: { p1: 4 }, poison: 4 });
    expect(infect.players[0]).toMatchObject({ life: 40, commanderDamage: { p1: 4 }, eliminated: false });
    expect(infect.players[0].counters.poison).toBe(4);
    // life at exactly 0 is
    expect(settlePlayer(fresh, 0, { life: -40 }).players[0].eliminated).toBe(true);
    // and nobody else was touched
    expect(byCommander.players[1]).toBe(fresh.players[1]);
  });

  test('a fight that changes nothing hands back the same state, and so does a seat that is not there', () => {
    const game = createGame(commanderConfig());
    expect(settlePlayer(game, 0, {})).toBe(game);
    expect(settlePlayer(game, 0, { life: 0, commander: { p1: 0 }, poison: 0 })).toBe(game);
    expect(settlePlayer(game, 9, { life: -3 })).toBe(game);
    expect(settlePlayer(game, 0, { life: Number.NaN, poison: Number.NaN })).toBe(game); // nonsense is no change
  });

  test('a defeated player stays defeated, and a gauge never goes below zero', () => {
    const dead = adjustLife(createGame(commanderConfig()), 0, -40);
    expect(settlePlayer(dead, 0, { life: 12 }).players[0].eliminated).toBe(true);
    const game = settlePlayer(createGame(commanderConfig()), 0, { commander: { p1: -4 }, poison: -2 });
    expect(game.players[0].commanderDamage.p1 ?? 0).toBe(0);
    expect(game.players[0].counters.poison ?? 0).toBe(0);
  });
});

describe('player counters (poison, energy, experience)', () => {
  test('counters set and clamp at zero', () => {
    let game = createGame(commanderConfig());
    game = setPlayerCounter(game, 0, 'energy', 3);
    game = setPlayerCounter(game, 0, 'energy', -2);
    expect(game.players[0].counters).toEqual({});
    game = setPlayerCounter(game, 0, 'experience', 2);
    expect(game.players[0].counters.experience).toBe(2);
  });

  test('ten poison eliminates; nine does not', () => {
    let game = createGame(commanderConfig());
    game = setPlayerCounter(game, 1, 'poison', 9);
    expect(game.players[1].eliminated).toBe(false);
    game = setPlayerCounter(game, 1, 'poison', 10);
    expect(game.players[1].eliminated).toBe(true);
  });

  test('energy at any amount never eliminates', () => {
    let game = createGame(commanderConfig());
    game = setPlayerCounter(game, 1, 'energy', 25);
    expect(game.players[1].eliminated).toBe(false);
  });
});

describe('commander deaths (tax)', () => {
  test('tracks deaths and clamps at zero', () => {
    let game = createGame(commanderConfig());
    game = setCommanderDeaths(game, 2, 2);
    expect(game.players[2].commanderDeaths).toBe(2);
    game = setCommanderDeaths(game, 2, -1);
    expect(game.players[2].commanderDeaths).toBe(0);
  });
});

describe('monarch and initiative', () => {
  test('claiming moves the badge between players', () => {
    let game = createGame(commanderConfig());
    game = claimMonarch(game, 1);
    expect(game.monarchIdx).toBe(1);
    game = claimMonarch(game, 3);
    expect(game.monarchIdx).toBe(3);
    game = claimInitiative(game, 0);
    expect(game.initiativeIdx).toBe(0);
    expect(game.monarchIdx).toBe(3);
  });

  test('claiming again releases the badge', () => {
    let game = createGame(commanderConfig());
    game = claimMonarch(game, 1);
    game = claimMonarch(game, 1);
    expect(game.monarchIdx).toBeNull();
  });
});

describe('passTurn', () => {
  test('advances to the next seat', () => {
    let game = createGame(commanderConfig());
    game = passTurn(game);
    expect(game.activePlayerIndex).toBe(1);
    expect(game.turnNumber).toBe(1);
  });

  test('stamps the turn start time', () => {
    let game = createGame(commanderConfig());
    game = passTurn(game, 123456);
    expect(game.turnStartedAt).toBe(123456);
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
