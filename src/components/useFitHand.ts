import { useLayoutEffect } from 'react';
import { CARD_ASPECT, HAND_FIT, fitHand, handRoom } from '../lib/fit';

/** Sizes an open hand so every card in it is in sight, whole: writes
 * `--hand-h` (a card's height), `--hand-pad` (what is left over each side
 * of a full row, so the rows break evenly) and `--hand-room` (the height
 * the hand may take) onto `el`, the box the cards lie in, whenever that
 * box or its seat resizes or the hand changes size. On the big board the
 * room comes from the seat's own height; on a bar it is a fixed strip.
 * Where nothing can be measured the variables stay unset and the
 * stylesheet's fallback sizes apply. */
export function useFitHand(el: HTMLElement | null, count: number): void {
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const zone = el.closest<HTMLElement>('.zone');
    if (!zone) return; // the phone's hand view lays its cards out by itself
    const apply = () => {
      const width = el.clientWidth;
      if (width === 0) return;
      // Read every time: the same seat is a bar on one turn and the big
      // board on the next, with its hand lying open across the change.
      const place = zone.classList.contains('zone--focused') ? 'board' : 'bar';
      const room = place === 'board' ? handRoom(zone.clientHeight) : HAND_FIT.bar.room;
      // A hair under: a row that fits to the last fraction of a pixel wraps.
      const { height, perRow } = fitHand(width - 1, room, count, place);
      const row = perRow * height * CARD_ASPECT + (perRow - 1) * HAND_FIT[place].gap;
      el.style.setProperty('--hand-h', `${height}px`);
      el.style.setProperty('--hand-pad', `${Math.max(0, Math.floor((width - row - 1) / 2))}px`);
      el.style.setProperty('--hand-room', `${room}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    observer.observe(zone);
    return () => observer.disconnect();
  }, [el, count]);
}
