import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import { _resetBackStack } from './lib/backstack';
import { createGame } from './lib/game';
import type { Deck, GameConfig } from './lib/types';
import { useAppStore } from './state/store';

// Hosting and joining an online table through the REAL app and store; only the network is
// stood in for. (The sheet's own tests cannot see the screens swap under it.)

vi.mock('./data/cloud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data/cloud')>()),
  getCloudConfig: vi.fn(async () => ({ url: 'https://x.supabase.co', anonKey: 'k' })),
  signedInEmail: vi.fn(async () => 'nathan@example.com'),
}));

vi.mock('./data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => undefined),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
  importBulkData: vi.fn(async () => 0),
}));

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: [
    { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  ],
};

vi.mock('./data/onlineTable', () => ({
  GAME_SCHEMA: 2,
  bindTable: vi.fn(),
  resumeTable: vi.fn(async () => null),
  hostTable: vi.fn(async () => ({ code: 'KQ7M2X' })),
  joinTable: vi.fn(async () => ({ state: createGame(config) })),
  leaveTable: vi.fn(async () => {}),
  endTableForEveryone: vi.fn(async () => {}),
  setMySeat: vi.fn(),
  getMySeat: vi.fn(() => null),
  onLocalMutation: vi.fn(),
  onLocalUndo: vi.fn(),
}));

const stompy: Deck = {
  id: 'deck-1',
  name: 'Stompy',
  commander: null,
  colors: [],
  cards: [
    {
      cardId: 'forest',
      name: 'Forest',
      typeLine: 'Basic Land — Forest',
      manaCost: '',
      imageNormal: null,
      count: 12,
      colorIdentity: [],
    },
  ],
  updatedAt: 1,
};

const realInit = useAppStore.getState().init;

beforeEach(() => {
  _resetBackStack();
  useAppStore.setState({
    // Boot straight to home: the card database is "already downloaded".
    init: async () => {
      useAppStore.setState({ setupDone: true });
    },
    game: null,
    inGame: false,
    online: null,
    decks: [stompy],
    profiles: [],
  });
});

afterEach(() => {
  useAppStore.setState({ init: realInit, game: null, inGame: false, online: null, decks: [] });
});

async function joinFromHome(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /join table/i }));
  await user.type(screen.getByPlaceholderText('KQ7M2X'), 'kq7m2x');
  await user.click(screen.getByRole('button', { name: /^join$/i }));
}

test('joining from home asks which seat is yours, then sits you at the table', async () => {
  const user = userEvent.setup();
  await joinFromHome(user);
  expect(await screen.findByText(/which seat is you/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  expect(useAppStore.getState().online?.mySeat).toBe(1);
});

test('a joiner at a cards table brings a deck and lands in the game with a hand', async () => {
  const user = userEvent.setup();
  await joinFromHome(user);
  await user.click(await screen.findByRole('button', { name: 'Sam' }));
  expect(await screen.findByText(/bring a deck/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Stompy' }));

  const state = useAppStore.getState();
  expect(state.inGame).toBe(true);
  expect(state.game?.players[1].cards?.hand).toHaveLength(7);
  expect(state.game?.players[1].cards?.library).toHaveLength(5);
  expect(screen.queryByText(/bring a deck/i)).not.toBeInTheDocument(); // the game screen took over
});

test('hosting a cards table from home opens the game with the chosen deck dealt', async () => {
  useAppStore.setState({
    saveProfile: vi.fn(async () => {}),
    profiles: [
      { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
    ],
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /new game/i }));
  await user.click(await screen.findByRole('radio', { name: /online/i }));
  await user.click(screen.getByRole('checkbox', { name: /virtual cards/i }));
  await user.click(screen.getByRole('button', { name: 'Nathan' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.selectOptions(screen.getByLabelText(/deck for Nathan/i), 'deck-1');
  await user.click(screen.getByRole('button', { name: /start game/i }));

  // The game replaces the setup screen, and the deck is dealt after the swap.
  expect(await screen.findByRole('button', { name: /online table/i })).toHaveTextContent('KQ7M2X');
  await vi.waitFor(() => expect(useAppStore.getState().game?.players[0].cards?.hand).toHaveLength(7));
  expect(useAppStore.getState().game?.players[1].cards).toBeUndefined(); // Sam brings their own
  expect(useAppStore.getState().inGame).toBe(true);
});

test('skipping every question still lands in the game', async () => {
  const user = userEvent.setup();
  await joinFromHome(user);
  await user.click(await screen.findByRole('button', { name: /skip/i }));
  expect(useAppStore.getState().inGame).toBe(true);
  expect(useAppStore.getState().online?.mySeat).toBeNull();
});
