import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { _debugBackStack, _resetBackStack } from '../lib/backstack';
import { useAppStore } from '../state/store';
import HomeScreen from './HomeScreen';

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => undefined),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
  importBulkData: vi.fn(async () => 0),
}));

vi.mock('../data/synergy', () => ({
  findCommandersFor: vi.fn(async () => [
    {
      card: {
        id: 'ashaya',
        name: 'Ashaya, Soul of the Wild',
        nameLower: 'ashaya, soul of the wild',
        typeLine: 'Legendary Creature — Elemental',
        oracleText: '',
        manaCost: '{3}{G}{G}',
        power: null,
        toughness: null,
        colors: ['G'],
        colorIdentity: ['G'],
        imageNormal: null,
        imageArtCrop: null,
        isToken: false,
        isBasicLand: false,
      },
      score: 9,
      shared: ['ramp'],
    },
  ]),
  findSynergiesFor: vi.fn(async () => []),
  findPartnersFor: vi.fn(async () => []),
}));

vi.mock('../data/cloud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/cloud')>()),
  getCloudConfig: vi.fn(async () => ({ url: 'https://x.supabase.co', anonKey: 'k' })),
  signedInEmail: vi.fn(async () => 'nathan@example.com'),
}));

beforeEach(() => {
  useAppStore.setState({
    game: null,
    profiles: [
      {
        id: 'p0',
        name: 'Cinco',
        avatarUrl: null,
        commanderName: 'Magda, Brazen Outlaw',
        commanderColors: ['R'],
        commanderImage: 'https://img.example/magda.jpg',
      },
    ],
  });
});

test('a cloud-ready device offers Join table from home', async () => {
  const user = userEvent.setup();
  render(<HomeScreen />);
  await user.click(await screen.findByRole('button', { name: /join table/i }));
  expect(await screen.findByPlaceholderText('KQ7M2X')).toBeInTheDocument();
});

test('settings open straight from the home screen', async () => {
  const user = userEvent.setup();
  render(<HomeScreen />);
  await user.click(screen.getByRole('button', { name: /settings/i }));
  expect(await screen.findByRole('heading', { name: /settings/i })).toBeInTheDocument();
});

test('a player tile shows their chosen commander card', () => {
  render(<HomeScreen />);
  const img = screen.getByAltText('Magda, Brazen Outlaw');
  expect(img).toHaveAttribute('src', 'https://img.example/magda.jpg');
  expect(screen.getByText('Cinco')).toBeInTheDocument();
});

test('Curation → What can I build? → a pick lands in the new deck’s editor', async () => {
  useAppStore.setState({
    decks: [],
    garage: [
      {
        cardId: 'elves',
        name: 'Llanowar Elves',
        typeLine: 'Creature — Elf Druid',
        imageNormal: null,
        count: 2,
        updatedAt: 1,
        deleted: false,
        dirty: 0,
      },
    ],
  });
  const user = userEvent.setup();
  render(<HomeScreen />);
  await user.click(screen.getByRole('button', { name: /curation/i }));
  await user.click(await screen.findByRole('button', { name: /what can i build/i }));
  await user.click(await screen.findByRole('button', { name: /start a deck with Ashaya/i }));
  // straight into the editor for the deck that was just started
  expect(await screen.findByLabelText('deck name')).toHaveValue('Ashaya, Soul of the Wild');
  expect(useAppStore.getState().decks[0].commander?.name).toBe('Ashaya, Soul of the Wild');
});

/** Home → Curation → What can I build? → pick: lands in the new deck's editor. */
async function startDeckFromCuration(user: ReturnType<typeof userEvent.setup>) {
  useAppStore.setState({
    decks: [],
    garage: [
      {
        cardId: 'elves',
        name: 'Llanowar Elves',
        typeLine: 'Creature — Elf Druid',
        imageNormal: null,
        count: 2,
        updatedAt: 1,
        deleted: false,
        dirty: 0,
      },
    ],
  });
  render(<HomeScreen />);
  await user.click(screen.getByRole('button', { name: /curation/i }));
  await user.click(await screen.findByRole('button', { name: /what can i build/i }));
  await user.click(await screen.findByRole('button', { name: /start a deck with Ashaya/i }));
  await screen.findByLabelText('deck name');
  await backStackSettled();
}

/** Screens swap in a beat; nobody presses Back inside it. Wait until every
 * open layer has its history entry before pressing. */
const backStackSettled = () =>
  vi.waitFor(() => {
    const s = _debugBackStack();
    expect(s.inFlight || s.settlePending || s.ats.some((at) => at === null)).toBe(false);
  });

async function pressBack() {
  act(() => history.back());
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  await backStackSettled();
}

test('Back from a deck started in the Curation goes to the deck list, like any other deck', async () => {
  _resetBackStack();
  const user = userEvent.setup();
  await startDeckFromCuration(user);
  await pressBack();
  expect(await screen.findByRole('heading', { name: 'Decks' })).toBeInTheDocument();
  expect(screen.queryByLabelText('deck name')).not.toBeInTheDocument();
});

test('backing all the way out forgets the deck: the Decks tile shows the list again', async () => {
  _resetBackStack();
  const user = userEvent.setup();
  await startDeckFromCuration(user);
  await pressBack(); // editor → deck list
  await screen.findByRole('heading', { name: 'Decks' });
  await pressBack(); // deck list → home
  await user.click(await screen.findByRole('button', { name: /^decks/i }));
  expect(await screen.findByRole('heading', { name: 'Decks' })).toBeInTheDocument();
  expect(screen.queryByLabelText('deck name')).not.toBeInTheDocument();
});
