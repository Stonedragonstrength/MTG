import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createBoardItem } from '../lib/board';
import { createGame } from '../lib/game';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import TokenChips from './TokenChips';

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

function rec(id: string, name: string, typeLine: string, oracleText = '', over: Partial<CardRecord> = {}): CardRecord {
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
    imageArtCrop: `https://img.example/${id}-art.jpg`,
    isToken: false,
    isBasicLand: false,
    ...over,
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-alarm': rec('c-alarm', 'Raise the Alarm', 'Instant', 'Create two 1/1 white Soldier creature tokens.'),
  'c-loot': rec('c-loot', 'Unexpected Windfall', 'Instant', 'Create two Treasure tokens.'),
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear'),
  'c-copy': rec('c-copy', 'Cackling Counterpart', 'Instant', "Create a token that's a copy of target creature you control."),
};

const TOKENS: CardRecord[] = [
  rec('t-soldier-rw', 'Soldier', 'Token Creature — Soldier', '', { isToken: true, power: '1', toughness: '1', colors: ['R', 'W'] }),
  rec('t-soldier', 'Soldier', 'Token Creature — Soldier', '', { isToken: true, power: '1', toughness: '1', colors: ['W'] }),
  rec('t-treasure', 'Treasure', 'Token Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.', { isToken: true }),
];

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
  findCardsNamed: vi.fn(async (name: string) => TOKENS.filter((t) => t.nameLower === name.toLowerCase())),
}));

const card = (iid: string, cardId: string): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name });

/** Seat 0's deck, spread over its zones: the chips read every card it was dealt. */
function game(over: { library?: CardInstance[]; hand?: CardInstance[]; graveyard?: CardInstance[] } = {}): GameState {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: {
      library: over.library ?? [card('l1', 'c-alarm'), card('l2', 'c-bear')],
      hand: over.hand ?? [card('h1', 'c-bear')],
      battlefield: [],
      graveyard: over.graveyard ?? [card('g1', 'c-loot')],
      exile: [],
      command: [],
      mulligans: 0,
      deckName: 'Tokens',
    },
  };
  return g;
}

beforeEach(() => {
  useAppStore.setState({ game: game(), online: null, addItem: vi.fn(), changeCount: vi.fn() });
});

test('there is one chip for each token the seat’s deck makes, wherever those cards are now', async () => {
  render(<TokenChips playerIdx={0} />);
  expect(await screen.findByRole('button', { name: 'make a Soldier token' })).toBeInTheDocument(); // from the library
  expect(screen.getByRole('button', { name: 'make a Treasure token' })).toBeInTheDocument(); // from the graveyard
  expect(screen.getAllByRole('button', { name: /^make a /i })).toHaveLength(2);
});

test('a tap makes one: the token the text names, in its right colors', async () => {
  const user = userEvent.setup();
  render(<TokenChips playerIdx={0} />);
  await user.click(await screen.findByRole('button', { name: 'make a Soldier token' }));
  const addItem = useAppStore.getState().addItem as ReturnType<typeof vi.fn>;
  expect(addItem).toHaveBeenCalledTimes(1);
  expect(addItem.mock.calls[0][0]).toBe(0);
  // The white 1/1, not the red-white one of the same name.
  expect(addItem.mock.calls[0][1]).toMatchObject({ cardId: 't-soldier', name: 'Soldier', count: 1, zone: 'board' });
});

test('one more of a token already on the board joins its stack', async () => {
  const g = game();
  const stack = { ...createBoardItem(TOKENS[1]), id: 'soldiers', count: 2 };
  const countered = { ...createBoardItem(TOKENS[1]), id: 'big-soldier', counters: { p1p1: 1 } };
  g.players[0] = { ...g.players[0], board: [countered, stack] };
  useAppStore.setState({ game: g });
  const user = userEvent.setup();
  render(<TokenChips playerIdx={0} />);
  await user.click(await screen.findByRole('button', { name: 'make a Soldier token' }));
  // The plain stack grows; the one somebody put a counter on is its own thing.
  expect(useAppStore.getState().changeCount).toHaveBeenCalledWith(0, 'soldiers', 1);
  expect(useAppStore.getState().addItem).not.toHaveBeenCalled();
});

test('a deck that makes no tokens has no such group at all', async () => {
  useAppStore.setState({
    game: game({ library: [card('l1', 'c-bear')], graveyard: [card('g1', 'c-copy')] }),
  });
  const { container } = render(<TokenChips playerIdx={0} />);
  await new Promise((r) => setTimeout(r, 30)); // the lookups have answered
  expect(screen.queryByRole('button', { name: /^make a /i })).not.toBeInTheDocument();
  expect(container).toBeEmptyDOMElement();
});

test('the chips are a group of the list, under a heading, and making one says so', async () => {
  const onMade = vi.fn();
  const user = userEvent.setup();
  render(<TokenChips playerIdx={0} onMade={onMade} />);
  const chip = await screen.findByRole('button', { name: 'make a Treasure token' });
  expect(screen.getByText('This deck makes')).toBeInTheDocument();
  expect(chip).toHaveTextContent('Treasure');
  await user.click(chip);
  expect(useAppStore.getState().addItem).toHaveBeenCalledTimes(1);
  expect(onMade).toHaveBeenCalledTimes(1); // the list it was picked from closes
});
