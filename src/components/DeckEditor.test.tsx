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
  oracleText: 'Whenever a land enters the battlefield under your control, draw a card.',
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
  oracleText: 'Whenever a land enters the battlefield, untap Llanowar Elves.',
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
  oracleText: '', // not ashaya's — a basic has no themes
  manaCost: '',
  isBasicLand: true,
};

const PARTNER_TEXT = 'Partner (You can have two commanders if both have partner.)';

const thrasios: CardRecord = {
  ...ashaya,
  id: 'c-thrasios',
  name: 'Thrasios, Triton Hero',
  nameLower: 'thrasios, triton hero',
  typeLine: 'Legendary Creature — Merfolk Wizard',
  oracleText: PARTNER_TEXT,
  colorIdentity: ['G', 'U'],
};

const tymna: CardRecord = {
  ...ashaya,
  id: 'c-tymna',
  name: 'Tymna the Weaver',
  nameLower: 'tymna the weaver',
  typeLine: 'Legendary Creature — Human Cleric',
  // a landfall line too, so the partner brings themes of its own
  oracleText: `${PARTNER_TEXT}\nWhenever a land enters the battlefield under your control, draw a card.`,
  colorIdentity: ['W', 'B'],
};

vi.mock('../data/synergy', () => ({
  findCommandersFor: vi.fn(async () => []),
  findSynergiesFor: vi.fn(async () => []),
  findPartnersFor: vi.fn(async () => [tymna]),
}));

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(
    async (id: string) =>
      ((
        {
          'c-ashaya': ashaya,
          'c-elves': elves,
          'c-forest': forest,
          'c-thrasios': thrasios,
          'c-tymna': tymna,
        }
      ) as Record<string, CardRecord>)[id],
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

test('a partner commander offers the second slot, and picking fills it', async () => {
  const pair = setCommander({ ...createDeck('Pair'), id: 'deck-2' }, thrasios);
  useAppStore.setState({ decks: [pair] });
  const user = userEvent.setup();
  render(<DeckEditor deckId="deck-2" onBack={() => {}} />);
  await user.click(await screen.findByRole('button', { name: /add partner/i }));
  // every legal partner is listed without typing
  await user.click(await screen.findByRole('button', { name: /tymna the weaver/i }));
  const saved = useAppStore.getState().decks.find((d) => d.id === 'deck-2')!;
  expect(saved.partner?.name).toBe('Tymna the Weaver');
  expect([...saved.colors].sort()).toEqual(['B', 'G', 'U', 'W']);
  expect(await screen.findByText('2 / 100')).toBeInTheDocument(); // both commanders count
  expect(screen.getByText('Tymna the Weaver')).toBeInTheDocument();
});

test('the partner can be removed again', async () => {
  const { setPartner } = await import('../lib/deck');
  const pair = setPartner(setCommander({ ...createDeck('Pair'), id: 'deck-2' }, thrasios), tymna);
  useAppStore.setState({ decks: [pair] });
  const user = userEvent.setup();
  render(<DeckEditor deckId="deck-2" onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /remove partner/i }));
  const saved = useAppStore.getState().decks.find((d) => d.id === 'deck-2')!;
  expect(saved.partner).toBeNull();
  expect([...saved.colors].sort()).toEqual(['G', 'U']);
});

test('stars weigh the partner as well as the commander', async () => {
  const { setPartner } = await import('../lib/deck');
  let pair = setPartner(setCommander({ ...createDeck('Pair'), id: 'deck-2' }, thrasios), tymna);
  pair = addCard(pair, elves); // landfall: matches the partner, not the commander
  useAppStore.setState({ decks: [pair] });
  render(<DeckEditor deckId="deck-2" onBack={() => {}} />);
  expect(await screen.findByLabelText(/stars for Llanowar Elves/i)).toBeInTheDocument();
});

test('an ordinary commander shows no partner slot', async () => {
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  await screen.findByText('Elf Druid'); // the card records are in
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.queryByRole('button', { name: /add partner/i })).not.toBeInTheDocument();
});

