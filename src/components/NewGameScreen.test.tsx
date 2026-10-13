import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Deck, GameConfig, PlayerProfile } from '../lib/types';
import { useAppStore } from '../state/store';
import NewGameScreen from './NewGameScreen';

vi.mock('../data/cloud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/cloud')>()),
  getCloudConfig: vi.fn(async () => ({ url: 'https://x.supabase.co', anonKey: 'k' })),
  signedInEmail: vi.fn(async () => 'nathan@example.com'),
}));

const profiles: PlayerProfile[] = [
  { id: 'p0', name: 'Nate', avatarUrl: null, commanderName: null },
  { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  { id: 'p2', name: 'Alex', avatarUrl: null, commanderName: null },
];

let startedWith: GameConfig | null;

beforeEach(() => {
  startedWith = null;
  useAppStore.setState({
    profiles,
    decks: [],
    saveProfile: vi.fn(async () => {}),
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

test('Play on the tablet deals the chosen decks after a local start', async () => {
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
  await user.click(screen.getByRole('radio', { name: /play on the tablet/i }));
  await user.selectOptions(screen.getByLabelText(/deck for Nate/i), 'deck-1');
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.mode).toBe('cards');
  expect(seedSeatFromDeck).toHaveBeenCalledWith(0, deck);
});

test('going back to the Assistant and Standard leaves no hidden deck game behind', async () => {
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
  await user.click(screen.getByRole('radio', { name: /play on the tablet/i }));
  await user.selectOptions(screen.getByLabelText(/deck for Nate/i), 'deck-1');
  await user.click(screen.getByRole('radio', { name: /assistant/i })); // mind changed
  await user.click(screen.getByRole('radio', { name: /standard/i }));
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.mode).toBeUndefined(); // no hidden cards-mode standard game
  expect(seedSeatFromDeck).not.toHaveBeenCalled();
});

test('a partner deck carries both commanders into the game so damage can be tracked per commander', async () => {
  const card = (cardId: string, name: string) => ({
    cardId,
    name,
    typeLine: 'Legendary Creature',
    manaCost: '',
    imageNormal: null,
    count: 1,
  });
  useAppStore.setState({
    saveProfile: vi.fn(async () => {}),
    decks: [
      { id: 'pair', name: 'Pair', commander: card('c1', 'Thrasios'), partner: card('c2', 'Tymna'), colors: ['G', 'U', 'W', 'B'], cards: [], updatedAt: 1 },
      { id: 'solo', name: 'Solo', commander: card('c3', 'Ashaya'), colors: ['G'], cards: [], updatedAt: 1 },
    ],
  });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.selectOptions(screen.getByLabelText(/deck for Nate/i), 'pair');
  await user.selectOptions(screen.getByLabelText(/deck for Sam/i), 'solo');
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.profiles[0]).toMatchObject({ commanderName: 'Thrasios', partnerName: 'Tymna' });
  expect(startedWith?.profiles[1].commanderName).toBe('Ashaya');
  expect(startedWith?.profiles[1].partnerName ?? null).toBeNull(); // a solo deck clears any old partner
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

test('leaving while the table is still being created calls the hosting off', async () => {
  let answer: (value: null) => void = () => {};
  const hostOnlineGame = vi.fn(
    (_config: unknown, _stillWanted?: () => boolean) =>
      new Promise<null>((resolve) => (answer = resolve)),
  );
  const seedSeatFromDeck = vi.fn();
  useAppStore.setState({
    hostOnlineGame,
    seedSeatFromDeck,
    decks: [{ id: 'd1', name: 'Stompy', commander: null, colors: [], cards: [], updatedAt: 1 }],
  });
  const user = userEvent.setup();
  const { unmount } = render(<NewGameScreen onBack={() => {}} />);
  await user.click(await screen.findByRole('radio', { name: /online/i }));
  await user.click(screen.getByRole('radio', { name: /play on the tablet/i }));
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.selectOptions(screen.getByLabelText(/deck for Nate/i), 'd1');
  await user.click(screen.getByRole('button', { name: /start game/i }));
  const stillWanted = hostOnlineGame.mock.calls[0][1]!;
  expect(stillWanted()).toBe(true);

  unmount(); // back to home while "Opening table…" is still up
  expect(stillWanted()).toBe(false);
  await act(async () => answer(null));
  // Nothing was hosted, so no deck may be dealt into whatever game is saved here.
  expect(seedSeatFromDeck).not.toHaveBeenCalled();
});

test('a device that is not signed in is pointed at Settings → Cloud sync', async () => {
  const cloud = await import('../data/cloud');
  vi.mocked(cloud.signedInEmail).mockResolvedValueOnce(null);
  render(<NewGameScreen onBack={() => {}} />);
  expect(screen.getByText(/sign in under Settings → Cloud sync first/)).toBeInTheDocument();
  expect(screen.queryByText(/curation cloud sync/i)).not.toBeInTheDocument();
});

test('a picked player who goes away while the screen is open (a sync took them) is simply not seated', async () => {
  useAppStore.setState({
    saveProfile: vi.fn(async () => {}),
    decks: [{ id: 'd1', name: 'Stompy', commander: null, colors: [], cards: [], updatedAt: 1 }],
  });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Nate' }));
  await user.click(screen.getByRole('button', { name: 'Sam' }));
  await user.click(screen.getByRole('button', { name: 'Alex' }));
  expect(screen.getByLabelText(/deck for Sam/i)).toBeInTheDocument();

  // Sam was deleted on another device, or turned out to be a player the cloud already had.
  act(() => useAppStore.setState({ profiles: profiles.filter((p) => p.id !== 'p1') }));
  expect(screen.queryByLabelText(/deck for Sam/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/deck for Alex/i)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.profiles.map((p) => p.id)).toEqual(['p0', 'p2']);
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

// ---- Assistant or Play on the tablet: one clear choice, and a deck that stays with its player ----

const card = (cardId: string, name: string) => ({
  cardId,
  name,
  typeLine: 'Legendary Creature',
  manaCost: '',
  imageNormal: null,
  count: 1,
});
const stompy: Deck = { id: 'stompy', name: 'Stompy', commander: card('c-ash', 'Ashaya'), colors: ['G'], cards: [], updatedAt: 1 };
const burn: Deck = { id: 'burn', name: 'Burn', commander: card('c-mag', 'Magda'), colors: ['R'], cards: [], updatedAt: 1 };

async function seat(user: ReturnType<typeof userEvent.setup>, ...names: string[]) {
  for (const name of names) await user.click(screen.getByRole('button', { name }));
}

test('the screen opens on the Assistant, with the two ways to play spelled out', () => {
  useAppStore.setState({ decks: [stompy] });
  render(<NewGameScreen onBack={() => {}} />);
  expect(screen.getByRole('radio', { name: /assistant/i })).toBeChecked();
  expect(screen.getByRole('radio', { name: /play on the tablet/i })).not.toBeChecked();
  expect(screen.getByText(/real cards on the table/i)).toBeInTheDocument();
  expect(screen.getByText(/shuffled, dealt and played on screen/i)).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

test('with no saved decks, Play on the tablet is off and says to build a deck first', () => {
  render(<NewGameScreen onBack={() => {}} />);
  expect(screen.getByRole('radio', { name: /play on the tablet/i })).toBeDisabled();
  expect(screen.getByText('Build a deck first (Home → Decks).')).toBeInTheDocument();
});

test('an Assistant game is a plain tracker game: no decks dealt', async () => {
  const seedSeatFromDeck = vi.fn();
  useAppStore.setState({ decks: [stompy], seedSeatFromDeck, saveProfile: vi.fn(async () => {}) });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await seat(user, 'Nate', 'Sam');
  await user.selectOptions(screen.getByLabelText(/commander deck for Nate/i), 'stompy');
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.mode).toBeUndefined();
  expect(startedWith?.profiles[0].commanderName).toBe('Ashaya');
  expect(seedSeatFromDeck).not.toHaveBeenCalled();
});

test('in the Assistant the empty deck choice reads "No deck", never the name of the commander', async () => {
  useAppStore.setState({
    decks: [stompy],
    profiles: [{ ...profiles[0], commanderName: 'Atraxa' }, profiles[1], profiles[2]],
  });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await seat(user, 'Nate', 'Sam');
  const select = screen.getByLabelText(/commander deck for Nate/i);
  expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['No deck', 'Stompy']);
});

test('Play on the tablet hides the format and plays Commander', async () => {
  useAppStore.setState({ decks: [stompy], seedSeatFromDeck: vi.fn(), saveProfile: vi.fn(async () => {}) });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('radio', { name: /standard/i }));
  await user.click(screen.getByRole('radio', { name: /play on the tablet/i }));
  expect(screen.queryByRole('radio', { name: /standard/i })).not.toBeInTheDocument();
  expect(screen.getByLabelText(/commander damage/i)).toBeInTheDocument();
  await seat(user, 'Nate', 'Sam');
  await user.selectOptions(screen.getByLabelText(/deck for Nate/i), 'stompy');
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith).toMatchObject({ format: 'commander', startingLife: 40, mode: 'cards' });
});

test('on the tablet a seat can stay with real cards, and at least one deck must be picked', async () => {
  const seedSeatFromDeck = vi.fn();
  useAppStore.setState({ decks: [stompy, burn], seedSeatFromDeck, saveProfile: vi.fn(async () => {}) });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('radio', { name: /play on the tablet/i }));
  await seat(user, 'Nate', 'Sam');
  const select = screen.getByLabelText(/deck for Sam/i);
  expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
    'Stompy',
    'Burn',
    'No deck — real cards (assistant seat)',
  ]);
  expect(select).toHaveValue('');
  expect(screen.getByRole('button', { name: /start game/i })).toBeDisabled();
  expect(screen.getByText('Pick a deck for at least one player.')).toBeInTheDocument();

  await user.selectOptions(select, 'burn');
  expect(screen.queryByText('Pick a deck for at least one player.')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(seedSeatFromDeck).toHaveBeenCalledTimes(1);
  expect(seedSeatFromDeck).toHaveBeenCalledWith(1, burn); // Nate's seat stays a tracker seat
});

test('the deck attached to a player is already chosen, in either way of playing', async () => {
  const seedSeatFromDeck = vi.fn();
  const saveProfile = vi.fn(async () => {});
  useAppStore.setState({
    decks: [stompy, burn],
    seedSeatFromDeck,
    saveProfile,
    profiles: [{ ...profiles[0], deckId: 'burn' }, { ...profiles[1], deckId: 'gone-deck' }, profiles[2]],
  });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await seat(user, 'Nate', 'Sam');
  expect(screen.getByLabelText(/commander deck for Nate/i)).toHaveValue('burn');
  expect(screen.getByLabelText(/commander deck for Sam/i)).toHaveValue(''); // a deleted deck is nobody's deck

  await user.click(screen.getByRole('radio', { name: /play on the tablet/i }));
  expect(screen.getByLabelText(/deck for Nate/i)).toHaveValue('burn');
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(seedSeatFromDeck).toHaveBeenCalledTimes(1);
  expect(seedSeatFromDeck).toHaveBeenCalledWith(0, burn);
  expect(startedWith?.profiles[0].commanderName).toBe('Magda');
  // Sam chose nothing: the profile is left alone, old deck id and all.
  expect(saveProfile).toHaveBeenCalledTimes(1);
  expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'p0', deckId: 'burn', commanderName: 'Magda' }));
});

