import { render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

// The saved art pack answers only when the test says so, and regrowing the
// pack from the card db is watched: both sit behind the component's one
// start-up read.
const held = vi.hoisted(() => ({
  answer: (_pack: unknown) => {},
  pickLandArtPack: vi.fn(async () => ({})),
}));

vi.mock('../data/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/db')>()),
  kvGet: vi.fn(
    () =>
      new Promise((resolve) => {
        held.answer = resolve;
      }),
  ),
}));

vi.mock('../data/images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/images')>()),
  pickLandArtPack: held.pickLandArtPack,
}));

import LandBackground from './LandBackground';

test('a background that is gone before its saved art answers does not go looking for more', async () => {
  const { unmount } = render(<LandBackground />);
  unmount();
  held.answer(undefined); // an old install: nothing saved, so it would regrow the pack
  await new Promise((r) => setTimeout(r, 20));
  expect(held.pickLandArtPack).not.toHaveBeenCalled();
});
