import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { buildSeatCards, seedSeat } from '../lib/cards';
import { addCard, changeCardCount, createDeck, setCommander } from '../lib/deck';
import { createGame } from '../lib/game';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
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
  'c-forest': { ...rec('c-forest', 'Forest', 'Basic Land — Forest'), oracleText: '({T}: Add {G}.)' },
  'c-goblin': { ...rec('c-goblin', 'Raging Goblin', 'Creature — Goblin Berserker'), oracleText: 'Haste' },
  'c-sol': { ...rec('c-sol', 'Sol Ring', 'Artifact'), oracleText: '{T}: Add {C}{C}.' },
  'c-fervor': {
    ...rec('c-fervor', 'Fervor', 'Enchantment'),
    oracleText: 'Creatures you control have haste.',
  },
  'c-goose': {
    ...rec('c-goose', 'The Goose Mother', 'Legendary Creature — Bird Hydra'),
    manaCost: '{X}{G}',
    oracleText: 'Flying\nThe Goose Mother enters with X +1/+1 counters on it.',
  },
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

/** The seeded game with a Forest already on the lands shelf. */
function gameWithForest() {
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      battlefield: [{ iid: 'land1', cardId: 'c-forest', name: 'Forest', row: 'lands' }],
    },
  };
  return g;
}

/** A deliberate tap, a moment after a sheet opened: the commander's card and the
 * X sheet both open under the finger and take no tap as an answer for their
 * first moment on screen (they go by when the tap happened). */
function tapLater(el: HTMLElement) {
  const tap = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(tap, 'timeStamp', { value: Date.now() + 1000 });
  fireEvent(el, tap);
}

test('a tap on the pedestal brings the commander up to read; Cast on that card casts it', async () => {
  useAppStore.setState({ game: gameWithForest() }); // Ashaya costs {1} in this fixture
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  const pedestal = await screen.findByLabelText('commander Ashaya'); // records in: the Forest pays for it
  await user.click(pedestal);
  // The tap itself casts nothing: a stray one costs nothing.
  expect(useAppStore.getState().castCommander).not.toHaveBeenCalled();
  expect(await screen.findByRole('heading', { name: 'Ashaya' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Ashaya' })).toBeInTheDocument(); // the card, large
  tapLater(screen.getByRole('button', { name: 'Cast' }));
  expect(useAppStore.getState().castCommander).toHaveBeenCalledWith(0, useAppStore.getState().game!.players[0].cards!.command[0].iid);
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Ashaya' })).not.toBeInTheDocument());
});

test('the second half of a double tap on the pedestal does not land on Cast', async () => {
  useAppStore.setState({ game: gameWithForest() });
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  const pedestal = await screen.findByLabelText('commander Ashaya');
  await user.click(pedestal);
  await user.click(await screen.findByRole('button', { name: 'Cast' })); // at once: still the same gesture
  expect(useAppStore.getState().castCommander).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Ashaya' })).toBeInTheDocument(); // still open, still asking
});

test('a hold on the pedestal opens the command zone', async () => {
  useAppStore.setState({ game: gameWithForest() });
  render(<BattlefieldRow playerIdx={0} />);
  const pedestal = await screen.findByLabelText('commander Ashaya');
  fireEvent.pointerDown(pedestal);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 650));
  });
  fireEvent.pointerUp(pedestal);
  expect(await screen.findByText(/command zone/i, { selector: 'h2' })).toBeInTheDocument();
  expect(useAppStore.getState().castCommander).not.toHaveBeenCalled();
});

test('a commander you cannot pay for says so on its card, and Cast anyway is the way round', async () => {
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />); // no lands at all
  const pedestal = await screen.findByLabelText(/commander Ashaya — not enough mana/i);
  await user.click(pedestal);
  expect(useAppStore.getState().castCommander).not.toHaveBeenCalled();
  expect(await screen.findByText(/not enough mana ready/i)).toBeInTheDocument();
  tapLater(screen.getByRole('button', { name: 'Cast anyway' }));
  expect(useAppStore.getState().castCommander).toHaveBeenCalledWith(0, useAppStore.getState().game!.players[0].cards!.command[0].iid);
});

test('commander tax counts against the mana on the table', async () => {
  const g = gameWithForest();
  const seat = g.players[0].cards!;
  // Ashaya has gone home once: {1} + 2 tax against a single Forest
  g.players[0] = { ...g.players[0], cards: { ...seat, cmd: { [seat.command[0].iid]: 1 } } };
  useAppStore.setState({ game: g });
  render(<BattlefieldRow playerIdx={0} />);
  expect(await screen.findByLabelText(/commander Ashaya — not enough mana/i)).toBeInTheDocument();
});

