import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { _resetBackStack, registerBack } from './backstack';

/** A stand-in for the browser's session history that behaves the way Chrome
 * was measured to: every traversal answers with ONE popstate a beat later,
 * pushState is immediate, and position is tracked so the tests can assert
 * the app never walks out past its own entries. */
let position: number;
let pushes: number;
let goes: number[];
let deliverPops: boolean;

beforeEach(() => {
  _resetBackStack();
  position = 0;
  pushes = 0;
  goes = [];
  deliverPops = true;
  vi.spyOn(history, 'pushState').mockImplementation(() => {
    position += 1;
    pushes += 1;
  });
  vi.spyOn(history, 'go').mockImplementation((delta?: number) => {
    goes.push(delta ?? 0);
    position += delta ?? 0;
    if (deliverPops) setTimeout(() => window.dispatchEvent(new PopStateEvent('popstate')), 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The user's hardware back: the browser steps back one entry, then says so. */
function pressBack() {
  position -= 1;
  window.dispatchEvent(new PopStateEvent('popstate'));
}

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
  window.dispatchEvent(new PopStateEvent('popstate')); // the traversal lands
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
