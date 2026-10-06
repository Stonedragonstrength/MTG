import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { useAppStore } from '../state/store';
import HomeScreen from './HomeScreen';

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => undefined),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
  importBulkData: vi.fn(async () => 0),
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
