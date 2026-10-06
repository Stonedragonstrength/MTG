import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { buildSeatCards, seedSeat } from '../lib/cards';
import { addCard, changeCardCount, createDeck, setCommander } from '../lib/deck';
import { createGame } from '../lib/game';
import type { CardRecord, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import HandTray from './HandTray';

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

function rec(id: string, name: string, typeLine: string): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText: '',
    manaCost: '{1}',
    power: null,
    toughness: null,
    colors: [],
    colorIdentity: ['G'],
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-cmd': rec('c-cmd', 'Ashaya', 'Legendary Creature — Elemental'),
  'c-forest': rec('c-forest', 'Forest', 'Basic Land — Forest'),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

function seededGame() {
  let deck = setCommander(createDeck('Stompy'), RECORDS['c-cmd']);
  deck = addCard(deck, RECORDS['c-forest']);
  deck = changeCardCount(deck, 'c-forest', 10);
  const g = createGame(config);
  return seedSeat(g, 0, buildSeatCards(deck, 42));
}

beforeEach(() => {
  useAppStore.setState({
    game: seededGame(),
    online: null,
    playCard: vi.fn(async () => {}),
    mulliganSeat: vi.fn(),
  });
});

test('the tray fans from a pill and a tap plays the card', async () => {
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 7 cards/i }));
  const first = useAppStore.getState().game!.players[0].cards!.hand[0];
  const buttons = await screen.findAllByRole('button', { name: `play ${first.name}` });
  await user.click(buttons[0]); // render order mirrors hand order
  expect(useAppStore.getState().playCard).toHaveBeenCalledWith(0, first.iid);
});

test('turn one offers a mulligan', async () => {
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 7 cards/i }));
  await user.click(screen.getByRole('button', { name: /mulligan/i }));
  expect(useAppStore.getState().mulliganSeat).toHaveBeenCalledWith(0);
});
