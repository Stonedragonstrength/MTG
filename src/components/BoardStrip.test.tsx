import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { BoardItem, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import BoardStrip from './BoardStrip';

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => undefined),
}));
vi.mock('../data/rules', () => ({
  getGlossary: vi.fn(async () => []),
}));

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
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
  count: 8,
  counters: { p1p1: 2 },
  color: null,
  zone: 'board',
};

beforeEach(() => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [soldiers] };
  useAppStore.setState({ game });
});

test('shows the count badge and computed P/T', () => {
  render(<BoardStrip playerIdx={0} />);
  expect(screen.getByText('×8')).toBeInTheDocument();
  expect(screen.getByText('3/3')).toBeInTheDocument();
});

test('inline +/− adjust the stack count', async () => {
  const spy = vi.fn();
  useAppStore.setState({ changeCount: spy });
  const { default: userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();
  render(<BoardStrip playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /add one soldier/i }));
  expect(spy).toHaveBeenCalledWith(0, 'item-1', 1);
  await user.click(screen.getByRole('button', { name: /remove one soldier/i }));
  expect(spy).toHaveBeenCalledWith(0, 'item-1', -1);
});

test('has an add-card tile', () => {
  render(<BoardStrip playerIdx={0} />);
  expect(screen.getByRole('button', { name: /add a card/i })).toBeInTheDocument();
});

test('lands-zone items stay out of the battlefield grid', () => {
  const game = useAppStore.getState().game!;
  const forest = { ...soldiers, id: 'land-1', name: 'Forest', zone: 'lands' as const };
  useAppStore.setState({
    game: {
      ...game,
      players: [{ ...game.players[0], board: [soldiers, forest] }, game.players[1]],
    },
  });
  render(<BoardStrip playerIdx={0} />);
  expect(screen.queryByRole('button', { name: /forest details/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /soldier details/i })).toBeInTheDocument();
});
