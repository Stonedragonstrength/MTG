import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../data/settings';
import type { GameConfig } from '../lib/types';
import { flushPersistence, useAppStore } from '../state/store';
import CenterHub from './CenterHub';
import GameScreen from './GameScreen';
import HistoryScreen from './HistoryScreen';
import PlayerSheet from './PlayerSheet';
import { VICTORY_SETTLE_MS } from './VictoryScreen';

const config = (n = 3): GameConfig => ({
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: ['Nathan', 'Sam', 'Alex'][i],
    avatarUrl: null,
    commanderName: ['Ashaya, Soul of the Wild', 'Vilis, Broker of Blood', 'Tana, the Bloodsower'][i],
  })),
});

const settle = () => act(() => new Promise((r) => setTimeout(r, VICTORY_SETTLE_MS + 60)));

/** A tap at a moment of our choosing: confirms go by when taps land. */
function tapAt(button: HTMLElement, at: number) {
  const tap = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(tap, 'timeStamp', { value: at });
  fireEvent(button, tap);
}

/** Nathan wins: Sam and Alex go to 0. */
function won() {
  const s = useAppStore.getState();
  s.startGame(config());
  s.adjustLife(1, -40);
  s.adjustLife(2, -40);
}

beforeEach(async () => {
  await flushPersistence();
  useAppStore.setState({
    game: null,
    online: null,
    seatFlips: {},
    games: [],
    settings: { ...DEFAULT_SETTINGS, soundOn: false, autoFocusOn: false },
  });
});

describe('the victory screen', () => {
  test('the last player standing: their name, the turn, and the recap', () => {
    won();
    render(<GameScreen />);
    const over = screen.getByRole('dialog', { name: 'Game over' });
    expect(within(over).getByText('Victory')).toBeInTheDocument();
    expect(within(over).getByRole('heading', { name: 'Nathan' })).toBeInTheDocument();
    expect(within(over).getByText(/wins on turn 1/)).toBeInTheDocument();
    expect(within(over).getByText(/with Ashaya/)).toBeInTheDocument();
    expect(within(over).getAllByText('Out of life')).toHaveLength(2);
    expect(within(over).getByText('Winner · 40 life')).toBeInTheDocument();
  });

  test('nothing shows while two players are still in', () => {
    useAppStore.getState().startGame(config());
    useAppStore.getState().adjustLife(1, -40);
    render(<GameScreen />);
    expect(screen.queryByRole('dialog', { name: 'Game over' })).not.toBeInTheDocument();
  });

  test('its buttons wait a moment: the end of a count-down cannot end the game', async () => {
    won();
    render(<GameScreen />);
    expect(screen.getByRole('button', { name: 'Home' })).toBeDisabled();
    await settle();
    expect(screen.getByRole('button', { name: 'Home' })).toBeEnabled();
  });

  test('Look at the board puts it away, and the pill brings it back', async () => {
    won();
    render(<GameScreen />);
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'Look at the board' }));
    expect(screen.queryByRole('dialog', { name: 'Game over' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Nathan wins · See the results/ }));
    expect(screen.getByRole('dialog', { name: 'Game over' })).toBeInTheDocument();
  });

  test('Home ends the game; it stays in the history', async () => {
    won();
    render(<GameScreen />);
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'Home' }));
    await flushPersistence();
    expect(useAppStore.getState().game).toBeNull();
    expect(useAppStore.getState().games.map((r) => r.winner)).toEqual([0]);
  });

  test('Rematch deals the same table again', async () => {
    won();
    render(<GameScreen />);
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    const g = useAppStore.getState().game!;
    expect(g.players.map((p) => [p.life, p.eliminated])).toEqual([
      [40, false],
      [40, false],
      [40, false],
    ]);
    expect(screen.queryByRole('dialog', { name: 'Game over' })).not.toBeInTheDocument();
  });

  test('Undo takes the win back, and the history with it', async () => {
    won();
    render(<GameScreen />);
    await settle();
    await userEvent.click(screen.getByRole('button', { name: /Undo/ }));
    await flushPersistence();
    expect(screen.queryByRole('dialog', { name: 'Game over' })).not.toBeInTheDocument();
    expect(useAppStore.getState().games).toEqual([]);
  });

  test('no Rematch at an online table', () => {
    won();
    useAppStore.setState({ online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: 0 } });
    render(<GameScreen />);
    expect(screen.queryByRole('button', { name: 'Rematch' })).not.toBeInTheDocument();
  });

  test('everyone falling at once is a draw', () => {
    useAppStore.getState().startGame(config(2));
    useAppStore.setState((s) => ({
      game: { ...s.game!, players: s.game!.players.map((p) => ({ ...p, life: 0, eliminated: true })) },
    }));
    render(<GameScreen />);
    const over = screen.getByRole('dialog', { name: 'Game over' });
    expect(within(over).getByText('Draw')).toBeInTheDocument();
    expect(within(over).getByRole('heading', { name: 'Nobody wins' })).toBeInTheDocument();
  });

  test('it turns to face the winner: the top seat of a duel', () => {
    const s = useAppStore.getState();
    s.startGame(config(2));
    s.adjustLife(0, -40);
    const { container } = render(<GameScreen />);
    expect(container.querySelector('.victory-panel--top')).not.toBeNull();
  });
});

