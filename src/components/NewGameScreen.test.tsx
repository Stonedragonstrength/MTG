import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import NewGameScreen from './NewGameScreen';

vi.mock('../data/cloud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/cloud')>()),
  getCloudConfig: vi.fn(async () => ({ url: 'https://x.supabase.co', anonKey: 'k' })),
  signedInEmail: vi.fn(async () => 'nathan@example.com'),
}));

const profiles = [
  { id: 'p0', name: 'Nate', avatarUrl: null, commanderName: null },
  { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  { id: 'p2', name: 'Alex', avatarUrl: null, commanderName: null },
];

let startedWith: GameConfig | null;

beforeEach(() => {
  startedWith = null;
  useAppStore.setState({
    profiles,
    startGame: vi.fn((config: GameConfig) => {
      startedWith = config;
    }),
  });
});

test('commander game starts with 40 life and threshold 21', async () => {
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.startingLife).toBe(40);
  expect(startedWith?.commanderDamageThreshold).toBe(21);
  expect(startedWith?.profiles.map((p) => p.id)).toEqual(['p0', 'p1']);
});

test('standard game starts with 20 life', async () => {
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('radio', { name: /standard/i }));
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.startingLife).toBe(20);
  expect(startedWith?.format).toBe('standard');
});

test('picking a deck for a player carries its commander into the game', async () => {
  const saveProfile = vi.fn(async () => {});
  useAppStore.setState({
    saveProfile,
    decks: [
      {
        id: 'deck-1',
        name: 'Ashaya Stompy',
        commander: {
          cardId: 'c-ashaya',
          name: 'Ashaya, Soul of the Wild',
          typeLine: 'Legendary Creature — Elemental',
          manaCost: '{3}{G}{G}',
          imageNormal: 'https://img.example/ashaya.jpg',
          count: 1,
        },
        colors: ['G'],
        cards: [],
        updatedAt: 1,
      },
    ],
  });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.selectOptions(screen.getByLabelText(/deck for Nate/i), 'deck-1');
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.profiles[0].commanderName).toBe('Ashaya, Soul of the Wild');
  expect(startedWith?.profiles[0].commanderColors).toEqual(['G']);
  expect(startedWith?.profiles[1].commanderName).toBeNull();
  expect(saveProfile).toHaveBeenCalledTimes(1);
});

test('virtual cards mode seeds chosen decks after a local start', async () => {
  const seedSeatFromDeck = vi.fn();
  const deck = {
    id: 'deck-1',
    name: 'Stompy',
    commander: {
      cardId: 'c-cmd',
      name: 'Ashaya',
      typeLine: 'Legendary Creature — Elemental',
      manaCost: '',
      imageNormal: null,
      count: 1,
    },
    colors: ['G'],
    cards: [],
    updatedAt: 1,
  };
  useAppStore.setState({ decks: [deck], seedSeatFromDeck, saveProfile: vi.fn(async () => {}) });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('checkbox', { name: /virtual cards/i }));
  await user.selectOptions(screen.getByLabelText(/deck for Nate/i), 'deck-1');
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.mode).toBe('cards');
  expect(seedSeatFromDeck).toHaveBeenCalledWith(0, deck);
});

test('switching to Standard disarms a previously ticked Virtual cards box', async () => {
  const seedSeatFromDeck = vi.fn();
  const deck = {
    id: 'deck-1',
    name: 'Stompy',
    commander: {
      cardId: 'c-cmd',
      name: 'Ashaya',
      typeLine: 'Legendary Creature — Elemental',
      manaCost: '',
      imageNormal: null,
      count: 1,
    },
    colors: ['G'],
    cards: [],
    updatedAt: 1,
  };
  useAppStore.setState({ decks: [deck], seedSeatFromDeck, saveProfile: vi.fn(async () => {}) });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('checkbox', { name: /virtual cards/i }));
  await user.selectOptions(screen.getByLabelText(/deck for Nate/i), 'deck-1');
  await user.click(screen.getByRole('radio', { name: /standard/i })); // mind changed
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.mode).toBeUndefined(); // no hidden cards-mode standard game
  expect(seedSeatFromDeck).not.toHaveBeenCalled();
});

test('online mode hosts a table instead of starting locally', async () => {
  const hostOnlineGame = vi.fn(async () => null);
  useAppStore.setState({ hostOnlineGame });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(await screen.findByRole('radio', { name: /online/i }));
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(hostOnlineGame).toHaveBeenCalled();
  expect(startedWith).toBeNull(); // local path untouched
});

test('start is disabled with fewer than 2 players selected', async () => {
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  expect(screen.getByRole('button', { name: /start game/i })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  expect(screen.getByRole('button', { name: /start game/i })).toBeDisabled();
});

test('a nonsense threshold falls back to 21', async () => {
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  const input = screen.getByLabelText(/commander damage/i);
  await user.clear(input);
  await user.type(input, '-3');
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.commanderDamageThreshold).toBe(21);
});

test('the commander damage threshold is adjustable', async () => {
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  const input = screen.getByLabelText(/commander damage/i);
  await user.clear(input);
  await user.type(input, '25');
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.commanderDamageThreshold).toBe(25);
});
