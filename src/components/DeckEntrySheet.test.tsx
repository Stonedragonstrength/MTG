import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createDeck, setCommander } from '../lib/deck';
import type { CardRecord, Deck } from '../lib/types';
import { useAppStore } from '../state/store';
import DeckEntrySheet from './DeckEntrySheet';

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

const cultivate: CardRecord = {
  ...ashaya,
  id: 'c-cultivate',
  name: 'Cultivate',
  nameLower: 'cultivate',
  typeLine: 'Sorcery',
  manaCost: '{2}{G}',
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => [
    { id: 'c-cultivate', name: 'Cultivate' },
    { id: 'c-ashaya', name: 'Ashaya, Soul of the Wild' },
  ]),
  getCardById: vi.fn(async (id: string) =>
    id === 'c-cultivate' ? cultivate : id === 'c-ashaya' ? ashaya : undefined,
  ),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

beforeEach(() => {
  const deck: Deck = setCommander({ ...createDeck('Stompy'), id: 'deck-1' }, ashaya);
  useAppStore.setState({
    decks: [deck],
    saveDeck: vi.fn(async (d: Deck) => {
      useAppStore.setState({ decks: [d] });
    }),
  });
});

test('typing finds cards; picking one adds it, clears the box, bumps the counter', async () => {
  const user = userEvent.setup();
  render(<DeckEntrySheet deckId="deck-1" onClose={() => {}} />);
  expect(screen.getByText('1 / 100')).toBeInTheDocument(); // commander only
  const input = screen.getByRole('searchbox');
  await user.type(input, 'culti');
  await user.click(await screen.findByRole('button', { name: /cultivate/i }));
  expect(await screen.findByText('2 / 100')).toBeInTheDocument();
  expect(input).toHaveValue('');
  expect(screen.getByText(/added cultivate/i)).toBeInTheDocument();
});

test('enter adds the top match', async () => {
  const user = userEvent.setup();
  render(<DeckEntrySheet deckId="deck-1" onClose={() => {}} />);
  await user.type(screen.getByRole('searchbox'), 'culti');
  await screen.findByRole('button', { name: /cultivate/i });
  await user.keyboard('{Enter}');
  expect(await screen.findByText('2 / 100')).toBeInTheDocument();
  const deck = useAppStore.getState().decks[0];
  expect(deck.cards[0]?.name).toBe('Cultivate');
});
