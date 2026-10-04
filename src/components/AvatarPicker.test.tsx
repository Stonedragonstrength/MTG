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

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => [{ id: 'r1', name: 'Ragavan, Nimble Pilferer' }]),
  getCardById: vi.fn(async (id: string) => (id === 'r1' ? ragavan : undefined)),
}));

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
