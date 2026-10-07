import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { buildSeatCards, seedSeat } from '../lib/cards';
import { addCard, changeCardCount, createDeck, setCommander } from '../lib/deck';
import { createGame } from '../lib/game';
import type { CardRecord, GameConfig, GameState, SeatCards } from '../lib/types';
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
  'c-giant': {
    ...rec('c-giant', 'Bonecrusher Giant', 'Creature — Giant // Instant — Adventure'),
    manaCost: '{2}{R} // {1}{R}',
  },
  'c-mountain': {
    ...rec('c-mountain', 'Mountain', 'Basic Land — Mountain'),
    oracleText: '({T}: Add {R}.)',
  },
  'c-exploration': {
    ...rec('c-exploration', 'Exploration', 'Enchantment'),
    oracleText: 'You may play an additional land on each of your turns.',
  },
  'c-rites': {
    ...rec('c-rites', 'Rites of Flourishing', 'Enchantment'),
    oracleText:
      "At the beginning of each player's draw step, that player draws an additional card.\nEach player may play an additional land on each of their turns.",
  },
  'c-hydra': {
    ...rec('c-hydra', 'Hungering Hydra', 'Creature — Hydra'),
    manaCost: '{X}{R}',
    oracleText: 'Hungering Hydra enters with X +1/+1 counters on it.',
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

test('a two-part card lights up at one face’s cost, not the sum of both', async () => {
  const playCard = vi.fn(async () => {});
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      hand: [{ iid: 'h1', cardId: 'c-giant', name: 'Bonecrusher Giant' }],
      battlefield: ['m1', 'm2', 'm3'].map((iid) => ({
        iid,
        cardId: 'c-mountain',
        name: 'Mountain',
        row: 'lands' as const,
      })),
    },
  };
  useAppStore.setState({ game: g, playCard });
  const user = userEvent.setup();
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 1 card/i }));
  const card = await screen.findByRole('button', { name: /play bonecrusher giant/i });
  await new Promise((r) => setTimeout(r, 50)); // records in
  expect(card.className).not.toContain('hand-card--poor'); // {2}{R} on three Mountains
  await user.click(card);
  expect(playCard).toHaveBeenCalledWith(0, 'h1');
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

// ---- turn rules: one land per turn, X costs ----

/** Seat 0 holding one Forest, with `played` lands already played this turn. */
function landInHand(played: number, over: Partial<SeatCards> = {}): GameState {
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      hand: [{ iid: 'h1', cardId: 'c-forest', name: 'Forest' }],
      battlefield: [],
      ...(played > 0
        ? { landPlays: { turn: g.turnNumber, active: g.activePlayerIndex, n: played } }
        : {}),
      ...over,
    },
  };
  return g;
}

/** A real-time sleep with whatever it lets happen (records arriving, the
 * long-press timer) landing inside act(). */
async function sleep(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Fans the one-card hand and hands back that card once its own record is read (its art
 * shows). What is on the battlefield may still be on its way: wait for the look you expect. */
async function oneCardHand(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  render(<HandTray playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /hand, 1 card/i }));
  const card = await screen.findByRole('button', { name });
  await vi.waitFor(() => expect(card.querySelector('img')).not.toBeNull());
  return card;
}
const dimmed = (card: HTMLElement) =>
  vi.waitFor(() => expect(card.className).toContain('hand-card--poor'));
const lit = (card: HTMLElement) =>
  vi.waitFor(() => expect(card.className).not.toContain('hand-card--poor'));

async function hold(user: ReturnType<typeof userEvent.setup>, el: HTMLElement) {
  await user.pointer({ keys: '[MouseLeft>]', target: el });
  await sleep(650);
  await user.pointer({ keys: '[/MouseLeft]', target: el });
}

/** A deliberate tap a moment from now. The X sheet opens under the finger and takes no
 * tap as an answer for its first moment on screen (it goes by when the tap happened). */
function tapLater(el: HTMLElement) {
  const tap = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(tap, 'timeStamp', { value: Date.now() + 1000 });
  fireEvent(el, tap);
}

test('the first land of the turn plays on a tap', async () => {
  const playCard = vi.fn(async () => {});
  useAppStore.setState({ game: landInHand(0), playCard });
  const user = userEvent.setup();
  const card = await oneCardHand(user, /play forest/i);
  await lit(card);
  await user.click(card);
  expect(playCard).toHaveBeenCalledWith(0, 'h1');
});

test('a second land is dimmed like a spell you cannot pay for, and a tap does not play it', async () => {
  const playCard = vi.fn(async () => {});
  useAppStore.setState({ game: landInHand(1), playCard });
  const user = userEvent.setup();
  const card = await oneCardHand(user, /play forest/i);
  await dimmed(card);
  await user.click(card);
  expect(playCard).not.toHaveBeenCalled();
});