test('battlefield cards render with art and tap to tap', async () => {
  useAppStore.setState({
    game: gameWith([{ iid: 'b1', cardId: 'c-bear', name: 'Grizzly Bears', row: 'front' }]),
  });
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  const card = (await screen.findAllByRole('button', { name: /^tap / }))[0];
  await waitFor(() => expect(card.querySelector('img')).not.toBeNull());
  await user.click(card);
  expect(useAppStore.getState().tapVirtualCard).toHaveBeenCalledWith(0, 'b1');
});

test('the field is for creatures: lands, mana rocks and other permanents are drawn elsewhere', async () => {
  useAppStore.setState({
    game: gameWith([
      { iid: 'b1', cardId: 'c-bear', name: 'Grizzly Bears', row: 'front' },
      { iid: 's1', cardId: 'c-sol', name: 'Sol Ring', row: 'front' }, // the lands row draws it
      { iid: 'v1', cardId: 'c-fervor', name: 'Fervor', row: 'front' }, // the side shelf draws it
      { iid: 'f1', cardId: 'c-forest', name: 'Forest', row: 'lands' },
    ]),
  });
  const { container } = render(<BattlefieldRow playerIdx={0} />);
  const bear = screen.getByRole('button', { name: 'tap Grizzly Bears' });
  await waitFor(() => expect(bear.querySelector('img')).not.toBeNull());
  await waitFor(() => expect(container.querySelectorAll('.bf-cards .vcard')).toHaveLength(1));
  expect(screen.queryByRole('button', { name: 'tap Sol Ring' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'tap Fervor' })).not.toBeInTheDocument();
});

test('a card this device cannot read stays in the field: nothing is ever hidden', async () => {
  useAppStore.setState({
    game: gameWith([{ iid: 'u1', cardId: 'c-unknown', name: 'Mystery Relic', row: 'front' }]),
  });
  render(<BattlefieldRow playerIdx={0} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50)); // the lookup comes back empty
  });
  expect(screen.getByRole('button', { name: 'tap Mystery Relic' })).toBeInTheDocument();
});

// ---- the turn's draw ----

test('on its own turn the library calls for the draw until the seat has drawn', async () => {
  const g = seededGame();
  // Turn 2: the very first turn of a two-player game has no draw.
  useAppStore.setState({ game: { ...g, turnNumber: 2 } });
  const first = render(<BattlefieldRow playerIdx={0} />);
  const pile = screen.getByLabelText('library, 4 cards — draw for the turn');
  expect(pile.className).toContain('dock-library--draw');
  expect(pile).toHaveTextContent(/draw/i);
  first.unmount();

  const seat = g.players[0].cards!;
  g.players[0] = { ...g.players[0], cards: { ...seat, drew: { turn: 2, active: 0 } } };
  useAppStore.setState({ game: { ...g, turnNumber: 2 } });
  render(<BattlefieldRow playerIdx={0} />);
  const quiet = screen.getByLabelText('library, 4 cards');
  expect(quiet.className).not.toContain('dock-library--draw');
  expect(quiet).not.toHaveTextContent(/draw/i);
});

test('nobody is called to draw on someone else’s turn, on the opening turn of a duel, or with no library', () => {
  const g = seededGame();
  const calls = () => document.querySelectorAll('.dock-library--draw').length;
  useAppStore.setState({ game: { ...g, turnNumber: 2, activePlayerIndex: 1 } });
  const other = render(<BattlefieldRow playerIdx={0} />);
  expect(calls()).toBe(0);
  other.unmount();

  useAppStore.setState({ game: { ...g, turnNumber: 1 } }); // two players: the first skips the draw
  const opening = render(<BattlefieldRow playerIdx={0} />);
  expect(calls()).toBe(0);
  opening.unmount();

  g.players[0] = { ...g.players[0], cards: { ...g.players[0].cards!, library: [] } };
  useAppStore.setState({ game: { ...g, turnNumber: 2 } });
  render(<BattlefieldRow playerIdx={0} />);
  expect(calls()).toBe(0);
});

// ---- turn rules: summoning sickness, X costs ----

