import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _debugBackStack, _resetBackStack } from '../lib/backstack';
import { createGame } from '../lib/game';
import type { CardRecord, GameConfig, GameState, Reveal } from '../lib/types';
import { useAppStore } from '../state/store';
import RevealBanner, { _reloadRevealMemory } from './RevealBanner';
import Sheet from './Sheet';

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

const RECORDS: Record<string, CardRecord> = {
  'c-bolt': {
    id: 'c-bolt',
    name: 'Lightning Bolt',
    nameLower: 'lightning bolt',
    typeLine: 'Instant',
    oracleText: 'Lightning Bolt deals 3 damage to any target.',
    manaCost: '{R}',
    power: null,
    toughness: null,
    colors: ['R'],
    imageNormal: 'https://img.example/c-bolt.jpg',
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  },
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

const BOLT = { cardId: 'c-bolt', name: 'Lightning Bolt' };
const MINUTE = 60_000;

let made = 0;
/** A reveal no test has shown yet. `ago`: how long since it was made. */
function reveal(over: Partial<Reveal> = {}, ago = 0): Reveal {
  return { id: `rv-${++made}`, seat: 0, from: 'hand', cards: [BOLT], t: Date.now() - ago, ...over };
}

/** The table as this device holds it, with `shown` as its latest reveal. */
function tableShows(shown?: Reveal) {
  const game: GameState = { ...createGame(config), ...(shown ? { reveal: shown } : {}) };
  act(() => useAppStore.setState({ game }));
}

const banner = () => screen.queryByRole('status');
const shields = () => Array.from(document.querySelectorAll<HTMLElement>('.tap-shield'));
/** Lets the card records land (they resolve off the clock). */
const settle = () => act(async () => {});

function fakeClock(withDate = false) {
  // Only the timer functions and the page's stopwatch (and the date when a test
  // moves it): fake-indexeddb needs the real setImmediate.
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'performance',
      ...(withDate ? (['Date'] as const) : []),
    ],
  });
}
const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** A deliberate tap on the banner: it has been up for a moment. (On the fake clock.) */
function tapAway(target: Element = banner()!) {
  pass(400);
  fireEvent.click(target);
}

beforeEach(() => {
  _resetBackStack();
  useAppStore.setState({ game: null, online: null });
});

afterEach(() => {
  cleanup(); // a banner still up goes here, and that raises a shield too…
  if (vi.isFakeTimers()) vi.runAllTimers(); // …which must lift on this test's clock
  vi.useRealTimers();
  shields().forEach((left) => left.remove());
});

test('shows who reveals what: each card by its image, or by its name on a frame when there is none', async () => {
  tableShows(
    reveal({ from: 'library', cards: [BOLT, { cardId: 'c-none', name: 'A Card With No Picture' }] }),
  );
  render(<RevealBanner />);
  const shown = banner()!;
  expect(shown).toHaveTextContent(/Nathan\s*reveals/);
  expect(shown).toHaveTextContent(/from the top of their library/i);
  const cards = within(shown).getAllByRole('listitem');
  expect(cards).toHaveLength(2);
  await waitFor(() =>
    expect(cards[0].querySelector('img')).toHaveAttribute('src', 'https://img.example/c-bolt.jpg'),
  );
  expect(cards[0]).toHaveTextContent('Lightning Bolt'); // the name sits under the art
  expect(cards[1].querySelector('img')).toBeNull();
  expect(cards[1]).toHaveTextContent('A Card With No Picture');
});

test('a reveal from the hand says so, and names the seat that made it', async () => {
  tableShows(reveal({ seat: 1, from: 'hand' }));
  render(<RevealBanner />);
  await settle();
  expect(banner()).toHaveTextContent(/Sam\s*reveals/);
  expect(banner()).toHaveTextContent(/from their hand/i);
});

test('with nothing revealed there is no banner', () => {
  render(<RevealBanner />);
  expect(banner()).toBeNull(); // no game at all
  tableShows();
  expect(banner()).toBeNull(); // a game, and nothing revealed
});

test('a tap anywhere on it puts it away', async () => {
  fakeClock();
  tableShows(reveal());
  render(<RevealBanner />);
  await settle();
  tapAway(within(banner()!).getByText('Lightning Bolt'));
  expect(banner()).toBeNull();
});

