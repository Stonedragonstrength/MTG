import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import type { Deck, DeckCard } from '../lib/types';
import SampleHandSheet from './SampleHandSheet';

const card = (name: string, typeLine: string, count = 1): DeckCard => ({
  cardId: name,
  name,
  typeLine,
  manaCost: '',
  imageNormal: `img/${name}`,
  count,
});

const deck = (cards: DeckCard[]): Deck => ({ id: 'd', name: 'Stompy', commander: null, colors: ['G'], cards, updatedAt: 1 });
const shown = () => screen.getAllByRole('img').length;

test('seven cards, with how many are lands', () => {
  render(<SampleHandSheet deck={deck([card('Forest', 'Basic Land — Forest', 9)])} onClose={() => {}} />);
  expect(shown()).toBe(7);
  expect(screen.getByText(/lands/).closest('p')).toHaveTextContent('7 lands · 0 spells');
  expect(screen.getByText(/2 left in the library/)).toBeInTheDocument();
});

test('Draw a card adds the next one; the library running out stops it', async () => {
  render(<SampleHandSheet deck={deck([card('Forest', 'Basic Land — Forest', 8)])} onClose={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: 'Draw a card' }));
  expect(shown()).toBe(8);
  expect(screen.getByText(/1 drawn/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Draw a card' })).toBeDisabled();
});

test('Mulligan deals seven again and counts; New hand starts the count over', async () => {
  render(
    <SampleHandSheet
      deck={deck([card('Forest', 'Basic Land — Forest', 10), card('Cultivate', 'Sorcery', 10)])}
      onClose={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Draw a card' }));
  await userEvent.click(screen.getByRole('button', { name: 'Mulligan' }));
  expect(shown()).toBe(7);
  expect(screen.getByText(/mulligan 1/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Mulligan' }));
  expect(screen.getByText(/mulligan 2/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'New hand' }));
  expect(screen.queryByText(/mulligan/)).not.toBeInTheDocument();
});

test('a deck with fewer than seven cards shows them all', () => {
  render(<SampleHandSheet deck={deck([card('Forest', 'Basic Land — Forest', 3)])} onClose={() => {}} />);
  expect(shown()).toBe(3);
});
