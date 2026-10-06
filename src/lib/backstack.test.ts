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

test('each handler fires at most once', () => {
  const onBack = vi.fn();
  registerBack(onBack);
  pressBack();
  pressBack();
  expect(onBack).toHaveBeenCalledTimes(1);
});
