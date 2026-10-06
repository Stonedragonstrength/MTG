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
