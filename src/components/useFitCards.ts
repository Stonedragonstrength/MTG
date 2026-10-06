import { useLayoutEffect, type RefObject } from 'react';
import { fitCardHeight } from '../lib/fit';

/** Sizes the cards inside `ref` to fill it: writes `--card-h` whenever the
 * box resizes or the card count changes. Where the box can't be measured
 * the variable stays unset and the stylesheet's fallback size applies. */
export function useFitCards(
  ref: RefObject<HTMLElement | null>,
  count: number,
  max = 240,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      const h = fitCardHeight(el.clientWidth, el.clientHeight, count, { max });
      el.style.setProperty('--card-h', `${h}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, count, max]);
}
