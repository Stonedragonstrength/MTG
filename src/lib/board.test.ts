import { describe, expect, test } from 'vitest';
import type { CardRecord, GameConfig, GameState } from './types';
import { createGame } from './game';
import {
  addItem,
  changeCount,
  computedPT,
  createBoardItem,
  createCustomToken,
  removeItem,
  setCounter,
  splitItem,
  tapItem,
  untapAll,
} from './board';

const soldier: CardRecord = {
  id: 'card-soldier',
  name: 'Soldier',
  nameLower: 'soldier',
  typeLine: 'Token Creature — Soldier',
  oracleText: '',
  manaCost: '',
  power: '1',
  toughness: '1',
  colors: ['W'],
  imageNormal: 'https://img.example/soldier.jpg',
  imageArtCrop: 'https://img.example/soldier-art.jpg',
  isToken: true,
  isBasicLand: false,
};

const clue: CardRecord = {
  ...soldier,
  id: 'card-clue',
  name: 'Clue',
  nameLower: 'clue',
  typeLine: 'Token Artifact — Clue',
  power: null,
  toughness: null,
  colors: [],
};

function freshGame(): GameState {
  const config: GameConfig = {
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    profiles: [
      { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
    ],
  };
  return createGame(config);
}

describe('createBoardItem', () => {
  test('maps card fields and parses numeric power/toughness', () => {
    const item = createBoardItem(soldier);
    expect(item.cardId).toBe('card-soldier');
    expect(item.name).toBe('Soldier');
    expect(item.basePower).toBe(1);
    expect(item.baseToughness).toBe(1);
    expect(item.count).toBe(1);
    expect(item.counters).toEqual({});
  });

  test('star power/toughness becomes null', () => {
    const tarmo = { ...soldier, power: '*', toughness: '1+*' };
    const item = createBoardItem(tarmo);
    expect(item.basePower).toBeNull();
    expect(item.baseToughness).toBeNull();
  });
});

describe('count changes', () => {
  test('incrementing stacks copies', () => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = changeCount(g, 0, item.id, 1);
    g = changeCount(g, 0, item.id, 1);
    expect(g.players[0].board[0].count).toBe(3);
  });

  test('decrementing to 0 removes the item entirely', () => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = changeCount(g, 0, item.id, 2);
    g = changeCount(g, 0, item.id, -3);
    expect(g.players[0].board).toHaveLength(0);
  });
});

describe('splitItem', () => {
  test('splits a stack, conserving total count, counters stay on original', () => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = changeCount(g, 0, item.id, 7); // x8
    g = setCounter(g, 0, item.id, 'p1p1', 2);
    g = splitItem(g, 0, item.id, 3);
    const board = g.players[0].board;
    expect(board).toHaveLength(2);
    expect(board[0].count + board[1].count).toBe(8);
    expect(board[0].count).toBe(5);
    expect(board[1].count).toBe(3);
    expect(board[0].counters).toEqual({ p1p1: 2 });
    expect(board[1].counters).toEqual({});
    expect(board[1].id).not.toBe(board[0].id);
  });

  test.each([0, -1, 8, 9])('rejects invalid moveCount %i unchanged', (move) => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = changeCount(g, 0, item.id, 7); // x8
    const after = splitItem(g, 0, item.id, move);
    expect(after).toEqual(g);
  });
});

describe('counters and computed P/T', () => {
  test('+1/+1 counters raise computed P/T', () => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = setCounter(g, 0, item.id, 'p1p1', 2);
    expect(computedPT(g.players[0].board[0])).toEqual({ power: 3, toughness: 3 });
  });

  test('named counters do not affect P/T', () => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = setCounter(g, 0, item.id, 'oil', 4);
    expect(computedPT(g.players[0].board[0])).toEqual({ power: 1, toughness: 1 });
    expect(g.players[0].board[0].counters).toEqual({ oil: 4 });
  });

  test('setting a counter to 0 removes its key', () => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = setCounter(g, 0, item.id, 'p1p1', 2);
    g = setCounter(g, 0, item.id, 'p1p1', 0);
    expect(g.players[0].board[0].counters).toEqual({});
  });

  test('computedPT is null for items without base P/T', () => {
    expect(computedPT(createBoardItem(clue))).toBeNull();
  });
});

describe('mana tapping', () => {
  function withLands(count: number): { g: GameState; id: string } {
    let g = freshGame();
    const item = { ...createBoardItem(soldier), zone: 'lands' as const };
    g = addItem(g, 0, item);
    g = changeCount(g, 0, item.id, count - 1);
    return { g, id: item.id };
  }

  test('tapping marks sources used, clamped to the stack size', () => {
    let { g, id } = withLands(3);
    g = tapItem(g, 0, id, 1);
    g = tapItem(g, 0, id, 1);
    expect(g.players[0].board[0].tapped).toBe(2);
    g = tapItem(g, 0, id, 5);
    expect(g.players[0].board[0].tapped).toBe(3);
    g = tapItem(g, 0, id, -10);
    expect(g.players[0].board[0].tapped).toBe(0);
  });

  test('untapAll readies every land of that player', () => {
    let { g, id } = withLands(4);
    g = tapItem(g, 0, id, 3);
    g = untapAll(g, 0);
    expect(g.players[0].board[0].tapped).toBe(0);
  });

  test('shrinking a stack clamps its tapped count', () => {
    let { g, id } = withLands(3);
    g = tapItem(g, 0, id, 3);
    g = changeCount(g, 0, id, -2);
    expect(g.players[0].board[0].tapped).toBe(1);
  });
});

describe('custom tokens and removal', () => {
  test('createCustomToken builds a colored item with no card id', () => {
    const item = createCustomToken('Blorbo', 3, 3, 'G');
    expect(item.cardId).toBeNull();
    expect(item.name).toBe('Blorbo');
    expect(item.color).toBe('G');
    expect(computedPT(item)).toEqual({ power: 3, toughness: 3 });
  });

  test('removeItem drops the item', () => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = removeItem(g, 0, item.id);
    expect(g.players[0].board).toHaveLength(0);
  });
});
