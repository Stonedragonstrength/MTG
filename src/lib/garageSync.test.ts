import { describe, expect, test } from 'vitest';
import type { GarageCard } from './types';
import { mergeGarage } from './garageSync';

function row(cardId: string, count: number, updatedAt: number, extra: Partial<GarageCard> = {}): GarageCard {
  return {
    cardId,
    name: cardId,
    typeLine: 'Instant',
    imageNormal: null,
    count,
    updatedAt,
    deleted: false,
    dirty: 0,
    ...extra,
  };
}

describe('mergeGarage', () => {
  test('newer side wins per card', () => {
    const { merged, toPush } = mergeGarage(
      [row('bolt', 2, 100, { dirty: 1 }), row('sol', 1, 500)],
      [row('bolt', 5, 900), row('sol', 3, 100)],
    );
    expect(merged.find((r) => r.cardId === 'bolt')).toMatchObject({ count: 5, dirty: 0 });
    expect(merged.find((r) => r.cardId === 'sol')).toMatchObject({ count: 1 });
    expect(toPush.map((r) => r.cardId)).toEqual(['sol']); // local-newer rows go up
  });

  test('cards only known to one side survive', () => {
    const { merged, toPush } = mergeGarage([row('local', 1, 100, { dirty: 1 })], [row('remote', 2, 200)]);
    expect(merged.map((r) => r.cardId).sort()).toEqual(['local', 'remote']);
    expect(toPush.map((r) => r.cardId)).toEqual(['local']);
  });

  test('remote tombstones clear local copies', () => {
    const { merged } = mergeGarage(
      [row('bolt', 4, 100)],
      [row('bolt', 0, 900, { deleted: true })],
    );
    expect(merged[0]).toMatchObject({ cardId: 'bolt', deleted: true });
  });
});
