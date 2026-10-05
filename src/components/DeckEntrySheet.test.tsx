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

const elementalToken: CardRecord = {
  ...ashaya,
  id: 'c-elemental-token',
  name: 'Elemental',
  nameLower: 'elemental',
  typeLine: 'Token Creature — Elemental',
  manaCost: '',
  isToken: true,
};

const lightningElemental: CardRecord = {
  ...ashaya,
  id: 'c-lightning-elemental',
  name: 'Lightning Elemental',
  nameLower: 'lightning elemental',
  typeLine: 'Creature — Elemental',
  manaCost: '{3}{R}',
  colorIdentity: ['R'],
};

const solRing: CardRecord = {
  ...ashaya,
  id: 'c-solring',
  name: 'Sol Ring',
  nameLower: 'sol ring',
  typeLine: 'Artifact',
  manaCost: '{1}',
  colorIdentity: [],
};

const swords: CardRecord = {
  ...ashaya,
  id: 'c-swords',
  name: 'Swords to Plowshares',
  nameLower: 'swords to plowshares',
  typeLine: 'Instant',
  manaCost: '{W}',
  colorIdentity: ['W'],
};

const forest: CardRecord = {
  ...ashaya,
  id: 'c-forest',
  name: 'Forest',
  nameLower: 'forest',
  typeLine: 'Basic Land — Forest',
  manaCost: '',
  isBasicLand: true,
  colorIdentity: [],
};

const BY_ID: Record<string, CardRecord> = {
  'c-forest': forest,
  'c-ashaya': ashaya,
  'c-cultivate': cultivate,
  'c-elemental-token': elementalToken,
  'c-lightning-elemental': lightningElemental,
  'c-solring': solRing,
  'c-swords': swords,
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => [
    { id: 'c-cultivate', name: 'Cultivate' },
    { id: 'c-ashaya', name: 'Ashaya, Soul of the Wild' },
    { id: 'c-elemental-token', name: 'Elemental' },
    { id: 'c-lightning-elemental', name: 'Lightning Elemental' },
  ]),
  getCardById: vi.fn(async (id: string) => BY_ID[id]),
  findCardByName: vi.fn(async (name: string) =>
    Object.values(BY_ID).find((c) => c.nameLower === name.toLowerCase()),
  ),
  findBasicLand: vi.fn(async (name: string) => (name === 'Forest' ? forest : undefined)),
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

test('token cards never appear; real cards show their type line', async () => {
  const user = userEvent.setup();
  render(<DeckEntrySheet deckId="deck-1" onClose={() => {}} />);
  await user.type(screen.getByRole('searchbox'), 'elemental');
  expect(await screen.findByRole('button', { name: /lightning elemental/i })).toBeInTheDocument();
  expect(screen.getByText(/creature — elemental/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^elemental$/i })).not.toBeInTheDocument();
});

test('staple categories offer in-color staples for one-tap adding', async () => {
  const user = userEvent.setup();
  render(<DeckEntrySheet deckId="deck-1" onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /mana rocks/i }));
  await user.click(await screen.findByRole('button', { name: /sol ring/i }));
  expect(await screen.findByText('2 / 100')).toBeInTheDocument();
  expect(useAppStore.getState().decks[0].cards[0]?.name).toBe('Sol Ring');
});

test('off-color staples stay hidden', async () => {
  const user = userEvent.setup();
  render(<DeckEntrySheet deckId="deck-1" onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /removal/i }));
  await screen.findByRole('button', { name: /beast within/i }).catch(() => {});
  expect(screen.queryByRole('button', { name: /swords to plowshares/i })).not.toBeInTheDocument();
});

test('basics add with one tap and show a live count', async () => {
  const user = userEvent.setup();
  render(<DeckEntrySheet deckId="deck-1" onClose={() => {}} />);
  const forestBtn = screen.getByRole('button', { name: /add forest/i });
  await user.click(forestBtn);
  await user.click(forestBtn);
  expect(await screen.findByText('3 / 100')).toBeInTheDocument(); // commander + 2 forests
  const deck = useAppStore.getState().decks[0];
  expect(deck.cards.find((c) => c.name === 'Forest')?.count).toBe(2);
  expect(screen.getByText('×2')).toBeInTheDocument();
});

test('paste list and scan open their sheets; scanning explains itself without a camera', async () => {
  const user = userEvent.setup();
  render(<DeckEntrySheet deckId="deck-1" onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /paste list/i }));
  expect(screen.getByRole('textbox')).toBeInTheDocument();
  const closes = screen.getAllByRole('button', { name: /close/i });
  await user.click(closes[closes.length - 1]);
  await user.click(screen.getByRole('button', { name: /scan/i }));
  expect(await screen.findByText(/no camera here/i)).toBeInTheDocument();
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
