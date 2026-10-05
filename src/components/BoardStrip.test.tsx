import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { BoardItem, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import BoardStrip from './BoardStrip';

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => undefined),
}));
vi.mock('../data/rules', () => ({
  getGlossary: vi.fn(async () => []),
}));
vi.mock('../lib/sound', () => ({
  playLifeTick: vi.fn(),
  playTurnChime: vi.fn(),
  playDefeat: vi.fn(),
  playSlash: vi.fn(),
}));

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
  ],
};

const soldiers: BoardItem = {
  id: 'item-1',
  cardId: 'c1',
  name: 'Soldier',
  imageNormal: null,
  imageArtCrop: null,
  typeLine: 'Token Creature — Soldier',
  oracleText: '',
  basePower: 1,
  baseToughness: 1,
  count: 8,
  counters: { p1p1: 2 },
  color: null,
  zone: 'board',
};

beforeEach(async () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [soldiers] };
  const { DEFAULT_SETTINGS } = await import('../data/settings');
  useAppStore.setState({ game, settings: { ...DEFAULT_SETTINGS } });
});

/** Waits out the death animation so its timer can't leak act() warnings. */
async function ghostGone(container: HTMLElement) {
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => expect(container.querySelector('.board-item--dying')).toBeNull(), {
    timeout: 1500,
  });
}

/** A real-time sleep with the long-press timer landing inside act(). */
async function sleep(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

test('mana sources show a mana badge on their card', () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [{ ...soldiers, manaMode: 'G' }] };
  useAppStore.setState({ game });
  render(<BoardStrip playerIdx={0} />);
  expect(screen.getByLabelText(/makes green mana/i)).toBeInTheDocument();
});

test('shows the count badge and computed P/T', () => {
  const { container } = render(<BoardStrip playerIdx={0} />);
  expect(container.querySelector('.count-controls .count-badge')).toHaveTextContent('×8');
  expect(screen.getByText('3/3')).toBeInTheDocument();
});

test('inline +/− adjust the stack count', async () => {
  const spy = vi.fn();
  useAppStore.setState({ changeCount: spy });
  const { default: userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();
  render(<BoardStrip playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /add one soldier/i }));
  expect(spy).toHaveBeenCalledWith(0, 'item-1', 1);
  await user.click(screen.getByRole('button', { name: /remove one soldier/i }));
  expect(spy).toHaveBeenCalledWith(0, 'item-1', -1);
});

test('has an add-card tile', () => {
  render(<BoardStrip playerIdx={0} />);
  expect(screen.getByRole('button', { name: /add a card/i })).toBeInTheDocument();
});

test('tapping a token card taps one copy', async () => {
  const tapItem = vi.fn();
  useAppStore.setState({ tapItem });
  const { default: userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();
  render(<BoardStrip playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: 'Soldier' }));
  expect(tapItem).toHaveBeenCalledWith(0, 'item-1', 1);
});

test('holding a token card opens details instead of tapping', async () => {
  const tapItem = vi.fn();
  useAppStore.setState({ tapItem });
  const { fireEvent } = await import('@testing-library/react');
  render(<BoardStrip playerIdx={0} />);
  const thumb = screen.getByRole('button', { name: 'Soldier' });

  fireEvent.pointerDown(thumb);
  await sleep(650);
  fireEvent.pointerUp(thumb);

  expect(tapItem).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: /one more copy/i })).toBeInTheDocument();
});

test('the card carries a count bubble for collapsed-player minis', () => {
  const { container } = render(<BoardStrip playerIdx={0} />);
  const bubble = container.querySelector('.thumb .thumb-count');
  expect(bubble).not.toBeNull();
  expect(bubble!.textContent).toBe('×8');
});

test('single copies skip the count bubble', () => {
  const game = useAppStore.getState().game!;
  const lastOne = { ...soldiers, count: 1 };
  useAppStore.setState({
    game: { ...game, players: [{ ...game.players[0], board: [lastOne] }, game.players[1]] },
  });
  const { container } = render(<BoardStrip playerIdx={0} />);
  expect(container.querySelector('.thumb .thumb-count')).toBeNull();
});

test('a partially tapped stack shows how many are tapped', () => {
  const game = useAppStore.getState().game!;
  const partiallyTapped = { ...soldiers, tapped: 3 };
  useAppStore.setState({
    game: {
      ...game,
      players: [{ ...game.players[0], board: [partiallyTapped] }, game.players[1]],
    },
  });
  render(<BoardStrip playerIdx={0} />);
  expect(screen.getByRole('button', { name: /soldier, 3 of 8 tapped/i })).toBeInTheDocument();
  expect(screen.getByText('3⤵')).toBeInTheDocument();
});

test('holding the ✕ removes the whole stack; a short tap does not', async () => {
  const removeItem = vi.fn();
  useAppStore.setState({ removeItem });
  const { fireEvent } = await import('@testing-library/react');
  const { container } = render(<BoardStrip playerIdx={0} />);
  const del = screen.getByRole('button', { name: /remove soldier stack/i });

  fireEvent.pointerDown(del);
  fireEvent.pointerUp(del);
  expect(removeItem).not.toHaveBeenCalled();

  fireEvent.pointerDown(del);
  await sleep(650);
  fireEvent.pointerUp(del);
  expect(removeItem).toHaveBeenCalledWith(0, 'item-1');
  await ghostGone(container);
});

