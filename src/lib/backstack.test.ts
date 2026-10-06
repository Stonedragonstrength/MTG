import { beforeEach, expect, test, vi } from 'vitest';
import { _resetBackStack, registerBack } from './backstack';

beforeEach(() => {
  _resetBackStack();
});

function pressBack() {
  window.dispatchEvent(new PopStateEvent('popstate'));
}

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
  await new Promise((r) => setTimeout(r, 0)); // let any queued popstate settle
  pressBack();
  expect(onBack).not.toHaveBeenCalled();
});

const settle = () => new Promise((r) => setTimeout(r, 30));

/** Chrome answers every history.back() with one popstate a beat later —
 * even when a pushState lands in between (measured in the real browser;
 * jsdom drops that one, so the tests pin the browser's behavior). */
function browserLikeBack() {
  return vi.spyOn(history, 'back').mockImplementation(() => {
    setTimeout(() => window.dispatchEvent(new PopStateEvent('popstate')), 0);
  });
}

test('closing the top layer by its own UI never fires the layer beneath', async () => {
  const back = browserLikeBack();
  const game = vi.fn();
  const sheet = vi.fn();
  registerBack(game);
  const closeSheet = registerBack(sheet);
  closeSheet(); // ✕ on the sheet: consumes its history entry
  await settle();
  expect(game).not.toHaveBeenCalled(); // the game must not be exited
  expect(sheet).not.toHaveBeenCalled();
  pressBack(); // a real back press now belongs to the game
  expect(game).toHaveBeenCalledTimes(1);
  back.mockRestore();
});

test('a layer opened in the same breath as another closes survives', async () => {
  const back = browserLikeBack();
  const game = vi.fn();
  const next = vi.fn();
  registerBack(game);
  const closeFirst = registerBack(vi.fn());
  closeFirst();
  registerBack(next); // e.g. one sheet swapping for another, or StrictMode's remount
  await settle();
  expect(next).not.toHaveBeenCalled();
  expect(game).not.toHaveBeenCalled();
  pressBack();
  expect(next).toHaveBeenCalledTimes(1);
  expect(game).not.toHaveBeenCalled();
  back.mockRestore();
});

test('a swallowed pop that never arrives does not eat a later real back press', async () => {
  const back = vi.spyOn(history, 'back').mockImplementation(() => {}); // browser stays silent
  const game = vi.fn();
  registerBack(game);
  const closeSheet = registerBack(vi.fn());
  closeSheet();
  await new Promise((r) => setTimeout(r, 1100)); // past the swallow window
  pressBack();
  expect(game).toHaveBeenCalledTimes(1);
  back.mockRestore();
});

test('each handler fires at most once', () => {
  const onBack = vi.fn();
  registerBack(onBack);
  pressBack();
  pressBack();
  expect(onBack).toHaveBeenCalledTimes(1);
});
