import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { BoardItem, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import CardDetail from './CardDetail';

vi.mock('../data/rules', () => ({
  getGlossary: vi.fn(async () => [
    { term: 'Flying', definition: 'A keyword ability that restricts how it may be blocked.' },
  ]),
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

const angel: BoardItem = {
  id: 'item-a',
  cardId: 'c-angel',
  name: 'Angel',
  imageNormal: 'https://img.example/angel.jpg',
  imageArtCrop: null,
  typeLine: 'Token Creature — Angel',
  oracleText: 'Flying',
  basePower: 4,
  baseToughness: 4,
  count: 2,
  counters: {},
  color: null,
  zone: 'board',
};

beforeEach(() => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [angel] };
  useAppStore.setState({ game });
});

test('keywords in rules text are tappable and show the glossary definition', async () => {
  const user = userEvent.setup();
  render(<CardDetail playerIdx={0} itemId="item-a" onClose={() => {}} />);
  const term = await screen.findByRole('button', { name: 'Flying' });
  await user.click(term);
  expect(await screen.findByText(/restricts how it may be blocked/i)).toBeInTheDocument();
});

test('adding +1/+1 counters updates the displayed P/T', async () => {
  const user = userEvent.setup();
  render(<CardDetail playerIdx={0} itemId="item-a" onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /add \+1\/\+1/i }));
  expect(useAppStore.getState().game?.players[0].board[0].counters.p1p1).toBe(1);
});

test('splitting a stack calls splitItem with the entered count', async () => {
  const spy = vi.fn();
  useAppStore.setState({ splitItem: spy });
  const user = userEvent.setup();
  render(<CardDetail playerIdx={0} itemId="item-a" onClose={() => {}} />);
  const input = screen.getByLabelText(/split off/i);
  await user.clear(input);
  await user.type(input, '1');
  await user.click(screen.getByRole('button', { name: /^split$/i }));
  expect(spy).toHaveBeenCalledWith(0, 'item-a', 1);
});

test('a mana pip sets the override', async () => {
  const spy = vi.fn();
  useAppStore.setState({ setManaMode: spy });
  const user = userEvent.setup();
  render(<CardDetail playerIdx={0} itemId="item-a" onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /taps for green/i }));
  expect(spy).toHaveBeenCalledWith(0, 'item-a', 'G');
});

test('tapping the active pip turns the override off', async () => {
  const spy = vi.fn();
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [{ ...angel, manaMode: 'G' }] };
  useAppStore.setState({ game, setManaMode: spy });
  const user = userEvent.setup();
  render(<CardDetail playerIdx={0} itemId="item-a" onClose={() => {}} />);
  const pip = screen.getByRole('button', { name: /taps for green/i });
  expect(pip).toHaveAttribute('aria-pressed', 'true');
  await user.click(pip);
  expect(spy).toHaveBeenCalledWith(0, 'item-a', undefined);
});

test('turning off a real dork silences it with none', async () => {
  const spy = vi.fn();
  const game = createGame(config);
  const elves = { ...angel, id: 'item-e', name: 'Llanowar Elves', oracleText: '{T}: Add {G}.' };
  game.players[0] = { ...game.players[0], board: [elves] };
  useAppStore.setState({ game, setManaMode: spy });
  const user = userEvent.setup();
  render(<CardDetail playerIdx={0} itemId="item-e" onClose={() => {}} />);
  const pip = screen.getByRole('button', { name: /taps for green/i });
  expect(pip).toHaveAttribute('aria-pressed', 'true');
  await user.click(pip);
  expect(spy).toHaveBeenCalledWith(0, 'item-e', 'none');
});

test('real cards link out to EDHREC', () => {
  render(<CardDetail playerIdx={0} itemId="item-a" onClose={() => {}} />);
  const link = screen.getByRole('link', { name: /edhrec/i });
  expect(link).toHaveAttribute('href', 'https://edhrec.com/cards/angel');
});

test('remove deletes the item and closes', async () => {
  const spy = vi.fn();
  const onClose = vi.fn();
  useAppStore.setState({ removeItem: spy });
  const user = userEvent.setup();
  render(<CardDetail playerIdx={0} itemId="item-a" onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: /remove/i }));
  expect(spy).toHaveBeenCalledWith(0, 'item-a');
  expect(onClose).toHaveBeenCalled();
});