test('starting a game attaches each chosen deck to its player, in one save each', async () => {
  const saveProfile = vi.fn(async () => {});
  useAppStore.setState({
    decks: [stompy, burn, { id: 'bare', name: 'No commander yet', commander: null, colors: [], cards: [], updatedAt: 1 }],
    seedSeatFromDeck: vi.fn(),
    saveProfile,
  });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('radio', { name: /play on the tablet/i }));
  await seat(user, 'Nate', 'Sam', 'Alex');
  await user.selectOptions(screen.getByLabelText(/deck for Nate/i), 'stompy');
  await user.selectOptions(screen.getByLabelText(/deck for Sam/i), 'bare');
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(saveProfile).toHaveBeenCalledTimes(2); // Alex picked nothing
  expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'p0', deckId: 'stompy', commanderName: 'Ashaya' }));
  expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', deckId: 'bare', commanderName: null }));
});

test('a player whose deck and commander are already theirs is not saved again', async () => {
  const saveProfile = vi.fn(async () => {});
  useAppStore.setState({
    decks: [stompy],
    saveProfile,
    profiles: [
      { ...profiles[0], deckId: 'stompy', commanderName: 'Ashaya', partnerName: null, commanderColors: ['G'], commanderImage: null },
      profiles[1],
    ],
  });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await seat(user, 'Nate', 'Sam');
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.profiles[0].commanderName).toBe('Ashaya');
  expect(saveProfile).not.toHaveBeenCalled();
});

