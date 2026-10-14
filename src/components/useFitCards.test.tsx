import { renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useFitCards } from './useFitCards';

function box(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  Object.defineProperty(el, 'clientHeight', { value: height });
  return el;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('writes the fitted card height onto the box and refits when the count changes', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const el = box(1000, 190);
  const { rerender } = renderHook(({ n }) => useFitCards({ current: el }, n), {
    initialProps: { n: 5 },
  });
  expect(el.style.getPropertyValue('--card-h')).toBe('190px');
  rerender({ n: 8 });
  expect(el.style.getPropertyValue('--card-h')).toBe('164px');
});

test('does nothing where the browser cannot measure (old engines, tests)', () => {
  const el = box(1000, 190);
  renderHook(() => useFitCards({ current: el }, 5));
  expect(el.style.getPropertyValue('--card-h')).toBe(''); // CSS fallback size applies
});

/** A box laid out at (left, top), `width`×`height`. */
function laid(left: number, top: number, width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  for (const [key, value] of Object.entries({
    clientWidth: width,
    clientHeight: height,
    offsetWidth: width,
    offsetHeight: height,
    offsetLeft: left,
    offsetTop: top,
  }))
    Object.defineProperty(el, key, { value });
  return el;
}

test('the cards keep clear of what stands in the bottom left corner: above it where they have the height', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // A tall field, seven cards: two rows of four, sized by the width.
  const field = laid(0, 100, 742, 744);
  const corner = laid(8, 100 + 744 - 6 - 64, 130, 64); // 6px off the foot, 64px tall
  renderHook(() => useFitCards({ current: field }, 7, 300, corner));
  expect(field.style.paddingBottom).toBe('76px'); // 6 + 64, and 6 between
  expect(field.style.paddingLeft).toBe('');
  expect(field.style.getPropertyValue('--card-h')).toBe('250px'); // as big as without it
});

test('…and beside it where a strip along the foot would cost them their size', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const field = laid(0, 100, 1220, 298);
  const corner = laid(8, 100 + 298 - 6 - 64, 130, 64);
  renderHook(() => useFitCards({ current: field }, 4, 300, corner));
  expect(field.style.paddingLeft).toBe('144px'); // 8 + 130, and 6 between
  expect(field.style.paddingBottom).toBe('');
  expect(field.style.getPropertyValue('--card-h')).toBe('298px');
});

test('a corner with no box of its own (a collapsed bar) is not there', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const field = laid(0, 0, 1000, 190);
  renderHook(() => useFitCards({ current: field }, 5, 240, laid(0, 0, 0, 0)));
  expect(field.style.paddingLeft).toBe('');
  expect(field.style.paddingBottom).toBe('');
  expect(field.style.getPropertyValue('--card-h')).toBe('190px');
});
