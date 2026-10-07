import type { BoardItem, CardRecord, GameState } from './types';

function newId(): string {
  return crypto.randomUUID();
}

function parsePT(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function createBoardItem(card: CardRecord, zone: 'board' | 'lands' = 'board'): BoardItem {
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
    zone,
  };
}

export function createCustomToken(
  name: string,
  power: number | null,
  toughness: number | null,
  color: string,
  keywords: string[] = [],
): BoardItem {
  return {
    id: newId(),
    cardId: null,
    name,
    imageNormal: null,
    imageArtCrop: null,
    typeLine: 'Custom Token',
    oracleText: keywords.join(', '),
    basePower: power,
    baseToughness: toughness,
    count: 1,
    counters: {},
    color,
    zone: 'board',
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
      .map((it) => {
        if (it.id !== itemId) return it;
        const count = Math.max(0, it.count + delta);
        return { ...it, count, tapped: Math.min(it.tapped ?? 0, count) };
      })
      .filter((it) => it.count > 0),
  );
}

export function tapItem(
  s: GameState,
  playerIdx: number,
  itemId: string,
  delta: number,
): GameState {
  return updateBoard(s, playerIdx, (board) =>
    board.map((it) =>
      it.id === itemId
        ? { ...it, tapped: Math.min(it.count, Math.max(0, (it.tapped ?? 0) + delta)) }
        : it,
    ),
  );
}

/** The untap step: readies every permanent that player controls. */
export function untapAll(s: GameState, playerIdx: number): GameState {
  return updateBoard(s, playerIdx, (board) =>
    board.map((it) => (it.tapped ? { ...it, tapped: 0 } : it)),
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
    if (!source || !Number.isInteger(moveCount) || moveCount <= 0 || moveCount >= source.count)
      return board;
    // The copies split off are the ones you can still use: untapped first.
    const tapped = source.tapped ?? 0;
    const splitTapped = Math.max(0, moveCount - (source.count - tapped));
    const split: BoardItem = {
      ...source,
      id: newId(),
      count: moveCount,
      counters: {},
      ...(tapped > 0 ? { tapped: splitTapped } : {}),
    };
    return board
      .map((it) =>
        it.id === itemId
          ? { ...it, count: it.count - moveCount, ...(tapped > 0 ? { tapped: tapped - splitTapped } : {}) }
          : it,
      )
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

export function setManaMode(
  s: GameState,
  playerIdx: number,
  itemId: string,
  mode: BoardItem['manaMode'],
): GameState {
  return updateBoard(s, playerIdx, (board) =>
    board.map((it) => (it.id === itemId ? { ...it, manaMode: mode } : it)),
  );
}

export function computedPT(item: BoardItem): { power: number; toughness: number } | null {
  if (item.basePower === null || item.baseToughness === null) return null;
  const plus = item.counters['p1p1'] ?? 0;
  return { power: item.basePower + plus, toughness: item.baseToughness + plus };
}
