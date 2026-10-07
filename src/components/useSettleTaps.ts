import { useLayoutEffect, useState } from 'react';

const SETTLE_MS = 350;

/** For a sheet that opens under the finger, on the very tap that asked for
 * it (a tap through useLongPress acts on pointerup). That tap is not over
 * when the sheet appears: a touch tap still owes its click, and the
 * browser aims that click afresh at whatever is under the finger NOW — the
 * new sheet's backdrop (the sheet closed the moment it opened), or one of
 * its buttons (it cast a spell nobody had confirmed). The second half of a
 * double tap lands there too.
 *
 * So for its first moment on screen such a sheet takes no tap as an
 * answer: every click that happened before SETTLE_MS had passed is
 * swallowed, wherever it lands. It goes by when the tap happened, not
 * when it was handled (as useConfirmTap does), so a busy main thread
 * cannot let a stale tap through. Sheets that open on a click or on a
 * hold do not need this: nothing of that gesture is left to arrive. */
export function useSettleTaps(): void {
  // When the sheet opened, on both clocks an event's timeStamp may run on:
  // the page's (current browsers) and the wall's (older ones).
  const [openedAt] = useState(() => ({ page: performance.now(), wall: Date.now() }));
  // A layout effect: in place before the browser can deliver the next event.
  useLayoutEffect(() => {
    const swallow = (tap: Event) => {
      const opened = tap.timeStamp > 1e12 ? openedAt.wall : openedAt.page;
      if (tap.timeStamp - opened < SETTLE_MS) tap.stopPropagation();
    };
    document.addEventListener('click', swallow, true); // capture: ahead of every handler
    return () => document.removeEventListener('click', swallow, true);
  }, [openedAt]);
}
