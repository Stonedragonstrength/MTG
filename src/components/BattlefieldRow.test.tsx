import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { buildSeatCards, seedSeat } from '../lib/cards';
import { addCard, changeCardCount, createDeck, setCommander } from '../lib/deck';
import { createGame } from '../lib/game';
import type { CardRecord, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldRow from './BattlefieldRow';

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
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear'),
  'c-forest': rec('c-forest', 'Forest', 'Basic Land — Forest'),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

vi.mock('../data/synergy', () => ({
  findCommandersFor: vi.fn(async () => []),
  findSynergiesFor: vi.fn(async () => []),
}));

function seededGame() {
  let deck = setCommander(createDeck('Stompy'), RECORDS['c-cmd']);
  deck = addCard(deck, RECORDS['c-bear']);
  deck = addCard(deck, RECORDS['c-forest']);
  deck = changeCardCount(deck, 'c-forest', 9);
  const g = createGame(config);
  return seedSeat(g, 0, buildSeatCards(deck, 42));
}

beforeEach(() => {
  useAppStore.setState({
    game: seededGame(),
    online: null,
    tapVirtualCard: vi.fn(),
    drawCards: vi.fn(),
    castCommander: vi.fn(),
  });
});

test('the dock shows library count and the command pedestal', () => {
  render(<BattlefieldRow playerIdx={0} />);
  expect(screen.getByLabelText(/library, 4 cards/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/commander Ashaya/i)).toBeInTheDocument();
  // own seat: the hand pill belongs to the HandTray, not the dock
  expect(screen.queryByLabelText(/hand, 7 cards/i)).not.toBeInTheDocument();
});

test('tapping the library draws one for your own seat', async () => {
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  await user.click(screen.getByLabelText(/library, 4 cards/i));
  expect(useAppStore.getState().drawCards).toHaveBeenCalledWith(0, 1);
});

test('tapping the pedestal casts the commander', async () => {
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  await user.click(screen.getByLabelText(/commander Ashaya/i));
  expect(useAppStore.getState().castCommander).toHaveBeenCalledWith(0);
});

test('battlefield cards render with art and tap to tap', async () => {
  const g = seededGame();
  const iid = g.players[0].cards!.hand[0].iid;
  const { moveCard } = await import('../lib/cards');
  useAppStore.setState({ game: moveCard(g, 0, iid, 'hand', 'battlefield', { row: 'front' }) });
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  const card = (await screen.findAllByRole('button', { name: /^tap / }))[0];
  await user.click(card);
  expect(useAppStore.getState().tapVirtualCard).toHaveBeenCalledWith(0, iid);
});

test('the graveyard pile opens the browser sheet', async () => {
  const g = seededGame();
  const iid = g.players[0].cards!.library[0].iid;
  const { millN } = await import('../lib/cards');
  useAppStore.setState({ game: millN(g, 0, [iid]) });
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  await user.click(screen.getByLabelText(/graveyard, 1 card/i));
  expect(await screen.findByText(/graveyard/i, { selector: 'h2' })).toBeInTheDocument();
});
