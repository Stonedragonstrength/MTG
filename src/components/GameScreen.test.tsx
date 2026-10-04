import { render } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import GameScreen from './GameScreen';

function config(playerCount: number, format: 'commander' | 'standard' = 'commander'): GameConfig {
  return {
    format,
    startingLife: format === 'commander' ? 40 : 20,
    commanderDamageThreshold: 21,
    profiles: Array.from({ length: playerCount }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${i}`,
      avatarUrl: null,
      commanderName: null,
    })),
  };
}

beforeEach(() => {
  useAppStore.setState({ game: createGame(config(4)) });
});

test('renders a rotated zone per player with seat classes', () => {
  const { container } = render(<GameScreen />);
  const zones = container.querySelectorAll('.zone');
  expect(zones).toHaveLength(4);
  for (let i = 0; i < 4; i++) {
    expect(container.querySelector(`.zone.seat-${i}`)).not.toBeNull();
  }
});

test('commander games show a damage bubble per enemy commander', () => {
  const { container } = render(<GameScreen />);
  const zone0 = container.querySelector('.zone.seat-0')!;
  const bubbles = zone0.querySelectorAll('.cmd-bubble');
  expect(bubbles).toHaveLength(3);
});

test('standard games show no commander damage strip', () => {
  useAppStore.setState({ game: createGame(config(2, 'standard')) });
  const { container } = render(<GameScreen />);
  expect(container.querySelectorAll('.cmd-bubble')).toHaveLength(0);
});

test('eliminated players get the dead treatment', () => {
  const game = createGame(config(4));
  game.players[2] = { ...game.players[2], eliminated: true };
  useAppStore.setState({ game });
  const { container } = render(<GameScreen />);
  expect(container.querySelector('.zone.seat-2')!.className).toContain('zone--dead');
});

test('the active player zone is highlighted', () => {
  const { container } = render(<GameScreen />);
  expect(container.querySelector('.zone.seat-0')!.className).toContain('zone--active');
  expect(container.querySelector('.zone.seat-1')!.className).not.toContain('zone--active');
});

test('tapping a commander damage bubble applies damage from that commander', async () => {
  const spy = vi.fn();
  useAppStore.setState({ applyCommanderDamage: spy });
  const { container } = render(<GameScreen />);
  const zone0 = container.querySelector('.zone.seat-0')!;
  const bubble = zone0.querySelector('.cmd-bubble') as HTMLElement;
  const { default: userEvent } = await import('@testing-library/user-event');
  await userEvent.setup().click(bubble);
  expect(spy).toHaveBeenCalledWith(0, 'p1', 1);
});

test('tapping a zone header focuses that zone, tapping again releases it', async () => {
  const { container } = render(<GameScreen />);
  const { default: userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();

  const header = container.querySelector('.zone.seat-1 .zone-header') as HTMLElement;
  await user.click(header);
  expect(container.querySelector('.game-screen')!.className).toContain('focus-mode');
  expect(container.querySelector('.zone.seat-1')!.className).toContain('zone--focused');
  expect(container.querySelector('.zone.seat-0')!.className).not.toContain('zone--focused');

  await user.click(header);
  expect(container.querySelector('.game-screen')!.className).not.toContain('focus-mode');
});

test('the monarch wears the crown in their zone', () => {
  const game = useAppStore.getState().game!;
  useAppStore.setState({ game: { ...game, monarchIdx: 2 } });
  const { container } = render(<GameScreen />);
  expect(container.querySelector('.zone.seat-2 .badge-monarch')).not.toBeNull();
  expect(container.querySelector('.zone.seat-0 .badge-monarch')).toBeNull();
});

test('player names render in their zones', () => {
  const { container } = render(<GameScreen />);
  const names = [...container.querySelectorAll('.zone-name')].map((el) => el.textContent);
  expect(names).toEqual(['Player 0', 'Player 1', 'Player 2', 'Player 3']);
});
