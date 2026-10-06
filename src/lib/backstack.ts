/** Android/tablet back-button support for a state-driven SPA: every open
 * layer (sheet, sub-screen, the game itself) registers a handler and gets
 * a history entry; the hardware back pops the top layer instead of
 * closing the PWA. Closing a layer normally consumes its entry quietly. */

interface Entry {
  id: number;
  handler: () => void;
  done: boolean;
}

let stack: Entry[] = [];
let nextId = 1;
let listening = false;

/** Expiry times of the popstates we caused ourselves: a layer closed by
 * its own UI consumes its history entry with history.back(), and the
 * browser answers with a popstate that is NOT a back press. Unswallowed,
 * it fired the handler of the layer beneath (closing a sheet exited the
 * game). The expiry keeps a pop that never arrives from eating a real one. */
let swallow: number[] = [];
const SWALLOW_MS = 1000;

function onPop() {
  const now = Date.now();
  swallow = swallow.filter((until) => until > now);
  if (swallow.length > 0) {
    swallow.shift();
    return;
  }
  const entry = stack.pop();
  if (!entry || entry.done) return;
  entry.done = true;
  entry.handler();
}

/** Registers a back handler and pushes a history entry for it. Returns a
 * release fn for when the layer closes by its own UI (✕, back button in
 * the header) — it consumes the history entry without firing the handler. */
export function registerBack(handler: () => void): () => void {
  if (!listening) {
    listening = true;
    window.addEventListener('popstate', onPop);
  }
  const entry: Entry = { id: nextId++, handler, done: false };
  stack.push(entry);
  try {
    history.pushState({ layer: entry.id }, '');
  } catch {
    // History can be unavailable (odd embeds); back just won't intercept.
  }
  return () => {
    if (entry.done) return;
    entry.done = true;
    const idx = stack.indexOf(entry);
    if (idx !== -1) stack.splice(idx, 1);
    // Consume this layer's history entry only when it's the newest one —
    // popping mid-stack would eat a newer layer's entry instead.
    if (idx === stack.length) {
      swallow.push(Date.now() + SWALLOW_MS);
      try {
        history.back();
      } catch {
        swallow.pop(); // no navigation happened, so no pop is coming
      }
    }
  };
}

/** Test hook: forgets all layers and listeners state. */
export function _resetBackStack(): void {
  stack = [];
  swallow = [];
}
