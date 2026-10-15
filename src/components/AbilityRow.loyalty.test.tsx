import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldCardSheet from './BattlefieldCardSheet';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: [
    { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  ],
};

const NALAAR: CardRecord = {
  id: 'c-nalaar',
  name: 'Chandra Nalaar',
  nameLower: 'chandra nalaar',
  typeLine: 'Legendary Planeswalker — Chandra',
  oracleText: '+1: Chandra Nalaar deals 1 damage to target player or planeswalker.\n−X: Chandra Nalaar deals X damage to target creature.',
  manaCost: '',
  power: null,
  toughness: null,
  colors: [],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
  loyalty: '6',
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => NALAAR),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

function table(walker: Partial<CardInstance>): GameState {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: {
      library: [],
      hand: [],
      battlefield: [{ iid: 'c1', cardId: 'c-nalaar', name: 'Chandra Nalaar', counters: { loyalty: 6 }, ...walker }],
      graveyard: [],
      exile: [],
      command: [],
      mulligans: 0,
      deckName: 'Test',
    },
  };
  return g;
}

const activateAbility = vi.fn(async () => {});
beforeEach(() => {
  activateAbility.mockClear();
  useAppStore.setState({ online: null, activateAbility });
});

test('a walker that used a loyalty ability this turn says so on its rows, and can still be used anyway', async () => {
  const g = table({ loyaltyUsed: { turn: 1, active: 0 } });
  useAppStore.setState({ game: g });
  render(<BattlefieldCardSheet playerIdx={0} iid="c1" onClose={() => {}} />);
  const row = (await screen.findByText('Chandra Nalaar deals 1 damage to target player or planeswalker.')).closest('.ability-row') as HTMLElement;
  expect(row).toHaveClass('ability-row--used');
  const use = within(row).getByRole('button', { name: 'Used this turn · use anyway' });
  fireEvent.click(use);
  expect(activateAbility).toHaveBeenCalledWith(0, 'c1', '0:loyalty', {});
});

test('a stamp from another turn is no use at all', async () => {
  useAppStore.setState({ game: table({ loyaltyUsed: { turn: 0, active: 1 } }) });
  render(<BattlefieldCardSheet playerIdx={0} iid="c1" onClose={() => {}} />);
  const row = (await screen.findByText('Chandra Nalaar deals 1 damage to target player or planeswalker.')).closest('.ability-row') as HTMLElement;
  expect(row).not.toHaveClass('ability-row--used');
  expect(within(row).getByRole('button', { name: 'Use' })).toBeInTheDocument();
});
