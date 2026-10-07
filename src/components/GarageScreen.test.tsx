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
  // legendary cards of three different types, for the tests that add them
  lathril: { colorIdentity: ['B', 'G'], manaCost: '{2}{B}{G}' },
  cradle: { colorIdentity: ['G'], manaCost: '' },
  karn: { colorIdentity: [], manaCost: '{7}' },
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

/** The usual binder plus three legendary cards of different types. */
function addLegends() {
  useAppStore.setState({
    garage: [
      ...useAppStore.getState().garage,
      row('lathril', 'Lathril, Blade of the Elves', 'Legendary Creature — Elf Noble', 1),
      row('cradle', "Gaea's Cradle", 'Legendary Land', 2),
      row('karn', 'Karn Liberated', 'Legendary Planeswalker — Karn', 1),
    ],
  });
}

const LEGENDS_AZ = ["Gaea's Cradle", 'Karn Liberated', 'Lathril, Blade of the Elves'];

/** The binder as it reads top to bottom: each section's title, copies and cards. */
function shelves(container: HTMLElement) {
  return Array.from(container.querySelectorAll('.deck-group:not(.curation-removed)')).map(
    (section) => ({
      title: section.querySelector('.deck-group-title')!.firstChild!.textContent,
      count: section.querySelector('.deck-group-count')!.textContent,
      cards: Array.from(section.querySelectorAll('.curation-card img')).map((img) =>
        img.getAttribute('alt'),
      ),
    }),
  );
}

test('legendary cards have a section of their own, first, whatever their type', async () => {
  addLegends();
  const { container } = render(<GarageScreen onBack={() => {}} />);
  await screen.findByText(/\$9\.00/); // the card data is in
  expect(shelves(container)).toEqual([
    { title: 'Legendaries', count: '4', cards: LEGENDS_AZ }, // copies: the Cradle is a pair
    { title: 'Creatures', count: '2', cards: ['Craterhoof Behemoth', 'Llanowar Elves'] },
    { title: 'Instants', count: '4', cards: ['Lightning Bolt'] },
    { title: 'Artifacts', count: '2', cards: ['Sol Ring'] },
    // no Planeswalkers, no Lands: the only ones here are legendary
  ]);
  // The section took the place of the "★ Legendary" filter: nothing hides the other cards.
  expect(screen.queryByRole('button', { name: /only legendary cards/i })).not.toBeInTheDocument();
});

test('grouping by color or by cost keeps Legendaries first and files only the rest', async () => {
  addLegends();
  const user = userEvent.setup();
  const { container } = render(<GarageScreen onBack={() => {}} />);
  const legends = { title: 'Legendaries', count: '4', cards: LEGENDS_AZ };

  await user.click(screen.getByRole('button', { name: /group by color/i }));
  await screen.findByRole('heading', { name: /^Red/ }); // color identities have loaded
  expect(shelves(container)).toEqual([
    legends, // not split over Multicolor, Colorless and Lands
    { title: 'Red', count: '4', cards: ['Lightning Bolt'] },
    { title: 'Green', count: '2', cards: ['Craterhoof Behemoth', 'Llanowar Elves'] },
    { title: 'Colorless', count: '2', cards: ['Sol Ring'] },
  ]);

  await user.click(screen.getByRole('button', { name: /group by cost/i }));
  expect(shelves(container)).toEqual([
    legends, // not split over 4 mana, 7+ mana and Lands
    { title: '1 mana', count: '7', cards: ['Lightning Bolt', 'Llanowar Elves', 'Sol Ring'] },
    { title: '7+ mana', count: '1', cards: ['Craterhoof Behemoth'] },
  ]);
});

test('A–Z stays one flat list: legendary cards keep their place in the alphabet', async () => {
  addLegends();
  const user = userEvent.setup();
  const { container } = render(<GarageScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: /group by a–z/i }));
  expect(shelves(container)).toEqual([
    {
      title: 'All cards',
      count: '12',
      cards: [
        'Craterhoof Behemoth',
        "Gaea's Cradle",
        'Karn Liberated',
        'Lathril, Blade of the Elves',
        'Lightning Bolt',
        'Llanowar Elves',
        'Sol Ring',
      ],
    },
  ]);
});

test('the text filter and the color pips narrow Legendaries along with everything else', async () => {
  addLegends();
  const user = userEvent.setup();
  const { container } = render(<GarageScreen onBack={() => {}} />);
  await user.type(screen.getByRole('searchbox'), 'elves');
  expect(shelves(container)).toEqual([
    { title: 'Legendaries', count: '1', cards: ['Lathril, Blade of the Elves'] },
    { title: 'Creatures', count: '1', cards: ['Llanowar Elves'] },
  ]);

  await user.clear(screen.getByRole('searchbox'));
  await user.click(screen.getByRole('button', { name: /only green cards/i }));
  await screen.findByRole('img', { name: 'Llanowar Elves' }); // color identities have loaded
  expect(shelves(container)).toEqual([
    { title: 'Legendaries', count: '3', cards: ["Gaea's Cradle", 'Lathril, Blade of the Elves'] },
    { title: 'Creatures', count: '2', cards: ['Craterhoof Behemoth', 'Llanowar Elves'] },
  ]);
});

test('sorting by cost reorders the cards inside Legendaries too', async () => {
  addLegends();
  const user = userEvent.setup();
  const { container } = render(<GarageScreen onBack={() => {}} />);
  const legends = () => shelves(container)[0];
  expect(legends()).toEqual({ title: 'Legendaries', count: '4', cards: LEGENDS_AZ });
  await user.click(screen.getByRole('button', { name: /sort by cost/i }));
  await vi.waitFor(() =>
    // a land costs nothing, Lathril four, Karn seven
    expect(legends().cards).toEqual(["Gaea's Cradle", 'Lathril, Blade of the Elves', 'Karn Liberated']),
  );
});

test('a binder with no legendary cards has no Legendaries section', async () => {
  const { container } = render(<GarageScreen onBack={() => {}} />);
  await screen.findByText(/\$9\.00/); // the card data is in
  expect(shelves(container).map((shelf) => shelf.title)).toEqual(['Creatures', 'Instants', 'Artifacts']);
});
