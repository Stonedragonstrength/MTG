import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
  const settings = useAppStore.getState().settings;
  useAppStore.setState({
    game: createGame(config(4)),
    settings: { ...settings, autoFocusOn: false },
  });
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
  const bubbles = zone0.querySelectorAll('.cmd-gauge');
  expect(bubbles).toHaveLength(3);
});

test('standard games show no commander damage strip', () => {
  useAppStore.setState({ game: createGame(config(2, 'standard')) });
  const { container } = render(<GameScreen />);
  expect(container.querySelectorAll('.cmd-gauge')).toHaveLength(0);
});

test('a seat that tracks tax per commander shows it on the pedestals, not as one header total', () => {
  const game = createGame(config(2));
  game.players[0] = {
    ...game.players[0],
    commanderDeaths: 3, // a pair's deaths added together would mislead here
    cards: { ...cardsSeat(), cmd: { a: 2, b: 1 } },
  };
  game.players[1] = { ...game.players[1], commanderDeaths: 1 }; // tracker seat: chip stays
  useAppStore.setState({ game });
  const { container } = render(<GameScreen />);
  const chips = (seat: number) =>
    Array.from(container.querySelectorAll(`.zone.seat-${seat} .player-chip`)).map(
      (el) => el.textContent,
    );
  expect(chips(0).some((t) => /tax/.test(t ?? ''))).toBe(false);
  expect(chips(1)).toContain('tax +2');
});

test('a virtual-cards seat wears the compact cards-mode class', () => {
  const game = createGame(config(2));
  game.players[0] = { ...game.players[0], cards: cardsSeat() };
  useAppStore.setState({ game });
  const { container } = render(<GameScreen />);
  expect(container.querySelector('.zone.seat-0')!.className).toContain('zone--cards');
  expect(container.querySelector('.zone.seat-1')!.className).not.toContain('zone--cards');
});

test('a virtual-cards seat shows hand and library counts in its header', () => {
  const game = createGame(config(2));
  game.players[0] = {
    ...game.players[0],
    cards: {
      library: [
        { iid: 'l1', cardId: 'c1', name: 'Forest' },
        { iid: 'l2', cardId: 'c1', name: 'Forest' },
        { iid: 'l3', cardId: 'c2', name: 'Island' },
      ],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
      mulligans: 0,
      deckName: 'Stompy',
    },
  };
  useAppStore.setState({ game });
  const { container } = render(<GameScreen />);
  const chips = Array.from(container.querySelectorAll('.zone.seat-0 .player-chip')).map(
    (el) => el.textContent,
  );
  expect(chips).toContain('✋0');
  expect(chips).toContain('📚3');
  // tracker seats stay chip-free
  expect(container.querySelectorAll('.zone.seat-1 .player-chip')).toHaveLength(0);
});

function cardsSeat() {
  return {
    library: [
      { iid: 'l1', cardId: 'c1', name: 'Forest' },
      { iid: 'l2', cardId: 'c1', name: 'Forest' },
    ],
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    command: [],
    mulligans: 0,
    deckName: 'Stompy',
  };
}

test('a claimed cards seat offers the hand view and switches both ways', async () => {
  const game = createGame(config(2));
  game.players[0] = { ...game.players[0], cards: cardsSeat() };
  useAppStore.setState({
    game,
    online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: 0 },
    setHandHeld: vi.fn(),
  });
  const user = userEvent.setup();
  const { container } = render(<GameScreen />);
  expect(container.querySelectorAll('.zone').length).toBe(2); // table first on a wide screen
  await user.click(screen.getByRole('button', { name: /my hand/i }));
  expect(await screen.findByRole('button', { name: /see table/i })).toBeInTheDocument();
  expect(container.querySelectorAll('.zone')).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: /see table/i }));
  expect(container.querySelectorAll('.zone').length).toBe(2);
  useAppStore.setState({ online: null });
});

test('a narrow viewport opens straight into the hand view', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const game = createGame(config(2));
  game.players[0] = { ...game.players[0], cards: cardsSeat() };
  useAppStore.setState({
    game,
    online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: 0 },
    setHandHeld: vi.fn(),
  });
  render(<GameScreen />);
  expect(screen.getByRole('button', { name: /see table/i })).toBeInTheDocument();
  vi.unstubAllGlobals();
  useAppStore.setState({ online: null });
});

/** A two-player cards game in which seat 0 has just revealed a card. */
function gameWithReveal(id: string) {
  const game = createGame(config(2));
  game.players[0] = { ...game.players[0], cards: cardsSeat() };
  return {
    ...game,
    reveal: {
      id,
      seat: 0,
      from: 'hand' as const,
      cards: [{ cardId: 'c9', name: 'Lightning Bolt' }],
      t: Date.now(),
    },
  };
}

