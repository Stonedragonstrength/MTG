import { renderHook, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { CardRecord } from '../lib/types';
import { useCardRecords } from './useCardRecords';

const bolt: CardRecord = {
  id: 'c-bolt',
  name: 'Lightning Bolt',
  nameLower: 'lightning bolt',
  typeLine: 'Instant',
  oracleText: '',
  manaCost: '{R}',
  power: null,
  toughness: null,
  colors: ['R'],
  colorIdentity: ['R'],
  imageNormal: 'https://img.example/bolt.jpg',
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => (id === 'c-bolt' ? bolt : undefined)),
  findCardByName: vi.fn(async (name: string) =>
    name.toLowerCase() === 'renamed bolt' ? bolt : undefined,
  ),
  findBasicLand: vi.fn(async () => undefined),
}));

test('resolves by id, falls back to name, and nulls the hopeless', async () => {
  const { result } = renderHook(() =>
    useCardRecords([
      { cardId: 'c-bolt', name: 'Lightning Bolt' },
      { cardId: 'c-moved', name: 'Renamed Bolt' }, // printing drift: id miss, name hit
      { cardId: 'c-ghost', name: 'Never Printed' },
    ]),
  );
  await waitFor(() => expect(result.current['c-ghost']).toBeNull());
  expect(result.current['c-bolt']?.imageNormal).toBe('https://img.example/bolt.jpg');
  expect(result.current['c-moved']?.id).toBe('c-bolt'); // rescued via name
});
