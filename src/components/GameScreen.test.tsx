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

describe('combat on the cards', () => {
  afterEach(() => {
    cleanup();
    document.querySelectorAll('.tap-shield').forEach((el) => el.remove());
  });

  const knight = (seat: number) => ({
    id: `knight-${seat}`,
    cardId: null,
    name: 'Knight',
    imageNormal: null,
    imageArtCrop: null,
    typeLine: 'Token Creature — Knight',
    oracleText: '',
    basePower: 2,
    baseToughness: 2,
    count: 2,
    counters: {},
    color: null,
    zone: 'board' as const,
  });
  const stack = (seat: number) => ({ kind: 'stack' as const, id: `knight-${seat}` });
  const store = () => useAppStore.getState();
  const focused = (container: HTMLElement) =>
    [...container.querySelectorAll('.zone--focused')].map((zone) => /seat-\d/.exec(zone.className)![0]);
  const shields = () => document.querySelectorAll('.tap-shield').length;

  /** Every seat has two knights on the tablet; `hands` gives the first two seats cards to hold. */
  function fightTable(seats: number, hands = false) {
    const game = createGame(config(seats));
    useAppStore.setState({
      game: {
        ...game,
        players: game.players.map((p, i) => ({
          ...p,
          board: [knight(i)],
          ...(hands && i < 2
            ? {
                cards: {
                  ...cardsSeat(),
                  hand: [
                    { iid: `h${i}a`, cardId: 'c1', name: 'Forest' },
                    { iid: `h${i}b`, cardId: 'c2', name: 'Island' },
                  ],
                },
              }
            : {}),
        })),
      },
    });
  }
  /** Seat 0 attacks seats 1 and 2 with one knight each, and confirms. */
  async function declare() {
    await act(async () => {
      store().startCombat();
      store().setAttacker(stack(0), 1, 1);
      store().setAttacker(stack(0), 2, 1);
      await store().confirmAttackers();
    });
  }

  test('while a defender chooses blockers THEIR zone is the big board, each in turn; then it goes back to the attacker', async () => {
    fightTable(4);
    const { container } = render(<GameScreen />);
    expect(focused(container)).toEqual(['seat-0']);
    act(() => store().startCombat());
    expect(focused(container)).toEqual(['seat-0']); // picking attackers: still the attacker's board
    await declare();
    expect(focused(container)).toEqual(['seat-1']);
    act(() => store().finishBlocks(1));
    expect(focused(container)).toEqual(['seat-2']);
    act(() => store().finishBlocks(2));
    expect(focused(container)).toEqual(['seat-0']); // the damage is the attacker's
    act(() => store().cancelCombat());
    expect(focused(container)).toEqual(['seat-0']);
  });

  test('the blocking board has a look of its own; the "your turn" pulse stays on the active player’s bar', async () => {
    fightTable(4);
    const { container } = render(<GameScreen />);
    await declare();
    const defender = container.querySelector('.zone.seat-1')!;
    const attacker = container.querySelector('.zone.seat-0')!;
    expect(defender.className).toContain('zone--blocking');
    expect(defender.className).not.toContain('zone--active');
    expect(attacker.className).toContain('zone--active');
    expect(attacker.className).not.toContain('zone--blocking');
    act(() => store().finishBlocks(1));
    expect(defender.className).not.toContain('zone--blocking');
    act(() => store().finishBlocks(2));
    expect(container.querySelector('.zone--blocking')).toBeNull(); // nobody blocks at damage
  });

  test('the hub does not follow the big board to a defender: it sits compact in the attacker’s bar', async () => {
    fightTable(4);
    const { container } = render(<GameScreen />);
    await declare();
    const attacker = container.querySelector('.zone.seat-0')!;
    expect(attacker.className).toContain('zone--hub');
    expect(attacker.querySelector('.center-hub')!.className).toContain('center-hub--compact');
    expect(container.querySelector('.zone.seat-1 .center-hub')).toBeNull();
    expect(container.querySelectorAll('.center-hub')).toHaveLength(1);
    act(() => store().finishBlocks(1));
    act(() => store().finishBlocks(2));
    expect(attacker.className).not.toContain('zone--hub'); // its own board again: the ordinary hub
    expect(attacker.querySelector('.center-hub')!.className).not.toContain('center-hub--compact');
  });

  test('the combat bar rides in the zone of the seat whose move it is, between the header and the cards', async () => {
    fightTable(4);
    const { container } = render(<GameScreen />);
    expect(container.querySelector('.combat-bar')).toBeNull();
    act(() => store().startCombat());
    const bars = () => [...container.querySelectorAll('.combat-bar')];
    expect(bars()).toHaveLength(1);
    expect(bars()[0].parentElement).toBe(container.querySelector('.zone.seat-0'));
    expect(bars()[0].previousElementSibling!.className).toContain('zone-header');
    expect(container.querySelector('.zone.seat-0')!.className).toContain('zone--combat');
    await act(async () => {
      store().setAttacker(stack(0), 1, 1);
      await store().confirmAttackers();
    });
    expect(bars()).toHaveLength(1);
    expect(bars()[0].parentElement).toBe(container.querySelector('.zone.seat-1'));
    expect(container.querySelector('.zone.seat-0')!.className).not.toContain('zone--combat');
  });

  test('every attacked seat’s header wears "⚔ n" from the first pick until the fight ends', async () => {
    fightTable(4);
    const { container } = render(<GameScreen />);
    const chip = (seat: number) => container.querySelector(`.zone.seat-${seat} .chip-attack`)?.textContent ?? null;
    act(() => store().startCombat());
    expect([0, 1, 2, 3].map(chip)).toEqual([null, null, null, null]);
    act(() => store().setAttacker(stack(0), 1, 2));
    expect([0, 1, 2, 3].map(chip)).toEqual([null, '⚔ 2', null, null]);
    act(() => store().setAttacker(stack(0), 1, 1));
    act(() => store().setAttacker(stack(0), 3, 1));
    expect([0, 1, 2, 3].map(chip)).toEqual([null, '⚔ 1', null, '⚔ 1']);
    await act(async () => {
      await store().confirmAttackers();
    });
    expect([0, 1, 2, 3].map(chip)).toEqual([null, '⚔ 1', null, '⚔ 1']); // still there while they block
    act(() => store().cancelCombat());
    expect([0, 1, 2, 3].map(chip)).toEqual([null, null, null, null]);
  });

  test('hand trays fold whenever the big board changes seat, not only when the turn moves', async () => {
    fightTable(2, true);
    const user = userEvent.setup();
    const { container } = render(<GameScreen />);
    const fans = () => container.querySelectorAll('.hand-fan').length;
    for (const pill of screen.getAllByRole('button', { name: 'hand, 2 cards' })) await user.click(pill);
    expect(fans()).toBe(2); // both hands lie open
    act(() => store().startCombat());
    expect(fans()).toBe(2); // the board has not moved
    await act(async () => {
      store().setAttacker(stack(0), 1, 1);
      await store().confirmAttackers();
    });
    expect(focused(container)).toEqual(['seat-1']);
    expect(fans()).toBe(0); // the table turned to the defender: every tray folded
    await user.click(container.querySelector<HTMLElement>('.zone.seat-1 .hand-pill')!);
    expect(fans()).toBe(1);
    act(() => store().finishBlocks(1));
    expect(focused(container)).toEqual(['seat-0']);
    expect(fans()).toBe(0); // and again when it turned back
    expect(store().game!.activePlayerIndex).toBe(0); // all within one turn
  });

  test('the stray-tap shield goes up whenever the fight’s step or acting seat changes or the fight ends — not on a pick', async () => {
    fightTable(4);
    render(<GameScreen />);
    expect(shields()).toBe(0); // nothing has moved on a first render
    const raised = async (change: () => void | Promise<void>) => {
      const before = shields();
      await act(async () => {
        await change();
      });
      return shields() - before;
    };
    expect(await raised(() => store().startCombat())).toBe(1); // the bar appears under the finger that pressed Attack
    expect(await raised(() => store().setAttacker(stack(0), 1, 1))).toBe(0); // a pick moves nothing
    expect(await raised(() => store().setAttacker(stack(0), 2, 1))).toBe(0);
    expect(await raised(() => store().confirmAttackers())).toBe(1); // the board swings to the first defender
    expect(await raised(() => store().setBlocker(1, stack(0), stack(1), 1))).toBe(0);
    expect(await raised(() => store().finishBlocks(1))).toBe(1); // …to the next
    expect(await raised(() => store().finishBlocks(2))).toBe(1); // …and back for the damage
    expect(await raised(() => store().applyCombat({ players: [{ seat: 1, life: -2 }], deaths: [] }))).toBe(1); // the bar goes
  });

  test('…also when the change arrives from another device', () => {
    fightTable(4);
    render(<GameScreen />);
    const game = store().game!;
    const before = shields();
    // a state another device pushed: its player declared an attack on seat 2
    act(() =>
      useAppStore.setState({
        game: {
          ...game,
          combat: {
            id: 'theirs',
            turn: game.turnNumber,
            active: 0,
            step: 'blockers',
            defender: 2,
            attacks: [{ unit: stack(0), target: 2 }],
          },
        },
      }),
    );
    expect(shields() - before).toBe(1);
  });

  test('a fight is not a layer: leaving for home and coming back finds it as it was', async () => {
    fightTable(4);
    const first = render(<GameScreen />);
    await declare();
    const fight = store().game!.combat;
    first.unmount(); // Back = leave to home; the game stays saved
    expect(store().game!.combat).toBe(fight);
    const { container } = render(<GameScreen />);
    expect(focused(container)).toEqual(['seat-1']);
    expect(container.querySelector('.zone.seat-1 .combat-bar')).not.toBeNull();
  });
});
