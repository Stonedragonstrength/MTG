import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { _resetBackStack } from '../lib/backstack';
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

const deck = { id: 'deck-1', name: 'Stompy', commander: null, colors: [], cards: [], updatedAt: 1 };

/** What the store does when the table answers: it lands here, not yet entered. */
const landsTable = (cfg: GameConfig = config) =>
  vi.fn(async (_code: string, _stillWanted?: () => boolean) => {
    useAppStore.setState({
      game: createGame(cfg),
      online: { code: 'KQ7M2X', status: { kind: 'connecting' }, mySeat: null },
    });
    return null;
  });

beforeEach(() => {
  _resetBackStack();
  useAppStore.setState({
    game: null,
    online: null,
    inGame: false,
    decks: [],
    joinOnlineGame: landsTable(),
    setMySeat: vi.fn(),
    enterGame: vi.fn(),
    seedSeatFromDeck: vi.fn(),
  });
});

async function joinWith(user: ReturnType<typeof userEvent.setup>, onClose = vi.fn()) {
  const view = render(<JoinTableSheet onClose={onClose} />);
  await user.type(screen.getByRole('textbox'), 'kq7m2x');
  await user.click(screen.getByRole('button', { name: /^join$/i }));
  return { onClose, ...view };
}

test('joining with a code flows into the seat picker, and the pick enters the table', async () => {
  const user = userEvent.setup();
  const { onClose } = await joinWith(user);
  expect(vi.mocked(useAppStore.getState().joinOnlineGame).mock.calls[0][0]).toBe('KQ7M2X');
  expect(await screen.findByText(/which seat is you/i)).toBeInTheDocument();
  expect(useAppStore.getState().enterGame).not.toHaveBeenCalled(); // not before the question is answered
  await user.click(screen.getByRole('button', { name: 'Nathan' }));
  expect(useAppStore.getState().setMySeat).toHaveBeenCalledWith(0);
  expect(useAppStore.getState().enterGame).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test('skipping the seat question still enters the table', async () => {
  const user = userEvent.setup();
  const { onClose } = await joinWith(user);
  await user.click(await screen.findByRole('button', { name: /skip/i }));
  expect(useAppStore.getState().setMySeat).not.toHaveBeenCalled();
  expect(useAppStore.getState().enterGame).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test('closing the seat question with the ✕ enters the table too', async () => {
  const user = userEvent.setup();
  const { onClose } = await joinWith(user);
  await screen.findByText(/which seat is you/i);
  await user.click(screen.getByRole('button', { name: 'close' }));
  expect(useAppStore.getState().enterGame).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test('the back button on the seat question only closes it: Back never opens a screen', async () => {
  const user = userEvent.setup();
  const { onClose } = await joinWith(user);
  await screen.findByText(/which seat is you/i);
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(onClose).toHaveBeenCalled();
  expect(useAppStore.getState().enterGame).not.toHaveBeenCalled(); // home offers Pick up instead
});

test('a cards table offers bringing a deck after the seat pick', async () => {
  useAppStore.setState({ decks: [deck], joinOnlineGame: landsTable({ ...config, mode: 'cards' }) });
  const user = userEvent.setup();
  const { onClose } = await joinWith(user);
  await user.click(await screen.findByRole('button', { name: 'Sam' })); // my seat
  expect(await screen.findByText(/bring a deck/i)).toBeInTheDocument();
  expect(useAppStore.getState().enterGame).not.toHaveBeenCalled(); // one more question first
  await user.click(screen.getByRole('button', { name: 'Stompy' }));
  expect(useAppStore.getState().seedSeatFromDeck).toHaveBeenCalledWith(1, deck);
  expect(useAppStore.getState().enterGame).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test('declining to bring a deck enters the table as a spectator', async () => {
  useAppStore.setState({ decks: [deck], joinOnlineGame: landsTable({ ...config, mode: 'cards' }) });
  const user = userEvent.setup();
  await joinWith(user);
  await user.click(await screen.findByRole('button', { name: 'Sam' }));
  await user.click(await screen.findByRole('button', { name: /spectate/i }));
  expect(useAppStore.getState().seedSeatFromDeck).not.toHaveBeenCalled();
  expect(useAppStore.getState().enterGame).toHaveBeenCalled();
});

test('closing the sheet while it is still joining calls the join off', async () => {
  let answer: (value: null) => void = () => {};
  const joinOnlineGame = vi.fn(
    (_code: string, _stillWanted?: () => boolean) => new Promise<null>((resolve) => (answer = resolve)),
  );
  useAppStore.setState({ joinOnlineGame });
  const user = userEvent.setup();
  const { unmount } = await joinWith(user);
  const stillWanted = joinOnlineGame.mock.calls[0][1]!;
  expect(stillWanted()).toBe(true);
  unmount(); // ✕, the backdrop or the back button: the sheet is gone
  expect(stillWanted()).toBe(false);
  await act(async () => answer(null));
  expect(useAppStore.getState().enterGame).not.toHaveBeenCalled();
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
  expect(useAppStore.getState().enterGame).not.toHaveBeenCalled();
});
