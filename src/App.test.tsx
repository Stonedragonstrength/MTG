import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import App from './App';
import { getDb } from './data/db';
import { useAppStore } from './state/store';

const realInit = useAppStore.getState().init;

beforeEach(async () => {
  await getDb().kv.clear();
});

afterEach(() => {
  useAppStore.setState({ init: realInit });
});

test('boots into the setup gate before the card database is downloaded', async () => {
  render(<App />);
  expect(await screen.findByText(/battlefield/i)).toBeInTheDocument();
  expect(
    await screen.findByRole('button', { name: /download card database/i }),
  ).toBeInTheDocument();
});

test('a saved game lands on home with a Pick up card that resumes it', async () => {
  const { kvSet } = await import('./data/db');
  const { createGame } = await import('./lib/game');
  await kvSet('cardsImportedAt', Date.now());
  const game = createGame({
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    profiles: [
      { id: 'p0', name: 'Cinco', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'Razzle', avatarUrl: null, commanderName: null },
    ],
  });
  await kvSet('activeGame', { ...game, turnNumber: 6 });

  const user = (await import('@testing-library/user-event')).default.setup();
  render(<App />);
  const pickUp = await screen.findByRole('button', { name: /pick up/i });
  expect(pickUp.textContent).toContain('Turn 6');
  await user.click(pickUp);
  expect(await screen.findByText(/pass turn/i)).toBeInTheDocument();
});

test('a failed boot offers a fresh start instead of hanging on Loading', async () => {
  useAppStore.setState({
    init: async () => {
      throw new Error('IndexedDB unavailable');
    },
  });
  render(<App />);
  expect(await screen.findByText(/IndexedDB unavailable/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /start fresh/i })).toBeInTheDocument();
});
