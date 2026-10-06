import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { buildSeatCards, seedSeat } from '../lib/cards';
import { addCard, changeCardCount, createDeck, setCommander } from '../lib/deck';
import { createGame } from '../lib/game';
import type { CardRecord, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import HandScreen from './HandScreen';

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
  deck = changeCardCount(deck, 'c-forest', 12);
  const g = createGame(config);
  return seedSeat(g, 0, buildSeatCards(deck, 42));
}

beforeEach(() => {
  useAppStore.setState({
    game: seededGame(),
    online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: 0 },
    setHandHeld: vi.fn(),
    playCard: vi.fn(async () => {}),
    mulliganSeat: vi.fn(),
  });
});

test('shows every player at a glance with my hand fanned and my board docked', () => {
  render(<HandScreen seatIdx={0} onShowTable={() => {}} />);
  expect(screen.getByText('Nathan')).toBeInTheDocument();
  expect(screen.getByText('Sam')).toBeInTheDocument();
  expect(screen.getAllByText('40').length).toBeGreaterThanOrEqual(2); // glance lives
  expect(screen.getByText(/✋7/)).toBeInTheDocument(); // my glance counts
  expect(screen.getAllByRole('button', { name: /^play / })).toHaveLength(7); // fanned, no pill tap
  expect(screen.getByRole('button', { name: /library, 6 cards/i })).toBeInTheDocument(); // dock present
});

test('marks the hand as phone-held while open and releases it on leave', () => {
  const { unmount } = render(<HandScreen seatIdx={0} onShowTable={() => {}} />);
  expect(useAppStore.getState().setHandHeld).toHaveBeenCalledWith(0, true);
  unmount();
  expect(useAppStore.getState().setHandHeld).toHaveBeenCalledWith(0, false);
});

test('the phone shows your lands too, so you can see and tap your mana', () => {
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      battlefield: [{ iid: 'land1', cardId: 'c-forest', name: 'Forest', row: 'lands' }],
    },
  };
  useAppStore.setState({ game: g });
  render(<HandScreen seatIdx={0} onShowTable={() => {}} />);
  expect(screen.getByRole('button', { name: 'Forest' })).toBeInTheDocument();
});

test('pagehide releases the hand so a killed phone cannot wedge it', () => {
  render(<HandScreen seatIdx={0} onShowTable={() => {}} />);
  window.dispatchEvent(new Event('pagehide'));
  expect(useAppStore.getState().setHandHeld).toHaveBeenCalledWith(0, false);
});

test('the See table button hands control back', async () => {
  const onShowTable = vi.fn();
  const user = userEvent.setup();
  render(<HandScreen seatIdx={0} onShowTable={onShowTable} />);
  await user.click(screen.getByRole('button', { name: /see table/i }));
  expect(onShowTable).toHaveBeenCalled();
});
