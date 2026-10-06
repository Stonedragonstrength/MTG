/** Android/tablet back-button support for a state-driven SPA: every open
 * layer (sheet, sub-screen, the game itself) registers a handler and owns
 * one history entry; the hardware back pops the top layer instead of
 * closing the PWA, and a layer closed by its own UI gives its entry back.
 *
 * The bookkeeping is a depth count, because the browser cannot be asked
 * where it is: `depth` is how many of our entries lie at or below the
 * current position, and each live layer remembers which one is its own.
 * Two rules keep that honest in Chrome, both learned the hard way:
 *  - a traversal and a pushState must never race. Chrome resolves them in
 *    an order that leaves the page one entry lower than it looks, and the
 *    next close then walks OUT of the app. So entries are trimmed in a
 *    later task (a layer opening in the same breath adopts the entry
 *    instead), and a layer that opens mid-traversal waits for it to land;
 *  - the popstate that answers our own traversal is not a back press. */

interface Entry {
  handler: () => void;
  /** Which of our history entries is this layer's (1 = first above the
   * page's own); null while it waits for a traversal to land. */
  at: number | null;
  done: boolean;
}

let stack: Entry[] = [];
let depth = 0;
let listening = false;
/** Expiry of the traversal we started ourselves, or null when none is out.
 * The expiry stops an answer that never arrives from eating a real press. */
let inFlight: number | null = null;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
const LAND_MS = 1000;

function topAt(): number {
  let top = 0;
  for (const e of stack) if (e.at !== null && e.at > top) top = e.at;
  return top;
}

function giveEntry(entry: Entry): void {
  depth += 1;
  entry.at = depth;
  try {
    history.pushState({ layer: depth }, '');
  } catch {
    // History can be unavailable (odd embeds); back just won't intercept.
  }
}

/** Our traversal is over (answered, or given up on): layers that opened
 * while it was out get their entries now. */
function landed(): void {
  inFlight = null;
  for (const e of stack) if (e.at === null) giveEntry(e);
  scheduleSettle();
}

function flying(): boolean {
  if (inFlight !== null && Date.now() > inFlight) landed();
  return inFlight !== null;
}

/** Walks history back down to the top live layer's entry, taking every
 * ownerless entry above it (closed layers, buried ones included) at once. */
function settle(): void {
  settleTimer = undefined;
  if (flying()) return; // one traversal at a time; landed() comes back here
  const excess = depth - topAt();
  if (excess <= 0) return;
  depth -= excess;
  inFlight = Date.now() + LAND_MS;
  try {
    history.go(-excess);
    setTimeout(flying, LAND_MS + 20); // an unanswered traversal still lands
  } catch {
    inFlight = null; // nothing moved, so no answer is coming
  }
}

function scheduleSettle(): void {
  settleTimer ??= setTimeout(settle, 0);
}

function onPop(): void {
  if (inFlight !== null) {
    const ours = Date.now() <= inFlight;
    landed();
    if (ours) return;
  }
  if (depth === 0) return; // below our entries: nothing of ours to close
  depth -= 1;
  // Whatever sat above the new position closes — normally the top layer,
  // nothing at all when the press landed on an entry no layer owns.
  const closing = stack.filter((e) => e.at !== null && e.at > depth);
  stack = stack.filter((e) => !closing.includes(e));
  for (const entry of closing.reverse()) {
    entry.done = true;
    entry.handler();
  }
  scheduleSettle();
}

/** Registers a back handler and gives it a history entry. Returns a
 * release fn for when the layer closes by its own UI (✕, back button in
 * the header) — the entry is handed back without firing the handler. */
export function registerBack(handler: () => void): () => void {
  if (!listening) {
    listening = true;
    window.addEventListener('popstate', onPop);
  }
  const entry: Entry = { handler, at: null, done: false };
  const top = topAt();
  stack.push(entry);
  if (flying()) {
    // landed() gives it an entry: no push while a traversal is unresolved
  } else if (depth > top) {
    entry.at = top + 1; // adopt the entry a just-closed layer left behind
  } else {
    giveEntry(entry);
  }
  return () => {
    if (entry.done) return;
    entry.done = true;
    const idx = stack.indexOf(entry);
    if (idx !== -1) stack.splice(idx, 1);
    scheduleSettle();
  };
}

/** Test hook: forgets all layers and listeners state. */
export function _resetBackStack(): void {
  stack = [];
  depth = 0;
  inFlight = null;
  clearTimeout(settleTimer);
  settleTimer = undefined;
}
