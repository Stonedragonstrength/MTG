import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import HandCardSheet from './HandCardSheet';

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

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => undefined),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

beforeEach(() => {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: {
      library: [],
      hand: [
        { iid: 'h1', cardId: 'c-bolt', name: 'Lightning Bolt' },
        { iid: 'h2', cardId: 'c-opt', name: 'Opt' },
      ],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
      mulligans: 0,
      deckName: 'Test',
    },
  };
  useAppStore.setState({
    game,
    online: null,
    revealCards: vi.fn(),
    moveVirtualCard: vi.fn(),
    playCard: vi.fn(async () => {}),
  });
});

test('Reveal shows the card to the table and leaves it in the hand', async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<HandCardSheet playerIdx={0} iid="h1" onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: /^reveal$/i }));
  expect(useAppStore.getState().revealCards).toHaveBeenCalledWith(0, ['h1'], 'hand');
  expect(useAppStore.getState().moveVirtualCard).not.toHaveBeenCalled(); // shown, not moved
  expect(useAppStore.getState().playCard).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled(); // out of the way: the table is looking at the card now
});

test('a build behind the table cannot reveal: the reveal could not announce itself', () => {
  useAppStore.setState({ online: { code: 'KQ7M2X', status: { kind: 'stale-build' }, mySeat: 0 } });
  render(<HandCardSheet playerIdx={0} iid="h1" onClose={() => {}} />);
  expect(screen.getByRole('button', { name: /^reveal$/i })).toBeDisabled();
});

test('the other chips still move the card as before', async () => {
  const user = userEvent.setup();
  render(<HandCardSheet playerIdx={0} iid="h2" onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /^discard$/i }));
  expect(useAppStore.getState().moveVirtualCard).toHaveBeenCalledWith(0, 'h2', 'hand', 'graveyard');
  expect(useAppStore.getState().revealCards).not.toHaveBeenCalled();
});
