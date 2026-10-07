import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { addCard, createDeck, setCommander } from '../lib/deck';
import type { CardRecord, Deck } from '../lib/types';
import { useAppStore } from '../state/store';
import DecksScreen from './DecksScreen';

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
