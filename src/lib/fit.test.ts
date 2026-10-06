import { describe, expect, test } from 'vitest';
import { fitCardHeight } from './fit';

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
