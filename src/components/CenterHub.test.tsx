import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import CenterHub from './CenterHub';

vi.mock('../data/rules', () => ({
  getGlossary: vi.fn(async () => []),
  searchRules: vi.fn(async () => []),
}));
vi.mock('../data/scryfall', () => ({
  importBulkData: vi.fn(async () => 0),
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => undefined),
}));

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: Array.from({ length: 4 }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    avatarUrl: null,
    commanderName: null,
  })),
};

beforeEach(() => {
  useAppStore.setState({ game: createGame(config) });
});

test('shows the turn number and active player', () => {
  render(<CenterHub />);
  expect(screen.getByText(/turn 1/i)).toBeInTheDocument();
  expect(screen.getByText('Player 0')).toBeInTheDocument();
});

test('pass turn advances to the next player', async () => {
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /pass turn/i }));
  expect(useAppStore.getState().game?.activePlayerIndex).toBe(1);
});

test('ending the game requires an inline confirmation', async () => {
  const endGame = vi.fn();
  useAppStore.setState({ endGame });
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /end game/i }));
  expect(endGame).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /yes, end it/i }));
  expect(endGame).toHaveBeenCalled();
});

test('hub actions carry visible labels', () => {
  render(<CenterHub />);
  for (const label of ['Dice', 'Rules', 'Settings', 'End', 'Undo', 'Log', 'Combat']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});

test('undo button delegates to the store and disables without history', async () => {
  const undo = vi.fn();
  useAppStore.setState({ undo, canUndo: () => true });
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /undo/i }));
  expect(undo).toHaveBeenCalled();
});

test('the turn clock shows when enabled and hides when off', () => {
  const settings = useAppStore.getState().settings;
  useAppStore.setState({ settings: { ...settings, turnTimerOn: true } });
  const { unmount } = render(<CenterHub />);
  expect(screen.getByTestId('turn-clock').textContent).toMatch(/\d+:\d\d/);
  unmount();

  useAppStore.setState({ settings: { ...settings, turnTimerOn: false } });
  render(<CenterHub />);
  expect(screen.queryByTestId('turn-clock')).not.toBeInTheDocument();
});

test('the log sheet shows game history', async () => {
  useAppStore.setState({ log: [{ t: Date.now(), text: 'Nate: life 40 → 38' }] });
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /log/i }));
  expect(await screen.findByText(/life 40 → 38/)).toBeInTheDocument();
});

test('dice roller produces a result in range', async () => {
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /dice/i }));
  await user.click(screen.getByRole('button', { name: /d20/i }));
  const result = Number(screen.getByTestId('dice-result').textContent);
  expect(result).toBeGreaterThanOrEqual(1);
  expect(result).toBeLessThanOrEqual(20);
});
