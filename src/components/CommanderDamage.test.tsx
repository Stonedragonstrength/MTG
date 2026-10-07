import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import CommanderDamage from './CommanderDamage';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
    {
      id: 'p1',
      name: 'Sam',
      avatarUrl: null,
      commanderName: 'Thrasios, Triton Hero',
      partnerName: 'Tymna the Weaver',
    },
    { id: 'p2', name: 'Alex', avatarUrl: null, commanderName: null },
  ],
};

beforeEach(() => {
  useAppStore.setState({ game: createGame(config), applyCommanderDamage: vi.fn() });
});

test('a partner pair gets a gauge per commander; everyone else keeps one', () => {
  render(<CommanderDamage playerIdx={0} />);
  expect(screen.getByRole('button', { name: /commander damage from Sam — Thrasios/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /commander damage from Sam — Tymna/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'commander damage from Alex' })).toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(3);
});

test('tapping a partner’s gauge charges that commander alone', async () => {
  const user = userEvent.setup();
  render(<CommanderDamage playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /commander damage from Sam — Tymna/i }));
  expect(useAppStore.getState().applyCommanderDamage).toHaveBeenCalledWith(0, 'p1#2', 1);
});

test('each gauge shows its own total', () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], commanderDamage: { p1: 4, 'p1#2': 9 } };
  useAppStore.setState({ game });
  render(<CommanderDamage playerIdx={0} />);
  expect(screen.getByRole('button', { name: /Sam — Thrasios/i })).toHaveTextContent('4');
  expect(screen.getByRole('button', { name: /Sam — Tymna/i })).toHaveTextContent('9');
});

test('a pair does not track damage against itself', () => {
  render(<CommanderDamage playerIdx={1} />);
  expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
    'commander damage from Nathan',
    'commander damage from Alex',
  ]);
});
