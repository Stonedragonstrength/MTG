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
  expect(await screen.findByText('MTG Companion')).toBeInTheDocument();
  expect(
    await screen.findByRole('button', { name: /download card database/i }),
  ).toBeInTheDocument();
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
