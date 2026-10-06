import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import JoinTableSheet from './JoinTableSheet';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  ],
};

beforeEach(() => {
  useAppStore.setState({
    game: null,
    online: null,
    joinOnlineGame: vi.fn(async () => {
      useAppStore.setState({
        game: createGame(config),
        online: { code: 'KQ7M2X', status: { kind: 'connecting' }, mySeat: null },
        inGame: true,
      });
      return null;
    }),
    setMySeat: vi.fn(),
  });
});

test('joining with a code flows into the seat picker', async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<JoinTableSheet onClose={onClose} />);
  await user.type(screen.getByRole('textbox'), 'kq7m2x');
  await user.click(screen.getByRole('button', { name: /^join$/i }));
  expect(useAppStore.getState().joinOnlineGame).toHaveBeenCalledWith('KQ7M2X');
  expect(await screen.findByText(/which seat is you/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Nathan' }));
  expect(useAppStore.getState().setMySeat).toHaveBeenCalledWith(0);
  expect(onClose).toHaveBeenCalled();
});

test('a join error shows inline and keeps the sheet open', async () => {
  useAppStore.setState({
    joinOnlineGame: vi.fn(async () => 'No table with that code — codes last 24 hours.'),
  });
  const user = userEvent.setup();
  render(<JoinTableSheet onClose={() => {}} />);
  await user.type(screen.getByRole('textbox'), 'WRONG1');
  await user.click(screen.getByRole('button', { name: /^join$/i }));
  expect(await screen.findByText(/no table with that code/i)).toBeInTheDocument();
});
