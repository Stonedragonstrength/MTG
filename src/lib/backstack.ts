/** Android/tablet back-button support for a state-driven SPA: every open
 * layer (sheet, sub-screen, the game itself) registers a handler and owns
 * one history entry; the hardware back pops the top layer instead of
 * closing the PWA, and a layer closed by its own UI gives its entry back.
 *
 * Each entry is labelled with its place (`layer`) and the page load that
 * made it (`run`), and every popstate hands that label back — so the
 * stack never guesses where the browser is: it reads it. `depth` is the
 * browser's position among our entries; each live layer remembers which
 * entry is its own; a pop closes every live layer above the new position.
 * That one rule covers a back press, the Forward button, a jump over
 * several entries, our own trimming, and entries left by an earlier load.
 *
 * One Chrome fact still shapes the writes, learned the hard way: a
 * traversal and a pushState must never race. Chrome resolves the pair so
 * the page sits one entry lower than it looks, and the next close then
 * walks OUT of the app. So entries are trimmed in a later task (a layer
 * opening in the same breath adopts the ownerless entry instead of
 * pushing), and a layer that opens mid-traversal waits for it to land. */

interface Entry {
  handler: () => void;
  /** Which of our history entries is this layer's (1 = first above the
   * page's own); null while it waits for a traversal to land. */
  at: number | null;
  done: boolean;
}

/** One id per page load: labels that outlive a reload read as not ours. */
const newRun = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let run = newRun();

let stack: Entry[] = [];
let depth = 0;
let listening = false;
/** Deadline of the trim we started, or null when none is out. Its only
 * job is to stop a traversal that never answers from stranding the layers
 * waiting on it. */
let inFlight: number | null = null;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
const LAND_MS = 1000;

function topAt(): number {
  let top = 0;
  for (const e of stack) if (e.at !== null && e.at > top) top = e.at;
  return top;
}

/** Where a history entry sits among ours: its label, or 0 for the page's
 * own entry and for anything this page load did not write. */
function placeOf(state: unknown): number {
  const s = state as { layer?: unknown; run?: unknown } | null;
  return s && s.run === run && typeof s.layer === 'number' ? s.layer : 0;
}

function giveEntry(entry: Entry): void {
  depth += 1;
  entry.at = depth;
  try {
    history.pushState({ layer: depth, run }, '');
  } catch {
    // History can be unavailable (odd embeds); back just won't intercept.
  }
}

/** The browser has come to rest: layers that opened while our trim was
 * out get their entries now, and anything ownerless above the top layer
 * is queued for trimming. */
function landed(): void {
  inFlight = null;
  for (const e of stack) if (e.at === null) giveEntry(e);
  scheduleSettle();
}

function flying(): boolean {
  if (inFlight !== null && Date.now() > inFlight) {
    depth = topAt(); // no answer came: take the trim as done
    landed();
  }
  return inFlight !== null;
}

/** Walks history back down to the top live layer's entry, taking every
 * ownerless entry above it (closed layers, buried ones included) at once. */
function settle(): void {
  settleTimer = undefined;
  if (flying()) return; // one traversal at a time; landing comes back here
  const excess = depth - topAt();
  if (excess <= 0) return;
  inFlight = Date.now() + LAND_MS;
  try {
    history.go(-excess);
    setTimeout(flying, LAND_MS + 20);
  } catch {
    inFlight = null; // nothing moved, so no answer is coming
  }
}

function scheduleSettle(): void {
  settleTimer ??= setTimeout(settle, 0);
}

function onPop(event: PopStateEvent): void {
  depth = placeOf(event.state); // the browser says where it landed
  // Whatever sat above that closes — the top layer on a back press, several
  // on a jump, nothing at all for our own trim or the Forward button.
  const closing = stack.filter((e) => e.at !== null && e.at > depth);
  stack = stack.filter((e) => !closing.includes(e));
  for (const entry of closing.reverse()) {
    entry.done = true;
    entry.handler();
  }
  landed();
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

/** Test hook: a fresh page load — no layers, and entries written before
 * it read as not ours. */
export function _resetBackStack(): void {
  run = newRun();
  stack = [];
  depth = 0;
  inFlight = null;
  clearTimeout(settleTimer);
  settleTimer = undefined;
}

/** Test hook: the stack's beliefs, for checking them against a real browser. */
export function _debugBackStack() {
  return {
    depth,
    ats: stack.map((e) => e.at),
    inFlight: inFlight !== null,
    settlePending: settleTimer !== undefined,
  };
}
