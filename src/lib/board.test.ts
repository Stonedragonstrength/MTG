import { describe, expect, test } from 'vitest';
import type { CardRecord, GameConfig, GameState } from './types';
import { createGame } from './game';
import {
  addItem,
  changeCount,
  computedPT,
  createBoardItem,
  createCustomToken,
  killCopies,
  readyItems,
  removeItem,
  setCounter,
  setManaMode,
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

describe('setManaMode', () => {
  test('sets, changes, and clears the mana override', () => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = setManaMode(g, 0, item.id, 'G');
    expect(g.players[0].board[0].manaMode).toBe('G');
    g = setManaMode(g, 0, item.id, 'any');
    expect(g.players[0].board[0].manaMode).toBe('any');
    g = setManaMode(g, 0, item.id, undefined);
    expect(g.players[0].board[0].manaMode).toBeUndefined();
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

  test.each([0, -1, 8, 9, 2.5, NaN])('rejects invalid moveCount %s unchanged', (move) => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = changeCount(g, 0, item.id, 7); // x8
    const after = splitItem(g, 0, item.id, move);
    expect(after).toEqual(g);
  });

  test('tapped copies are shared out: the split takes untapped ones first, none are invented', () => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = changeCount(g, 0, item.id, 7); // x8
    g = tapItem(g, 0, item.id, 6); // 6 tapped, 2 untapped
    g = splitItem(g, 0, item.id, 3);
    const [rest, split] = g.players[0].board;
    expect([split.count, split.tapped]).toEqual([3, 1]); // both untapped ones, plus one tapped
    expect([rest.count, rest.tapped]).toEqual([5, 5]);
  });

  test('splitting off fewer than the untapped copies leaves every tapped one behind', () => {
    let g = freshGame();
    const item = createBoardItem(soldier);
    g = addItem(g, 0, item);
    g = changeCount(g, 0, item.id, 7); // x8
    g = tapItem(g, 0, item.id, 2);
    g = splitItem(g, 0, item.id, 3);
    const [rest, split] = g.players[0].board;
    expect(split.tapped ?? 0).toBe(0);
    expect([rest.count, rest.tapped]).toEqual([5, 2]);
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

  test('untapAll readies tapped board creatures too', () => {
    let g = freshGame();
    const creature = createBoardItem(soldier); // zone defaults to 'board'
    g = addItem(g, 0, creature);
    g = tapItem(g, 0, creature.id, 1);
    expect(g.players[0].board[0].tapped).toBe(1);
    g = untapAll(g, 0);
    expect(g.players[0].board[0].tapped).toBe(0);
  });

  test('untapAll leaves other players’ permanents alone', () => {
    let g = freshGame();
    const creature = createBoardItem(soldier);
    g = addItem(g, 1, creature);
    g = tapItem(g, 1, creature.id, 1);
    g = untapAll(g, 0);
    expect(g.players[1].board[0].tapped).toBe(1);
  });

  test('shrinking a stack clamps its tapped count', () => {
    let { g, id } = withLands(3);
    g = tapItem(g, 0, id, 3);
    g = changeCount(g, 0, id, -2);
    expect(g.players[0].board[0].tapped).toBe(1);
  });
});

describe('copies that only just arrived (summoning sickness)', () => {
  /** A stack of `count` soldiers of which `sick` arrived this turn. */
  function stack(count: number, sick: number): { g: GameState; id: string } {
    const item = createBoardItem(soldier);
    const ready = count - sick;
    if (ready === 0) return { g: addItem(freshGame(), 0, { ...item, count }), id: item.id };
    // The ones that have been here a while: added, then readied by their controller's turn.
    let g = readyItems(addItem(freshGame(), 0, { ...item, count: ready }), 0);
    if (sick > 0) g = changeCount(g, 0, item.id, sick); // these only just arrived
    return { g, id: item.id };
  }
  const only = (g: GameState) => g.players[0].board[0];

  test('a new stack arrives all sick', () => {
    const g = addItem(freshGame(), 0, createBoardItem(soldier));
    expect(only(g).sick).toBe(1);
    const five = addItem(freshGame(), 0, { ...createBoardItem(soldier), count: 5 });
    expect(only(five).sick).toBe(5);
  });

  test('copies added to a stack arrive sick, on top of what already was', () => {
    const { g, id } = stack(3, 0); // three soldiers that have been here a while
    expect('sick' in only(g)).toBe(false);
    const more = changeCount(g, 0, id, 2);
    expect([only(more).count, only(more).sick]).toEqual([5, 2]);
    expect(only(changeCount(more, 0, id, 1)).sick).toBe(3);
  });

  test('removing copies never leaves more sick ones than the stack holds', () => {
    const { g, id } = stack(5, 4);
    expect([only(g).count, only(g).sick]).toEqual([5, 4]);
    expect(only(changeCount(g, 0, id, -1)).sick).toBe(4); // four left: the one that went was the ready one
    expect(only(changeCount(g, 0, id, -3)).sick).toBe(2); // two left: at most two can be sick
  });

  test('the count is left out entirely when no copy is sick', () => {
    const { g, id } = stack(3, 0);
    expect('sick' in only(changeCount(g, 0, id, -1))).toBe(false);
    const { g: fresh, id: freshId } = stack(2, 2);
    expect('sick' in only(readyItems(fresh, 0))).toBe(false);
    expect('sick' in only(changeCount(readyItems(fresh, 0), 0, freshId, -1))).toBe(false);
  });

  test('a split takes the copies that are ready first, as it does with untapped ones', () => {
    const { g, id } = stack(8, 6); // 2 ready, 6 sick
    const split = splitItem(g, 0, id, 3);
    const [rest, off] = split.players[0].board;
    expect([off.count, off.sick]).toEqual([3, 1]); // both ready ones, plus one sick
    expect([rest.count, rest.sick]).toEqual([5, 5]);
  });

  test('splitting off fewer than the ready copies leaves every sick one behind', () => {
    const { g, id } = stack(8, 2);
    const split = splitItem(g, 0, id, 3);
    const [rest, off] = split.players[0].board;
    expect('sick' in off).toBe(false);
    expect([rest.count, rest.sick]).toEqual([5, 2]);
  });

  test('a stack with nobody sick splits without growing the key', () => {
    const { g, id } = stack(4, 0);
    const [rest, off] = splitItem(g, 0, id, 1).players[0].board;
    expect('sick' in rest).toBe(false);
    expect('sick' in off).toBe(false);
  });

  test('readyItems clears that player only, and hands back the same state when there is nothing to clear', () => {
    let g = addItem(freshGame(), 0, createBoardItem(soldier));
    g = addItem(g, 1, createBoardItem(soldier));
    const readied = readyItems(g, 0);
    expect('sick' in readied.players[0].board[0]).toBe(false);
    expect(readied.players[1].board[0].sick).toBe(1);
    expect(readied.players[1]).toBe(g.players[1]); // untouched, not even copied
    expect(readyItems(readied, 0)).toBe(readied); // a replay changes nothing
    expect(readyItems(freshGame(), 0)).toEqual(freshGame());
    const empty = freshGame();
    expect(readyItems(empty, 0)).toBe(empty);
    expect(readyItems(empty, 9)).toBe(empty); // no such seat
  });

  test('untapping and tapping leave sickness alone', () => {
    const { g, id } = stack(3, 3);
    expect(only(untapAll(tapItem(g, 0, id, 2), 0)).sick).toBe(3); // the untap button is not a new turn
    expect(only(tapItem(g, 0, id, 1)).sick).toBe(3);
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

  // ---- killCopies: the copies of a stack that died in a fight ----

  /** `count` soldiers that have been here a while, `tapped` of them tapped. */
  function soldiers(count: number, tapped: number): { g: GameState; id: string } {
    const item = createBoardItem(soldier);
    let g = readyItems(addItem(freshGame(), 0, { ...item, count }), 0);
    if (tapped > 0) g = tapItem(g, 0, item.id, tapped);
    return { g, id: item.id };
  }
  const first = (g: GameState) => g.players[0].board[0];

  test('dead attackers leave with their tap: 5 with 3 tapped, 2 tapped attackers die, 3 with 1 tapped', () => {
    const { g, id } = soldiers(5, 3);
    const after = killCopies(g, 0, id, 2, 2);
    expect([first(after).count, first(after).tapped]).toEqual([3, 1]); // the two that stayed home still stand
    // changeCount would have left all three looking tapped: that is why this exists
    expect(first(changeCount(g, 0, id, -2)).tapped).toBe(3);
  });

  test('dead blockers were not tapped: the tapped count stays, clamped to what is left', () => {
    const { g, id } = soldiers(5, 1);
    expect([first(killCopies(g, 0, id, 2)).count, first(killCopies(g, 0, id, 2)).tapped]).toEqual([3, 1]);
    const { g: mostly, id: mostlyId } = soldiers(4, 3);
    expect(first(killCopies(mostly, 0, mostlyId, 2)).tapped).toBe(2); // only two are left to be tapped
    const { g: fresh, id: freshId } = soldiers(3, 0);
    expect('tapped' in first(killCopies(fresh, 0, freshId, 1))).toBe(false); // nothing written that was not there
  });

  test('the sick count is clamped to the copies left, and left out at zero', () => {
    const item = createBoardItem(soldier);
    const arrived = addItem(freshGame(), 0, { ...item, count: 4 }); // all four only just arrived
    expect(first(killCopies(arrived, 0, item.id, 3)).sick).toBe(1);
    const { g, id } = soldiers(4, 0);
    expect('sick' in first(killCopies(g, 0, id, 1))).toBe(false);
  });

  test('the stack is removed when its last copy dies, and never goes below zero', () => {
    const { g, id } = soldiers(2, 2);
    expect(killCopies(g, 0, id, 2, 2).players[0].board).toHaveLength(0);
    expect(killCopies(g, 0, id, 9, 9).players[0].board).toHaveLength(0);
  });

  test('more tapped dead than dead, or than tapped, is clamped', () => {
    const { g, id } = soldiers(5, 1);
    const after = killCopies(g, 0, id, 2, 5); // at most two of the dead can have been tapped
    expect([first(after).count, first(after).tapped]).toEqual([3, 0]);
  });

  test('a stack that is gone, a seat that is not there or a count that makes no sense changes nothing', () => {
    const { g, id } = soldiers(3, 1);
    expect(killCopies(g, 0, 'nope', 1)).toBe(g);
    expect(killCopies(g, 7, id, 1)).toBe(g);
    expect(killCopies(g, 0, id, 0)).toBe(g);
    expect(killCopies(g, 0, id, -2)).toBe(g);
    expect(killCopies(g, 0, id, Number.NaN)).toBe(g);
    expect(killCopies(g, 1, id, 1)).toBe(g); // somebody else's seat does not hold it
  });
});