test('choosing "No deck" over a pre-filled deck takes the deck off the player', async () => {
  const saveProfile = vi.fn(async () => {});
  useAppStore.setState({
    decks: [stompy],
    saveProfile,
    profiles: [{ ...profiles[0], deckId: 'stompy', commanderName: 'Ashaya' }, profiles[1]],
  });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await seat(user, 'Nate', 'Sam');
  await user.selectOptions(screen.getByLabelText(/commander deck for Nate/i), '');
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(saveProfile).toHaveBeenCalledTimes(1);
  expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'p0', deckId: null, commanderName: 'Ashaya' }));
});

test('a Standard game in the Assistant has no deck choices and leaves attached decks alone', async () => {
  const saveProfile = vi.fn(async () => {});
  useAppStore.setState({
    decks: [stompy],
    saveProfile,
    profiles: [{ ...profiles[0], deckId: 'stompy' }, profiles[1]],
  });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('radio', { name: /standard/i }));
  await seat(user, 'Nate', 'Sam');
  expect(screen.queryByLabelText(/deck for Nate/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.profiles[0].commanderName).toBeNull();
  expect(saveProfile).not.toHaveBeenCalled();
});

test('a chosen deck that a sync deletes while the screen is open is no longer chosen', async () => {
  const seedSeatFromDeck = vi.fn();
  useAppStore.setState({ decks: [stompy, burn], seedSeatFromDeck, saveProfile: vi.fn(async () => {}) });
  const user = userEvent.setup();
  render(<NewGameScreen onBack={() => {}} />);
  await user.click(screen.getByRole('radio', { name: /play on the tablet/i }));
  await seat(user, 'Nate', 'Sam');
  await user.selectOptions(screen.getByLabelText(/deck for Nate/i), 'stompy');
  act(() => useAppStore.setState({ decks: [burn] }));
  expect(screen.getByLabelText(/deck for Nate/i)).toHaveValue('');
  expect(screen.getByRole('button', { name: /start game/i })).toBeDisabled();

  // The last deck goes too: nothing is left to play on the tablet, so it is the Assistant again.
  act(() => useAppStore.setState({ decks: [] }));
  expect(screen.getByRole('radio', { name: /assistant/i })).toBeChecked();
  await user.click(screen.getByRole('button', { name: /start game/i }));
  expect(startedWith?.mode).toBeUndefined();
  expect(seedSeatFromDeck).not.toHaveBeenCalled();
});
