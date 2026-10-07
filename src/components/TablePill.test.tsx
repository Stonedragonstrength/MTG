import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { _resetBackStack } from '../lib/backstack';
import { buildSeatCards, seedSeat } from '../lib/cards';
import { createGame } from '../lib/game';
import type { Deck, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import TablePill from './TablePill';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: [
    { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  ],
};

const stompy: Deck = { id: 'deck-1', name: 'Stompy', commander: null, colors: [], cards: [], updatedAt: 1 };

function atTable(mySeat: number | null, cfg: GameConfig = config) {
  useAppStore.setState({
    game: createGame(cfg),
    online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat },
    decks: [stompy],
    seedSeatFromDeck: vi.fn(),
  });
}

beforeEach(() => {
  _resetBackStack();
});

async function openTableSheet() {
  const user = userEvent.setup();
  render(<TablePill />);
  await user.click(screen.getByRole('button', { name: /online table/i }));
  return user;
}

test('a claimed seat with no cards at a cards table can bring a deck from the table menu', async () => {
  atTable(1);
  const user = await openTableSheet();
  expect(screen.getByText(/bring a deck/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Stompy' }));
  expect(useAppStore.getState().seedSeatFromDeck).toHaveBeenCalledWith(1, stompy);
});

test('a seat that already has its cards is not offered another deck', async () => {
  atTable(1);
  const game = useAppStore.getState().game!;
  useAppStore.setState({ game: seedSeat(game, 1, buildSeatCards(stompy, 7)) });
  await openTableSheet();
  expect(screen.queryByText(/bring a deck/i)).not.toBeInTheDocument();
});

test('no deck is offered before a seat is claimed, or at a tracker table', async () => {
  atTable(null);
  await openTableSheet();
  expect(screen.queryByText(/bring a deck/i)).not.toBeInTheDocument();
});

test('a tracker table never asks for a deck', async () => {
  const { mode: _mode, ...tracker } = config;
  atTable(1, tracker);
  await openTableSheet();
  expect(screen.queryByText(/bring a deck/i)).not.toBeInTheDocument();
});
