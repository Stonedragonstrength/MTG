import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { addCard, createDeck, setCommander } from '../lib/deck';
import type { CardRecord, Deck } from '../lib/types';
import { useAppStore } from '../state/store';
import CommanderAlignSheet from './CommanderAlignSheet';

const elves: CardRecord = {
  id: 'c-elves',
  name: 'Llanowar Elves',
  nameLower: 'llanowar elves',
  typeLine: 'Creature — Elf Druid',
  oracleText: 'Whenever an Elf you control attacks, add {G}.',
  manaCost: '{G}',
  power: '1',
  toughness: '1',
  colors: ['G'],
  colorIdentity: ['G'],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
};

const lathril: CardRecord = {
  ...elves,
  id: 'c-lathril',
  name: 'Lathril, Blade of the Elves',
  nameLower: 'lathril, blade of the elves',
  typeLine: 'Legendary Creature — Elf Noble',
  oracleText: 'Whenever an Elf you control deals combat damage, create that many Elf tokens.',
  colorIdentity: ['B', 'G'],
  imageNormal: 'https://img.example/lathril.jpg',
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => (id === 'c-elves' ? elves : undefined)),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

vi.mock('../data/synergy', () => ({
  findCommandersFor: vi.fn(async () => [
    { card: lathril, score: 12, shared: ['tribal:Elf', 'tokens'] },
  ]),
}));

beforeEach(() => {
  const deck: Deck = addCard({ ...createDeck('Elfball'), id: 'deck-1' }, elves);
  useAppStore.setState({
    decks: [deck],
    saveDeck: vi.fn(async (d: Deck) => {
      useAppStore.setState({ decks: [d] });
    }),
  });
});

test('suggests commanders with an alignment bar and reasons', async () => {
  render(<CommanderAlignSheet deckId="deck-1" onClose={() => {}} />);
  expect(await screen.findByText('Lathril, Blade of the Elves')).toBeInTheDocument();
  expect(screen.getByText(/tribal:Elf/)).toBeInTheDocument();
  const bar = document.querySelector('.align-bar-fill');
  expect(bar).not.toBeNull();
});

test('crowning a new commander keeps the old one in the deck', async () => {
  const old: CardRecord = {
    ...lathril,
    id: 'c-old',
    name: 'Ezuri, Renegade Leader',
    nameLower: 'ezuri, renegade leader',
    colorIdentity: ['G'],
  };
  const deck = addCard(setCommander({ ...createDeck('Elfball'), id: 'deck-1' }, old), elves);
  useAppStore.setState({ decks: [deck] });
  const user = userEvent.setup();
  render(<CommanderAlignSheet deckId="deck-1" onClose={() => {}} />);
  await user.click(await screen.findByText('Lathril, Blade of the Elves'));
  await vi.waitFor(() =>
    expect(useAppStore.getState().decks[0].commander?.name).toBe('Lathril, Blade of the Elves'),
  );
  expect(useAppStore.getState().decks[0].cards.map((c) => c.name).sort()).toEqual([
    'Ezuri, Renegade Leader',
    'Llanowar Elves',
  ]);
});

test('tapping a suggestion makes it the commander', async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<CommanderAlignSheet deckId="deck-1" onClose={onClose} />);
  await user.click(await screen.findByText('Lathril, Blade of the Elves'));
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  const deck = useAppStore.getState().decks[0];
  expect(deck.commander?.name).toBe('Lathril, Blade of the Elves');
  expect(deck.colors).toEqual(['B', 'G']);
});