/** The seeded game with exactly these cards on seat 0's battlefield. */
function gameWith(battlefield: CardInstance[]): GameState {
  const g = seededGame();
  g.players[0] = { ...g.players[0], cards: { ...g.players[0].cards!, battlefield } };
  return g;
}
const FRESH_BEAR: CardInstance = { iid: 'b1', cardId: 'c-bear', name: 'Grizzly Bears', row: 'front', sick: true };
const badge = (card: HTMLElement) => card.querySelector('.sick-badge');

test('a creature that arrived this turn wears the summoning-sick badge and says so', async () => {
  useAppStore.setState({ game: gameWith([FRESH_BEAR]) });
  render(<BattlefieldRow playerIdx={0} />);
  const card = await screen.findByRole('button', { name: 'tap Grizzly Bears, summoning sick' });
  expect(badge(card)).toHaveTextContent('💤');
});

test('once its controller’s turn has come round the badge is gone', async () => {
  const { sick: _sick, ...readied } = FRESH_BEAR;
  useAppStore.setState({ game: gameWith([readied]) });
  render(<BattlefieldRow playerIdx={0} />);
  const card = screen.getByRole('button', { name: 'tap Grizzly Bears' });
  await waitFor(() => expect(card.querySelector('img')).not.toBeNull()); // record in
  expect(badge(card)).toBeNull();
  expect(card).toHaveAccessibleName('tap Grizzly Bears');
});

test('a fresh artifact or land never shows it: only creatures get summoning sick', async () => {
  useAppStore.setState({
    game: gameWith([
      // Both kept up in the field by hand: the board would draw them with the lands.
      { iid: 's1', cardId: 'c-sol', name: 'Sol Ring', row: 'field', sick: true },
      { iid: 'f1', cardId: 'c-forest', name: 'Forest', row: 'field', sick: true },
    ]),
  });
  render(<BattlefieldRow playerIdx={0} />);
  for (const name of ['tap Sol Ring', 'tap Forest']) {
    const card = screen.getByRole('button', { name });
    await waitFor(() => expect(card.querySelector('img')).not.toBeNull());
    expect(badge(card)).toBeNull();
    expect(card).toHaveAccessibleName(name);
  }
});

test('a fresh creature with haste shows none, whether the haste is its own or handed to it', async () => {
  useAppStore.setState({
    game: gameWith([{ iid: 'g1', cardId: 'c-goblin', name: 'Raging Goblin', row: 'front', sick: true }]),
  });
  const first = render(<BattlefieldRow playerIdx={0} />);
  const goblin = screen.getByRole('button', { name: /^tap Raging Goblin/ });
  await waitFor(() => expect(goblin.querySelector('img')).not.toBeNull());
  expect(badge(goblin)).toBeNull();
  expect(goblin).toHaveAccessibleName('tap Raging Goblin');
  first.unmount();

  useAppStore.setState({
    game: gameWith([FRESH_BEAR, { iid: 'v1', cardId: 'c-fervor', name: 'Fervor', row: 'front' }]),
  });
  render(<BattlefieldRow playerIdx={0} />);
  // Fervor itself is on the side shelf; its text still reaches the creatures.
  const bear = await screen.findByRole('button', { name: 'tap Grizzly Bears' });
  expect(badge(bear)).toBeNull();
});

test('a fresh card whose record cannot be read shows no badge', async () => {
  useAppStore.setState({
    game: gameWith([{ iid: 'u1', cardId: 'c-unknown', name: 'Mystery Beast', row: 'front', sick: true }]),
  });
  render(<BattlefieldRow playerIdx={0} />);
  const card = screen.getByRole('button', { name: /^tap Mystery Beast/ });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50)); // the lookup comes back empty
  });
  expect(badge(card)).toBeNull();
  expect(card).toHaveAccessibleName('tap Mystery Beast');
});

test('a summoning-sick creature still taps on a tap: crewing and convoke are legal', async () => {
  useAppStore.setState({ game: gameWith([FRESH_BEAR]) });
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  await user.click(await screen.findByRole('button', { name: 'tap Grizzly Bears, summoning sick' }));
  expect(useAppStore.getState().tapVirtualCard).toHaveBeenCalledWith(0, 'b1');
});

/** A seat whose commander costs {X}{G}, with `forests` Forests on its lands shelf. */
function gooseGame(forests: number): { g: GameState; iid: string } {
  let deck = setCommander(createDeck('Geese'), RECORDS['c-goose']);
  deck = addCard(deck, RECORDS['c-forest']);
  deck = changeCardCount(deck, 'c-forest', 9);
  const g = seedSeat(createGame(config), 0, buildSeatCards(deck, 42));
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      battlefield: Array.from({ length: forests }, (_, k) => ({
        iid: `f${k + 1}`,
        cardId: 'c-forest',
        name: 'Forest',
        row: 'lands' as const,
      })),
    },
  };
  return { g, iid: g.players[0].cards!.command[0].iid };
}