// It comes up unannounced in the middle of the table, quite possibly under a
// finger on its way to a card. That tap was not meant for the banner.

test('a tap that lands in its first moment does not put it away: it was aimed at the board', async () => {
  fakeClock();
  tableShows(reveal());
  render(<RevealBanner />);
  await settle();
  fireEvent.click(banner()!);
  pass(200);
  fireEvent.click(banner()!);
  expect(banner()).not.toBeNull(); // still there to be seen
  expect(shields()).toHaveLength(0);
  pass(200); // 400 ms after it appeared, a tap on it is an answer
  fireEvent.click(banner()!);
  expect(banner()).toBeNull();
});

test('a reveal that takes another’s place gets the same moment', async () => {
  fakeClock();
  tableShows(reveal());
  render(<RevealBanner />);
  await settle();
  pass(3_000);
  tableShows(reveal({ seat: 1, cards: [{ cardId: 'c-none', name: 'Second Card' }] }));
  fireEvent.click(banner()!); // a finger already on its way to dismiss the first
  expect(banner()).toHaveTextContent('Second Card');
  tapAway();
  expect(banner()).toBeNull();
});

test('it puts itself away after twelve seconds', async () => {
  fakeClock();
  tableShows(reveal());
  render(<RevealBanner />);
  await settle();
  pass(11_000);
  expect(banner()).not.toBeNull();
  pass(1_500);
  expect(banner()).toBeNull();
});

test('once put away it does not come back for the same reveal: not on a new state, not on a remount', async () => {
  fakeClock();
  const shown = reveal();
  tableShows(shown);
  const first = render(<RevealBanner />);
  await settle();
  tapAway();
  expect(banner()).toBeNull();
  // The table moves on (a life total, say) and still carries that reveal.
  const game = useAppStore.getState().game!;
  act(() => useAppStore.setState({ game: { ...game, turnNumber: game.turnNumber + 1 } }));
  expect(banner()).toBeNull();
  first.unmount(); // the table view gives way to the hand view and back
  render(<RevealBanner />);
  expect(banner()).toBeNull();
});

test('a reveal that timed out stays away too', async () => {
  fakeClock();
  const shown = reveal();
  tableShows(shown);
  const first = render(<RevealBanner />);
  await settle();
  pass(12_500);
  expect(banner()).toBeNull();
  first.unmount();
  render(<RevealBanner />);
  expect(banner()).toBeNull();
});

test('it stays away across a reload too: what was put away is remembered for the browser session', async () => {
  fakeClock();
  const shown = reveal();
  tableShows(shown);
  const first = render(<RevealBanner />);
  await settle();
  tapAway();
  first.unmount();
  _reloadRevealMemory(); // the page loads again: its memory is gone, the session's storage is not
  tableShows(shown); // the saved game comes back, still carrying that young reveal
  render(<RevealBanner />);
  expect(banner()).toBeNull();
});

test('a new session has forgotten: a reveal still young enough shows once more', async () => {
  fakeClock();
  const shown = reveal();
  tableShows(shown);
  const first = render(<RevealBanner />);
  await settle();
  tapAway();
  first.unmount();
  sessionStorage.clear(); // the app was closed and opened again
  _reloadRevealMemory();
  tableShows(shown);
  render(<RevealBanner />);
  await settle();
  expect(banner()).not.toBeNull(); // which is why a reveal also has to be young to show at all
});

test('where the session cannot store anything, putting a reveal away still works', async () => {
  const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  try {
    fakeClock();
    tableShows(reveal());
    render(<RevealBanner />);
    await settle();
    tapAway();
    expect(banner()).toBeNull();
    const game = useAppStore.getState().game!;
    act(() => useAppStore.setState({ game: { ...game, reveal: structuredClone(game.reveal!) } }));
    expect(banner()).toBeNull(); // remembered in memory all the same
  } finally {
    refuse.mockRestore();
  }
});

test('the next reveal takes its place, and shows even after the last one was put away', async () => {
  fakeClock();
  tableShows(reveal());
  render(<RevealBanner />);
  await settle();
  tableShows(reveal({ seat: 1, cards: [{ cardId: 'c-none', name: 'Second Card' }] }));
  expect(banner()).toHaveTextContent(/Sam\s*reveals/);
  expect(banner()).toHaveTextContent('Second Card');
  expect(banner()).not.toHaveTextContent('Lightning Bolt');
  tapAway();
  expect(banner()).toBeNull();
  tableShows(reveal({ cards: [{ cardId: 'c-none', name: 'Third Card' }] }));
  expect(banner()).toHaveTextContent('Third Card');
});

