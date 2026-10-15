import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { CardInstance, GameState, SeatCards } from '../lib/types';
import { useAppStore } from '../state/store';
import CardFlights from './CardFlights';

const c = (iid: string): CardInstance => ({ iid, cardId: `id-${iid}`, name: iid });
const seat = (over: Partial<SeatCards>): SeatCards => ({
  library: [],
  hand: [],
  battlefield: [],
  graveyard: [],
  exile: [],
  command: [],
  mulligans: 0,
  deckName: 'Stompy',
  ...over,
});
const table = (s: SeatCards): GameState => {
  const g = createGame({
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    profiles: [
      { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
    ],
  });
  return { ...g, players: g.players.map((p, i) => (i === 0 ? { ...p, cards: s } : p)) };
};

let root: HTMLElement;
let finish: (() => void)[] = [];
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = `<div class="zone seat-0"><div class="dock-library"></div><div class="hand-tray"><button data-iid="a"><img src="a.png"></button></div><button data-iid="h"><img src="h.png"></button></div>`;
  document.body.appendChild(root);
  finish = [];
  HTMLElement.prototype.animate = vi.fn(function () {
    const anim = { onfinish: null as null | (() => void), cancel: vi.fn() };
    finish.push(() => anim.onfinish?.());
    return anim;
  }) as unknown as typeof HTMLElement.prototype.animate;
});
afterEach(() => {
  root.remove();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

test('a drawn card flies face down from the library into the hand, and lands', () => {
  useAppStore.setState({ game: table(seat({ library: [c('a')] })) });
  const { container } = render(<CardFlights />);
  act(() => useAppStore.setState({ game: table(seat({ hand: [c('a')] })) }));
  const flight = container.querySelector('.flight-card');
  expect(flight).not.toBeNull();
  expect(flight).toHaveClass('flight-card--back');
  expect(flight!.querySelector('img')).toBeNull(); // the face stays hidden
  const landed = root.querySelector<HTMLElement>('[data-iid="a"]')!;
  expect(landed.style.visibility).toBe('hidden'); // waits for the flight
  act(() => finish.forEach((f) => f()));
  expect(container.querySelector('.flight-card')).toBeNull();
  expect(landed.style.visibility).toBe('');
});

test('a played card flies face up', () => {
  useAppStore.setState({ game: table(seat({ hand: [c('h')] })) });
  const { container } = render(<CardFlights />);
  act(() => useAppStore.setState({ game: table(seat({ battlefield: [c('h')] })) }));
  expect(container.querySelector('.flight-card img')).toHaveAttribute('src', 'h.png');
});

test('a change that moves no card flies nothing', () => {
  useAppStore.setState({ game: table(seat({ hand: [c('h')] })) });
  const { container } = render(<CardFlights />);
  act(() => useAppStore.setState((s) => ({ game: { ...s.game!, turnNumber: 2 } })));
  expect(container.querySelector('.flight-card')).toBeNull();
});
