import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import { searchAsk } from '../lib/search';
import type { CardInstance, CardRecord, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import LibrarySearchSheet from './LibrarySearchSheet';

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
  'c-forest': rec('c-forest', 'Forest', 'Basic Land — Forest'),
  'c-island': rec('c-island', 'Island', 'Basic Land — Island'),
  'c-tower': rec('c-tower', 'Command Tower', 'Land'),
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear'),
  'c-bolt': rec('c-bolt', 'Lightning Bolt', 'Instant'),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

const card = (iid: string, cardId: string): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name });

/** The order the cards lie in: the sheet must not show it. */
const LIBRARY = [
  card('l1', 'c-bolt'),
  card('l2', 'c-forest'),
  card('l3', 'c-bear'),
  card('l4', 'c-island'),
  card('l5', 'c-forest'),
  card('l6', 'c-tower'),
];

const STORM = searchAsk({
  name: 'Encroaching Dragonstorm',
  typeLine: 'Enchantment',
  oracleText:
    'When this enchantment enters, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.',
});
const CULTIVATE = searchAsk({
  name: 'Cultivate',
  typeLine: 'Sorcery',
  oracleText:
    'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
});

let searchLibrary: ReturnType<typeof vi.fn>;

beforeEach(() => {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: { library: LIBRARY, hand: [], battlefield: [], graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'Deck' },
  };
  searchLibrary = vi.fn();
  useAppStore.setState({ game: g, online: null, searchLibrary });
});

/** A tap as the board reads it (useLongPress acts on pointer up). */
function tap(el: HTMLElement) {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
}
const tiles = () => screen.getAllByRole('button', { name: /^take / }).map((b) => b.getAttribute('aria-label'));

test('a plain search shows every card once, by name, with how many copies there are', async () => {
  render(<LibrarySearchSheet playerIdx={0} onClose={() => {}} />);
  await screen.findByRole('button', { name: 'take Forest' });
  // Alphabetical: the order they lie in stays secret.
  expect(tiles()).toEqual(['take Command Tower', 'take Forest', 'take Grizzly Bears', 'take Island', 'take Lightning Bolt']);
  expect(screen.getByRole('button', { name: 'take Forest' })).toHaveTextContent('×2');
  expect(screen.getByRole('button', { name: 'take Island' })).not.toHaveTextContent('×');
});

test('a card’s search shows what it asks for first, and the rest is one tap away', async () => {
  const user = userEvent.setup();
  render(<LibrarySearchSheet playerIdx={0} ask={STORM} source="Encroaching Dragonstorm" onClose={() => {}} />);
  await screen.findByText(/Find up to two basic land cards\./);
  // Once the cards are read, only the basic lands are left in view.
  await screen.findByRole('button', { name: 'Basic land cards', pressed: true });
  await vi.waitFor(() => expect(tiles()).toEqual(['take Forest', 'take Island']));
  await new Promise((r) => setTimeout(r, 400)); // the sheet's first moment takes no answer
  await user.click(screen.getByRole('button', { name: 'All cards' }));
  expect(tiles()).toHaveLength(5);
  await user.click(screen.getByRole('button', { name: 'Creatures' }));
  expect(tiles()).toEqual(['take Grizzly Bears']);
  await user.click(screen.getByRole('button', { name: 'All cards' }));
  await user.type(screen.getByRole('searchbox', { name: 'filter by name' }), 'bolt');
  expect(tiles()).toEqual(['take Lightning Bolt']);
});

test('tap the cards, press Done: they go where the card says and the rest is shuffled, in one move', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<LibrarySearchSheet playerIdx={0} ask={STORM} source="Encroaching Dragonstorm" onClose={onClose} />);
  tap(await screen.findByRole('button', { name: 'take Forest' }));
  tap(screen.getByRole('button', { name: 'take Forest' })); // the second copy
  expect(screen.getByRole('button', { name: 'take Forest' })).toBeDisabled(); // none left to take
  const taking = screen.getByRole('list', { name: 'taking' });
  expect(within(taking).getAllByRole('listitem')).toHaveLength(2);
  expect(within(taking).getAllByRole('button', { name: 'Battlefield, tapped', pressed: true })).toHaveLength(2);
  await new Promise((r) => setTimeout(r, 400)); // the sheet's first moment takes no answer
  await user.click(screen.getByRole('button', { name: 'Done · shuffle the rest' }));
  expect(searchLibrary).toHaveBeenCalledWith(
    0,
    [
      { iid: 'l2', to: 'tapped', row: 'lands' },
      { iid: 'l5', to: 'tapped', row: 'lands' },
    ],
    'Encroaching Dragonstorm',
  );
  expect(onClose).toHaveBeenCalledWith(true);
});

test('one to the battlefield and the other to the hand; either can be sent elsewhere, or put back', async () => {
  const user = userEvent.setup();
  render(<LibrarySearchSheet playerIdx={0} ask={CULTIVATE} source="Cultivate" onClose={() => {}} />);
  tap(await screen.findByRole('button', { name: 'take Forest' }));
  tap(screen.getByRole('button', { name: 'take Island' }));
  await new Promise((r) => setTimeout(r, 400)); // the sheet's first moment takes no answer
  await user.click(screen.getByRole('button', { name: 'All cards' }));
  tap(screen.getByRole('button', { name: 'take Grizzly Bears' }));
  expect(screen.getByText('The card says up to 2.')).toBeInTheDocument(); // said, never refused
  await user.click(screen.getByRole('button', { name: 'put Grizzly Bears back' }));
  expect(screen.queryByText('The card says up to 2.')).not.toBeInTheDocument();
  const island = within(screen.getByRole('group', { name: 'where Island goes' }));
  expect(island.getByRole('button', { name: 'Hand', pressed: true })).toBeInTheDocument();
  await user.click(island.getByRole('button', { name: 'Top of library' }));
  await new Promise((r) => setTimeout(r, 400));
  await user.click(screen.getByRole('button', { name: 'Done · shuffle the rest' }));
  expect(searchLibrary).toHaveBeenCalledWith(
    0,
    [
      { iid: 'l2', to: 'tapped', row: 'lands' },
      { iid: 'l4', to: 'top' },
    ],
    'Cultivate',
  );
});

test('a search that finds nothing still shuffles; closing the sheet does not', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<LibrarySearchSheet playerIdx={0} onClose={onClose} />);
  await screen.findByRole('button', { name: 'take Forest' });
  await new Promise((r) => setTimeout(r, 400));
  await user.click(screen.getByRole('button', { name: 'Nothing found · shuffle' }));
  expect(searchLibrary).toHaveBeenCalledWith(0, [], undefined);
  expect(onClose).toHaveBeenCalledWith(true);
});
