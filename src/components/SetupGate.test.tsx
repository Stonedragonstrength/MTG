import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { useAppStore } from '../state/store';
import SetupGate from './SetupGate';

vi.mock('../data/scryfall', () => ({
  importBulkData: vi.fn(async (onProgress: (pct: number, msg: string) => void) => {
    onProgress(100, 'Done');
    return 4;
  }),
}));

vi.mock('../data/rules', () => ({
  ensureRulesLoaded: vi.fn(async () => {}),
}));

beforeEach(() => {
  useAppStore.setState({ setupDone: false });
});

test('shows the one-time download explanation and button', () => {
  render(<SetupGate />);
  expect(screen.getByText(/one-time download/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /download card database/i })).toBeInTheDocument();
});

test('running the download completes setup', async () => {
  const user = userEvent.setup();
  render(<SetupGate />);
  await user.click(screen.getByRole('button', { name: /download card database/i }));
  await waitFor(() => expect(useAppStore.getState().setupDone).toBe(true));
});

test('a failed download shows the error and a retry button', async () => {
  const { importBulkData } = await import('../data/scryfall');
  vi.mocked(importBulkData).mockRejectedValueOnce(new Error('Scryfall bulk index failed: 503'));
  const user = userEvent.setup();
  render(<SetupGate />);
  await user.click(screen.getByRole('button', { name: /download card database/i }));
  expect(await screen.findByText(/503/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  expect(useAppStore.getState().setupDone).toBe(false);
});
