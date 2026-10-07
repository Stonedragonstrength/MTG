import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import CenterHub from './CenterHub';

vi.mock('../data/rules', () => ({
  getGlossary: vi.fn(async () => []),
  searchRules: vi.fn(async () => []),
}));
vi.mock('../data/scryfall', () => ({
  importBulkData: vi.fn(async () => 0),
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => undefined),
}));

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: Array.from({ length: 4 }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    avatarUrl: null,
    commanderName: null,
  })),
};

beforeEach(() => {
  useAppStore.setState({ game: createGame(config) });
});

test('shows the turn number without repeating the player name', () => {
  render(<CenterHub />);
  expect(screen.getByText(/turn 1/i)).toBeInTheDocument();
  expect(screen.queryByText('Player 0')).not.toBeInTheDocument();
});

test('pass turn advances to the next player', async () => {
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /pass turn/i }));
  expect(useAppStore.getState().game?.activePlayerIndex).toBe(1);
});

test('ending the game requires an inline confirmation', async () => {
  const endGame = vi.fn();
  useAppStore.setState({ endGame });
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /more options/i }));
  await user.click(screen.getByRole('button', { name: /end game/i }));
  expect(endGame).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /yes, end it/i }));
  expect(endGame).toHaveBeenCalled();
});

test('the options tray is collapsed by default; undo stays visible', async () => {
  const user = userEvent.setup();
  render(<CenterHub />);
  expect(screen.getByText('Undo')).toBeInTheDocument();
  for (const label of ['Dice', 'Rules', 'Settings', 'End', 'Log', 'Combat math', 'Stack']) {
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  }
  await user.click(screen.getByRole('button', { name: /more options/i }));
  for (const label of ['Dice', 'Rules', 'Settings', 'End', 'Log', 'Combat math', 'Stack']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});

test('picking an action closes the tray', async () => {
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /more options/i }));
  await user.click(screen.getByRole('button', { name: /dice/i }));
  expect(screen.queryByText('Rules')).not.toBeInTheDocument(); // tray closed
});

test('undo button delegates to the store and disables without history', async () => {
  const undo = vi.fn();
  useAppStore.setState({ undo, canUndo: () => true });
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /undo/i }));
  expect(undo).toHaveBeenCalled();
});

test('the turn clock shows when enabled and hides when off', () => {
  const settings = useAppStore.getState().settings;
  useAppStore.setState({ settings: { ...settings, turnTimerOn: true } });
  const { unmount } = render(<CenterHub />);
  expect(screen.getByTestId('turn-clock').textContent).toMatch(/\d+:\d\d/);
  unmount();

  useAppStore.setState({ settings: { ...settings, turnTimerOn: false } });
  render(<CenterHub />);
  expect(screen.queryByTestId('turn-clock')).not.toBeInTheDocument();
});

test('the log sheet shows game history', async () => {
  useAppStore.setState({ log: [{ t: Date.now(), text: 'Nate: life 40 → 38' }] });
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /more options/i }));
  await user.click(screen.getByRole('button', { name: /game log/i }));
  expect(await screen.findByText(/life 40 → 38/)).toBeInTheDocument();
});

test('dice roller produces a result in range', async () => {
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /more options/i }));
  await user.click(screen.getByRole('button', { name: /dice/i }));
  await user.click(screen.getByRole('button', { name: /d20/i }));
  const result = Number(screen.getByTestId('dice-result').textContent);
  expect(result).toBeGreaterThanOrEqual(1);
  expect(result).toBeLessThanOrEqual(20);
});

// ---- "Turn bar stays put": the hub docked in a zone that is not the active player's ----

/** Seat `active` is taking turn `turn`. */
function turnOf(active: number, turn = 5) {
  useAppStore.setState({
    game: { ...createGame(config), activePlayerIndex: active, turnNumber: turn },
  });
}

const sheetTitles = () => [...document.querySelectorAll('.sheet h2')].map((h) => h.textContent);

test('docked in another player’s zone the hub says whose turn it is', () => {
  const settings = useAppStore.getState().settings;
  useAppStore.setState({ settings: { ...settings, turnTimerOn: true } });
  turnOf(2);
  const { container } = render(<CenterHub variant="row" seat={0} />);
  expect(container.querySelector('.hub-turn')!.textContent).toMatch(/^Turn 5 · Player 2 · \d+:\d\d$/);
});

test('with the clock off it still names the active player', () => {
  const settings = useAppStore.getState().settings;
  useAppStore.setState({ settings: { ...settings, turnTimerOn: false } });
  turnOf(3);
  const { container } = render(<CenterHub variant="row" seat={0} />);
  expect(container.querySelector('.hub-turn')!.textContent).toBe('Turn 5 · Player 3');
});

