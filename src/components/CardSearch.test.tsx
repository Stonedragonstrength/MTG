import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { BoardItem, CardRecord, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import CardSearch from './CardSearch';

const treasure: CardRecord = {
  id: 't1',
  name: 'Treasure',
  nameLower: 'treasure',
  typeLine: 'Token Artifact — Treasure',
  oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
  manaCost: '',
  power: null,
  toughness: null,
  colors: [],
  imageNormal: 'https://img.example/treasure.jpg',
  imageArtCrop: null,
  isToken: true,
  isBasicLand: false,
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => [
    { id: 't1', name: 'Treasure' },
    { id: 's1', name: 'Sol Ring' },
  ]),
  getCardById: vi.fn(async (id: string) => (id === 't1' ? treasure : undefined)),
}));

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
  ],
};

let added: { playerIdx: number; item: BoardItem }[];

beforeEach(() => {
  added = [];
  useAppStore.setState({
    game: createGame(config),
    addItem: vi.fn((playerIdx: number, item: BoardItem) => {
      added.push({ playerIdx, item });
    }),
  });
});

test('typing finds cards and picking one adds it to the board', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<CardSearch playerIdx={0} onClose={onClose} />);

  await user.type(screen.getByPlaceholderText(/search/i), 'treas');
  const result = await screen.findByRole('button', { name: 'Treasure' });
  await user.click(result);

  expect(added).toHaveLength(1);
  expect(added[0].playerIdx).toBe(0);
  expect(added[0].item.name).toBe('Treasure');
  expect(added[0].item.cardId).toBe('t1');
  expect(onClose).toHaveBeenCalled();
});

test('common token chips add with a single tap', async () => {
  const user = userEvent.setup();
  render(<CardSearch playerIdx={0} onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: /^Treasure token$/i }));
  expect(added).toHaveLength(1);
  expect(added[0].item.name).toBe('Treasure');
});

test('searching in lands mode adds to the lands zone', async () => {
  const user = userEvent.setup();
  render(<CardSearch playerIdx={0} zone="lands" onClose={() => {}} />);
  await user.type(screen.getByPlaceholderText(/search/i), 'treas');
  await user.click(await screen.findByRole('button', { name: 'Treasure' }));
  expect(added[0].item.zone).toBe('lands');
});

test('offers a custom token form', async () => {
  const user = userEvent.setup();
  render(<CardSearch playerIdx={0} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /custom token/i }));
  expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  await user.type(screen.getByLabelText(/name/i), 'Blorbo');
  await user.type(screen.getByLabelText(/power/i), '3');
  await user.type(screen.getByLabelText(/toughness/i), '3');
  await user.click(screen.getByRole('button', { name: /create/i }));
  expect(added).toHaveLength(1);
  expect(added[0].item.name).toBe('Blorbo');
  expect(added[0].item.basePower).toBe(3);
  expect(added[0].item.cardId).toBeNull();
});
