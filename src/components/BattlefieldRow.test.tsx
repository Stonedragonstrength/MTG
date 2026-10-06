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

test('an empty library goes quiet: no draws, no arm, and it says so', async () => {
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: { ...g.players[0].cards!, library: [] },
  };
  useAppStore.setState({
    game: g,
    online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: 1 }, // not my seat: arm path
  });
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  const pile = screen.getByLabelText(/library, empty/i);
  await user.click(pile);
  expect(useAppStore.getState().drawCards).not.toHaveBeenCalled();
  expect(screen.queryByText(/draw\?/i)).not.toBeInTheDocument(); // never arms on empty
});

test('a stale build cannot peek: the reveal is gated on the announcement', async () => {
  useAppStore.setState({
    online: { code: 'KQ7M2X', status: { kind: 'stale-build' }, mySeat: 1 },
    peekNotice: vi.fn(),
  });
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  // unclaimed seat shows the dock hand pill; hold it to reach the peek gate
  const pill = screen.getByLabelText(/hand, 7 cards/i);
  await user.pointer({ keys: '[MouseLeft>]', target: pill });
  await new Promise((r) => setTimeout(r, 650));
  await user.pointer({ keys: '[/MouseLeft]', target: pill });
  const reveal = await screen.findByRole('button', { name: /show the hand/i });
  expect(reveal).toBeDisabled();
  expect(screen.getByText(/refresh this device first/i)).toBeInTheDocument();
});

test('overlapping arm windows: an old disarm timer cannot kill a fresh one', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const g = seededGame();
    useAppStore.setState({
      game: g,
      online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: 1 },
      drawCards: vi.fn(),
    });
    const { fireEvent } = await import('@testing-library/react');
    render(<BattlefieldRow playerIdx={0} />);
    const pile = screen.getByLabelText(/library, 4 cards/i);
    const tap = (el: HTMLElement) => {
      fireEvent.pointerDown(el);
      fireEvent.pointerUp(el); // useLongPress taps ride pointer events, not click
    };
    tap(pile); // arm #1 (timer A at +3000)
    tap(pile); // confirm: draws, window closes, timer A still pending
    expect(useAppStore.getState().drawCards).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    tap(screen.getByLabelText(/library, 3 cards|library, 4 cards/i)); // arm #2 (timer B at +3500)
    vi.advanceTimersByTime(2700); // past timer A's moment — only B may disarm
    expect(screen.getByText(/draw\?/i)).toBeInTheDocument(); // window #2 survives
  } finally {
    vi.useRealTimers();
  }
});