test('the table moving on does not restart its twelve seconds', async () => {
  fakeClock();
  tableShows(reveal());
  render(<RevealBanner />);
  await settle();
  pass(4_000);
  const game = useAppStore.getState().game!; // someone taps a land, a life total moves…
  act(() => useAppStore.setState({ game: { ...game, turnNumber: game.turnNumber + 1 } }));
  pass(4_000);
  // …and the table's next state arrives from another device: the same reveal, as a fresh object.
  const later = useAppStore.getState().game!;
  act(() => useAppStore.setState({ game: { ...later, reveal: structuredClone(later.reveal!) } }));
  expect(banner()).not.toBeNull();
  pass(4_500);
  expect(banner()).toBeNull(); // twelve seconds in all, not four plus four plus twelve
});

test('a new reveal gets its own twelve seconds', async () => {
  fakeClock();
  tableShows(reveal());
  render(<RevealBanner />);
  await settle();
  pass(10_000);
  tableShows(reveal({ cards: [{ cardId: 'c-none', name: 'Second Card' }] }));
  pass(10_000); // twenty seconds since the first, ten since this one
  expect(banner()).toHaveTextContent('Second Card');
  pass(2_500);
  expect(banner()).toBeNull();
});

test('a stale reveal is ignored: a reload must not bring an old one back', () => {
  tableShows(reveal({}, 3 * MINUTE)); // what a restored save or a rejoined table still carries
  render(<RevealBanner />);
  expect(banner()).toBeNull();
});

test('a reveal younger than two minutes still shows on a device that only now sees it', async () => {
  tableShows(reveal({}, 2 * MINUTE - 10_000));
  render(<RevealBanner />);
  await settle();
  expect(banner()).not.toBeNull();
});

test('a reveal stamped by a clock that runs ahead of this one still shows', async () => {
  tableShows(reveal({}, -5 * MINUTE));
  render(<RevealBanner />);
  await settle();
  expect(banner()).not.toBeNull();
});

// A stamp from a clock that runs ahead never looks old to this device, so its
// age is also counted from the moment this device first saw it.

test('a reveal stamped by a clock an hour fast does not come back when the app is reopened half an hour later', async () => {
  fakeClock(true);
  vi.setSystemTime(new Date('2026-10-06T20:00:00Z'));
  const shown = reveal({ seat: 1, cards: [{ cardId: 'c-none', name: 'Secret Plan' }] }, -60 * MINUTE);
  tableShows(shown);
  render(<RevealBanner />);
  await settle();
  expect(banner()).not.toBeNull(); // seen once
  pass(14_000);
  expect(banner()).toBeNull(); // put away
  pass(30 * MINUTE);
  cleanup();
  sessionStorage.clear(); // the app was closed and opened again
  _reloadRevealMemory();
  tableShows(shown); // nobody has revealed anything since
  render(<RevealBanner />);
  await settle();
  expect(banner()).toBeNull();
});

test('a reveal stamped by a fast clock still goes stale while it waits under a sheet', async () => {
  fakeClock(true);
  vi.setSystemTime(new Date('2026-10-06T20:00:00Z'));
  tableShows(reveal({}, -60 * MINUTE));
  const { rerender } = render(<Table sheet />);
  await settle();
  pass(2 * MINUTE + 2_000);
  expect(banner()).toBeNull();
  rerender(<Table sheet={false} />);
  expect(banner()).toBeNull();
});

test('it never touches the back stack', async () => {
  fakeClock();
  const entries = history.length;
  tableShows(reveal());
  render(<RevealBanner />);
  await settle();
  expect(_debugBackStack()).toMatchObject({ depth: 0, ats: [] });
  tapAway();
  expect(banner()).toBeNull();
  expect(_debugBackStack()).toMatchObject({ depth: 0, ats: [] });
  expect(history.length).toBe(entries);
});

// The tap that puts the banner away is often the first half of a double tap. The
// second half must not act on the board the banner was covering.