test('docked in the active player’s own zone it does not repeat their name', () => {
  turnOf(2);
  render(<CenterHub variant="row" seat={2} />);
  expect(screen.getByText(/turn 5/i)).toBeInTheDocument();
  expect(screen.queryByText('Player 2')).not.toBeInTheDocument();
});

test('in a collapsed bar "More" opens the options in a sheet instead of unfolding in place', async () => {
  turnOf(1);
  const user = userEvent.setup();
  const { container } = render(<CenterHub variant="row" seat={0} compact />);
  expect(screen.getByRole('button', { name: /pass turn/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /more options/i }));
  expect(container.querySelector('.hub-tray')).toBeNull(); // the bar cannot grow: nothing unfolds in it
  expect(sheetTitles()).toEqual(['More']);
  const sheet = within(document.querySelector<HTMLElement>('.sheet')!);
  for (const label of ['Combat math', 'Stack', 'Dice', 'Rules', 'Log', 'Settings', 'End']) {
    expect(sheet.getByText(label)).toBeInTheDocument();
  }
});

test('every option in that sheet opens its own sheet, and closing it lands back on the table', async () => {
  turnOf(1);
  const user = userEvent.setup();
  render(<CenterHub variant="row" seat={0} compact />);
  const options: [RegExp, string][] = [
    [/combat math/i, 'Combat math'],
    [/the stack/i, 'The Stack'],
    [/^dice$/i, 'Dice'],
    [/^rules$/i, 'Rules & Glossary'],
    [/game log/i, 'Game log'],
    [/^settings$/i, 'Settings'],
    [/end game/i, 'End this game?'],
  ];
  for (const [option, title] of options) {
    await user.click(screen.getByRole('button', { name: /more options/i }));
    expect(sheetTitles()).toEqual(['More']);
    await user.click(screen.getByRole('button', { name: option }));
    expect(sheetTitles()).toEqual([title]); // the chosen sheet alone: the options stepped aside
    await user.click(screen.getByRole('button', { name: 'close' }));
    expect(sheetTitles()).toEqual([]); // not back in the options
  }
});

test('the compact hub still passes the turn', async () => {
  turnOf(1);
  const user = userEvent.setup();
  render(<CenterHub variant="row" seat={0} compact />);
  await user.click(screen.getByRole('button', { name: /pass turn/i }));
  expect(useAppStore.getState().game?.activePlayerIndex).toBe(2);
});

/** A tap that happens at a moment of our choosing (ms). */
function tapAt(button: HTMLElement, at: number) {
  const tap = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(tap, 'timeStamp', { value: at });
  fireEvent(button, tap);
}

test('a double tap on a Pass turn that stays put passes once, and a deliberate second tap passes again', () => {
  turnOf(0);
  render(<CenterHub variant="row" seat={3} compact />);
  const active = () => useAppStore.getState().game?.activePlayerIndex;
  tapAt(screen.getByRole('button', { name: /pass turn/i }), 5000);
  expect(active()).toBe(1);
  tapAt(screen.getByRole('button', { name: /pass turn/i }), 5150); // the same double tap: nobody is skipped
  expect(active()).toBe(1);
  tapAt(screen.getByRole('button', { name: /pass turn/i }), 5900);
  expect(active()).toBe(2);
});

test('a stray double tap on End in the options sheet cannot answer "Yes, end it"', () => {
  const endGame = vi.fn();
  useAppStore.setState({ endGame });
  turnOf(1);
  render(<CenterHub variant="row" seat={0} compact />);
  fireEvent.click(screen.getByRole('button', { name: /more options/i }));
  tapAt(screen.getByRole('button', { name: /end game/i }), 5000);
  // The second half of that double tap lands where the confirm sheet has just opened.
  tapAt(screen.getByRole('button', { name: /yes, end it/i }), 5150);
  expect(endGame).not.toHaveBeenCalled();
  expect(sheetTitles()).toEqual(['End this game?']); // still asking
  tapAt(screen.getByRole('button', { name: /yes, end it/i }), 6200); // a deliberate answer
  expect(endGame).toHaveBeenCalledTimes(1);
});

