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
      // The cards fill the box INSIDE its padding: the padding is there for
      // a tapped card's tilted corners, and a row sized to the padded width
      // wraps one card early and pushes the last row out of sight.
      const pad = getComputedStyle(el);
      const px = (v: string) => Number.parseFloat(v) || 0;
      const width = el.clientWidth - px(pad.paddingLeft) - px(pad.paddingRight);
      const height = el.clientHeight - px(pad.paddingTop) - px(pad.paddingBottom);
      // A hair under: a row that fits to the last fraction of a pixel wraps.
      const h = fitCardHeight(width - 1, height, count, { max });
      el.style.setProperty('--card-h', `${h}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, count, max]);
}
