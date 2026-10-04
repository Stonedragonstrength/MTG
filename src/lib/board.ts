import type { BoardItem, CardRecord, GameState } from './types';

function newId(): string {
  return crypto.randomUUID();
}

function parsePT(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function createBoardItem(card: CardRecord): BoardItem {
  return {
    id: newId(),
    cardId: card.id,
    name: card.name,
    imageNormal: card.imageNormal,
    imageArtCrop: card.imageArtCrop,
    typeLine: card.typeLine,
    oracleText: card.oracleText,
    basePower: parsePT(card.power),
    baseToughness: parsePT(card.toughness),
    count: 1,
    counters: {},
    color: null,
  };
}

export function createCustomToken(
  name: string,
  power: number | null,
  toughness: number | null,
  color: string,
): BoardItem {
  return {
    id: newId(),
    cardId: null,
    name,
    imageNormal: null,
    imageArtCrop: null,
    typeLine: 'Custom Token',
    oracleText: '',
    basePower: power,
    baseToughness: toughness,
    count: 1,
    counters: {},
    color,
  };
}

function updateBoard(
  s: GameState,
  playerIdx: number,
  fn: (board: BoardItem[]) => BoardItem[],
): GameState {
  return {
    ...s,
    players: s.players.map((p, i) => (i === playerIdx ? { ...p, board: fn(p.board) } : p)),
  };
}

export function addItem(s: GameState, playerIdx: number, item: BoardItem): GameState {
  return updateBoard(s, playerIdx, (board) => [...board, item]);
}

export function removeItem(s: GameState, playerIdx: number, itemId: string): GameState {
  return updateBoard(s, playerIdx, (board) => board.filter((it) => it.id !== itemId));
}

export function changeCount(
  s: GameState,
  playerIdx: number,
  itemId: string,
  delta: number,
): GameState {
  return updateBoard(s, playerIdx, (board) =>
    board
      .map((it) => (it.id === itemId ? { ...it, count: Math.max(0, it.count + delta) } : it))
      .filter((it) => it.count > 0),
  );
}

export function splitItem(
  s: GameState,
  playerIdx: number,
  itemId: string,
  moveCount: number,
): GameState {
  return updateBoard(s, playerIdx, (board) => {
    const source = board.find((it) => it.id === itemId);
    if (!source || moveCount <= 0 || moveCount >= source.count) return board;
    const split: BoardItem = { ...source, id: newId(), count: moveCount, counters: {} };
    return board
      .map((it) => (it.id === itemId ? { ...it, count: it.count - moveCount } : it))
      .concat(split);
  });
}

export function setCounter(
  s: GameState,
  playerIdx: number,
  itemId: string,
  counterName: string,
  value: number,
): GameState {
  return updateBoard(s, playerIdx, (board) =>
    board.map((it) => {
      if (it.id !== itemId) return it;
      const counters = { ...it.counters };
      if (value <= 0) delete counters[counterName];
      else counters[counterName] = value;
      return { ...it, counters };
    }),
  );
}

export function computedPT(item: BoardItem): { power: number; toughness: number } | null {
  if (item.basePower === null || item.baseToughness === null) return null;
  const plus = item.counters['p1p1'] ?? 0;
  return { power: item.basePower + plus, toughness: item.baseToughness + plus };
}
