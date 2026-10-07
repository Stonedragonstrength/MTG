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
