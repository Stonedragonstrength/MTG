import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { _resetBackStack, registerBack } from './backstack';

/** A stand-in for the browser's session history that behaves the way Chrome
 * was measured to: pushState is immediate and records its state, every
 * traversal answers with ONE popstate a beat later carrying the state of
 * the entry it landed on, and position is tracked so the tests can assert
 * the app never walks out past its own entries. */
let entries: unknown[]; // entries[i] = the state of history entry i
let position: number;
let pushes: number;
let goes: number[];
let deliverPops: boolean;

const pop = () =>
  window.dispatchEvent(new PopStateEvent('popstate', { state: entries[position] ?? null }));

beforeEach(() => {
  _resetBackStack();
  entries = [null]; // the page's own entry
  position = 0;
  pushes = 0;
  goes = [];
  deliverPops = true;
  vi.spyOn(history, 'pushState').mockImplementation((state: unknown) => {
    entries = [...entries.slice(0, position + 1), state]; // a push drops forward entries
    position += 1;
    pushes += 1;
  });
  vi.spyOn(history, 'go').mockImplementation((delta?: number) => {
    goes.push(delta ?? 0);
    position += delta ?? 0;
    if (deliverPops) setTimeout(pop, 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The browser moving on its own: hardware back, the Forward button, or
 * the back button's history menu jumping several entries at once. */
function travel(delta: number) {
  position += delta;
  pop();
}
const pressBack = () => travel(-1);

const settle = () => new Promise((r) => setTimeout(r, 30));

test('hardware back fires the most recent handler first', () => {
  const a = vi.fn();
  const b = vi.fn();
  registerBack(a);
  registerBack(b);
  pressBack();
  expect(b).toHaveBeenCalledTimes(1);
  expect(a).not.toHaveBeenCalled();
  pressBack();
  expect(a).toHaveBeenCalledTimes(1);
});

test('a handler released by normal closing never fires on back', async () => {
  const onBack = vi.fn();
  const release = registerBack(onBack);
  release();
  await settle();
  expect(position).toBe(0); // its history entry was consumed
  pressBack();
  expect(onBack).not.toHaveBeenCalled();
});

test('closing the top layer by its own UI never fires the layer beneath', async () => {
  const game = vi.fn();
  const sheet = vi.fn();
  registerBack(game);
  const closeSheet = registerBack(sheet);
  closeSheet(); // ✕ on the sheet
  await settle();
  expect(game).not.toHaveBeenCalled(); // the game must not be exited
  expect(sheet).not.toHaveBeenCalled();
  expect(position).toBe(1); // back on the game's own entry
  pressBack(); // a real back press now belongs to the game
  expect(game).toHaveBeenCalledTimes(1);
});

test('a layer opened in the same breath as another closes takes over its entry', async () => {
  const game = vi.fn();
  const next = vi.fn();
  registerBack(game);
  const closeFirst = registerBack(vi.fn());
  closeFirst();
  registerBack(next); // one sheet swapping for another, or StrictMode's remount
  await settle();
  // No traversal raced a push: the new layer simply adopted the old entry.
  expect(goes).toEqual([]);
  expect(pushes).toBe(2);
  expect(position).toBe(2);
  expect(next).not.toHaveBeenCalled();
  pressBack();
  expect(next).toHaveBeenCalledTimes(1);
  expect(game).not.toHaveBeenCalled();
});

test('entering and leaving a screen (mount, unmount, remount, unmount) never walks out of the app', async () => {
  // React StrictMode's effect double-run, then a real leave — the sequence
  // that navigated the whole page away in Chrome.
  const release1 = registerBack(vi.fn());
  release1();
  const release2 = registerBack(vi.fn());
  await settle();
  expect(position).toBe(1);
  release2();
  await settle();
  expect(position).toBe(0); // exactly back where it started, not below
  expect(Math.min(0, ...goes.map((g) => g))).toBeGreaterThanOrEqual(-1);
});

test('a layer closed beneath another is trimmed once the one above goes', async () => {
  const game = vi.fn();
  registerBack(game);
  const closeLower = registerBack(vi.fn());
  const closeUpper = registerBack(vi.fn());
  closeLower(); // buried: its entry cannot be consumed yet
  await settle();
  expect(position).toBe(3);
  closeUpper();
  await settle();
  expect(position).toBe(1); // both entries gone in one step
  expect(goes).toEqual([-2]);
  pressBack();
  expect(game).toHaveBeenCalledTimes(1);
});

test('a layer that opens while a traversal is in flight waits for it to land', async () => {
  deliverPops = false; // hold the browser's answer
  const game = vi.fn();
  const late = vi.fn();
  registerBack(game);
  const closeSheet = registerBack(vi.fn());
  closeSheet();
  await settle(); // go(-1) is now in flight
  expect(goes).toEqual([-1]);
  registerBack(late);
  expect(pushes).toBe(2); // no pushState while the traversal is unresolved
  pop(); // the traversal lands
  expect(pushes).toBe(3); // now the late layer gets its entry
  expect(late).not.toHaveBeenCalled();
  pressBack();
  expect(late).toHaveBeenCalledTimes(1);
  expect(game).not.toHaveBeenCalled();
});

test('a back press that lands on an ownerless entry closes nothing', async () => {
  const game = vi.fn();
  registerBack(game);
  const closeSheet = registerBack(vi.fn());
  closeSheet();
  pressBack(); // beats the cleanup to it
  expect(game).not.toHaveBeenCalled();
  await settle();
  expect(goes).toEqual([]); // nothing left to trim
  pressBack();
  expect(game).toHaveBeenCalledTimes(1);
});

test('a traversal whose answer never arrives does not eat a later real back press', async () => {
  deliverPops = false;
  const game = vi.fn();
  registerBack(game);
  const closeSheet = registerBack(vi.fn());
  closeSheet();
  await new Promise((r) => setTimeout(r, 1100)); // past the wait
  pressBack();
  expect(game).toHaveBeenCalledTimes(1);
});

test('each handler fires at most once', () => {
  const onBack = vi.fn();
  registerBack(onBack);
  pressBack();
  pressBack();
  expect(onBack).toHaveBeenCalledTimes(1);
});

// The browser says where it landed (each entry carries its place in the
// popstate's state), so the stack reads that instead of guessing from a
// clock or assuming every pop is one step back.

test('a slow answer to our own traversal is still not a back press', async () => {
  deliverPops = false;
  const game = vi.fn();
  registerBack(game);
  const closeSheet = registerBack(vi.fn());
  closeSheet(); // ✕ on the sheet; the trim goes out…
  await new Promise((r) => setTimeout(r, 1150)); // …and the main thread stalls past any clock
  pop(); // the browser's answer finally arrives, saying "you are on the game's entry"
  expect(game).not.toHaveBeenCalled(); // the game must not be exited
  pressBack();
  expect(game).toHaveBeenCalledTimes(1);
});

test('the Forward button closes nothing, and the stack recovers its place', async () => {
  const game = vi.fn();
  const sheet = vi.fn();
  registerBack(game);
  registerBack(sheet);
  pressBack(); // closes the sheet
  expect(sheet).toHaveBeenCalledTimes(1);
  travel(+1); // desktop Forward: back onto the sheet's old entry
  expect(game).not.toHaveBeenCalled();
  await settle();
  expect(position).toBe(1); // trimmed back to the game's entry
  pressBack();
  expect(game).toHaveBeenCalledTimes(1);
});

test('a jump back over two entries closes both layers and leaves nothing to over-trim', async () => {
  const game = vi.fn();
  const sheet = vi.fn();
  registerBack(game);
  registerBack(sheet);
  travel(-2); // the back button's history menu
  expect(sheet).toHaveBeenCalledTimes(1);
  expect(game).toHaveBeenCalledTimes(1);
  const closeNext = registerBack(vi.fn());
  closeNext();
  await settle();
  expect(position).toBe(0); // back on the page's own entry — never below it
});

test('entries left over from an earlier page load are not mistaken for ours', async () => {
  // A reload keeps the tab's history: two labelled entries from the last run.
  entries = [null, { layer: 1, run: 'previous-load' }, { layer: 2, run: 'previous-load' }];
  position = 2;
  const sheet = vi.fn();
  registerBack(sheet);
  pressBack(); // lands on a stale entry that says "layer 2"
  expect(sheet).toHaveBeenCalledTimes(1); // the press still closes the live layer
});
