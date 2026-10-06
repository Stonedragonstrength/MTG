import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { GarageCard } from '../lib/types';
import { useAppStore } from '../state/store';
import GarageScreen from './GarageScreen';

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => undefined),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

function row(cardId: string, name: string, typeLine: string, count: number): GarageCard {
  return { cardId, name, typeLine, imageNormal: null, count, updatedAt: 1, deleted: false, dirty: 0 };
}

beforeEach(() => {
  useAppStore.setState({
    garage: [
      row('bolt', 'Lightning Bolt', 'Instant', 4),
      row('sol', 'Sol Ring', 'Artifact', 2),
      row('elves', 'Llanowar Elves', 'Creature — Elf Druid', 1),
    ],
    setGarageCount: vi.fn(async () => {}),
  });
});

test('shows the collection grouped by type with a total', () => {
  render(<GarageScreen onBack={() => {}} />);
  expect(screen.getByText(/7 cards/i)).toBeInTheDocument();
  expect(screen.getByText('Creatures')).toBeInTheDocument();
  expect(screen.getByText('Lightning Bolt')).toBeInTheDocument();
});

test('the filter narrows the list', async () => {
  const user = userEvent.setup();
  render(<GarageScreen onBack={() => {}} />);
  await user.type(screen.getByRole('searchbox'), 'sol');
  expect(screen.getByText('Sol Ring')).toBeInTheDocument();
  expect(screen.queryByText('Lightning Bolt')).not.toBeInTheDocument();
});

test('steppers adjust counts through the store', async () => {
  const user = userEvent.setup();
  render(<GarageScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /one more Sol Ring/i }));
  expect(useAppStore.getState().setGarageCount).toHaveBeenCalledWith('sol', 3);
});