test('a tray left unfolded folds away when the pinned hub’s zone collapses, and stays folded', async () => {
  turnOf(0);
  const user = userEvent.setup();
  const { container, rerender } = render(<CenterHub variant="row" seat={0} />);
  await user.click(screen.getByRole('button', { name: /more options/i }));
  expect(container.querySelector('.hub-tray')).not.toBeNull();

  rerender(<CenterHub variant="row" seat={0} compact />); // the turn passed: the zone is a slim bar now
  expect(container.querySelector('.hub-tray')).toBeNull();
  expect(sheetTitles()).toEqual([]); // and it did not turn into a sheet nobody asked for

  rerender(<CenterHub variant="row" seat={0} />); // their turn again
  expect(container.querySelector('.hub-tray')).toBeNull();
});

// ---- combat on the cards: passing the turn ends the fight, so it asks first ----

/** Seat 0's turn with a fight open on the table. */
function fightOn(id = 'c1') {
  const game = { ...createGame(config), turnNumber: 5 };
  useAppStore.setState({ game: { ...game, combat: { id, turn: 5, active: 0, step: 'attackers' } } });
}
const combatOf = () => useAppStore.getState().game!.combat;

test('while a fight is on, Pass turn asks in place — "End combat and pass?" — and only a deliberate second tap passes', () => {
  fightOn();
  render(<CenterHub variant="row" seat={0} />);
  const active = () => useAppStore.getState().game?.activePlayerIndex;
  tapAt(screen.getByRole('button', { name: 'Pass turn' }), 5000);
  expect(active()).toBe(0);
  const asking = screen.getByRole('button', { name: 'End combat and pass?' });
  expect(asking.className).toContain('hub-pass');
  tapAt(asking, 5150); // the other half of a double tap is not an answer
  expect(active()).toBe(0);
  expect(combatOf()).toMatchObject({ id: 'c1', step: 'attackers' });
  tapAt(asking, 5900);
  expect(active()).toBe(1);
  expect(combatOf()).toBeUndefined(); // the store dropped the fight with the turn
  expect(screen.getByRole('button', { name: 'Pass turn' })).toBeInTheDocument(); // and the question with it
});

test('…and the double-tap guard still holds once it has passed', () => {
  fightOn();
  render(<CenterHub variant="row" seat={3} compact />); // pinned: it stays under the finger
  const active = () => useAppStore.getState().game?.activePlayerIndex;
  tapAt(screen.getByRole('button', { name: 'Pass turn' }), 1000);
  tapAt(screen.getByRole('button', { name: 'End combat and pass?' }), 1700);
  expect(active()).toBe(1);
  tapAt(screen.getByRole('button', { name: 'Pass turn' }), 1850); // the same double tap: nobody is skipped
  expect(active()).toBe(1);
  tapAt(screen.getByRole('button', { name: 'Pass turn' }), 2500);
  expect(active()).toBe(2); // no fight now: one tap
});

test('a question nobody answers goes back to Pass turn; so does one whose fight ended some other way', () => {
  vi.useFakeTimers();
  try {
    fightOn();
    render(<CenterHub variant="row" seat={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pass turn' }));
    expect(screen.getByRole('button', { name: 'End combat and pass?' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(screen.getByRole('button', { name: 'Pass turn' })).toBeInTheDocument();
    expect(useAppStore.getState().game?.activePlayerIndex).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Pass turn' }));
    expect(screen.getByRole('button', { name: 'End combat and pass?' })).toBeInTheDocument();
    act(() => useAppStore.getState().cancelCombat()); // applied or called off from the bar
    expect(screen.getByRole('button', { name: 'Pass turn' })).toBeInTheDocument();
    // a new fight starts with a fresh question, not an armed one
    act(() => useAppStore.getState().startCombat());
    tapAt(screen.getByRole('button', { name: 'Pass turn' }), 90_000);
    expect(useAppStore.getState().game?.activePlayerIndex).toBe(0);
    expect(screen.getByRole('button', { name: 'End combat and pass?' })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('without a fight Pass turn is one tap, as ever — also after a fight that is finished', () => {
  const game = { ...createGame(config), turnNumber: 5 };
  useAppStore.setState({ game: { ...game, combat: { id: 'done1', turn: 5, active: 0, step: 'done' } } });
  render(<CenterHub variant="row" seat={0} />);
  fireEvent.click(screen.getByRole('button', { name: 'Pass turn' }));
  expect(useAppStore.getState().game?.activePlayerIndex).toBe(1);
});

test('the arithmetic sheet under More is called "Combat math", so nobody takes it for the fight on the cards', async () => {
  const user = userEvent.setup();
  render(<CenterHub />);
  await user.click(screen.getByRole('button', { name: /more options/i }));
  expect(screen.getByText('Combat math')).toBeInTheDocument();
  expect(screen.queryByText('Combat')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'combat math' }));
  expect(sheetTitles()).toEqual(['Combat math']);
});
