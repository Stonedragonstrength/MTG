import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import NewGameScreen from './NewGameScreen';

const profiles = [
  { id: 'p0', name: 'Nate', avatarUrl: null, commanderName: null },
  { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  { id: 'p2', name: 'Alex', avatarUrl: null, commanderName: null },
];

let startedWith: GameConfig | null;

beforeEach(() => {
  startedWith = null;
  useAppStore.setState({
    profiles,
    startGame: vi.fn((config: GameConfig) => {
      startedWith = config;
    }),
  });
});

test('commander game starts with 40 life and threshold 21', async () => {
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.startingLife).toBe(40);
  expect(startedWith?.commanderDamageThreshold).toBe(21);
  expect(startedWith?.profiles.map((p) => p.id)).toEqual(['p0', 'p1']);
});

test('standard game starts with 20 life', async () => {
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('radio', { name: /standard/i }));
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.startingLife).toBe(20);
  expect(startedWith?.format).toBe('standard');
});

test('start is disabled with fewer than 2 players selected', async () => {
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  expect(screen.getByRole('button', { name: /start game/i })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  expect(screen.getByRole('button', { name: /start game/i })).toBeDisabled();
});

test('a nonsense threshold falls back to 21', async () => {
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  const input = screen.getByLabelText(/commander damage/i);
  await user.clear(input);
  await user.type(input, '-3');
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.commanderDamageThreshold).toBe(21);
});

test('the commander damage threshold is adjustable', async () => {
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  const input = screen.getByLabelText(/commander damage/i);
  await user.clear(input);
  await user.type(input, '25');
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.commanderDamageThreshold).toBe(25);
});
