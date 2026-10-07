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

test('a transient DB failure is not cached — the next mount retries and heals', async () => {
  const { getCardById } = await import('../data/scryfall');
  vi.mocked(getCardById).mockRejectedValueOnce(new Error('DatabaseClosedError')); // mount 1: DB hiccup
  vi.mocked(getCardById).mockResolvedValueOnce(bolt); // mount 2: DB healthy again
  const flaky = [{ cardId: 'c-flaky', name: 'No Such Name' }];

  const first = renderHook(() => useCardRecords(flaky));
  // The rejection must leave the id unresolved, not poison it as null.
  await waitFor(() => expect(vi.mocked(getCardById)).toHaveBeenCalledWith('c-flaky'));
  first.unmount();

  const second = renderHook(() => useCardRecords(flaky));
  await waitFor(() => expect(second.result.current['c-flaky']?.id).toBe('c-bolt')); // retried, healed
});

test('a caller that cannot go on without an answer may ask again without remounting', async () => {
  const { getCardById } = await import('../data/scryfall');
  vi.mocked(getCardById).mockClear();
  vi.mocked(getCardById).mockRejectedValueOnce(new Error('DatabaseClosedError'));
  vi.mocked(getCardById).mockResolvedValueOnce(bolt);
  const stuck = [{ cardId: 'c-stuck', name: 'No Such Name' }];

  const { result, rerender } = renderHook(({ retry }) => useCardRecords(stuck, retry), {
    initialProps: { retry: 0 },
  });
  await waitFor(() => expect(vi.mocked(getCardById)).toHaveBeenCalledWith('c-stuck'));
  expect('c-stuck' in result.current).toBe(false); // not answered: neither a record nor a miss
  rerender({ retry: 0 }); // the same question is not asked twice
  expect(vi.mocked(getCardById)).toHaveBeenCalledTimes(1);
  rerender({ retry: 1 });
  await waitFor(() => expect(result.current['c-stuck']?.id).toBe('c-bolt'));
});
