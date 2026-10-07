import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { resolveDeckList } from '../data/import';
import { createDeck } from '../lib/deck';
import type { CardRecord, Deck } from '../lib/types';
import { useAppStore } from '../state/store';
import PasteListSheet from './PasteListSheet';

const solRing: CardRecord = {
  id: 'c-sol',
  name: 'Sol Ring',
  nameLower: 'sol ring',
  typeLine: 'Artifact',
  oracleText: '',
  manaCost: '{1}',
  power: null,
  toughness: null,
  colors: [],
  colorIdentity: [],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
};

const lathril: CardRecord = {
  ...solRing,
  id: 'c-lathril',
  name: 'Lathril, Blade of the Elves',
  nameLower: 'lathril, blade of the elves',
  typeLine: 'Legendary Creature — Elf Noble',
  colorIdentity: ['B', 'G'],
};

vi.mock('../data/import', () => ({
  resolveDeckList: vi.fn(async () => ({
    hits: [
      { card: lathril, count: 1, commander: true },
      { card: solRing, count: 1, commander: false },
    ],
    misses: ['1 Totally Fake Card'],
  })),
}));

beforeEach(() => {
  const deck: Deck = { ...createDeck('Pasted'), id: 'deck-1' };
  useAppStore.setState({
    decks: [deck],
    saveDeck: vi.fn(async (d: Deck) => {
      useAppStore.setState({ decks: [d] });
    }),
  });
});

test('importing applies cards and commander, and reports misses', async () => {
  const user = userEvent.setup();
  render(<PasteListSheet deckId="deck-1" onClose={() => {}} />);
  await user.type(screen.getByRole('textbox'), '1 Lathril *CMDR*{enter}1 Sol Ring');
  await user.click(screen.getByRole('button', { name: /import/i }));
  expect(await screen.findByText(/added 2/i)).toBeInTheDocument();
  expect(screen.getByText(/1 Totally Fake Card/)).toBeInTheDocument();
  const deck = useAppStore.getState().decks[0];
  expect(deck.commander?.name).toBe('Lathril, Blade of the Elves');
  expect(deck.cards.find((c) => c.name === 'Sol Ring')?.count).toBe(1);
  // Pasted cards are owned cards: they land in the garage too.
  expect(useAppStore.getState().garage.some((g) => g.name === 'Sol Ring')).toBe(true);
});

test('a list with two commanders seats the pair instead of dropping one', async () => {
  const partnerText = 'Partner (You can have two commanders if both have partner.)';
  const thrasios: CardRecord = {
    ...lathril,
    id: 'c-thrasios',
    name: 'Thrasios, Triton Hero',
    nameLower: 'thrasios, triton hero',
    oracleText: partnerText,
    colorIdentity: ['G', 'U'],
  };
  const tymna: CardRecord = {
    ...lathril,
    id: 'c-tymna',
    name: 'Tymna the Weaver',
    nameLower: 'tymna the weaver',
    oracleText: partnerText,
    colorIdentity: ['W', 'B'],
  };
  vi.mocked(resolveDeckList).mockResolvedValueOnce({
    hits: [
      { card: thrasios, count: 1, commander: true },
      { card: tymna, count: 1, commander: true },
      { card: solRing, count: 1, commander: false },
    ],
    misses: [],
  });
  const user = userEvent.setup();
  render(<PasteListSheet deckId="deck-1" onClose={() => {}} />);
  await user.type(screen.getByRole('textbox'), 'a pair');
  await user.click(screen.getByRole('button', { name: /import/i }));
  expect(await screen.findByText(/added 3 cards/i)).toBeInTheDocument();
  const deck = useAppStore.getState().decks[0];
  expect(deck.commander?.name).toBe('Thrasios, Triton Hero');
  expect(deck.partner?.name).toBe('Tymna the Weaver');
  expect([...deck.colors].sort()).toEqual(['B', 'G', 'U', 'W']);
});
