import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { PlayerProfile } from '../lib/types';
import { useAppStore } from '../state/store';
import ProfileEditor from './ProfileEditor';

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => undefined),
}));

const profile: PlayerProfile = {
  id: 'p0',
  name: 'Cinco',
  avatarUrl: null,
  commanderName: 'Magda, Brazen Outlaw',
  commanderColors: ['R'],
  commanderImage: 'https://img.example/magda.jpg',
  commanderHistory: [
    { name: 'Magda, Brazen Outlaw', image: 'https://img.example/magda.jpg', colors: ['R'] },
    { name: 'Atraxa, Praetors’ Voice', image: 'https://img.example/atraxa.jpg', colors: ['W', 'U', 'B', 'G'] },
  ],
};

let saved: PlayerProfile | null;

beforeEach(() => {
  saved = null;
  useAppStore.setState({
    saveProfile: vi.fn(async (p: PlayerProfile) => {
      saved = p;
    }),
  });
});

test('recent commanders show as one-tap chips, excluding the current one', () => {
  render(<ProfileEditor profile={profile} onDone={() => {}} />);
  expect(screen.getByRole('button', { name: /atraxa/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /magda/i })).not.toBeInTheDocument();
});

test('tapping a recent commander switches to it and keeps the old one in history', async () => {
  const user = userEvent.setup();
  render(<ProfileEditor profile={profile} onDone={() => {}} />);

  await user.click(screen.getByRole('button', { name: /atraxa/i }));
  expect(screen.getByText(/atraxa/i)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /^save$/i }));
  expect(saved?.commanderName).toBe('Atraxa, Praetors’ Voice');
  expect(saved?.commanderImage).toBe('https://img.example/atraxa.jpg');
  expect(saved?.commanderColors).toEqual(['W', 'U', 'B', 'G']);
  expect(saved?.commanderHistory?.[0].name).toBe('Atraxa, Praetors’ Voice');
  expect(saved?.commanderHistory?.some((h) => h.name.includes('Magda'))).toBe(true);
});

// ---- deleting a player: it travels to every device now, so it takes a second, deliberate tap ----

/** A tap that happens at a moment of our choosing (ms): the confirm goes by when taps land. */
function tapAt(button: HTMLElement, at: number) {
  const tap = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(tap, 'timeStamp', { value: at });
  fireEvent(button, tap);
}

test('one tap on Delete only asks; a second, deliberate one deletes the player and closes the sheet', async () => {
  const deleteProfile = vi.fn(async () => {});
  const onDone = vi.fn();
  useAppStore.setState({ deleteProfile });
  render(<ProfileEditor profile={profile} onDone={onDone} />);
  const button = screen.getByRole('button', { name: 'Delete' });
  tapAt(button, 5000);
  expect(deleteProfile).not.toHaveBeenCalled(); // one stray tap costs nothing
  expect(onDone).not.toHaveBeenCalled();
  expect(button).toHaveTextContent('Really delete?');

  tapAt(button, 5700); // a beat later, on purpose
  expect(deleteProfile).toHaveBeenCalledWith('p0');
  await waitFor(() => expect(onDone).toHaveBeenCalled());
});

test('a stray double tap on Delete arms it and takes nobody', () => {
  const deleteProfile = vi.fn(async () => {});
  const onDone = vi.fn();
  useAppStore.setState({ deleteProfile });
  render(<ProfileEditor profile={profile} onDone={onDone} />);
  const button = screen.getByRole('button', { name: 'Delete' });
  tapAt(button, 5000);
  tapAt(button, 5150); // the second half of the same double tap
  expect(deleteProfile).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
  expect(button).toHaveTextContent('Really delete?'); // armed, and still asking
});

test('a new player has nothing to delete', () => {
  render(<ProfileEditor profile={null} onDone={() => {}} />);
  expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
});

// ---- the deck a player sits down with ----

const deck = (id: string, name: string) => ({ id, name, commander: null, colors: [], cards: [], updatedAt: 1 });

test('the deck of a player can be chosen from the saved decks and is saved with the player', async () => {
  useAppStore.setState({ decks: [deck('d1', 'Stompy'), deck('d2', 'Burn')] });
  const user = userEvent.setup();
  render(<ProfileEditor profile={profile} onDone={() => {}} />);
  const select = screen.getByLabelText('Deck');
  expect(select).toHaveValue('');
  expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['None', 'Stompy', 'Burn']);
  await user.selectOptions(select, 'd2');
  await user.click(screen.getByRole('button', { name: /^save$/i }));
  expect(saved?.deckId).toBe('d2');
});

test('the attached deck shows as chosen, and "None" takes it off', async () => {
  useAppStore.setState({ decks: [deck('d1', 'Stompy')] });
  const user = userEvent.setup();
  render(<ProfileEditor profile={{ ...profile, deckId: 'd1' }} onDone={() => {}} />);
  expect(screen.getByLabelText('Deck')).toHaveValue('d1');
  await user.selectOptions(screen.getByLabelText('Deck'), '');
  await user.click(screen.getByRole('button', { name: /^save$/i }));
  expect(saved?.deckId).toBeNull();
});

test('an attached deck that no longer exists reads as None and is left as it was on save', async () => {
  useAppStore.setState({ decks: [deck('d1', 'Stompy')] });
  const user = userEvent.setup();
  render(<ProfileEditor profile={{ ...profile, deckId: 'gone' }} onDone={() => {}} />);
  expect(screen.getByLabelText('Deck')).toHaveValue('');
  await user.click(screen.getByRole('button', { name: /^save$/i }));
  expect(saved?.deckId).toBe('gone');
});

test('with no saved decks there is no deck to choose', () => {
  useAppStore.setState({ decks: [] });
  render(<ProfileEditor profile={profile} onDone={() => {}} />);
  expect(screen.queryByLabelText('Deck')).not.toBeInTheDocument();
});

test('editing a player keeps the second commander of their pair; picking another commander lets it go', async () => {
  const paired: PlayerProfile = { ...profile, partnerName: 'Tana, the Bloodsower' };
  const user = userEvent.setup();
  const first = render(<ProfileEditor profile={paired} onDone={() => {}} />);
  await user.clear(screen.getByPlaceholderText('Player name'));
  await user.type(screen.getByPlaceholderText('Player name'), 'Cinco B');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saved).not.toBeNull());
  expect(saved).toMatchObject({ name: 'Cinco B', partnerName: 'Tana, the Bloodsower' });
  first.unmount();

  saved = null;
  render(<ProfileEditor profile={paired} onDone={() => {}} />);
  await user.click(screen.getByRole('button', { name: /switch commander to atraxa/i }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saved).not.toBeNull());
  expect(saved!.commanderName).toBe('Atraxa, Praetors’ Voice');
  expect(saved!.partnerName).toBeUndefined(); // Tana was Magda's partner, not Atraxa's
});
