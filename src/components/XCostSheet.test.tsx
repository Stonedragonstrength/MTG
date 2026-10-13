import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import XCostSheet from './XCostSheet';

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

function rec(id: string, name: string, typeLine: string, manaCost: string, oracleText = ''): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost,
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
  'c-hydra': rec(
    'c-hydra',
    'Hungering Hydra',
    'Creature — Hydra',
    '{X}{G}',
    'Hungering Hydra enters with X +1/+1 counters on it.',
  ),
  'c-doubler': rec('c-doubler', 'Twin Flame', 'Sorcery', '{X}{X}{G}'),
  'c-explosion': rec('c-explosion', 'Expansion // Explosion', 'Instant // Instant', '{G} // {X}{G}{G}'),
  'c-cmd': rec('c-cmd', 'The Goose Mother', 'Legendary Creature — Bird Hydra', '{X}{G}{G}'),
  'c-forest': rec('c-forest', 'Forest', 'Basic Land — Forest', '', '({T}: Add {G}.)'),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

const HYDRA: CardInstance = { iid: 'h-hydra', cardId: 'c-hydra', name: 'Hungering Hydra' };
const COMMANDER: CardInstance = { iid: 'cmd-1', cardId: 'c-cmd', name: 'The Goose Mother' };

/** Seat 0 with `forests` untapped Forests, the given hand, and its commander at home. */
function table(forests: number, hand: CardInstance[] = [HYDRA], returns = 0): GameState {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: {
      library: [],
      hand,
      battlefield: Array.from({ length: forests }, (_, k) => ({
        iid: `f${k + 1}`,
        cardId: 'c-forest',
        name: 'Forest',
        row: 'lands' as const,
      })),
      graveyard: [],
      exile: [],
      command: [COMMANDER],
      mulligans: 0,
      deckName: 'Stompy',
      cmd: { [COMMANDER.iid]: returns },
    },
  };
  return g;
}

const playCard = vi.fn(async () => {});
const castCommander = vi.fn();

beforeEach(() => {
  playCard.mockClear();
  castCommander.mockClear();
  useAppStore.setState({ game: table(5), online: null, playCard, castCommander });
});

/** Renders the sheet and waits until the card is read (its picture shows). What comes
 * back as "before" is a moment no later than the one the sheet opened at. */
async function open(iid = 'h-hydra', from: 'hand' | 'command' = 'hand') {
  const onClose = vi.fn();
  const before = Date.now();
  const view = render(<XCostSheet playerIdx={0} iid={iid} from={from} onClose={onClose} />);
  await screen.findByRole('img');
  return { onClose, before, ...view };
}

/** A tap that happens at a moment of our choosing (ms on the wall clock). The sheet goes by
 * when taps happen: for its first moment on screen it takes none of them as an answer. */
function tapAt(el: Element, at: number) {
  const tap = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(tap, 'timeStamp', { value: at });
  fireEvent(el, tap);
}
/** A deliberate tap, well after the sheet has opened. */
const tap = (el: Element) => tapAt(el, Date.now() + 1000);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const castButton = () => button(/^cast /i);