test('rows wear their subtype next to the name', () => {
  const { container } = render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  expect(screen.getByText('Elf Druid')).toBeInTheDocument();
  // Forest's subtype renders too (its group header says Lands, the row says Forest)
  const typeTags = Array.from(container.querySelectorAll('.deck-row-type')).map(
    (el) => el.textContent,
  );
  expect(typeTags).toContain('Forest');
});

test('card art rides the rows and the toggle hides it', async () => {
  const user = userEvent.setup();
  const { container } = render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  expect(container.querySelectorAll('.deck-row-art').length).toBeGreaterThan(0); // on by default
  await user.click(screen.getByRole('button', { name: /card art/i }));
  expect(container.querySelectorAll('.deck-row-art')).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: /card art/i }));
  expect(container.querySelectorAll('.deck-row-art').length).toBeGreaterThan(0);
});

test('the deck search counts what you already added', async () => {
  const user = userEvent.setup();
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  const box = screen.getByRole('searchbox', { name: /find in deck/i });
  await user.type(box, 'fore');
  expect(screen.getByText(/in the deck: 8 copies \(1 card\)/i)).toBeInTheDocument();
  expect(screen.queryByText('Llanowar Elves')).not.toBeInTheDocument(); // filtered out
  await user.clear(box);
  await user.type(box, 'sol ring');
  expect(screen.getByText(/not in this deck yet/i)).toBeInTheDocument();
});

test('the deck search recognizes the commander', async () => {
  const user = userEvent.setup();
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  await user.type(screen.getByRole('searchbox', { name: /find in deck/i }), 'ashaya');
  expect(screen.getByText(/your commander/i)).toBeInTheDocument();
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
  expect(screen.getByText('Ramp 0/10')).toBeInTheDocument();
});

test('off-color cards wear a warning', () => {
  const deck = { ...sampleDeck(), cards: [...sampleDeck().cards] };
  const withBolt = addCard(deck, bolt);
  useAppStore.setState({ decks: [withBolt] });
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  expect(screen.getByLabelText(/Lightning Bolt is outside commander colors/i)).toBeInTheDocument();
});

test('composition shows color counts and star ratings against the commander', async () => {
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  expect(await screen.findByLabelText(/9 green cards/i)).toBeInTheDocument();
  expect(await screen.findByLabelText(/5 stars for Llanowar Elves/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/stars for Forest/i)).not.toBeInTheDocument();
  expect(screen.getByText(/made of/i)).toBeInTheDocument();
});

test('align commander opens the suggestion sheet', async () => {
  const user = userEvent.setup();
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /align commander/i }));
  expect(await screen.findByText(/who wants to lead/i)).toBeInTheDocument();
});

test('the commander offers synergy browsing', () => {
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  expect(screen.getByRole('button', { name: /goes well with/i })).toBeInTheDocument();
});

test('send to curation tops up instead of double-counting', async () => {
  // 5 of the 8 Forests are already logged; only the gap should be added.
  await useAppStore.getState().addToGarage(
    { id: 'c-forest', name: 'Forest', typeLine: 'Basic Land — Forest', imageNormal: null },
    5,
  );
  const user = userEvent.setup();
  render(<DeckEditor deckId="deck-1" onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /send to curation/i }));
  expect(await screen.findByText(/added 5.*already there/i)).toBeInTheDocument();
  const garage = useAppStore.getState().garage;
  expect(garage.find((g) => g.name === 'Forest')?.count).toBe(8); // max, not 13
  expect(garage.some((g) => g.name === 'Ashaya, Soul of the Wild')).toBe(true);
  expect(garage.find((g) => g.name === 'Llanowar Elves')?.count).toBe(1);
});

test('delete deck asks the store and goes back', async () => {
  const onBack = vi.fn();
  const user = userEvent.setup();
  render(<DeckEditor deckId="deck-1" onBack={onBack} />);
  await user.click(screen.getByRole('button', { name: /delete deck/i }));
  expect(useAppStore.getState().deleteDeck).toHaveBeenCalledWith('deck-1');
  expect(onBack).toHaveBeenCalled();
});
