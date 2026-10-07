import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { getDb } from '../data/db';
import { addCard, createDeck, setCommander } from '../lib/deck';
import type { CardRecord, Deck } from '../lib/types';
import { useAppStore } from '../state/store';
import DecksScreen from './DecksScreen';

// The store's own actions, before any test swaps them for stand-ins.
const real = useAppStore.getState();

const ashaya: CardRecord = {
  id: 'c-ashaya',
  name: 'Ashaya, Soul of the Wild',
  nameLower: 'ashaya, soul of the wild',
  typeLine: 'Legendary Creature — Elemental',
  oracleText: '',
  manaCost: '{3}{G}{G}',
  power: '*',
  toughness: '*',
  colors: ['G'],
  colorIdentity: ['G'],
  imageNormal: 'https://img.example/ashaya.jpg',
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
};

const forest: CardRecord = {
  ...ashaya,
  id: 'c-forest',
  name: 'Forest',
  nameLower: 'forest',
  typeLine: 'Basic Land — Forest',
  manaCost: '',
  isBasicLand: true,
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => [
    { id: 'c-ashaya', name: 'Ashaya, Soul of the Wild' },
    { id: 'c-forest', name: 'Forest' },
  ]),
  getCardById: vi.fn(async (id: string) =>
    id === 'c-ashaya' ? ashaya : id === 'c-forest' ? forest : undefined,
  ),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

function sampleDeck(): Deck {
  let deck = setCommander(createDeck('Stompy'), ashaya);
  deck = addCard(deck, forest);
  return deck;
}

beforeEach(() => {
  useAppStore.setState({
    decks: [],
    saveDeck: vi.fn(async (d: Deck) => {
      const others = useAppStore.getState().decks.filter((x) => x.id !== d.id);
      useAppStore.setState({ decks: [d, ...others] });
    }),
    deleteDeck: vi.fn(async () => {}),
  });
});

test('saved decks show as tiles with commander art and card count', () => {
  useAppStore.setState({ decks: [sampleDeck()] });
  render(<DecksScreen onBack={() => {}} />);
  expect(screen.getByText('Stompy')).toBeInTheDocument();
  expect(screen.getByText(/2 cards/i)).toBeInTheDocument();
});

test('tapping a deck tile opens its editor', async () => {
  useAppStore.setState({ decks: [sampleDeck()] });
  const user = userEvent.setup();
  render(<DecksScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /open deck Stompy/i }));
  expect(screen.getByDisplayValue('Stompy')).toBeInTheDocument();
});

test('start from cards creates a commanderless deck and opens it', async () => {
  const user = userEvent.setup();
  render(<DecksScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /start from cards/i }));
  expect(useAppStore.getState().decks).toHaveLength(1);
  expect(useAppStore.getState().decks[0].commander).toBeNull();
  expect(screen.getByDisplayValue(/untitled deck/i)).toBeInTheDocument();
});

test('new deck flow: pick a commander, deck is created and opened', async () => {
  const user = userEvent.setup();
  render(<DecksScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /new deck/i }));
  await user.type(screen.getByRole('searchbox'), 'ashaya');
  await user.click(await screen.findByRole('button', { name: /ashaya, soul of the wild/i }));
  expect(useAppStore.getState().decks).toHaveLength(1);
  expect(useAppStore.getState().decks[0].commander?.name).toBe('Ashaya, Soul of the Wild');
  expect(screen.getByDisplayValue(/ashaya/i)).toBeInTheDocument();
});

test('a partner deck shows both commanders on its tile and counts them both', async () => {
  const { setPartner } = await import('../lib/deck');
  const partner: CardRecord = {
    ...ashaya,
    id: 'c-partner',
    name: 'Tymna the Weaver',
    nameLower: 'tymna the weaver',
    colorIdentity: ['W', 'B'],
    imageNormal: 'https://img.example/tymna.jpg',
  };
  useAppStore.setState({ decks: [setPartner(sampleDeck(), partner)] });
  const { container } = render(<DecksScreen onBack={() => {}} />);
  const arts = Array.from(container.querySelectorAll('.profile-commander-card')).map((el) =>
    el.getAttribute('src'),
  );
  expect(arts).toEqual(['https://img.example/ashaya.jpg', 'https://img.example/tymna.jpg']);
  expect(screen.getByText('3 cards')).toBeInTheDocument(); // forest + two commanders
});

test('opens straight into a deck when told which one', () => {
  const deck = { ...sampleDeck(), id: 'deck-direct' };
  useAppStore.setState({ decks: [deck] });
  render(<DecksScreen onBack={() => {}} initialOpenId="deck-direct" />);
  expect(screen.getByLabelText('deck name')).toHaveValue('Stompy'); // the editor, not the list
});

// ---- "Recently deleted": a deletion travels to every device, so it needs a way back ----

