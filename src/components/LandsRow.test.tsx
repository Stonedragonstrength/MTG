import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { BoardItem, CardInstance, CardRecord, GameConfig, SeatCards } from '../lib/types';
import { useAppStore } from '../state/store';
import LandsRow from './LandsRow';

function record(id: string, name: string, typeLine: string, oracleText: string): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

const forestCard = record('forest-1', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)');

const VRECORDS: Record<string, CardRecord> = {
  'c-forest': record('c-forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  'c-tower': record('c-tower', 'Command Tower', 'Land', '{T}: Add one mana of any color.'),
};

vi.mock('../data/scryfall', () => ({
  findBasicLand: vi.fn(async (name: string) => (name === 'Forest' ? forestCard : undefined)),
  getCardById: vi.fn(async (id: string) => VRECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  loadNameIndex: vi.fn(async () => []),
}));

vi.mock('../data/images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/images')>()),
  randomBasicArt: vi.fn(async (name: string) =>
    name === 'Forest'
      ? { normal: 'https://img.example/forest-variant.jpg', artCrop: 'https://img.example/forest-variant-art.jpg' }
      : undefined,
  ),
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

test('quick-adding a basic creates a lands-zone stack with a random art variant', async () => {
  const added: BoardItem[] = [];
  useAppStore.setState({ addItem: vi.fn((_i: number, item: BoardItem) => added.push(item)) });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /add forest/i }));
  expect(added).toHaveLength(1);
  expect(added[0].name).toBe('Forest');
  expect(added[0].zone).toBe('lands');
  expect(added[0].imageNormal).toBe('https://img.example/forest-variant.jpg');
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

test('board-zone mana sources join the color pips but not the land total', () => {
  const game = createGame(config);
  const elves: BoardItem = {
    ...landItem('Llanowar Elves', '{T}: Add {G}.', 2),
    id: 'tok-elves',
    zone: 'board',
  };
  const bear: BoardItem = { ...landItem('Bear', '', 1), id: 'tok-bear', zone: 'board', manaMode: 'G' };
  game.players[0] = {
    ...game.players[0],
    board: [landItem('Forest', '({T}: Add {G}.)', 3), elves, bear],
  };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByText(/3 lands/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/6 green sources/i)).toBeInTheDocument();
});

test('land stacks render with their counts', () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [landItem('Forest', '({T}: Add {G}.)', 5)] };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByText('×5')).toBeInTheDocument();
});

test('tapping a land stack marks one source used', async () => {
  const tapItem = vi.fn();
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [landItem('Forest', '({T}: Add {G}.)', 5)] };
  useAppStore.setState({ game, tapItem });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: 'Forest' }));
  expect(tapItem).toHaveBeenCalledWith(0, 'land-Forest', 1);
});

test('tapping a one-shot source spends it instead', async () => {
  const changeCount = vi.fn();
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    board: [landItem('Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.', 3)],
  };
  useAppStore.setState({ game, changeCount });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: 'Treasure' }));
  expect(changeCount).toHaveBeenCalledWith(0, 'land-Treasure', -1);
});

test('the untap button appears when only a board creature is tapped', () => {
  const game = createGame(config);
  const creature: BoardItem = {
    ...landItem('Soldier', '', 2),
    id: 'tok-1',
    zone: 'board',
    tapped: 1,
  };
  game.players[0] = { ...game.players[0], board: [creature] };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByRole('button', { name: /untap all/i })).toBeInTheDocument();
});

test('untap all readies the row', async () => {
  const untapAll = vi.fn();
  const game = createGame(config);
  const tapped = { ...landItem('Forest', '({T}: Add {G}.)', 5), tapped: 3 };
  game.players[0] = { ...game.players[0], board: [tapped] };
  useAppStore.setState({ game, untapAll });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByLabelText(/forest, 3 of 5 tapped/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /untap all/i }));
  expect(untapAll).toHaveBeenCalledWith(0);
});

function seatWith(battlefield: CardInstance[]): SeatCards {
  return {
    library: [],
    hand: [],
    battlefield,
    graveyard: [],
    exile: [],
    command: [],
    mulligans: 0,
    deckName: 'Stompy',
  };
}

test('virtual deck lands stack with an m-of-n tapped badge and feed the summary', async () => {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: seatWith([
      { iid: 'i1', cardId: 'c-forest', name: 'Forest', row: 'lands' },
      { iid: 'i2', cardId: 'c-forest', name: 'Forest', row: 'lands', tapped: true },
      { iid: 'i3', cardId: 'c-tower', name: 'Command Tower', row: 'lands' },
      { iid: 'i4', cardId: 'c-bear', name: 'Grizzly Bears', row: 'front' },
    ]),
  };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByText(/3 lands/i)).toBeInTheDocument(); // counts before records resolve
  expect(screen.getByLabelText('Forest, 1 of 2 tapped')).toBeInTheDocument();
  expect(await screen.findByLabelText(/2 green sources/i)).toBeInTheDocument();
  expect(await screen.findByLabelText(/1 any-color sources/i)).toBeInTheDocument();
  expect(screen.queryByText(/grizzly bears/i)).not.toBeInTheDocument(); // front row stays off the shelf
});

test('tapping a virtual land stack taps its first untapped copy', async () => {
  const tapVirtualCard = vi.fn();
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: seatWith([
      { iid: 'i-a', cardId: 'c-forest', name: 'Forest', row: 'lands', tapped: true },
      { iid: 'i-b', cardId: 'c-forest', name: 'Forest', row: 'lands' },
    ]),
  };
  useAppStore.setState({ game, tapVirtualCard });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: 'Forest, 1 of 2 tapped' }));
  expect(tapVirtualCard).toHaveBeenCalledWith(0, 'i-b', true); // directed: never a toggle
});

test('a fully tapped virtual stack ignores taps and surfaces untap-all', async () => {
  const tapVirtualCard = vi.fn();
  const untapAll = vi.fn();
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: seatWith([{ iid: 'i-a', cardId: 'c-forest', name: 'Forest', row: 'lands', tapped: true }]),
  };
  useAppStore.setState({ game, tapVirtualCard, untapAll });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: 'Forest, 1 of 1 tapped' }));
  expect(tapVirtualCard).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /untap all/i }));
  expect(untapAll).toHaveBeenCalledWith(0);
});

test('holding a virtual land stack opens its card sheet', async () => {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: seatWith([{ iid: 'i-a', cardId: 'c-tower', name: 'Command Tower', row: 'lands' }]),
  };
  useAppStore.setState({ game });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  const stack = screen.getByRole('button', { name: 'Command Tower' });
  await user.pointer({ keys: '[MouseLeft>]', target: stack });
  await new Promise((r) => setTimeout(r, 650));
  await user.pointer({ keys: '[/MouseLeft]', target: stack });
  expect(await screen.findByRole('heading', { name: 'Command Tower' })).toBeInTheDocument();
});