test('removing a stack leaves a dying ghost with the slash overlay', async () => {
  const removeItem = vi.fn();
  const { DEFAULT_SETTINGS } = await import('../data/settings');
  useAppStore.setState({ removeItem, settings: { ...DEFAULT_SETTINGS, soundOn: true } });
  const { fireEvent } = await import('@testing-library/react');
  const { playSlash } = await import('../lib/sound');
  vi.mocked(playSlash).mockClear();
  const { container } = render(<BoardStrip playerIdx={0} />);
  const del = screen.getByRole('button', { name: /remove soldier stack/i });

  fireEvent.pointerDown(del);
  await sleep(650);
  fireEvent.pointerUp(del);

  expect(removeItem).toHaveBeenCalledWith(0, 'item-1');
  expect(container.querySelector('.board-item--dying')).not.toBeNull();
  expect(container.querySelector('.death-slash')).not.toBeNull();
  expect(container.querySelector('.death-x')).not.toBeNull();
  expect(playSlash).toHaveBeenCalled();
  await ghostGone(container);
});

test('the slash sound respects the mute setting', async () => {
  const removeItem = vi.fn();
  const { DEFAULT_SETTINGS } = await import('../data/settings');
  useAppStore.setState({ removeItem, settings: { ...DEFAULT_SETTINGS, soundOn: false } });
  const { fireEvent } = await import('@testing-library/react');
  const { playSlash } = await import('../lib/sound');
  vi.mocked(playSlash).mockClear();
  const { container } = render(<BoardStrip playerIdx={0} />);
  const del = screen.getByRole('button', { name: /remove soldier stack/i });

  fireEvent.pointerDown(del);
  await sleep(650);
  fireEvent.pointerUp(del);

  expect(removeItem).toHaveBeenCalled();
  expect(playSlash).not.toHaveBeenCalled();
  await ghostGone(container);
});

test('minus on the last copy also plays the death animation', async () => {
  const game = useAppStore.getState().game!;
  const lastOne = { ...soldiers, count: 1 };
  const changeCount = vi.fn();
  useAppStore.setState({
    game: { ...game, players: [{ ...game.players[0], board: [lastOne] }, game.players[1]] },
    changeCount,
  });
  const { default: userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();
  const { container } = render(<BoardStrip playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /remove one soldier/i }));
  expect(changeCount).toHaveBeenCalledWith(0, 'item-1', -1);
  expect(container.querySelector('.board-item--dying')).not.toBeNull();
  await ghostGone(container);
});

test('the dying ghost cleans itself up after the animation', async () => {
  const game = useAppStore.getState().game!;
  const lastOne = { ...soldiers, count: 1 };
  useAppStore.setState({
    game: { ...game, players: [{ ...game.players[0], board: [lastOne] }, game.players[1]] },
    changeCount: vi.fn(),
  });
  const { default: userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();
  const { container } = render(<BoardStrip playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /remove one soldier/i }));
  expect(container.querySelector('.board-item--dying')).not.toBeNull();
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => expect(container.querySelector('.board-item--dying')).toBeNull(), {
    timeout: 1500,
  });
});

test('token size scales down as the board fills up', () => {
  const game = useAppStore.getState().game!;

  const { container, rerender, unmount } = render(<BoardStrip playerIdx={0} />);
  expect(container.querySelector('.board-strip')!.className).toContain('board-strip--lg');

  const many = Array.from({ length: 5 }, (_, i) => ({ ...soldiers, id: `it-${i}` }));
  act(() => {
    useAppStore.setState({
      game: { ...game, players: [{ ...game.players[0], board: many }, game.players[1]] },
    });
  });
  rerender(<BoardStrip playerIdx={0} />);
  expect(container.querySelector('.board-strip')!.className).toContain('board-strip--md');

  const lots = Array.from({ length: 10 }, (_, i) => ({ ...soldiers, id: `lot-${i}` }));
  act(() => {
    useAppStore.setState({
      game: { ...game, players: [{ ...game.players[0], board: lots }, game.players[1]] },
    });
  });
  rerender(<BoardStrip playerIdx={0} />);
  expect(container.querySelector('.board-strip')!.className).toContain('board-strip--sm');
  unmount();
});

test('lands-zone items stay out of the battlefield grid', () => {
  const game = useAppStore.getState().game!;
  const forest = { ...soldiers, id: 'land-1', name: 'Forest', zone: 'lands' as const };
  useAppStore.setState({
    game: {
      ...game,
      players: [{ ...game.players[0], board: [soldiers, forest] }, game.players[1]],
    },
  });
  render(<BoardStrip playerIdx={0} />);
  expect(screen.queryByRole('button', { name: 'Forest' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Soldier' })).toBeInTheDocument();
});
