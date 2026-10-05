import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { addCard, changeCardCount, createDeck, setCommander } from '../lib/deck';
import type { CardRecord, Deck } from '../lib/types';
import { useAppStore } from '../state/store';
import DeckEditor from './DeckEditor';

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

const elves: CardRecord = {
  ...ashaya,
  id: 'c-elves',
  name: 'Llanowar Elves',
  nameLower: 'llanowar elves',
  typeLine: 'Creature — Elf Druid',
  manaCost: '{G}',
  oracleText: '{T}: Add {G}.',
};

const bolt: CardRecord = {
  ...ashaya,
  id: 'c-bolt',
  name: 'Lightning Bolt',
  nameLower: 'lightning bolt',
  typeLine: 'Instant',
  manaCost: '{R}',
  oracleText: 'Lightning Bolt deals 3 damage to any target.',
  colorIdentity: ['R'],
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
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(
    async (id: string) =>
      (({ 'c-ashaya': ashaya, 'c-elves': elves, 'c-forest': forest }) as Record<string, CardRecord>)[
        id
      ],
  ),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

function sampleDeck(): Deck {
  let deck = setCommander({ ...createDeck('Stompy'), id: 'deck-1' }, ashaya);
  deck = addCard(deck, elves);
  deck = addCard(deck, forest);
  deck = changeCardCount(deck, 'c-forest', 7); // 8 forests
  return deck;
}

beforeEach(() => {
  useAppStore.setState({
    decks: [sampleDeck()],
    saveDeck: vi.fn(async (d: Deck) => {
      const others = useAppStore.getState().decks.filter((x) => x.id !== d.id);
      useAppStore.setState({ decks: [d, ...others] });
    }),
    deleteDeck: vi.fn(async () => {}),
  });
});

test('shows type groups, counts, and the running total with commander', () => {
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  expect(screen.getByText('Creatures')).toBeInTheDocument();
  expect(screen.getByText('Lands')).toBeInTheDocument();
  expect(screen.getByText('10 / 100')).toBeInTheDocument(); // 1 elf + 8 forests + commander
  expect(screen.getByText('Llanowar Elves')).toBeInTheDocument();
});

test('steppers change copy counts through the store', async () => {
  const user = userEvent.setup();
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /one more Forest/i }));
  const deck = useAppStore.getState().decks[0];
  expect(deck.cards.find((c) => c.cardId === 'c-forest')?.count).toBe(9);
});

test('minus on a single copy removes the card', async () => {
  const user = userEvent.setup();
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /one fewer Llanowar Elves/i }));
  const deck = useAppStore.getState().decks[0];
  expect(deck.cards.some((c) => c.cardId === 'c-elves')).toBe(false);
});

test('renaming saves the deck', async () => {
  const user = userEvent.setup();
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  const input = screen.getByDisplayValue('Stompy');
  await user.clear(input);
  await user.type(input, 'Forest Fury');
  expect(useAppStore.getState().decks[0].name).toBe('Forest Fury');
});

test('the deck health line counts staples from the real card records', async () => {
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  expect(await screen.findByText('Lands 8/36')).toBeInTheDocument();
  expect(screen.getByText('Ramp 1/10')).toBeInTheDocument();
});

test('off-color cards wear a warning', () => {
  const deck = { ...sampleDeck(), cards: [...sampleDeck().cards] };
  const withBolt = addCard(deck, bolt);
  useAppStore.setState({ decks: [withBolt] });
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  expect(screen.getByLabelText(/Lightning Bolt is outside commander colors/i)).toBeInTheDocument();
});

test('the commander offers synergy browsing', () => {
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  expect(screen.getByRole('button', { name: /goes well with/i })).toBeInTheDocument();
});

test('delete deck asks the store and goes back', async () => {
  const onBack = vi.fn();
  const user = userEvent.setup();
  render(<DeckEditor deckId="deck-1" onBack={onBack} />);
  await user.click(screen.getByRole('button', { name: /delete deck/i }));
  expect(useAppStore.getState().deleteDeck).toHaveBeenCalledWith('deck-1');
  expect(onBack).toHaveBeenCalled();
});
