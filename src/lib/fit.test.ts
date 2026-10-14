import { describe, expect, test } from 'vitest';
import { fitAroundCorner, fitCardHeight, shareInSight } from './fit';

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

describe('shareInSight', () => {
  test('a card with room for all of it is in sight whole', () => {
    expect(shareInSight(156, 0, 164, null)).toBe(1);
    expect(shareInSight(156, 468, 156, null)).toBe(1); // the last of the fan
  });

  test('a card under the next one shows its slot', () => {
    expect(shareInSight(156, 122, 61, null)).toBeCloseTo(0.39, 2);
    expect(shareInSight(156, 280, 140, null)).toBeCloseTo(0.9, 2);
  });

  test('the card brought to the front hides what it lies over', () => {
    // Slots 61 wide: the front card at 122 reaches 278, over the next two slots and a little more.
    expect(shareInSight(156, 183, 61, 122)).toBe(0);
    expect(shareInSight(156, 244, 61, 122)).toBeCloseTo(27 / 156, 5);
    expect(shareInSight(156, 305, 61, 122)).toBeCloseTo(61 / 156, 5);
    // The cards before it lose nothing.
    expect(shareInSight(156, 61, 61, 122)).toBeCloseTo(61 / 156, 5);
  });

  test('a slot with no box of its own covers nothing', () => {
    expect(shareInSight(100, 0, 0, null)).toBe(1);
    expect(shareInSight(0, 0, 0, null)).toBe(1);
  });
});

describe('fitAroundCorner', () => {
  test('with nothing in the corner it is the plain fit', () => {
    expect(fitAroundCorner(1000, 190, 5, 0, 0)).toEqual({ cardHeight: fitCardHeight(1000, 190, 5), clear: null });
  });

  test('cards that have height to spare stand above the corner and stay as big', () => {
    // Seven cards in a tall box, two rows of four: the width decides their size.
    const plain = fitCardHeight(742, 744, 7, { max: 300 });
    expect(fitAroundCorner(742, 744, 7, 144, 76, { max: 300 })).toEqual({ cardHeight: plain, clear: 'above' });
  });

  test('cards that fill a low, wide box stand beside the corner instead', () => {
    // Four cards in one row, as tall as the box: a strip along the foot
    // would cost them a quarter of their height, a column at the side nothing.
    const fit = fitAroundCorner(1220, 298, 4, 130, 70, { max: 300 });
    expect(fit.clear).toBe('beside');
    expect(fit.cardHeight).toBe(298);
    expect(fitCardHeight(1220, 298 - 70, 4, { max: 300 })).toBe(228);
  });
});