test('a tap that puts it away leaves the board shielded for a moment', async () => {
  fakeClock();
  tableShows(reveal());
  render(<RevealBanner />);
  await settle();
  expect(shields()).toHaveLength(0);
  tapAway();
  expect(banner()).toBeNull();
  expect(shields()).toHaveLength(1);
  expect(shields()[0].parentElement).toBe(document.body);
  vi.advanceTimersByTime(300); // where the second half of a double tap lands
  expect(shields()).toHaveLength(1);
  vi.advanceTimersByTime(700);
  expect(shields()).toHaveLength(0);
});

test('so does the banner timing out under a finger that was on its way', async () => {
  fakeClock();
  tableShows(reveal());
  render(<RevealBanner />);
  await settle();
  pass(12_000);
  expect(banner()).toBeNull();
  expect(shields()).toHaveLength(1);
});

// A sheet lies over the banner (it sits under every backdrop), so nobody could
// see its twelve seconds pass there — the player who reveals from a look least of all.

/** The banner with or without a sheet open over it. */
function Table({ sheet }: { sheet: boolean }) {
  return (
    <>
      <RevealBanner />
      {sheet && (
        <Sheet title="Library" onClose={() => {}}>
          <p>a look in progress</p>
        </Sheet>
      )}
    </>
  );
}

test('its twelve seconds wait while a sheet covers it, and start once the sheet is gone', async () => {
  fakeClock();
  tableShows(reveal());
  const { rerender } = render(<Table sheet />);
  await settle();
  pass(60_000);
  expect(banner()).not.toBeNull(); // still waiting under the sheet
  pass(300); // the sheet closes part-way through one of the banner's seconds…
  rerender(<Table sheet={false} />);
  pass(12_000);
  expect(banner()).not.toBeNull(); // …so the part-second does not count: never less than twelve in view
  pass(1_000);
  expect(banner()).toBeNull(); // and never much more
});

test('a sheet that opens over it stops its clock; the seconds already seen still count', async () => {
  fakeClock();
  tableShows(reveal());
  const { rerender } = render(<Table sheet={false} />);
  await settle();
  pass(5_000); // five seconds in view
  rerender(<Table sheet />);
  pass(30_000);
  expect(banner()).not.toBeNull();
  rerender(<Table sheet={false} />);
  pass(7_500);
  expect(banner()).not.toBeNull(); // five before, and not yet seven whole seconds after
  pass(1_000);
  expect(banner()).toBeNull();
});

test('a reveal that goes stale while it waits under a sheet is put away unseen', async () => {
  fakeClock(true);
  vi.setSystemTime(new Date('2026-10-06T20:00:00Z'));
  const shown = reveal();
  tableShows(shown);
  const { rerender } = render(<Table sheet />);
  await settle();
  pass(2 * MINUTE + 2_000);
  expect(banner()).toBeNull();
  rerender(<Table sheet={false} />);
  expect(banner()).toBeNull(); // too old to be news by the time the sheet closed
});

describe('stacking, as the app stylesheets have it', () => {
  // jsdom cannot hit-test, but it does read a stylesheet: enough to tell who lies over whom.
  let css: HTMLStyleElement;
  beforeEach(() => {
    css = document.createElement('style');
    css.textContent = ['screens.css', 'zones.css']
      .map((file) => readFileSync(resolve(process.cwd(), 'src/styles', file), 'utf8'))
      .join('\n');
    document.head.appendChild(css);
  });
  afterEach(() => css.remove());
  const layer = (el: Element) => Number(getComputedStyle(el).zIndex);
  /** Something that lives on the board, by its class. */
  const onBoard = (className: string) => {
    const el = document.createElement('div');
    el.className = className;
    document.body.appendChild(el);
    return el;
  };

  test('the banner lies over everything the board shows and under the tap shield and every sheet', async () => {
    tableShows(reveal());
    render(<Table sheet />);
    await settle();
    const board = ['table-banner', 'hand-jump', 'table-pill', 'center-hub'].map(onBoard);
    const shield = onBoard('tap-shield');
    try {
      const mine = layer(banner()!);
      for (const el of board) expect(mine).toBeGreaterThan(layer(el) || 0);
      expect(mine).toBeLessThan(layer(shield));
      expect(mine).toBeLessThan(layer(document.querySelector('.modal-backdrop')!));
      expect(getComputedStyle(banner()!).position).toBe('fixed'); // screen-centred, whatever the zones do
    } finally {
      [...board, shield].forEach((el) => el.remove());
    }
  });
});
