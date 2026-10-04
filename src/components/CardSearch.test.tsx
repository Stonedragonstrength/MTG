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
  findCardByName: vi.fn(async (name: string) => (name === 'Treasure' ? treasure : undefined)),
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

beforeEach(async () => {
  const { getDb } = await import('../data/db');
  await getDb().kv.clear();
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

test('common token chips add with a single tap and show card art', async () => {
  const user = userEvent.setup();
  render(<CardSearch playerIdx={0} onClose={() => {}} />);
  const chip = await screen.findByRole('button', { name: /^Treasure token$/i });
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => expect(chip.querySelector('img')).toHaveAttribute('src', treasure.imageNormal));
  await user.click(chip);
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

test('a search result can be pinned into the quick token row', async () => {
  const { kvGet } = await import('../data/db');
  const user = userEvent.setup();
  render(<CardSearch playerIdx={0} onClose={() => {}} />);

  await user.type(screen.getByPlaceholderText(/search/i), 'treas');
  await user.click(await screen.findByRole('button', { name: /pin treasure to quick tokens/i }));
  expect(await kvGet('customQuickTokens')).toEqual([{ id: 't1', name: 'Treasure' }]);

  await user.clear(screen.getByPlaceholderText(/search/i));
  expect(await screen.findByRole('button', { name: /treasure \(pinned\)/i })).toBeInTheDocument();
});

test('a pinned quick token adds with one tap and unpins on hold', async () => {
  const { kvSet, kvGet } = await import('../data/db');
  const { fireEvent } = await import('@testing-library/react');
  await kvSet('customQuickTokens', [{ id: 't1', name: 'Treasure' }]);
  const user = userEvent.setup();
  render(<CardSearch playerIdx={0} onClose={() => {}} />);

  const chip = await screen.findByRole('button', { name: /treasure \(pinned\)/i });
  await user.click(chip);
  expect(added).toHaveLength(1);
  expect(added[0].item.name).toBe('Treasure');

  fireEvent.pointerDown(chip);
  await new Promise((r) => setTimeout(r, 650));
  fireEvent.pointerUp(chip);
  await new Promise((r) => setTimeout(r, 50));
  expect(await kvGet('customQuickTokens')).toEqual([]);
});

test('custom tokens can carry evergreen keywords', async () => {
  const user = userEvent.setup();
  render(<CardSearch playerIdx={0} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /custom token/i }));
  await user.type(screen.getByLabelText(/name/i), 'Dragon');
  await user.click(screen.getByRole('button', { name: /^Flying$/ }));
  await user.click(screen.getByRole('button', { name: /^Trample$/ }));
  await user.click(screen.getByRole('button', { name: /create/i }));
  expect(added[0].item.oracleText).toBe('Flying, Trample');
});
