import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { CardRecord, GarageCard } from '../lib/types';
import { useAppStore } from '../state/store';
import GarageScreen from './GarageScreen';

const records: Record<string, Partial<CardRecord>> = {
  bolt: { colorIdentity: ['R'], manaCost: '{R}', priceUsd: 1 },
  sol: { colorIdentity: [], manaCost: '{1}', priceUsd: 2.5 },
  elves: { colorIdentity: ['G'], manaCost: '{G}' },
  hoof: { colorIdentity: ['G'], manaCost: '{5}{G}{G}{G}' },
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) =>
    records[id]
      ? ({
          id,
          name: id,
          nameLower: id,
          typeLine: 'x',
          oracleText: '',
          power: null,
          toughness: null,
          colors: [],
          imageNormal: null,
          imageArtCrop: null,
          isToken: false,
          isBasicLand: false,
          manaCost: records[id].manaCost ?? '',
          colorIdentity: records[id].colorIdentity,
          priceUsd: records[id].priceUsd ?? null,
        } as CardRecord)
      : undefined,
  ),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

function row(cardId: string, name: string, typeLine: string, count: number): GarageCard {
  return {
    cardId,
    name,
    typeLine,
    imageNormal: `https://img.example/${cardId}.jpg`,
    count,
    updatedAt: 1,
    deleted: false,
    dirty: 0,
  };
}

beforeEach(() => {
  useAppStore.setState({
    garage: [
      row('bolt', 'Lightning Bolt', 'Instant', 4),
      row('sol', 'Sol Ring', 'Artifact', 2),
      row('elves', 'Llanowar Elves', 'Creature — Elf Druid', 1),
      row('hoof', 'Craterhoof Behemoth', 'Creature — Beast', 1),
    ],
    setGarageCount: vi.fn(async () => {}),
  });
});

test('shows totals and full card art grouped by type', () => {
  render(<GarageScreen onBack={() => {}} />);
  expect(screen.getByText(/8 cards · 4 unique/i)).toBeInTheDocument();
  expect(screen.getByText('Creatures')).toBeInTheDocument();
  const art = screen.getByRole('img', { name: 'Lightning Bolt' });
  expect(art).toHaveAttribute('src', 'https://img.example/bolt.jpg');
});

test('prices the collection: total, average, and how much is priced', async () => {
  render(<GarageScreen onBack={() => {}} />);
  // 4 bolts at $1 + 2 sol rings at $2.50 = $9; elves + hoof have no price yet
  expect(await screen.findByText(/\$9\.00/)).toBeInTheDocument();
  expect(screen.getByText(/avg \$1\.50/i)).toBeInTheDocument();
  expect(screen.getByText(/6 of 8 copies priced/i)).toBeInTheDocument();
});

test('a collection with no prices points at the card-data refresh', async () => {
  useAppStore.setState({
    garage: [row('elves', 'Llanowar Elves', 'Creature — Elf Druid', 1)],
  });
  render(<GarageScreen onBack={() => {}} />);
  expect(await screen.findByText(/refresh the card data/i)).toBeInTheDocument();
});

test('the filter narrows the binder', async () => {
  const user = userEvent.setup();
  render(<GarageScreen onBack={() => {}} />);
  await user.type(screen.getByRole('searchbox'), 'sol');
  expect(screen.getByRole('img', { name: 'Sol Ring' })).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Lightning Bolt' })).not.toBeInTheDocument();
});

test('color pips filter to one color identity', async () => {
  const user = userEvent.setup();
  render(<GarageScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /only green cards/i }));
  expect(await screen.findByRole('img', { name: 'Llanowar Elves' })).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Lightning Bolt' })).not.toBeInTheDocument();
});

test('grouping by cost buckets on mana value', async () => {
  const user = userEvent.setup();
  render(<GarageScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /group by cost/i }));
  expect(await screen.findByText('1 mana')).toBeInTheDocument();
});

test('cost works as a second axis inside any grouping', async () => {
  const user = userEvent.setup();
  const { container } = render(<GarageScreen onBack={() => {}} />);
  // Alphabetical default: Craterhoof before Llanowar inside Creatures.
  await screen.findByRole('img', { name: 'Craterhoof Behemoth' });
  const namesBefore = [...container.querySelectorAll('.curation-card img')].map((i) =>
    i.getAttribute('alt'),
  );
  expect(namesBefore.indexOf('Craterhoof Behemoth')).toBeLessThan(
    namesBefore.indexOf('Llanowar Elves'),
  );
  await user.click(screen.getByRole('button', { name: /sort by cost/i }));
  const namesAfter = [...container.querySelectorAll('.curation-card img')].map((i) =>
    i.getAttribute('alt'),
  );
  expect(namesAfter.indexOf('Llanowar Elves')).toBeLessThan(
    namesAfter.indexOf('Craterhoof Behemoth'),
  ); // 1-drop before 8-drop within the same section
});

test('steppers adjust counts through the store', async () => {
  const user = userEvent.setup();
  render(<GarageScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /one more Sol Ring/i }));
  expect(useAppStore.getState().setGarageCount).toHaveBeenCalledWith('sol', 3);
});