describe('ending a game by hand', () => {
  test('End → Who won? puts the game into the history as theirs', async () => {
    useAppStore.getState().startGame(config());
    render(<CenterHub variant="row" />);
    await userEvent.click(screen.getByRole('button', { name: 'more options' }));
    await userEvent.click(screen.getByRole('button', { name: 'end game' }));
    const chips = screen.getByRole('radiogroup', { name: 'who won' });
    expect(within(chips).getByRole('radio', { name: 'Nobody' })).toBeChecked();
    await userEvent.click(within(chips).getByRole('radio', { name: 'Sam' }));
    await userEvent.click(screen.getByRole('button', { name: 'End it — Sam won' }));
    await flushPersistence();
    expect(useAppStore.getState().game).toBeNull();
    const [rec] = useAppStore.getState().games;
    expect(rec.winner).toBe(1);
    expect(rec.outs.map((o) => o.how)).toEqual(['conceded', 'conceded']);
  });

  test('ending with Nobody picked records nothing', async () => {
    useAppStore.getState().startGame(config());
    render(<CenterHub variant="row" />);
    await userEvent.click(screen.getByRole('button', { name: 'more options' }));
    await userEvent.click(screen.getByRole('button', { name: 'end game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, end it' }));
    await flushPersistence();
    expect(useAppStore.getState().game).toBeNull();
    expect(useAppStore.getState().games).toEqual([]);
  });

  test('Concede in the player sheet takes a second, deliberate tap', async () => {
    useAppStore.getState().startGame(config());
    render(<PlayerSheet playerIdx={2} onClose={() => {}} />);
    const button = screen.getByRole('button', { name: '🏳 Concede' });
    tapAt(button, 5000);
    tapAt(button, 5150); // the second half of the same double tap
    expect(useAppStore.getState().game!.players[2].eliminated).toBe(false);
    tapAt(screen.getByRole('button', { name: 'Really concede?' }), 6000);
    expect(useAppStore.getState().game!.players[2].eliminated).toBe(true);
  });
});

describe('the history screen', () => {
  test('standings, the games, and a game recap with a way to take it out and back', async () => {
    won();
    await flushPersistence();
    render(<HistoryScreen onBack={() => {}} />);
    expect(screen.getByText('1 game')).toBeInTheDocument();
    expect(screen.getByText('Nathan won')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Nathan won'));
    const sheet = document.querySelector('.sheet') as HTMLElement;
    expect(within(sheet).getByText('Winner · 40 life')).toBeInTheDocument();
    const out = within(sheet).getByRole('button', { name: 'Remove from history' });
    tapAt(out, 5000);
    tapAt(within(sheet).getByRole('button', { name: 'Really remove it?' }), 6000);
    await act(() => flushPersistence());
    await screen.findByRole('button', { name: /restore Nathan won/ });
    expect(screen.getByText('0 games')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /restore Nathan won/ }));
    expect(await screen.findByText('1 game')).toBeInTheDocument();
  });

  test('says how a game gets there when there are none', () => {
    render(<HistoryScreen onBack={() => {}} />);
    expect(screen.getByText(/No finished games yet/)).toBeInTheDocument();
  });
});
