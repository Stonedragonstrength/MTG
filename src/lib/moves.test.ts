import { describe, expect, test } from 'vitest';
import { createGame } from './game';
import { movesBetween } from './moves';
import type { CardInstance, GameState, SeatCards } from './types';

const c = (iid: string, name = iid): CardInstance => ({ iid, cardId: `id-${iid}`, name });
const seat = (over: Partial<SeatCards> = {}): SeatCards => ({
  library: [],
  hand: [],
  battlefield: [],
  graveyard: [],
  exile: [],
  command: [],
  mulligans: 0,
  deckName: 'Stompy',
  ...over,
});
const table = (s0: SeatCards, s1?: SeatCards): GameState => {
  const g = createGame({
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    profiles: [
      { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
    ],
  });
  return { ...g, players: g.players.map((p, i) => (i === 0 ? { ...p, cards: s0 } : s1 ? { ...p, cards: s1 } : p)) };
};

describe('movesBetween', () => {
  test('a draw, a play and a death, each from where it was to where it is', () => {
    const before = table(seat({ library: [c('a'), c('b')], hand: [c('h')], battlefield: [c('x')] }));
    const after = table(seat({ library: [c('b')], hand: [c('a')], battlefield: [c('h')], graveyard: [c('x')] }));
    expect(movesBetween(before, after).map((m) => `${m.iid}:${m.from}>${m.to}`)).toEqual([
      'a:library>hand',
      'h:hand>battlefield',
      'x:battlefield>graveyard',
    ]);
  });

  test('a card that stayed put is no move, and neither is a reorder inside a zone', () => {
    const before = table(seat({ library: [c('a'), c('b')], battlefield: [c('x')] }));
    const after = table(seat({ library: [c('b'), c('a')], battlefield: [{ ...c('x'), tapped: true }] }));
    expect(movesBetween(before, after)).toEqual([]);
  });

  test('seats are told apart, and a seat whose cards did not change is not read', () => {
    const same = seat({ hand: [c('q')] });
    const before = table(seat({ hand: [c('h')] }), same);
    const after = table(seat({ battlefield: [c('h')] }), same);
    expect(movesBetween(before, after)).toEqual([
      { seat: 0, iid: 'h', cardId: 'id-h', name: 'h', from: 'hand', to: 'battlefield' },
    ]);
  });

  test('a tracker seat has no cards to move', () => {
    const g = table(seat());
    expect(movesBetween(g, { ...g, players: g.players.map((p) => ({ ...p, life: 30 })) })).toEqual([]);
  });
});
