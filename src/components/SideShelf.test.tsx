import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import SideShelf from './SideShelf';

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

function rec(id: string, name: string, typeLine: string, oracleText = ''): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '{1}',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear'),
  'c-sol': rec('c-sol', 'Sol Ring', 'Artifact', '{T}: Add {C}{C}.'),
  'c-study': rec('c-study', 'Rhystic Study', 'Enchantment', 'Whenever an opponent casts a spell…'),
  'c-greaves': rec('c-greaves', 'Lightning Greaves', 'Artifact — Equipment', 'Equip {0}'),
  'c-forest': rec('c-forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

function gameWith(battlefield: CardInstance[]): GameState {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: {
      library: [],
      hand: [],
      battlefield,
      graveyard: [],
      exile: [],
      command: [],
      mulligans: 0,
      deckName: 'Stompy',
    },
  };
  return g;
}

const BOARD: CardInstance[] = [
  { iid: 'b1', cardId: 'c-bear', name: 'Grizzly Bears', row: 'front' },
  { iid: 's1', cardId: 'c-sol', name: 'Sol Ring', row: 'front' },
  { iid: 'e1', cardId: 'c-study', name: 'Rhystic Study', row: 'front' },
  { iid: 'q1', cardId: 'c-greaves', name: 'Lightning Greaves', row: 'front' },
  { iid: 'f1', cardId: 'c-forest', name: 'Forest', row: 'lands' },
];

beforeEach(() => {
  useAppStore.setState({ game: gameWith(BOARD), online: null, tapVirtualCard: vi.fn() });
});

test('the side shelf holds the permanents that are neither creatures nor there for mana', async () => {
  const { container } = render(<SideShelf playerIdx={0} />);
  await waitFor(() => expect(container.querySelectorAll('.bf-side .vcard')).toHaveLength(2));
  const shelf = screen.getByRole('group', { name: /artifacts and enchantments/i });
  expect(shelf).toContainElement(screen.getByRole('button', { name: 'tap Rhystic Study' }));
  expect(shelf).toContainElement(screen.getByRole('button', { name: 'equip Lightning Greaves' }));
  expect(screen.queryByRole('button', { name: /Grizzly Bears/ })).not.toBeInTheDocument(); // the field's
  expect(screen.queryByRole('button', { name: /Sol Ring/ })).not.toBeInTheDocument(); // the lands row's
  // It says how many cards it holds: the big board shares its shelf line out by it.
  expect(shelf.style.getPropertyValue('--n')).toBe('2');
});

test('a card on the shelf taps on a tap and opens its sheet on a hold, as it would in the field', async () => {
  render(<SideShelf playerIdx={0} />);
  const study = await screen.findByRole('button', { name: 'tap Rhystic Study' });
  fireEvent.pointerDown(study);
  fireEvent.pointerUp(study);
  expect(useAppStore.getState().tapVirtualCard).toHaveBeenCalledWith(0, 'e1');

  fireEvent.pointerDown(study);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 650));
  });
  fireEvent.pointerUp(study);
  expect(await screen.findByRole('heading', { name: 'Rhystic Study' })).toBeInTheDocument();
});

test('an Equipment lying unattached says so, and a tap opens the list of what it can go on', async () => {
  render(<SideShelf playerIdx={0} />);
  const greaves = await screen.findByRole('button', { name: 'equip Lightning Greaves' });
  expect(greaves.querySelector('.use-band')).toHaveTextContent('equip');
  // Anything else on the shelf wears no such word.
  expect(screen.getByRole('button', { name: 'tap Rhystic Study' }).querySelector('.use-band')).toBeNull();

  fireEvent.pointerDown(greaves);
  fireEvent.pointerUp(greaves);
  expect(useAppStore.getState().tapVirtualCard).not.toHaveBeenCalled(); // tapping it is not what a player wants
  expect(await screen.findByRole('heading', { name: 'Equip Lightning Greaves' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'put it on Grizzly Bears' })).toBeInTheDocument();
});

test('the hold still opens an Equipment’s own sheet, where it can be tapped', async () => {
  render(<SideShelf playerIdx={0} />);
  const greaves = await screen.findByRole('button', { name: 'equip Lightning Greaves' });
  fireEvent.pointerDown(greaves);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 650));
  });
  fireEvent.pointerUp(greaves);
  expect(await screen.findByRole('heading', { name: 'Lightning Greaves' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tap' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Equip…' })).toBeInTheDocument();
});

test('nothing is drawn while the shelf is empty', async () => {
  useAppStore.setState({ game: gameWith([BOARD[0], BOARD[4]]) });
  const { container } = render(<SideShelf playerIdx={0} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30)); // the lookups have answered
  });
  expect(container.querySelector('.bf-side')).toBeNull();
});

test('a card the player put there by hand is on it whatever its type; one moved to the field is not', async () => {
  useAppStore.setState({
    game: gameWith([
      { ...BOARD[0], row: 'side' }, // a creature kept small
      { ...BOARD[2], row: 'field' }, // an enchantment kept up with the creatures
    ]),
  });
  const { container } = render(<SideShelf playerIdx={0} />);
  await waitFor(() => expect(container.querySelectorAll('.bf-side .vcard')).toHaveLength(1));
  expect(screen.getByRole('button', { name: 'tap Grizzly Bears' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Rhystic Study/ })).not.toBeInTheDocument();
});

test('a tracker seat has no shelf', () => {
  const { container } = render(<SideShelf playerIdx={1} />);
  expect(container).toBeEmptyDOMElement();
});
