import { useLayoutEffect, type RefObject } from 'react';
import { fitAroundCorner } from '../lib/fit';

/** The room left between the cards and what stands in the corner. */
const CORNER_GAP = 6;

/** Sizes the cards inside `ref` to fill it: writes `--card-h` whenever the
 * box resizes or the card count changes. Where the box can't be measured
 * the variable stays unset and the stylesheet's fallback size applies.
 *
 * `corner` is something laid over the box's bottom left corner (the seat's
 * tokens, on the big board): the cards keep clear of it — above it or
 * beside it, whichever leaves them bigger — and the box's padding on that
 * side says so. A corner with no box of its own (a collapsed bar) is not
 * there. */
export function useFitCards(
  ref: RefObject<HTMLElement | null>,
  count: number,
  max = 240,
  corner: HTMLElement | null = null,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      // The padding as the stylesheet has it: what was kept clear last time
      // is taken off first.
      el.style.paddingLeft = '';
      el.style.paddingBottom = '';
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      // The cards fill the box INSIDE its padding: the padding is there for
      // a tapped card's tilted corners, and a row sized to the padded width
      // wraps one card early and pushes the last row out of sight.
      const pad = getComputedStyle(el);
      const px = (v: string) => Number.parseFloat(v) || 0;
      const padLeft = px(pad.paddingLeft);
      const padBottom = px(pad.paddingBottom);
      const width = el.clientWidth - padLeft - px(pad.paddingRight);
      const height = el.clientHeight - px(pad.paddingTop) - padBottom;
      // How far the corner reaches into the box, from its left and from its
      // foot — read off the layout, not the screen: a seat may be turned.
      const standing = !!corner && corner.offsetWidth > 0 && corner.offsetHeight > 0;
      const reachX = standing ? corner.offsetLeft + corner.offsetWidth - el.offsetLeft + CORNER_GAP : 0;
      const reachY = standing ? el.offsetTop + el.offsetHeight - corner.offsetTop + CORNER_GAP : 0;
      const keepX = Math.max(0, reachX - padLeft);
      const keepY = Math.max(0, reachY - padBottom);
      // A hair under: a row that fits to the last fraction of a pixel wraps.
      const fit = fitAroundCorner(width - 1, height, count, keepX, keepY, { max });
      if (fit.clear === 'above') el.style.paddingBottom = `${padBottom + keepY}px`;
      if (fit.clear === 'beside') el.style.paddingLeft = `${padLeft + keepX}px`;
      el.style.setProperty('--card-h', `${fit.cardHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    // The whole box, padding and all: the padding written above must not
    // call this back.
    observer.observe(el, { box: 'border-box' });
    if (corner) observer.observe(corner);
    return () => {
      observer.disconnect();
      el.style.paddingLeft = '';
      el.style.paddingBottom = '';
    };
  }, [ref, count, max, corner]);
}