test('a reveal is shown over the table view, on the revealing device too', async () => {
  useAppStore.setState({ game: gameWithReveal('gs-table') });
  const { container } = render(<GameScreen />);
  const banner = await screen.findByRole('status');
  expect(banner).toHaveTextContent(/Player 0\s*reveals/);
  expect(banner).toHaveTextContent('Lightning Bolt');
  expect(banner.parentElement).toBe(container.querySelector('.game-screen')); // outside every rotated zone
});

test('a reveal is shown over the phone hand view as well', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  useAppStore.setState({
    game: gameWithReveal('gs-hand'),
    online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: 0 },
    setHandHeld: vi.fn(),
  });
  const { container } = render(<GameScreen />);
  expect(screen.getByRole('button', { name: /see table/i })).toBeInTheDocument(); // the hand view
  const banner = await screen.findByRole('status');
  expect(banner).toHaveTextContent(/Player 0\s*reveals/);
  expect(banner.parentElement).toBe(container.querySelector('.game-screen.hand-mode'));
  vi.unstubAllGlobals();
  const { act } = await import('@testing-library/react');
  act(() => useAppStore.setState({ online: null }));
});

test('tracker-only tables never offer the hand view', () => {
  useAppStore.setState({
    online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: 0 },
  });
  render(<GameScreen />);
  expect(screen.queryByRole('button', { name: /my hand/i })).not.toBeInTheDocument();
  useAppStore.setState({ online: null });
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

test('an online game shows the table pill with its code', () => {
  useAppStore.setState({
    online: { code: 'KQ7M2X', status: { kind: 'live', peers: 3 }, mySeat: null },
  });
  render(<GameScreen />);
  expect(screen.getByText(/KQ7M2X/)).toBeInTheDocument();
  useAppStore.setState({ online: null });
});

test('tapping a commander damage bubble applies damage from that commander', async () => {
  const spy = vi.fn();
  useAppStore.setState({ applyCommanderDamage: spy });
  const { container } = render(<GameScreen />);
  const zone0 = container.querySelector('.zone.seat-0')!;
  const bubble = zone0.querySelector('.cmd-gauge') as HTMLElement;
  const { default: userEvent } = await import('@testing-library/user-event');
  await userEvent.setup().click(bubble);
  expect(spy).toHaveBeenCalledWith(0, 'p1', 1);
});

test('the active player always holds the big board; the turn moves it', async () => {
  const { act } = await import('@testing-library/react');
  const { container } = render(<GameScreen />);
  expect(container.querySelector('.game-screen')!.className).toContain('focus-mode');
  expect(container.querySelector('.zone.seat-0')!.className).toContain('zone--focused');

  const game = useAppStore.getState().game!;
  act(() => {
    useAppStore.setState({ game: { ...game, activePlayerIndex: 2, turnStartedAt: Date.now() } });
  });
  expect(container.querySelector('.zone.seat-2')!.className).toContain('zone--focused');
  expect(container.querySelector('.zone.seat-0')!.className).not.toContain('zone--focused');
});

test('the hub always rides inside the active zone', () => {
  const { container } = render(<GameScreen />);
  expect(container.querySelector('.game-screen > .center-hub')).toBeNull();
  const docked = container.querySelector('.zone--focused .center-hub');
  expect(docked).not.toBeNull();
  expect(docked!.className).toContain('center-hub--row');
});

describe('seat orientation', () => {
  afterEach(() => {
    cleanup(); // the screen first: nothing should re-render for the reset below
    vi.unstubAllGlobals();
    useAppStore.setState({
      seatFlips: {},
      online: null,
      settings: { ...useAppStore.getState().settings, hubPinned: false },
    });
  });

  const pinTurnBar = () =>
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, hubPinned: true } });
  const takeTurn = (activePlayerIndex: number) =>
    useAppStore.setState({ game: { ...useAppStore.getState().game!, activePlayerIndex } });
  /** The seats whose zone carries the hub, e.g. ['seat-0']. */
  const hubSeats = (container: HTMLElement) =>
    [...container.querySelectorAll('.zone')]
      .filter((zone) => zone.querySelector('.center-hub'))
      .map((zone) => /seat-\d/.exec(zone.className)![0]);

  test('a seat flipped on this device wears the flipped class; the others do not', () => {
    useAppStore.setState({ seatFlips: { 2: true } });
    const { container } = render(<GameScreen />);
    expect(container.querySelector('.zone.seat-2')!.className).toContain('zone--flipped');
    for (const seat of [0, 1, 3]) {
      expect(container.querySelector(`.zone.seat-${seat}`)!.className).not.toContain('zone--flipped');
    }
  });

  test('a flipped seat stays flipped when it takes the big board', () => {
    useAppStore.setState({ seatFlips: { 2: true } });
    takeTurn(2);
    const { container } = render(<GameScreen />);
    const zone = container.querySelector('.zone.seat-2')!;
    expect(zone.className).toContain('zone--focused');
    expect(zone.className).toContain('zone--flipped');
  });

  test('with "Turn bar stays put" the hub docks at the near edge, whoever is active', () => {
    pinTurnBar();
    const { container } = render(<GameScreen />);
    expect(hubSeats(container)).toEqual(['seat-0']); // their own turn: where it always was
    for (const active of [1, 2, 3]) {
      act(() => takeTurn(active));
      expect(container.querySelector(`.zone.seat-${active}`)!.className).toContain('zone--focused');
      expect(hubSeats(container)).toEqual(['seat-0']); // the board moved on, the turn bar did not
    }
    expect(container.querySelector('.zone.seat-0')!.className).toContain('edge-bottom');
  });

  test('online, the near edge is your own seat', () => {
    pinTurnBar();
    useAppStore.setState({
      online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: 2 },
    });
    const { container } = render(<GameScreen />); // seat 0 is active
    expect(container.querySelector('.zone.seat-2')!.className).toContain('edge-bottom');
    expect(hubSeats(container)).toEqual(['seat-2']);
  });

  test('two players online: the pinned hub follows the seat the table turned to the bottom', () => {
    pinTurnBar();
    useAppStore.setState({
      game: createGame(config(2)),
      online: { code: 'KQ7M2X', status: { kind: 'live', peers: 2 }, mySeat: 1 },
    });
    const { container } = render(<GameScreen />);
    expect(container.querySelector('.zone.seat-1')!.className).toContain('edge-bottom');
    expect(hubSeats(container)).toEqual(['seat-1']);
  });

  test('pinned in a collapsed zone the hub turns compact and says whose turn it is', () => {
    pinTurnBar();
    takeTurn(3);
    const { container } = render(<GameScreen />);
    const bar = container.querySelector('.zone.seat-0')!;
    expect(bar.className).not.toContain('zone--focused');
    expect(bar.className).toContain('zone--hub'); // the bar makes room for it
    const hub = bar.querySelector('.center-hub')!;
    expect(hub.className).toContain('center-hub--compact');
    expect(hub.querySelector('.hub-turn')!.textContent).toContain('Player 3');
  });

  test('pinned on the near seat’s own turn the hub is the ordinary docked one', () => {
    pinTurnBar();
    const { container } = render(<GameScreen />); // seat 0 is active
    const zone = container.querySelector('.zone.seat-0')!;
    expect(zone.className).not.toContain('zone--hub');
    const hub = zone.querySelector('.center-hub')!;
    expect(hub.className).toContain('center-hub--row');
    expect(hub.className).not.toContain('center-hub--compact');
    expect(hub.querySelector('.hub-turn')!.textContent).not.toContain('Player 0');
  });

  /** jsdom has no matchMedia: this makes the screen a phone-width one. */
  const onAPhone = () =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );

  test('on a phone-width screen a 3–4 player edge bar is too short for the hub: it keeps following the active player', () => {
    onAPhone();
    pinTurnBar();
    takeTurn(2);
    const { container } = render(<GameScreen />);
    expect(hubSeats(container)).toEqual(['seat-2']);
    expect(container.querySelector('.zone--hub')).toBeNull();
  });

  test('two players on a phone keep it pinned: their bars can grow', () => {
    onAPhone();
    pinTurnBar();
    useAppStore.setState({ game: { ...createGame(config(2)), activePlayerIndex: 1 } });
    const { container } = render(<GameScreen />);
    expect(hubSeats(container)).toEqual(['seat-0']);
  });

  test('left unpinned, no zone is marked as carrying the hub and nothing is flipped', () => {
    takeTurn(1);
    const { container } = render(<GameScreen />);
    expect(hubSeats(container)).toEqual(['seat-1']);
    expect(container.querySelector('.zone--hub')).toBeNull();
    expect(container.querySelector('.zone--flipped')).toBeNull();
    expect(container.querySelector('.center-hub--compact')).toBeNull();
  });
});

test('every player has their own dice button beneath their life counter', async () => {
  render(<GameScreen />);
  const diceButtons = screen.getAllByRole('button', { name: /dice roller/i });
  expect(diceButtons).toHaveLength(4);
  const { default: userEvent } = await import('@testing-library/user-event');
  await userEvent.setup().click(diceButtons[0]);
  expect(await screen.findByRole('button', { name: /who goes first/i })).toBeInTheDocument();
});

test('3+ players sit around the table edges (360 board)', () => {
  const { container } = render(<GameScreen />);
  expect(container.querySelector('.game-screen')!.className).toContain('table-360');
  expect(container.querySelector('.zone.seat-0')!.className).toContain('edge-bottom');
  expect(container.querySelector('.zone.seat-1')!.className).toContain('edge-right');
  expect(container.querySelector('.zone.seat-2')!.className).toContain('edge-top');
  expect(container.querySelector('.zone.seat-3')!.className).toContain('edge-left');
});

test('2-player games keep the simple top/bottom layout', () => {
  useAppStore.setState({ game: createGame(config(2)) });
  const { container } = render(<GameScreen />);
  expect(container.querySelector('.game-screen')!.className).not.toContain('table-360');
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
