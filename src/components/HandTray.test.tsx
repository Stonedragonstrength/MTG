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
  'c-forest': { ...rec('c-forest', 'Forest', 'Basic Land — Forest'), oracleText: '({T}: Add {G}.)' },
  'c-bolt': { ...rec('c-bolt', 'Lightning Bolt', 'Instant'), manaCost: '{R}' },
  'c-mountain': {
    ...rec('c-mountain', 'Mountain', 'Basic Land — Mountain'),
    oracleText: '({T}: Add {R}.)',
  },
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

test('in a pod the first mulligan is free: Keep hand, no bottoming owed', async () => {
  const podConfig = {
    ...config,
    profiles: [
      ...config.profiles,
      { id: 'p2', name: 'Alex', avatarUrl: null, commanderName: null },
    ],
  };
  const { createGame: freshGame } = await import('../lib/game');
  const g = freshGame(podConfig);
  const seeded = seededGame();
  const keepHand = vi.fn();
  useAppStore.setState({
    game: {
      ...g,
      players: g.players.map((p, i) =>
        i === 0 ? { ...p, cards: { ...seeded.players[0].cards!, mulligans: 1 } } : p,
      ),
    },
    keepHand,
  });
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 7 cards/i }));
  await user.click(screen.getByRole('button', { name: /^keep hand$/i })); // CR 103.5d: free in multiplayer
  expect(keepHand).toHaveBeenCalledWith(0, []);
});

test('two players owe a bottom per mulligan, and the debt survives a played land', async () => {
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      mulligans: 1,
      battlefield: [{ iid: 'b1', cardId: 'c-forest', name: 'Forest', row: 'lands' }],
    },
  };
  useAppStore.setState({ game: g });
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 7 cards/i }));
  // the land is down: mulligan itself is gone, but the owed bottom is not
  expect(screen.queryByRole('button', { name: /^mulligan$/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /keep \(bottom 1\)/i })).toBeInTheDocument();
});

test('a kept hand shows no mulligan controls at all', async () => {
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: { ...g.players[0].cards!, mulligans: 1, kept: true },
  };
  useAppStore.setState({ game: g });
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 7 cards/i }));
  expect(screen.queryByRole('button', { name: /mulligan/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /keep/i })).not.toBeInTheDocument();
});

test('a spell you cannot pay for is dimmed and will not play', async () => {
  const playCard = vi.fn(async () => {});
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      hand: [{ iid: 'h1', cardId: 'c-bolt', name: 'Lightning Bolt' }],
      battlefield: [], // no mana at all
    },
  };
  useAppStore.setState({ game: g, playCard });
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 1 card/i }));
  const card = await screen.findByRole('button', { name: /play lightning bolt/i });
  await vi.waitFor(() => expect(card.className).toContain('hand-card--poor'));
  await user.click(card);
  expect(playCard).not.toHaveBeenCalled();
});

test('the same spell plays once the mana sits untapped', async () => {
  const playCard = vi.fn(async () => {});
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      hand: [{ iid: 'h1', cardId: 'c-bolt', name: 'Lightning Bolt' }],
      battlefield: [{ iid: 'm1', cardId: 'c-mountain', name: 'Mountain', row: 'lands' }],
    },
  };
  useAppStore.setState({ game: g, playCard });
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 1 card/i }));
  const card = await screen.findByRole('button', { name: /play lightning bolt/i });
  await vi.waitFor(() => expect(card.className).not.toContain('hand-card--poor'));
  await user.click(card);
  expect(playCard).toHaveBeenCalledWith(0, 'h1');
});

test('a land you already tapped still pays: its mana is floating', async () => {
  const playCard = vi.fn(async () => {});
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      hand: [{ iid: 'h1', cardId: 'c-bolt', name: 'Lightning Bolt' }],
      battlefield: [
        { iid: 'm1', cardId: 'c-mountain', name: 'Mountain', row: 'lands', tapped: true },
      ],
    },
  };
  useAppStore.setState({ game: g, playCard });
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 1 card/i }));
  const card = await screen.findByRole('button', { name: /play lightning bolt/i });
  await vi.waitFor(() => expect(card.className).not.toContain('hand-card--poor'));
  await user.click(card);
  expect(playCard).toHaveBeenCalledWith(0, 'h1');
});

test('mana a payment already spent does not pay twice', async () => {
  const playCard = vi.fn(async () => {});
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      hand: [{ iid: 'h1', cardId: 'c-bolt', name: 'Lightning Bolt' }],
      battlefield: [
        { iid: 'm1', cardId: 'c-mountain', name: 'Mountain', row: 'lands', tapped: true, spent: 1 },
      ],
    },
  };
  useAppStore.setState({ game: g, playCard });
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 1 card/i }));
  const card = await screen.findByRole('button', { name: /play lightning bolt/i });
  await vi.waitFor(() => expect(card.className).toContain('hand-card--poor'));
  await user.click(card);
  expect(playCard).not.toHaveBeenCalled();
});

test('Play anyway waits behind the hold for the cards the gate cannot read', async () => {
  const playCard = vi.fn(async () => {});
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      hand: [{ iid: 'h1', cardId: 'c-bolt', name: 'Lightning Bolt' }],
      battlefield: [],
    },
  };
  useAppStore.setState({ game: g, playCard });
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 1 card/i }));
  const card = await screen.findByRole('button', { name: /play lightning bolt/i });
  await user.pointer({ keys: '[MouseLeft>]', target: card });
  await new Promise((r) => setTimeout(r, 650));
  await user.pointer({ keys: '[/MouseLeft]', target: card });
  await user.click(await screen.findByRole('button', { name: /play anyway/i }));
  expect(playCard).toHaveBeenCalledWith(0, 'h1');
});

test('forceFanned shows the cards straight away, with no pill or collapse', () => {
  render(<HandTray playerIdx={0} forceFanned />);
  expect(screen.queryByRole('button', { name: /hand, 7 cards/i })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^play / })).toHaveLength(7);
  expect(screen.queryByRole('button', { name: /collapse hand/i })).not.toBeInTheDocument();
});

test('a phone-held hand collapses to a hint on other devices', () => {
  const g = seededGame();
  g.players[0] = { ...g.players[0], cards: { ...g.players[0].cards!, handHeld: true } };
  useAppStore.setState({
    game: g,
    online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: null },
  });
  render(<HandTray playerIdx={0} />);
  expect(screen.getByTitle(/phone/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /hand, 7 cards/i })).not.toBeInTheDocument();
});

test('a dead phone cannot wedge the hand: the hint expands on demand', async () => {
  const g = seededGame();
  g.players[0] = { ...g.players[0], cards: { ...g.players[0].cards!, handHeld: true } };
  useAppStore.setState({
    game: g,
    online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: null },
  });
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /show the hand here anyway/i }));
  expect(screen.getByRole('button', { name: /hand, 7 cards/i })).toBeInTheDocument();
});

test('the device that claimed the seat keeps its own tray despite handHeld', () => {
  const g = seededGame();
  g.players[0] = { ...g.players[0], cards: { ...g.players[0].cards!, handHeld: true } };
  useAppStore.setState({
    game: g,
    online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: 0 },
  });
  render(<HandTray playerIdx={0} />);
  expect(screen.getByRole('button', { name: /hand, 7 cards/i })).toBeInTheDocument();
});
