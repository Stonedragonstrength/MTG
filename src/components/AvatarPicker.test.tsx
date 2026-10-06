import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { CardRecord } from '../lib/types';
import AvatarPicker from './AvatarPicker';

const ragavan: CardRecord = {
  id: 'r1',
  name: 'Ragavan, Nimble Pilferer',
  nameLower: 'ragavan, nimble pilferer',
  typeLine: 'Legendary Creature — Monkey Pirate',
  oracleText: '',
  manaCost: '{R}',
  power: '2',
  toughness: '1',
  colors: ['R'],
  imageNormal: 'https://img.example/ragavan.jpg',
  imageArtCrop: 'https://img.example/ragavan-art.jpg',
  isToken: false,
  isBasicLand: false,
};

const impostor: CardRecord = {
  ...ragavan,
  id: 'r2',
  name: 'Ragavan the Unlegendary',
  nameLower: 'ragavan the unlegendary',
  typeLine: 'Creature — Monkey',
  imageNormal: 'https://img.example/impostor.jpg',
  imageArtCrop: 'https://img.example/impostor-art.jpg',
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => [
    { id: 'r1', name: 'Ragavan, Nimble Pilferer' },
    { id: 'r2', name: 'Ragavan the Unlegendary' },
  ]),
  getCardById: vi.fn(async (id: string) =>
    id === 'r1' ? ragavan : id === 'r2' ? impostor : undefined,
  ),
}));

test('a filter keeps non-qualifying cards out of the grid', async () => {
  const { isCommanderLegal } = await import('../lib/game');
  const user = userEvent.setup();
  render(
    <AvatarPicker
      title="Pick commander"
      onPick={() => {}}
      onClose={() => {}}
      filter={isCommanderLegal}
    />,
  );

  await user.type(screen.getByPlaceholderText(/search card names/i), 'ragavan');

  await screen.findByAltText('Ragavan, Nimble Pilferer');
  expect(screen.queryByText('Ragavan the Unlegendary')).not.toBeInTheDocument();
});

test('search results show art previews, and picking returns the card', async () => {
  const onPick = vi.fn();
  const user = userEvent.setup();
  render(<AvatarPicker title="Pick avatar art" onPick={onPick} onClose={() => {}} />);

  await user.type(screen.getByPlaceholderText(/search card names/i), 'ragavan');

  const preview = await screen.findByAltText('Ragavan, Nimble Pilferer');
  expect(preview).toHaveAttribute('src', 'https://img.example/ragavan-art.jpg');

  await user.click(screen.getByRole('button', { name: /ragavan, nimble pilferer/i }));
  expect(onPick).toHaveBeenCalledWith(ragavan);
});

test('suggestions fill the grid before any typing, and a search takes over', async () => {
  const onPick = vi.fn();
  const user = userEvent.setup();
  render(
    <AvatarPicker
      title="Pick partner"
      onPick={onPick}
      onClose={() => {}}
      suggestions={[impostor]}
    />,
  );
  // nothing typed: the caller's shortlist is on show
  await user.click(await screen.findByRole('button', { name: /ragavan the unlegendary/i }));
  expect(onPick).toHaveBeenCalledWith(impostor);

  await user.type(screen.getByPlaceholderText(/search card names/i), 'nimble');
  expect(await screen.findByAltText('Ragavan, Nimble Pilferer')).toBeInTheDocument();
  expect(screen.queryByText('Ragavan the Unlegendary')).not.toBeInTheDocument();
});