test('a commander with X in its cost asks how much from the pedestal, instead of casting', async () => {
  const { g, iid } = gooseGame(3);
  useAppStore.setState({ game: g });
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  const pedestal = screen.getByLabelText(/commander The Goose Mother/i);
  await waitFor(() => expect(pedestal.querySelector('img')).not.toBeNull()); // records in
  expect(pedestal).toHaveAccessibleName('commander The Goose Mother'); // X = 0 is payable: not short
  await user.click(pedestal);
  expect(useAppStore.getState().castCommander).not.toHaveBeenCalled();
  expect(await screen.findByRole('heading', { name: 'The Goose Mother' })).toBeInTheDocument();
  // Cast on its card asks how much, in that card's place: one sheet, not two.
  tapLater(screen.getByRole('button', { name: 'Cast' }));
  expect(useAppStore.getState().castCommander).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Cast for X = 0' })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { name: 'The Goose Mother' })).toHaveLength(1);
  tapLater(screen.getByRole('button', { name: 'Max' }));
  tapLater(screen.getByRole('button', { name: 'Cast for X = 2' }));
  expect(useAppStore.getState().castCommander).toHaveBeenCalledWith(0, iid, { x: 2 });
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'The Goose Mother' })).not.toBeInTheDocument(),
  );
});

test('an X commander the seat cannot pay for: Cast anyway asks for X as well', async () => {
  const { g } = gooseGame(0);
  useAppStore.setState({ game: g });
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  await user.click(await screen.findByLabelText(/commander The Goose Mother — not enough mana/i));
  tapLater(await screen.findByRole('button', { name: 'Cast anyway' }));
  expect(useAppStore.getState().castCommander).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Cast anyway (X = 0)' })).toBeInTheDocument();
  expect(screen.queryByText(/command zone/i, { selector: 'h2' })).not.toBeInTheDocument(); // one sheet, not two
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

test('a partner pair shows two pedestals, and each casts its own commander', async () => {
  const { setPartner } = await import('../lib/deck');
  let deck = setPartner(
    setCommander(createDeck('Pair'), { ...RECORDS['c-cmd'], manaCost: '' }),
    { ...rec('c-partner', 'Tymna', 'Legendary Creature — Human'), manaCost: '' },
  );
  deck = addCard(deck, RECORDS['c-forest']);
  deck = changeCardCount(deck, 'c-forest', 9);
  const g = seedSeat(createGame(config), 0, buildSeatCards(deck, 42));
  useAppStore.setState({ game: g });
  const [first, second] = g.players[0].cards!.command;
  const user = userEvent.setup();
  render(<BattlefieldRow playerIdx={0} />);
  expect(screen.getByLabelText(/commander Ashaya/i)).toBeInTheDocument();
  await user.click(screen.getByLabelText(/commander Tymna/i));
  expect(await screen.findByRole('heading', { name: 'Tymna' })).toBeInTheDocument();
  tapLater(screen.getByRole('button', { name: 'Cast' }));
  expect(useAppStore.getState().castCommander).toHaveBeenCalledWith(0, second.iid);
  expect(useAppStore.getState().castCommander).not.toHaveBeenCalledWith(0, first.iid);
});

test('each pedestal wears its own tax', async () => {
  const { setPartner } = await import('../lib/deck');
  let deck = setPartner(
    setCommander(createDeck('Pair'), RECORDS['c-cmd']),
    rec('c-partner', 'Tymna', 'Legendary Creature — Human'),
  );
  deck = addCard(deck, RECORDS['c-forest']);
  deck = changeCardCount(deck, 'c-forest', 9);
  const g = seedSeat(createGame(config), 0, buildSeatCards(deck, 42));
  const [, second] = g.players[0].cards!.command;
  g.players[0] = {
    ...g.players[0],
    cards: { ...g.players[0].cards!, cmd: { ...g.players[0].cards!.cmd, [second.iid]: 2 } },
  };
  useAppStore.setState({ game: g });
  render(<BattlefieldRow playerIdx={0} />);
  expect(screen.getByLabelText(/commander Tymna/i)).toHaveTextContent('+4');
  expect(screen.getByLabelText(/commander Ashaya/i)).not.toHaveTextContent('+');
});
