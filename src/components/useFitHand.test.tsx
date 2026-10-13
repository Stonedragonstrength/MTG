import { renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useFitHand } from './useFitHand';

/** The box a hand's cards lie in, inside a seat: `width` wide, the seat `zoneHeight` tall. */
function handBox(width: number, zoneHeight: number, zoneClass: string) {
  const zone = document.createElement('section');
  zone.className = zoneClass;
  Object.defineProperty(zone, 'clientHeight', { value: zoneHeight });
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width });
  zone.append(el);
  return { zone, el };
}

const sizes = (el: HTMLElement) =>
  ['--hand-h', '--hand-pad', '--hand-room'].map((name) => el.style.getPropertyValue(name));

/** A ResizeObserver that can be made to fire. */
function observers() {
  const fired: (() => void)[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        fired.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  return { resize: () => fired.forEach((callback) => callback()) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('on the big board of a tablet on its side the hand is one row, sized to its width', () => {
  observers();
  const { el } = handBox(997, 724, 'zone zone--cards zone--focused');
  const { rerender } = renderHook(({ n }) => useFitHand(el, n), { initialProps: { n: 7 } });
  expect(sizes(el)).toEqual(['191px', '1px', '246px']);
  rerender({ n: 14 }); // two rows of seven
  expect(el.style.getPropertyValue('--hand-h')).toBe('120px');
});

test('held upright the hand takes two rows, and the padding breaks them evenly', () => {
  observers();
  const { el } = handBox(608, 1204, 'zone zone--cards zone--focused zone--narrow');
  renderHook(() => useFitHand(el, 7));
  // Four cards of 201px (143.9px wide) and three gaps are 593.6px: 6px each
  // side leaves 596px — room for four, never for a fifth.
  expect(sizes(el)).toEqual(['201px', '6px', '409px']);
});

test('on a bar the hand has a fixed strip, and is sized again when the seat takes the big board', () => {
  const { resize } = observers();
  const { zone, el } = handBox(630, 54, 'zone zone--cards');
  renderHook(() => useFitHand(el, 7));
  expect(sizes(el)).toEqual(['120px', '1px', '140px']);
  zone.classList.add('zone--focused');
  resize();
  expect(el.style.getPropertyValue('--hand-room')).toBe('218px');
  expect(el.style.getPropertyValue('--hand-h')).toBe('118px'); // 630px across still limits seven cards, now 6px apart
});

test('does nothing before the hand is open, outside a seat, or where the browser cannot measure', () => {
  const { el } = handBox(997, 724, 'zone zone--focused');
  renderHook(() => useFitHand(el, 7)); // no ResizeObserver
  expect(sizes(el)).toEqual(['', '', '']);
  observers();
  renderHook(() => useFitHand(null, 7));
  const loose = document.createElement('div'); // the phone's hand view: no seat around it
  Object.defineProperty(loose, 'clientWidth', { value: 360 });
  renderHook(() => useFitHand(loose, 7));
  expect(sizes(loose)).toEqual(['', '', '']);
});
