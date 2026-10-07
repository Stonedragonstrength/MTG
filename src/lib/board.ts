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

/** How many copies arrived since their controller's turn began. The key is
 * left out at zero, like every optional field (the state goes over the wire). */
function withSick(item: BoardItem, sick: number): BoardItem {
  const { sick: _was, ...rest } = item;
  return sick > 0 ? { ...rest, sick } : rest;
}

/** A new stack has only just arrived — every copy of it. Like the cards'
 * flag this is blind to types: the table decides which stacks it matters for. */
export function addItem(s: GameState, playerIdx: number, item: BoardItem): GameState {
  return updateBoard(s, playerIdx, (board) => [...board, withSick(item, item.count)]);
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
        // Copies added have only just arrived; taking copies away can
        // only clamp how many of the rest still are.
        const sick = Math.min((it.sick ?? 0) + Math.max(0, delta), count);
        return withSick({ ...it, count, tapped: Math.min(it.tapped ?? 0, count) }, sick);
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

/** That player's turn begins: the copies that arrived since their last
 * one have now been there all along. Not part of untapAll — the untap
 * button mid-turn does not cure summoning sickness. */
export function readyItems(s: GameState, playerIdx: number): GameState {
  if (!s.players[playerIdx]?.board.some((it) => it.sick)) return s; // nothing to clear
  return updateBoard(s, playerIdx, (board) =>
    board.map((it) => (it.sick ? withSick(it, 0) : it)),
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
    // The copies split off are the ones you can still use: untapped first,
    // and the ones that have been here a while before this turn's arrivals.
    const tapped = source.tapped ?? 0;
    const splitTapped = Math.max(0, moveCount - (source.count - tapped));
    const sick = source.sick ?? 0;
    const splitSick = Math.max(0, moveCount - (source.count - sick));
    const split: BoardItem = withSick(
      {
        ...source,
        id: newId(),
        count: moveCount,
        counters: {},
        ...(tapped > 0 ? { tapped: splitTapped } : {}),
      },
      splitSick,
    );
    return board
      .map((it) =>
        it.id === itemId
          ? withSick(
              { ...it, count: it.count - moveCount, ...(tapped > 0 ? { tapped: tapped - splitTapped } : {}) },
              sick - splitSick,
            )
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
