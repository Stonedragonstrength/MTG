import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { BoardItem, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import CombatSheet from './CombatSheet';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'Nate', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  ],
};

const soldiers: BoardItem = {
  id: 'item-1',
  cardId: 'c1',
  name: 'Soldier',
  imageNormal: null,
  imageArtCrop: null,
  typeLine: 'Token Creature — Soldier',
  oracleText: '',
  basePower: 1,
  baseToughness: 1,
  count: 2,
  counters: { p1p1: 2 }, // 3/3 each
  color: null,
  zone: 'board',
};

const clue: BoardItem = {
  ...soldiers,
  id: 'item-2',
  name: 'Clue',
  basePower: null,
  baseToughness: null,
  counters: {},
};

beforeEach(() => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [soldiers, clue] };
  useAppStore.setState({ game });
});

test('only creatures are listed, and sending everyone shows the right total', async () => {
  const user = userEvent.setup();
  render(<CombatSheet onClose={() => {}} />);
  expect(screen.queryByText('Clue')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /everything attacks/i }));
  expect(screen.getByTestId('combat-total').textContent).toContain('6');
});

test('blocked stacks are excluded from the total', async () => {
  const user = userEvent.setup();
  render(<CombatSheet onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /everything attacks/i }));
  await user.click(screen.getByRole('checkbox', { name: /soldier blocked/i }));
  expect(screen.getByTestId('combat-total').textContent).toContain('0');
});

test('applying the damage hits the defender’s life', async () => {
  const adjustLife = vi.fn();
  useAppStore.setState({ adjustLife });
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<CombatSheet onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: /everything attacks/i }));
  await user.click(screen.getByRole('button', { name: /deal 6 to sam/i }));
  expect(adjustLife).toHaveBeenCalledWith(1, -6);
  expect(onClose).toHaveBeenCalled();
});
