import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { BoardItem, CardRecord, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import LandsRow from './LandsRow';

const forestCard: CardRecord = {
  id: 'forest-1',
  name: 'Forest',
  nameLower: 'forest',
  typeLine: 'Basic Land — Forest',
  oracleText: '({T}: Add {G}.)',
  manaCost: '',
  power: null,
  toughness: null,
  colors: [],
  imageNormal: 'https://img.example/forest.jpg',
  imageArtCrop: null,
  isToken: false,
  isBasicLand: true,
};

vi.mock('../data/scryfall', () => ({
  findBasicLand: vi.fn(async (name: string) => (name === 'Forest' ? forestCard : undefined)),
  getCardById: vi.fn(async () => undefined),
  loadNameIndex: vi.fn(async () => []),
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

function landItem(name: string, oracleText: string, count: number): BoardItem {
  return {
    id: `land-${name}`,
    cardId: name,
    name,
    imageNormal: null,
    imageArtCrop: null,
    typeLine: 'Land',
    oracleText,
    basePower: null,
    baseToughness: null,
    count,
    counters: {},
    color: null,
    zone: 'lands',
  };
}

beforeEach(() => {
  useAppStore.setState({ game: createGame(config) });
});

test('quick-adding a basic creates a lands-zone stack', async () => {
  const added: BoardItem[] = [];
  useAppStore.setState({ addItem: vi.fn((_i: number, item: BoardItem) => added.push(item)) });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /add forest/i }));
  expect(added).toHaveLength(1);
  expect(added[0].name).toBe('Forest');
  expect(added[0].zone).toBe('lands');
});

test('quick-adding a basic you already have bumps the stack instead', async () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [landItem('Forest', '({T}: Add {G}.)', 3)] };
  const changeCount = vi.fn();
  useAppStore.setState({ game, changeCount });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /add forest/i }));
  expect(changeCount).toHaveBeenCalledWith(0, 'land-Forest', 1);
});

test('the mana summary tallies the lands zone', () => {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    board: [
      landItem('Forest', '({T}: Add {G}.)', 4),
      landItem('Command Tower', '{T}: Add one mana of any color.', 2),
    ],
  };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByText(/6 lands/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/4 green sources/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/2 any-color sources/i)).toBeInTheDocument();
});

test('land stacks render with their counts', () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [landItem('Forest', '({T}: Add {G}.)', 5)] };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByText('×5')).toBeInTheDocument();
});