test('shows the card, X at zero, what that costs and how much mana is ready', async () => {
  await open();
  expect(screen.getByRole('heading', { name: 'Hungering Hydra' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Hungering Hydra' })).toBeInTheDocument();
  expect(screen.getByText('Costs 1 · 5 ready')).toBeInTheDocument(); // {X}{G} with X = 0
  expect(castButton()).toHaveTextContent('Cast for X = 0');
});

test('the stepper raises and lowers X, and the cost follows', async () => {
  await open();
  expect(button('lower X')).toBeDisabled(); // nothing below zero
  tap(button('raise X'));
  tap(button('raise X'));
  expect(screen.getByText('Costs 3 · 5 ready')).toBeInTheDocument();
  expect(castButton()).toHaveTextContent('Cast for X = 2');
  tap(button('lower X'));
  expect(screen.getByText('Costs 2 · 5 ready')).toBeInTheDocument();
  expect(castButton()).toHaveTextContent('Cast for X = 1');
});

test('Max jumps to the most the mana on the table can pay', async () => {
  await open();
  tap(button('Max'));
  expect(castButton()).toHaveTextContent('Cast for X = 4'); // five Forests: {G} and four more
  expect(screen.getByText('Costs 5 · 5 ready')).toBeInTheDocument();
});

test('each {X} in the cost is paid once per point', async () => {
  useAppStore.setState({ game: table(5, [{ iid: 'h-twin', cardId: 'c-doubler', name: 'Twin Flame' }]) });
  await open('h-twin');
  tap(button('raise X'));
  expect(screen.getByText('Costs 3 · 5 ready')).toBeInTheDocument(); // {X}{X}{G} with X = 1
  tap(button('Max'));
  expect(castButton()).toHaveTextContent('Cast for X = 2');
});

test('past what the mana covers, the one button says Cast anyway', async () => {
  await open();
  for (let i = 0; i < 5; i++) tap(button('raise X'));
  expect(screen.getByText('Costs 6 · 5 ready')).toBeInTheDocument();
  expect(castButton()).toHaveTextContent('Cast anyway (X = 5)');
  tap(button('lower X'));
  expect(castButton()).toHaveTextContent('Cast for X = 4'); // back within reach
});

test('with no mana at all it is Cast anyway from the start, and Max stays at zero', async () => {
  useAppStore.setState({ game: table(0) });
  await open();
  expect(screen.getByText('Costs 1 · 0 ready')).toBeInTheDocument();
  expect(castButton()).toHaveTextContent('Cast anyway (X = 0)');
  expect(button('Max')).toBeDisabled(); // already there
});

test('casting plays the card for that X and closes the sheet', async () => {
  const { onClose } = await open();
  tap(button('raise X'));
  tap(button('raise X'));
  tap(castButton());
  expect(playCard).toHaveBeenCalledWith(0, 'h-hydra', { x: 2 });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Cast anyway casts for the X that was asked, payable or not', async () => {
  useAppStore.setState({ game: table(1) });
  const { onClose } = await open();
  for (let i = 0; i < 3; i++) tap(button('raise X'));
  expect(castButton()).toHaveTextContent('Cast anyway (X = 3)');
  tap(castButton());
  expect(playCard).toHaveBeenCalledWith(0, 'h-hydra', { x: 3 });
  expect(onClose).toHaveBeenCalled();
});

test('closing the sheet casts nothing', async () => {
  const { onClose } = await open();
  tap(button('raise X'));
  tap(button('close'));
  expect(onClose).toHaveBeenCalled();
  expect(playCard).not.toHaveBeenCalled();
  expect(castCommander).not.toHaveBeenCalled();
});

// The sheet opens under the finger, on the tap that plays a hand card. On a touch screen that
// tap still owes its click, and the browser aims it at whatever is under the finger by then:
// this sheet. (Found with real touch input: the sheet closed the moment it opened.)

test('the click the opening tap still owes is not an answer: it neither closes the sheet nor moves X', async () => {
  const { onClose, before } = await open();
  tapAt(document.querySelector('.modal-backdrop')!, before + 20); // it lands beside the sheet
  expect(onClose).not.toHaveBeenCalled();
  tapAt(button('close'), before + 20); // or on the ✕
  expect(onClose).not.toHaveBeenCalled();
  tapAt(button('raise X'), before + 20); // or on the stepper
  tapAt(button('Max'), before + 20);
  expect(castButton()).toHaveTextContent('Cast for X = 0');
  expect(playCard).not.toHaveBeenCalled();
});

test('nor is the second half of a double tap: it cannot cast', async () => {
  const { onClose, before } = await open();
  tapAt(castButton(), before + 250);
  expect(playCard).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled(); // and the sheet is still there to answer
  tap(castButton()); // a deliberate tap a moment later
  expect(playCard).toHaveBeenCalledWith(0, 'h-hydra', { x: 0 });
});

test('once the sheet has been up for a moment every tap counts again', async () => {
  const { onClose } = await open();
  // a real wait, and taps stamped by the clock like any other event
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  fireEvent.click(button('raise X'));
  expect(castButton()).toHaveTextContent('Cast for X = 1');
  fireEvent.click(document.querySelector('.modal-backdrop')!);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a closed sheet leaves no tap unanswered behind it', async () => {
  const outside = vi.fn();
  document.body.addEventListener('click', outside);
  try {
    const { before, unmount } = await open();
    unmount();
    tapAt(document.body, before + 20); // right away, on the board
    expect(outside).toHaveBeenCalledTimes(1);
  } finally {
    document.body.removeEventListener('click', outside);
  }
});

test('from the command zone it casts the commander, with the tax counted in', async () => {
  useAppStore.setState({ game: table(6, [], 1) }); // it has gone home once: +2
  const { onClose } = await open('cmd-1', 'command');
  expect(screen.getByRole('heading', { name: 'The Goose Mother' })).toBeInTheDocument();
  expect(screen.getByText(/^Costs 4 · 6 ready/)).toBeInTheDocument(); // {X}{G}{G} + 2 tax
  expect(screen.getByText(/tax \+2/i)).toBeInTheDocument();
  tap(button('Max'));
  expect(castButton()).toHaveTextContent('Cast for X = 2');
  tap(castButton());
  expect(castCommander).toHaveBeenCalledWith(0, 'cmd-1', { x: 2 });
  expect(playCard).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test('a two-part card: X above zero means the half with the X in it', async () => {
  useAppStore.setState({
    game: table(4, [{ iid: 'h-exp', cardId: 'c-explosion', name: 'Expansion // Explosion' }]),
  });
  await open('h-exp');
  expect(screen.getByText('Costs 1 · 4 ready')).toBeInTheDocument(); // X = 0: the cheap half will do
  tap(button('raise X'));
  expect(screen.getByText('Costs 3 · 4 ready')).toBeInTheDocument(); // {X}{G}{G} with X = 1
  tap(button('Max'));
  expect(castButton()).toHaveTextContent('Cast for X = 2');
});

test('closes itself for real when its card is gone, instead of lurking', async () => {
  const { onClose } = await open();
  // The card was cast or discarded from another device:
  act(() => {
    useAppStore.setState({ game: table(5, []) });
  });
  expect(onClose).toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Hungering Hydra' })).not.toBeInTheDocument();
});

test('what is ready follows the table while the sheet is open', async () => {
  await open();
  const g = useAppStore.getState().game!;
  const seat = g.players[0].cards!;
  act(() => {
    useAppStore.setState({
      game: {
        ...g,
        players: g.players.map((p, i) =>
          i === 0
            ? {
                ...p,
                cards: {
                  ...seat,
                  // two Forests were tapped and spent on something else meanwhile
                  battlefield: seat.battlefield.map((c, k) => (k < 2 ? { ...c, tapped: true, spent: 1 } : c)),
                },
              }
            : p,
        ),
      },
    });
  });
  expect(screen.getByText('Costs 1 · 3 ready')).toBeInTheDocument();
});

// ---- optional extra costs: kicker and its relatives ----

const SPOUT: CardInstance = { iid: 'h-spout', cardId: 'c-spout', name: 'Waterspout Elemental' };
const BLAST: CardInstance = { iid: 'h-blast', cardId: 'c-blast', name: 'Everflowing Chalice' };
const WURM: CardInstance = { iid: 'h-wurm', cardId: 'c-wurm', name: 'Kicker Hydra' };
RECORDS['c-spout'] = rec(
  'c-spout',
  'Waterspout Elemental',
  'Creature — Elemental',
  '{3}{G}{G}',
  'Kicker {G} (You may pay an additional {G} as you cast this spell.)\nFlying',
);
RECORDS['c-blast'] = rec('c-blast', 'Everflowing Chalice', 'Artifact', '{0}', 'Multikicker {2}');
RECORDS['c-wurm'] = rec('c-wurm', 'Kicker Hydra', 'Creature — Hydra', '{X}{G}', 'Kicker {2}');

test('a card with a kicker asks whether it is paid: off until the player says so, and no X row', async () => {
  useAppStore.setState({ game: table(6, [SPOUT]) });
  await open('h-spout');
  const kicker = screen.getByRole('switch', { name: 'Kicker {G}' });
  expect(kicker).toHaveAttribute('aria-checked', 'false');
  expect(kicker).toHaveTextContent('Not paid');
  expect(screen.queryByRole('button', { name: 'raise X' })).not.toBeInTheDocument();
  expect(screen.getByText('Costs 5 · 6 ready')).toBeInTheDocument();
  tap(button('Cast'));
  expect(playCard).toHaveBeenCalledWith(0, 'h-spout', { extras: [0] }); // cast as printed
});

test('switching the kicker on adds its cost, and the cast says it was paid', async () => {
  useAppStore.setState({ game: table(6, [SPOUT]) });
  await open('h-spout');
  tap(screen.getByRole('switch', { name: 'Kicker {G}' }));
  expect(screen.getByRole('switch', { name: 'Kicker {G}' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('Costs 6 · 6 ready')).toBeInTheDocument();
  tap(button('Cast'));
  expect(playCard).toHaveBeenCalledWith(0, 'h-spout', { extras: [1] });
});

test('a kicker the mana does not cover is still the player’s call: the button says "anyway"', async () => {
  useAppStore.setState({ game: table(5, [SPOUT]) });
  await open('h-spout');
  expect(button('Cast')).toBeInTheDocument(); // five Forests pay the printed cost
  tap(screen.getByRole('switch', { name: 'Kicker {G}' }));
  expect(screen.getByText('Costs 6 · 5 ready')).toBeInTheDocument();
  tap(button('Cast anyway'));
  expect(playCard).toHaveBeenCalledWith(0, 'h-spout', { extras: [1] });
});

test('a multikicker is a count: each time adds its cost', async () => {
  useAppStore.setState({ game: table(5, [BLAST]) });
  await open('h-blast');
  expect(screen.getByText('Costs 0 · 5 ready')).toBeInTheDocument();
  expect(button('one fewer Multikicker {2}')).toBeDisabled();
  tap(button('one more Multikicker {2}'));
  tap(button('one more Multikicker {2}'));
  expect(screen.getByText('Costs 4 · 5 ready')).toBeInTheDocument();
  tap(button('one fewer Multikicker {2}'));
  expect(screen.getByText('Costs 2 · 5 ready')).toBeInTheDocument();
  tap(button('Cast'));
  expect(playCard).toHaveBeenCalledWith(0, 'h-blast', { extras: [1] });
});

test('X and a kicker on one card are asked together, and Max counts the kicker in', async () => {
  useAppStore.setState({ game: table(5, [WURM]) });
  await open('h-wurm');
  tap(button('Max'));
  expect(castButton()).toHaveTextContent('Cast for X = 4'); // {X}{G}: four left for X
  tap(screen.getByRole('switch', { name: 'Kicker {2}' }));
  expect(castButton()).toHaveTextContent('Cast anyway (X = 4)'); // seven mana wanted, five ready
  tap(button('Max'));
  expect(castButton()).toHaveTextContent('Cast for X = 2');
  tap(castButton());
  expect(playCard).toHaveBeenCalledWith(0, 'h-wurm', { x: 2, extras: [1] });
});

test('a card with X and no extra cost is cast exactly as before', async () => {
  await open();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  tap(castButton());
  expect(playCard).toHaveBeenCalledWith(0, 'h-hydra', { x: 0 });
});
