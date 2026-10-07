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

// ---- combat on the cards: no picking on the phone in this version, one line instead ----

/** The seeded game with a creature of mine in the front row and three knights on Sam's side. */
function gameWithCreatures() {
  const g = seededGame();
  g.players[0] = {
    ...g.players[0],
    cards: {
      ...g.players[0].cards!,
      battlefield: [{ iid: 'cmd1', cardId: 'c-cmd', name: 'Ashaya', row: 'front' }],
    },
  };
  g.players[1] = {
    ...g.players[1],
    board: [
      {
        id: 'knights',
        cardId: null,
        name: 'Knight',
        imageNormal: null,
        imageArtCrop: null,
        typeLine: 'Token Creature — Knight',
        oracleText: '',
        basePower: 2,
        baseToughness: 2,
        count: 3,
        counters: {},
        color: null,
        zone: 'board',
      },
    ],
  };
  return g;
}

test('no fight, no line', () => {
  useAppStore.setState({ game: gameWithCreatures() });
  const { container } = render(<HandScreen seatIdx={0} onShowTable={() => {}} />);
  expect(container.querySelector('.hs-combat')).toBeNull();
});

test('attacked: one line says by whom and with how many, and tapping it is "See table"', async () => {
  const g = gameWithCreatures();
  useAppStore.setState({
    game: {
      ...g,
      activePlayerIndex: 1,
      combat: {
        id: 'c1',
        turn: g.turnNumber,
        active: 1,
        step: 'blockers',
        defender: 0,
        attacks: [{ unit: { kind: 'stack', id: 'knights' }, n: 3, target: 0 }],
      },
    },
  });
  const onShowTable = vi.fn();
  const user = userEvent.setup();
  const { container } = render(<HandScreen seatIdx={0} onShowTable={onShowTable} />);
  const line = container.querySelector<HTMLElement>('.hs-combat')!;
  expect(line).toHaveTextContent('Sam attacks you with 3 — block on the table');
  await user.click(line);
  expect(onShowTable).toHaveBeenCalledTimes(1);
});

test('attacking: the line says the attack is open on the table, and there is no Attack button here', async () => {
  const g = gameWithCreatures();
  useAppStore.setState({ game: g });
  const { container } = render(<HandScreen seatIdx={0} onShowTable={() => {}} />);
  await screen.findByRole('button', { name: 'tap Ashaya' });
  expect(screen.queryByRole('button', { name: 'attack' })).not.toBeInTheDocument(); // my turn, a creature: still none
  const { act } = await import('@testing-library/react');
  act(() =>
    useAppStore.setState({ game: { ...g, combat: { id: 'c2', turn: g.turnNumber, active: 0, step: 'attackers' } } }),
  );
  expect(container.querySelector('.hs-combat')).toHaveTextContent('Your attack is open on the table');
  expect(screen.queryByRole('button', { name: /in combat/ })).not.toBeInTheDocument();
});

test('no picking on this screen: during my own attack a tap on my creature still just taps it', async () => {
  const g = gameWithCreatures();
  const tapVirtualCard = vi.fn();
  useAppStore.setState({
    game: { ...g, combat: { id: 'c3', turn: g.turnNumber, active: 0, step: 'attackers' } },
    tapVirtualCard,
  });
  const user = userEvent.setup();
  const { container } = render(<HandScreen seatIdx={0} onShowTable={() => {}} />);
  await user.click(await screen.findByRole('button', { name: 'tap Ashaya' }));
  expect(tapVirtualCard).toHaveBeenCalledWith(0, 'cmd1');
  expect(useAppStore.getState().game!.combat!.attacks).toBeUndefined();
  expect(container.querySelector('.combat-bar')).toBeNull(); // the bar is on the table, not here
});

test('…and the hold sheet offers no way to pick from here either', async () => {
  const g = gameWithCreatures();
  useAppStore.setState({ game: { ...g, combat: { id: 'c4', turn: g.turnNumber, active: 0, step: 'attackers' } } });
  const { act, fireEvent } = await import('@testing-library/react');
  render(<HandScreen seatIdx={0} onShowTable={() => {}} />);
  const card = await screen.findByRole('button', { name: 'tap Ashaya' });
  fireEvent.pointerDown(card);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 650));
  });
  fireEvent.pointerUp(card);
  expect(await screen.findByRole('heading', { name: 'Ashaya' })).toBeInTheDocument(); // the card sheet
  const { within } = await import('@testing-library/react');
  const sheet = within(document.querySelector<HTMLElement>('.sheet')!);
  expect(sheet.getByText('Move')).toBeInTheDocument();
  expect(sheet.queryByText('Combat')).not.toBeInTheDocument();
  expect(sheet.queryByRole('button', { name: /attack|^tap$|^untap$/i })).not.toBeInTheDocument();
});
