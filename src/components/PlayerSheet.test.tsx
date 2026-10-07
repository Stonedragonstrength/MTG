import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import PlayerSheet from './PlayerSheet';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'Nate', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  ],
};

beforeEach(() => {
  useAppStore.setState({ game: createGame(config) });
});

test('poison, energy, and experience steppers wire to the store', async () => {
  const spy = vi.fn();
  useAppStore.setState({ setPlayerCounter: spy });
  const user = userEvent.setup();
  render(<PlayerSheet playerIdx={0} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /more poison/i }));
  expect(spy).toHaveBeenCalledWith(0, 'poison', 1);
  await user.click(screen.getByRole('button', { name: /more energy/i }));
  expect(spy).toHaveBeenCalledWith(0, 'energy', 1);
});

test('commander deaths show the current tax', async () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], commanderDeaths: 2 };
  useAppStore.setState({ game });
  render(<PlayerSheet playerIdx={0} onClose={() => {}} />);
  expect(screen.getByText(/tax \+4/i)).toBeInTheDocument();
});

test('commander damage has precise steppers per enemy', async () => {
  const spy = vi.fn();
  useAppStore.setState({ applyCommanderDamage: spy });
  const user = userEvent.setup();
  render(<PlayerSheet playerIdx={0} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /more commander damage from sam/i }));
  expect(spy).toHaveBeenCalledWith(0, 'p1', 1);
  await user.click(screen.getByRole('button', { name: /less commander damage from sam/i }));
  expect(spy).toHaveBeenCalledWith(0, 'p1', -1);
});

test('monarch and initiative can be claimed from the sheet', async () => {
  const monarch = vi.fn();
  const initiative = vi.fn();
  useAppStore.setState({ claimMonarch: monarch, claimInitiative: initiative });
  const user = userEvent.setup();
  render(<PlayerSheet playerIdx={1} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /monarch/i }));
  expect(monarch).toHaveBeenCalledWith(1);
  await user.click(screen.getByRole('button', { name: /initiative/i }));
  expect(initiative).toHaveBeenCalledWith(1);
});

test('a partner pair gets a commander-damage row per commander', async () => {
  const spy = vi.fn();
  useAppStore.setState({
    applyCommanderDamage: spy,
    game: createGame({
      ...config,
      profiles: [
        config.profiles[0],
        { ...config.profiles[1], commanderName: 'Thrasios', partnerName: 'Tymna' },
      ],
    }),
  });
  const user = userEvent.setup();
  render(<PlayerSheet playerIdx={0} onClose={() => {}} />);
  expect(screen.getByText(/cmdr dmg from Sam — Thrasios/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /more commander damage from Sam — Tymna/i }));
  expect(spy).toHaveBeenCalledWith(0, 'p1#2', 1);
});

test('"Flip this side" turns that player’s side around on this device, and back again', async () => {
  useAppStore.setState({ seatFlips: {} });
  const game = useAppStore.getState().game;
  const user = userEvent.setup();
  render(<PlayerSheet playerIdx={1} onClose={() => {}} />);
  expect(screen.getByText('Flip this side')).toBeInTheDocument();
  expect(
    screen.getByText("Turns this player's side of the table around on this device."),
  ).toBeInTheDocument();
  const flip = screen.getByRole('button', { name: /flip this side/i });
  expect(flip).toHaveAttribute('aria-pressed', 'false');

  await user.click(flip);
  expect(useAppStore.getState().seatFlips).toEqual({ 1: true }); // this seat and no other
  expect(flip).toHaveAttribute('aria-pressed', 'true');

  await user.click(flip);
  expect(useAppStore.getState().seatFlips).toEqual({});
  expect(flip).toHaveAttribute('aria-pressed', 'false');
  expect(useAppStore.getState().game).toBe(game); // the game itself never heard of it
});

// ---- a seat that tracks its commanders per card: each one's trips home can be put right ----

/** The store is shared by every test in this file, spies and all: the real action, kept aside. */
const realSetCommanderReturns = useAppStore.getState().setCommanderReturns;

/** Nate plays cards with a partner pair: Thrasios has gone home twice, Tymna never. */
function pairGame() {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    commanderDeaths: 2,
    cards: {
      library: [],
      hand: [],
      battlefield: [{ iid: 'zz-thrasios', cardId: 'c-thrasios', name: 'Thrasios, Triton Hero', row: 'front' }],
      graveyard: [],
      exile: [],
      command: [{ iid: 'aa-tymna', cardId: 'c-tymna', name: 'Tymna the Weaver' }],
      mulligans: 0,
      deckName: 'Pair',
      cmd: { 'zz-thrasios': 2, 'aa-tymna': 0 },
    },
  };
  return game;
}

test('a cards seat has one stepper per tracked commander for its trips back to the command zone, wherever the card is', () => {
  useAppStore.setState({ game: pairGame() });
  render(<PlayerSheet playerIdx={0} onClose={() => {}} />);
  expect(screen.getByText(/Tymna the Weaver: back to the command zone/)).toHaveTextContent('(tax +0)');
  expect(screen.getByText(/Thrasios, Triton Hero: back to the command zone/)).toHaveTextContent('(tax +4)');
  // the seat-wide count such a seat ignores is gone
  expect(screen.queryByText(/commander deaths/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /more commander deaths/i })).not.toBeInTheDocument();
});

test('a wrongly added tax can be taken off again, and the stepper stops at nothing', async () => {
  const spy = vi.fn();
  useAppStore.setState({ game: pairGame(), setCommanderReturns: spy });
  const user = userEvent.setup();
  render(<PlayerSheet playerIdx={0} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'fewer returns to the command zone for Thrasios, Triton Hero' }));
  expect(spy).toHaveBeenCalledWith(0, 'zz-thrasios', 1);
  await user.click(screen.getByRole('button', { name: 'more returns to the command zone for Tymna the Weaver' }));
  expect(spy).toHaveBeenCalledWith(0, 'aa-tymna', 1);
  expect(screen.getByRole('button', { name: 'fewer returns to the command zone for Tymna the Weaver' })).toBeDisabled();
});

test('through the real store the correction moves that commander’s tax and nothing else', async () => {
  useAppStore.setState({ game: pairGame(), setCommanderReturns: realSetCommanderReturns });
  const user = userEvent.setup();
  render(<PlayerSheet playerIdx={0} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'fewer returns to the command zone for Thrasios, Triton Hero' }));
  expect(useAppStore.getState().game!.players[0].cards!.cmd).toEqual({ 'zz-thrasios': 1, 'aa-tymna': 0 });
  expect(screen.getByText(/Thrasios, Triton Hero: back to the command zone/)).toHaveTextContent('(tax +2)');
});

test('a tracker seat keeps its one "Commander deaths" stepper, and a Standard game has neither', () => {
  const { unmount } = render(<PlayerSheet playerIdx={1} onClose={() => {}} />);
  expect(screen.getByRole('button', { name: /more commander deaths/i })).toBeInTheDocument();
  expect(screen.queryByText(/back to the command zone/)).not.toBeInTheDocument();
  unmount();
  const standard = pairGame();
  useAppStore.setState({ game: { ...standard, config: { ...standard.config, format: 'standard' } } });
  render(<PlayerSheet playerIdx={0} onClose={() => {}} />);
  expect(screen.queryByText(/back to the command zone/)).not.toBeInTheDocument();
  expect(screen.queryByText(/commander deaths/i)).not.toBeInTheDocument();
});
