import { expect, test } from 'vitest';
import { manaCurveByColor } from './deck';
import type { DeckCard } from './types';

const card = (name: string, typeLine: string, manaCost: string, colorIdentity: string[] | undefined, count = 1): DeckCard => ({
  cardId: name,
  name,
  typeLine,
  manaCost,
  imageNormal: null,
  count,
  ...(colorIdentity ? { colorIdentity } : {}),
});

test('each bucket split by color: one color, several (M), none (C), not known (?); lands left out', () => {
  const curve = manaCurveByColor([
    card('Llanowar Elves', 'Creature — Elf Druid', '{G}', ['G'], 2),
    card('Lightning Bolt', 'Instant', '{R}', ['R']),
    card('Sol Ring', 'Artifact', '{1}', []),
    card('Old Card', 'Sorcery', '{1}', undefined),
    card('Lathril', 'Legendary Creature — Elf', '{2}{B}{G}', ['B', 'G']),
    card('Forest', 'Basic Land — Forest', '', ['G'], 30),
    card('Craterhoof Behemoth', 'Creature — Beast', '{5}{G}{G}{G}', ['G']),
  ]);
  expect(curve[1]).toEqual({ G: 2, R: 1, C: 1, '?': 1 });
  expect(curve[4]).toEqual({ M: 1 });
  expect(curve[7]).toEqual({ G: 1 });
  expect(curve[0]).toEqual({});
});
