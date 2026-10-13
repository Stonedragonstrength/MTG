import { describe, expect, test } from 'vitest';
import { CARD_ASPECT, fitCardHeight, fitHand, handRoom } from './fit';

describe('fitCardHeight', () => {
  test('a lone card takes the cap, not the whole box', () => {
    expect(fitCardHeight(1000, 600, 1)).toBe(240);
    expect(fitCardHeight(1000, 600, 0)).toBe(240); // an empty row is ready for its first card
  });

  test('a short box limits a few cards by its height', () => {
    expect(fitCardHeight(1000, 190, 5)).toBe(190);
  });

  test('a crowded single row shrinks to the width instead of wrapping tiny', () => {
    // 8 cards, 190px tall: one row at 164px beats two rows at 91px
    expect(fitCardHeight(1000, 190, 8)).toBe(164);
  });

  test('a tall box wraps to a second row when that keeps cards bigger', () => {
    // 8 cards in 600×420: one row would be 94px, two rows of four reach 201px
    expect(fitCardHeight(600, 420, 8)).toBe(201);
  });

  test('never drops below the readable floor — the row scrolls instead', () => {
    expect(fitCardHeight(300, 60, 20)).toBe(72);
  });

  test('an unmeasured box falls back to the floor rather than NaN', () => {
    expect(fitCardHeight(0, 0, 4)).toBe(72);
  });
});

describe('handRoom', () => {
  test('one row of full-size cards on a board with no height to spare', () => {
    expect(handRoom(600)).toBe(218);
    expect(handRoom(724)).toBe(246); // a tablet on its side
  });

  test('about a third of a tall seat, and never more than two full rows', () => {
    expect(handRoom(1204)).toBe(409); // a tablet held upright
    expect(handRoom(2000)).toBe(440);
  });
});

describe('fitHand', () => {
  // Every row it answers with fits the box: that is what "in sight, whole" rests on.
  const rowWidth = ({ height, perRow }: { height: number; perRow: number }, gap: number) =>
    perRow * height * CARD_ASPECT + (perRow - 1) * gap;

  test('a tablet on its side: seven cards side by side, as large as the row lets them', () => {
    const fit = fitHand(996, handRoom(724), 7, 'board');
    expect(fit).toEqual({ height: 191, perRow: 7 });
    expect(rowWidth(fit, 6)).toBeLessThanOrEqual(996);
  });

  test('a tablet held upright: seven cards in two rows, each nearly full size', () => {
    // One row would leave them 113px tall; the seat has the height for two rows of 201px.
    const fit = fitHand(607, handRoom(1204), 7, 'board');
    expect(fit).toEqual({ height: 201, perRow: 4 });
    expect(rowWidth(fit, 6)).toBeLessThanOrEqual(607);
  });

  test('a few cards stay in one row', () => {
    expect(fitHand(607, handRoom(1204), 4, 'board')).toEqual({ height: 205, perRow: 4 });
    expect(fitHand(996, handRoom(724), 3, 'board')).toEqual({ height: 218, perRow: 3 });
  });

  test('a second row has to earn its height: a hair taller is not worth it', () => {
    // Eleven in one row are 118px tall; two rows would make them 120px.
    expect(fitHand(996, handRoom(724), 11, 'board')).toEqual({ height: 118, perRow: 11 });
    // Fourteen in one row are 91px; two rows of seven reach 120px.
    expect(fitHand(996, handRoom(724), 14, 'board')).toEqual({ height: 120, perRow: 7 });
  });

  test('a hand too large for its room keeps the smallest size and takes the rows it needs', () => {
    expect(fitHand(300, 218, 40, 'board')).toEqual({ height: 84, perRow: 4 });
  });

  test('on a bar the cards are smaller, and still side by side', () => {
    expect(fitHand(629, 140, 7, 'bar')).toEqual({ height: 120, perRow: 7 });
    expect(fitHand(629, 140, 3, 'bar')).toEqual({ height: 140, perRow: 3 });
  });

  test('an empty hand is ready for its first card', () => {
    expect(fitHand(996, 246, 0, 'board')).toEqual({ height: 218, perRow: 1 });
  });

  test('an unmeasured box falls back to the smallest size rather than NaN', () => {
    expect(fitHand(0, 0, 4, 'board')).toEqual({ height: 84, perRow: 1 });
  });
});
