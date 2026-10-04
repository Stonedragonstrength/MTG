import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import PlayerSheet from './PlayerSheet';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'Nate', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  ],
};

beforeEach(() => {
  useAppStore.setState({ game: createGame(config) });
});

test('poison, energy, and experience steppers wire to the store', async () => {
  const spy = vi.fn();
  useAppStore.setState({ setPlayerCounter: spy });
  const user = userEvent.setup();
  render(<PlayerSheet playerIdx={0} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /more poison/i }));
  expect(spy).toHaveBeenCalledWith(0, 'poison', 1);
  await user.click(screen.getByRole('button', { name: /more energy/i }));
  expect(spy).toHaveBeenCalledWith(0, 'energy', 1);
});

test('commander deaths show the current tax', async () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], commanderDeaths: 2 };
  useAppStore.setState({ game });
  render(<PlayerSheet playerIdx={0} onClose={() => {}} />);
  expect(screen.getByText(/tax \+4/i)).toBeInTheDocument();
});

test('commander damage has precise steppers per enemy', async () => {
  const spy = vi.fn();
  useAppStore.setState({ applyCommanderDamage: spy });
  const user = userEvent.setup();
  render(<PlayerSheet playerIdx={0} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /more commander damage from sam/i }));
  expect(spy).toHaveBeenCalledWith(0, 'p1', 1);
  await user.click(screen.getByRole('button', { name: /less commander damage from sam/i }));
  expect(spy).toHaveBeenCalledWith(0, 'p1', -1);
});

test('monarch and initiative can be claimed from the sheet', async () => {
  const monarch = vi.fn();
  const initiative = vi.fn();
  useAppStore.setState({ claimMonarch: monarch, claimInitiative: initiative });
  const user = userEvent.setup();
  render(<PlayerSheet playerIdx={1} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /monarch/i }));
  expect(monarch).toHaveBeenCalledWith(1);
  await user.click(screen.getByRole('button', { name: /initiative/i }));
  expect(initiative).toHaveBeenCalledWith(1);
});
