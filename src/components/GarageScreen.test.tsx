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
    removedGarage: vi.fn(async () => []),
    restoreGarage: vi.fn(async () => {}),
  });
});

/** House long-press idiom: pointer down, wait out the hold, release. */
async function hold(el: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  await user.pointer({ keys: '[MouseLeft>]', target: el });
  await new Promise((r) => setTimeout(r, 650));
  await user.pointer({ keys: '[/MouseLeft]', target: el });
}

test('the binder face carries no bare count or delete controls', () => {
  render(<GarageScreen onBack={() => {}} />);
  expect(screen.queryByRole('button', { name: /one fewer/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /one more/i })).not.toBeInTheDocument();
});

test('holding a card opens manage, where the stepper adjusts counts', async () => {
  const user = userEvent.setup();
  render(<GarageScreen onBack={() => {}} />);
  await hold(screen.getByRole('button', { name: /lightning bolt details/i }), user);
  await user.click(await screen.findByRole('button', { name: /one more lightning bolt/i }));
  expect(useAppStore.getState().setGarageCount).toHaveBeenCalledWith('bolt', 5);
});

test('removing a card demands a confirm first', async () => {
  const user = userEvent.setup();
  render(<GarageScreen onBack={() => {}} />);
  await hold(screen.getByRole('button', { name: /sol ring details/i }), user);
  await user.click(await screen.findByRole('button', { name: /remove from curation/i }));
  expect(useAppStore.getState().setGarageCount).not.toHaveBeenCalled(); // not yet
  await user.click(screen.getByRole('button', { name: /yes, remove/i }));
  expect(useAppStore.getState().setGarageCount).toHaveBeenCalledWith('sol', 0);
});

test('recently removed cards wait with a Restore button', async () => {
  const restoreGarage = vi.fn(async () => {});
  useAppStore.setState({
    removedGarage: vi.fn(async () => [
      { ...row('hoof', 'Craterhoof Behemoth', 'Creature — Beast', 1), deleted: true },
    ]),
    restoreGarage,
  });
  const user = userEvent.setup();
  render(<GarageScreen onBack={() => {}} />);
  expect(await screen.findByText(/recently removed/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /restore craterhoof behemoth/i }));
  expect(restoreGarage).toHaveBeenCalledWith('hoof');
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

test('the manage stepper never drops below one — removal is its own gesture', async () => {
  const user = userEvent.setup();
  render(<GarageScreen onBack={() => {}} />);
  await hold(screen.getByRole('button', { name: /llanowar elves details/i }), user);
  // ×1 card: minus is disabled; only the confirmed Remove can zero it
  expect(await screen.findByRole('button', { name: /one fewer llanowar elves/i })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: /one more llanowar elves/i }));
  expect(useAppStore.getState().setGarageCount).toHaveBeenCalledWith('elves', 2);
});

test('legendary cards are their own choice: one tap shows only them, in every grouping', async () => {
  useAppStore.setState({
    garage: [
      ...useAppStore.getState().garage,
      row('lathril', 'Lathril, Blade of the Elves', 'Legendary Creature — Elf Noble', 1),
      row('cradle', "Gaea's Cradle", 'Legendary Land', 2),
    ],
  });
  const user = userEvent.setup();
  render(<GarageScreen onBack={() => {}} />);
  const chip = screen.getByRole('button', { name: /only legendary cards/i });
  expect(chip).toHaveTextContent('2'); // two legendary cards in the collection
  expect(chip).toHaveAttribute('aria-pressed', 'false');

  await user.click(chip);
  expect(chip).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('img', { name: 'Lathril, Blade of the Elves' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: "Gaea's Cradle" })).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Llanowar Elves' })).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Lightning Bolt' })).not.toBeInTheDocument();
  // still grouped the way the binder is set: a legendary land is a land
  expect(screen.getByRole('heading', { name: /^Creatures/ })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /^Lands/ })).toBeInTheDocument();

  await user.click(chip); // and off again
  expect(screen.getByRole('img', { name: 'Lightning Bolt' })).toBeInTheDocument();
});

test('a collection with no legendary cards says so instead of offering an empty choice', () => {
  render(<GarageScreen onBack={() => {}} />);
  expect(screen.getByRole('button', { name: /only legendary cards/i })).toBeDisabled();
});