test('hold the refused land: the sheet says why, and Play anyway plays it', async () => {
  const playCard = vi.fn(async () => {});
  useAppStore.setState({ game: landInHand(1), playCard });
  const user = userEvent.setup();
  const card = await oneCardHand(user, /play forest/i);
  await hold(user, card);
  expect(await screen.findByText('You have already played a land this turn.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /play anyway/i }));
  expect(playCard).toHaveBeenCalledWith(0, 'h1'); // the store counts it all the same
  expect(screen.queryByRole('button', { name: /play anyway/i })).not.toBeInTheDocument(); // sheet closed
});

test('a land is dimmed on someone else’s turn, and its sheet says so', async () => {
  const playCard = vi.fn(async () => {});
  useAppStore.setState({ game: { ...landInHand(0), activePlayerIndex: 1 }, playCard });
  const user = userEvent.setup();
  const card = await oneCardHand(user, /play forest/i);
  await dimmed(card);
  await user.click(card);
  expect(playCard).not.toHaveBeenCalled();
  await hold(user, card);
  expect(await screen.findByText("It isn't your turn.")).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /play anyway/i }));
  expect(playCard).toHaveBeenCalledWith(0, 'h1');
});

test('last turn’s land does not dim this turn’s', async () => {
  const playCard = vi.fn(async () => {});
  const g = landInHand(1);
  useAppStore.setState({ game: { ...g, turnNumber: g.turnNumber + 1 }, playCard });
  const user = userEvent.setup();
  const card = await oneCardHand(user, /play forest/i);
  await lit(card);
  await user.click(card);
  expect(playCard).toHaveBeenCalledWith(0, 'h1');
});

test('a permanent that grants another land drop lights the second land', async () => {
  const playCard = vi.fn(async () => {});
  const exploration = { iid: 'b1', cardId: 'c-exploration', name: 'Exploration', row: 'front' as const };
  useAppStore.setState({ game: landInHand(1, { battlefield: [exploration] }), playCard });
  const user = userEvent.setup();
  const card = await oneCardHand(user, /play forest/i);
  await lit(card);
  await user.click(card);
  expect(playCard).toHaveBeenCalledWith(0, 'h1');
});

test('another seat’s Rites of Flourishing lights it too; their Exploration does not', async () => {
  const theirs = (cardId: string): SeatCards => ({
    library: [],
    hand: [],
    battlefield: [{ iid: 'x1', cardId, name: cardId, row: 'front' }],
    graveyard: [],
    exile: [],
    command: [],
    mulligans: 0,
    deckName: 'Group hug',
  });
  const withTheir = (cardId: string) => {
    const g = landInHand(1);
    g.players[1] = { ...g.players[1], cards: theirs(cardId) };
    return g;
  };
  useAppStore.setState({ game: withTheir('c-rites') });
  const user = userEvent.setup();
  const card = await oneCardHand(user, /play forest/i);
  await lit(card);

  act(() => {
    useAppStore.setState({ game: withTheir('c-exploration') });
  });
  await dimmed(card);
});

test('a refused spell’s sheet says the mana is short', async () => {
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      hand: [{ iid: 'h1', cardId: 'c-bolt', name: 'Lightning Bolt' }],
      battlefield: [],
    },
  };
  useAppStore.setState({ game: g });
  const user = userEvent.setup();
  const card = await oneCardHand(user, /play lightning bolt/i);
  await hold(user, card);
  expect(await screen.findByText('Not enough mana ready.')).toBeInTheDocument();
});

test('a card the table would play has no reason to give and no override to offer', async () => {
  useAppStore.setState({ game: landInHand(0) });
  const user = userEvent.setup();
  const card = await oneCardHand(user, /play forest/i);
  await hold(user, card);
  expect(await screen.findByRole('button', { name: /discard/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /play anyway/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/your turn|already played|not enough mana/i)).not.toBeInTheDocument();
});

/** Seat 0 holding the Hydra ({X}{R}) with `mountains` Mountains on the table. */
function hydraInHand(mountains: number): GameState {
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      hand: [{ iid: 'h1', cardId: 'c-hydra', name: 'Hungering Hydra' }],
      battlefield: Array.from({ length: mountains }, (_, k) => ({
        iid: `m${k + 1}`,
        cardId: 'c-mountain',
        name: 'Mountain',
        row: 'lands' as const,
      })),
    },
  };
  return g;
}

test('a card with X in its cost opens the X sheet instead of playing', async () => {
  const playCard = vi.fn(async () => {});
  useAppStore.setState({ game: hydraInHand(3), playCard });
  const user = userEvent.setup();
  const card = await oneCardHand(user, /play hungering hydra/i);
  await lit(card); // X = 0 is payable: it lights up
  await user.click(card);
  expect(playCard).not.toHaveBeenCalled();
  expect(await screen.findByRole('heading', { name: 'Hungering Hydra' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cast for X = 0' })).toBeInTheDocument();
  // closing it casts nothing and puts the hand back as it was
  tapLater(screen.getByRole('button', { name: 'close' }));
  expect(playCard).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Hungering Hydra' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /play hungering hydra/i })).toBeInTheDocument();
});

test('Play anyway on a card with X asks for X too', async () => {
  const playCard = vi.fn(async () => {});
  useAppStore.setState({ game: hydraInHand(0), playCard }); // not even X = 0 is payable
  const user = userEvent.setup();
  const card = await oneCardHand(user, /play hungering hydra/i);
  await dimmed(card);
  await user.click(card);
  expect(screen.queryByRole('heading', { name: 'Hungering Hydra' })).not.toBeInTheDocument(); // a tap does nothing
  await hold(user, card);
  await user.click(await screen.findByRole('button', { name: /play anyway/i }));
  expect(playCard).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Cast anyway (X = 0)' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument(); // one sheet, not two
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