/** The real store underneath, with nothing saved. */
async function realStore() {
  const db = getDb();
  await Promise.all([db.decks.clear(), db.kv.clear()]);
  useAppStore.setState({
    decks: [],
    saveDeck: real.saveDeck,
    deleteDeck: real.deleteDeck,
    removedDecks: real.removedDecks,
    restoreDeck: real.restoreDeck,
  });
  return useAppStore.getState();
}

test('with nothing deleted there is no shelf', async () => {
  const store = await realStore();
  await store.saveDeck(sampleDeck());
  render(<DecksScreen onBack={() => {}} />);
  await screen.findByText('Stompy');
  expect(screen.queryByText(/recently deleted/i)).not.toBeInTheDocument();
});

test('a deleted deck waits on a shelf under the grid, and Restore brings it back whole', async () => {
  const store = await realStore();
  const deck = sampleDeck();
  await store.saveDeck(deck);
  await store.saveDeck({ ...createDeck('Keeper'), id: 'keeper' });
  await store.deleteDeck(deck.id);

  const user = userEvent.setup();
  const { container } = render(<DecksScreen onBack={() => {}} />);
  const shelf = (await screen.findByRole('heading', { name: /recently deleted/i })).closest('section')!;
  expect(within(shelf).getByText('Stompy')).toBeInTheDocument();
  expect(within(shelf).getByText(/2 cards/)).toBeInTheDocument(); // what would come back
  expect(screen.queryByRole('button', { name: /open deck Stompy/i })).not.toBeInTheDocument();
  // Under the grid, not in it.
  const grid = container.querySelector('.profile-grid')!;
  expect(grid.compareDocumentPosition(shelf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await user.click(within(shelf).getByRole('button', { name: /restore deck Stompy/i }));
  expect(await screen.findByRole('button', { name: /open deck Stompy/i })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(/recently deleted/i)).not.toBeInTheDocument());
  const back = useAppStore.getState().decks.find((d) => d.id === deck.id)!;
  expect(back.commander?.name).toBe('Ashaya, Soul of the Wild');
  expect(back.cards.map((c) => c.name)).toEqual(['Forest']);
});

test('the shelf lists the newest deletion first', async () => {
  const store = await realStore();
  for (const name of ['First gone', 'Then this one']) {
    await store.saveDeck({ ...createDeck(name), id: name });
    await store.deleteDeck(name);
  }
  render(<DecksScreen onBack={() => {}} />);
  const shelf = (await screen.findByRole('heading', { name: /recently deleted/i })).closest('section')!;
  const listed = Array.from(shelf.querySelectorAll('.deck-row-cardname')).map((el) => el.textContent);
  expect(listed).toEqual(['Then this one', 'First gone']);
});

test('a deck deleted on another device shows up on the shelf when the sync lands', async () => {
  const store = await realStore();
  const deck = sampleDeck();
  await store.saveDeck(deck);
  render(<DecksScreen onBack={() => {}} />);
  await screen.findByRole('button', { name: /open deck Stompy/i });
  expect(screen.queryByText(/recently deleted/i)).not.toBeInTheDocument();

  // What a sync leaves behind: the tombstone in the database, then the lists re-read.
  const row = (await getDb().decks.get(deck.id))!;
  await getDb().decks.put({ ...row, deleted: true, updatedAt: row.updatedAt + 1, dirty: 0 });
  await act(() => useAppStore.getState().refreshSynced());
  expect(await screen.findByRole('heading', { name: /recently deleted/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /open deck Stompy/i })).not.toBeInTheDocument();
});

test('a new deck opens in its editor although the save lands a moment later', async () => {
  await realStore();
  const user = userEvent.setup();
  render(<DecksScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /start from cards/i }));
  // The real save is asynchronous: the editor must wait for the deck, not walk away.
  expect(await screen.findByDisplayValue(/untitled deck/i)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Decks' })).not.toBeInTheDocument();
});

test('a deck deleted elsewhere while it is open closes its editor instead of leaving a blank screen', async () => {
  const store = await realStore();
  const deck = sampleDeck();
  await store.saveDeck(deck);
  const user = userEvent.setup();
  render(<DecksScreen onBack={() => {}} />);
  await user.click(await screen.findByRole('button', { name: /open deck Stompy/i }));
  expect(screen.getByLabelText('deck name')).toHaveValue('Stompy');

  const row = (await getDb().decks.get(deck.id))!;
  await getDb().decks.put({ ...row, deleted: true, updatedAt: row.updatedAt + 1, dirty: 0 });
  await act(() => useAppStore.getState().refreshSynced());
  expect(await screen.findByRole('heading', { name: 'Decks' })).toBeInTheDocument(); // back at the list
  expect(screen.queryByLabelText('deck name')).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: /recently deleted/i })).toBeInTheDocument();
});
