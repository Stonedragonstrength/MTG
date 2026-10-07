import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { CardInstance, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import LibrarySheet from './LibrarySheet';

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

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async () => undefined),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

const LIBRARY: CardInstance[] = [
  { iid: 'a', cardId: 'c-a', name: 'Alpha Strike' },
  { iid: 'b', cardId: 'c-b', name: 'Beast Within' },
  { iid: 'c', cardId: 'c-c', name: 'Cultivate' },
  { iid: 'd', cardId: 'c-d', name: 'Doom Blade' },
];

beforeEach(() => {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: {
      library: LIBRARY,
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
      mulligans: 0,
      deckName: 'Test',
    },
  };
  useAppStore.setState({
    game,
    online: null,
    lookNotice: vi.fn(),
    arrangeTop: vi.fn(),
    exileCards: vi.fn(),
    revealCards: vi.fn(),
  });
});

/** Opens the look view on the top `n` cards. */
async function lookAt(n: number, user: ReturnType<typeof userEvent.setup>) {
  for (let i = 1; i < n; i++) await user.click(screen.getByRole('button', { name: 'more' }));
  await user.click(screen.getByRole('button', { name: new RegExp(`look at top ${n}`, 'i') }));
}

const rows = () => screen.getAllByRole('listitem');

test('looking at the top N shows those cards in order and tells the table', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(3, user);
  expect(useAppStore.getState().lookNotice).toHaveBeenCalledWith(0, 3);
  expect(rows().map((r) => within(r).getByText(/Alpha|Beast|Cultivate/).textContent)).toEqual([
    'Alpha Strike',
    'Beast Within',
    'Cultivate',
  ]);
  expect(screen.queryByText('Doom Blade')).not.toBeInTheDocument(); // the fourth card stays unseen
});

test('each card goes where it is sent, and Done commits the whole plan at once', async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={onClose} />);
  await lookAt(3, user);
  await user.click(within(rows()[0]).getByRole('button', { name: /bottom/i }));
  await user.click(within(rows()[1]).getByRole('button', { name: /hand/i }));
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  expect(useAppStore.getState().arrangeTop).toHaveBeenCalledWith(0, ['a', 'b', 'c'], {
    top: ['c'],
    bottom: ['a'],
    graveyard: [],
    hand: ['b'],
  });
  expect(onClose).toHaveBeenCalled();
});

test('cards kept on top can be put in any order', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(3, user);
  await user.click(within(rows()[2]).getByRole('button', { name: /move .* up/i })); // Cultivate above Beast
  await user.click(within(rows()[1]).getByRole('button', { name: /move .* up/i })); // …and above Alpha
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  expect(useAppStore.getState().arrangeTop).toHaveBeenCalledWith(0, ['a', 'b', 'c'], {
    top: ['c', 'a', 'b'],
    bottom: [],
    graveyard: [],
    hand: [],
  });
});

test('a card can be moved down as well as up', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(2, user);
  await user.click(within(rows()[0]).getByRole('button', { name: /move .* down/i })); // Alpha under Beast
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  expect(useAppStore.getState().arrangeTop).toHaveBeenCalledWith(0, ['a', 'b'], {
    top: ['b', 'a'],
    bottom: [],
    graveyard: [],
    hand: [],
  });
});

/** The library as another device would leave it mid-look. */
function libraryBecomes(library: CardInstance[]) {
  const game = useAppStore.getState().game!;
  act(() =>
    useAppStore.setState({
      game: {
        ...game,
        players: game.players.map((p, i) => (i === 0 ? { ...p, cards: { ...p.cards!, library } } : p)),
      },
    }),
  );
}

test('a card drawn during the look drops out of the plan', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(3, user);
  libraryBecomes(LIBRARY.slice(1)); // Alpha Strike was drawn elsewhere
  expect(screen.queryByText('Alpha Strike')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  expect(useAppStore.getState().arrangeTop).toHaveBeenCalledWith(0, ['b', 'c'], {
    top: ['b', 'c'],
    bottom: [],
    graveyard: [],
    hand: [],
  });
});

test('a shuffle during the look voids it: nothing to arrange, look again', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(2, user);
  libraryBecomes([LIBRARY[3], LIBRARY[2], LIBRARY[0], LIBRARY[1]]); // the top two are buried now
  expect(screen.getByText(/library changed/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^done$/i })).not.toBeInTheDocument();
  expect(screen.queryByText('Alpha Strike')).not.toBeInTheDocument(); // no arranging cards that are not on top
  await user.click(screen.getByRole('button', { name: /look again/i }));
  expect(screen.getByRole('button', { name: /look at top/i })).toBeInTheDocument();
  expect(useAppStore.getState().arrangeTop).not.toHaveBeenCalled();
});

test('surveil: a card can be sent to the graveyard', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(1, user);
  await user.click(within(rows()[0]).getByRole('button', { name: /graveyard/i }));
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  expect(useAppStore.getState().arrangeTop).toHaveBeenCalledWith(0, ['a'], {
    top: [],
    bottom: [],
    graveyard: ['a'],
    hand: [],
  });
});

test('a build behind the table cannot look: the look could not announce itself', () => {
  useAppStore.setState({ online: { code: 'KQ7M2X', status: { kind: 'stale-build' }, mySeat: 0 } });
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  expect(screen.getByRole('button', { name: /look at top/i })).toBeDisabled();
});

test('helping with someone else’s seat never offers a look at their library', () => {
  render(<LibrarySheet playerIdx={0} claimed={false} onClose={() => {}} />);
  expect(screen.queryByRole('button', { name: /look at top/i })).not.toBeInTheDocument();
});

// ---- exile from the top ----

test('Exile n sends the top n to exile and closes, like Mill', async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: 'more' }));
  await user.click(screen.getByRole('button', { name: /^exile 2$/i }));
  expect(useAppStore.getState().exileCards).toHaveBeenCalledWith(0, 2);
  expect(onClose).toHaveBeenCalled();
});

test('helping with someone else’s seat can exile from the top: it is as public as a mill', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed={false} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /^exile 1$/i }));
  expect(useAppStore.getState().exileCards).toHaveBeenCalledWith(0, 1);
});

test('the fifth destination: a looked-at card can be sent to exile', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(3, user);
  await user.click(within(rows()[0]).getByRole('button', { name: /^exile$/i }));
  await user.click(within(rows()[2]).getByRole('button', { name: /^exile$/i }));
  expect(within(rows()[0]).getByText('Exile', { selector: '.look-tag' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  expect(useAppStore.getState().arrangeTop).toHaveBeenCalledWith(0, ['a', 'b', 'c'], {
    top: ['b'],
    bottom: [],
    graveyard: [],
    hand: [],
    exile: ['a', 'c'],
  });
});

// ---- the rest to the bottom ----

const tags = () => rows().map((r) => r.querySelector('.look-tag')!.textContent);
/** Two taps with no time between them, whatever the machine's load: an impatient thumb. */
const doubleTap = (el: Element) => {
  fireEvent.click(el);
  fireEvent.click(el);
};
/** The plan the last Done handed to the store. */
const lastPlan = () =>
  vi.mocked(useAppStore.getState().arrangeTop).mock.lastCall![2] as {
    top: string[];
    bottom: string[];
    graveyard: string[];
    hand: string[];
    exile?: string[];
  };

test('Rest to the bottom sends every card nobody sent anywhere, and nothing moves until Done', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(4, user);
  await user.click(within(rows()[1]).getByRole('button', { name: /^hand$/i })); // Beast Within: the pick
  await user.click(screen.getByRole('button', { name: /rest to the bottom/i }));
  // The screen keeps its order; the untouched cards say where they are headed.
  expect(rows().map((r) => r.querySelector('.look-name')!.textContent)).toEqual([
    'Alpha Strike',
    'Beast Within',
    'Cultivate',
    'Doom Blade',
  ]);
  expect(tags()).toEqual(['Bottom · random', 'Hand', 'Bottom · random', 'Bottom · random']);
  expect(useAppStore.getState().arrangeTop).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  const plan = lastPlan();
  expect(plan.hand).toEqual(['b']);
  expect(plan.top).toEqual([]);
  expect(plan.graveyard).toEqual([]);
  expect([...plan.bottom].sort()).toEqual(['a', 'c', 'd']); // exactly the untouched cards
  expect('exile' in plan).toBe(false);
});

test('the rest go down in an order drawn at Done, never the order on screen', async () => {
  const bottomWith = async (random: number) => {
    const user = userEvent.setup();
    const { unmount } = render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
    await lookAt(4, user);
    await user.click(screen.getByRole('button', { name: /rest to the bottom/i }));
    expect(tags()).toEqual(Array(4).fill('Bottom · random')); // nothing on screen gives the order away
    const dice = vi.spyOn(Math, 'random').mockReturnValue(random);
    try {
      await user.click(screen.getByRole('button', { name: /^done$/i }));
    } finally {
      dice.mockRestore();
    }
    unmount();
    return lastPlan().bottom;
  };
  const one = await bottomWith(0.1);
  const other = await bottomWith(0.7);
  expect([...one].sort()).toEqual(['a', 'b', 'c', 'd']);
  expect([...other].sort()).toEqual(['a', 'b', 'c', 'd']);
  expect(one).not.toEqual(other); // the dice decide, not the screen
});

test('cards sent by hand keep their order, and a hand pick after the bulk button is explicit again', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(4, user);
  await user.click(within(rows()[3]).getByRole('button', { name: /^top$/i })); // Doom Blade stays, by hand
  await user.click(screen.getByRole('button', { name: /rest to the bottom/i }));
  expect(tags()).toEqual(['Bottom · random', 'Bottom · random', 'Bottom · random', 'Top']);
  await user.click(within(rows()[1]).getByRole('button', { name: /^top$/i })); // Beast Within: back on top after all
  await user.click(within(rows()[2]).getByRole('button', { name: /^bottom$/i })); // Cultivate: bottom, on purpose
  expect(tags()).toEqual(['Bottom · random', 'Top · 1', 'Bottom', 'Top · 2']);
  await user.click(within(rows()[3]).getByRole('button', { name: /move .* up/i })); // Doom Blade above Cultivate…
  await user.click(within(rows()[2]).getByRole('button', { name: /move .* up/i })); // …and above Beast Within
  expect(tags()).toEqual(['Bottom · random', 'Top · 1', 'Top · 2', 'Bottom']);
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  expect(useAppStore.getState().arrangeTop).toHaveBeenCalledWith(0, ['a', 'b', 'c', 'd'], {
    top: ['d', 'b'],
    bottom: ['c', 'a'], // the hand-picked one first, the rest under it
    graveyard: [],
    hand: [],
  });
});

test('the bulk button is only offered when two or more cards are seen', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(1, user);
  expect(screen.queryByRole('button', { name: /rest to the bottom/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^done$/i })).toBeInTheDocument();
});

test('pressing the bulk button again puts the rest back on top; a double tap does not undo itself', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(2, user);
  const bulk = screen.getByRole('button', { name: /rest to the bottom/i });
  expect(bulk).toHaveAttribute('aria-pressed', 'false');
  doubleTap(bulk); // the second half of a double tap changes nothing
  expect(bulk).toHaveAttribute('aria-pressed', 'true');
  expect(tags()).toEqual(['Bottom · random', 'Bottom · random']);
  await act(() => new Promise((r) => setTimeout(r, 650))); // a deliberate second press, a moment later
  await user.click(bulk);
  expect(bulk).toHaveAttribute('aria-pressed', 'false');
  expect(tags()).toEqual(['Top · 1', 'Top · 2']);
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  expect(useAppStore.getState().arrangeTop).toHaveBeenCalledWith(0, ['a', 'b'], {
    top: ['a', 'b'],
    bottom: [],
    graveyard: [],
    hand: [],
  });
});

// ---- reveal to the table ----

test('Reveal top n shows those cards to the table and leaves them where they are', async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: 'more' }));
  await user.click(screen.getByRole('button', { name: /^reveal top 2$/i }));
  expect(useAppStore.getState().revealCards).toHaveBeenCalledWith(0, ['a', 'b'], 'library');
  expect(onClose).toHaveBeenCalled(); // out of the way: the table is looking at the cards now
  expect(useAppStore.getState().lookNotice).not.toHaveBeenCalled(); // the reveal announces itself
  expect(useAppStore.getState().arrangeTop).not.toHaveBeenCalled();
});

test('a build behind the table cannot reveal: the reveal could not announce itself', () => {
  useAppStore.setState({ online: { code: 'KQ7M2X', status: { kind: 'stale-build' }, mySeat: 0 } });
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  expect(screen.getByRole('button', { name: /^reveal top 1$/i })).toBeDisabled();
});

test('helping with someone else’s seat never offers to reveal their library', () => {
  render(<LibrarySheet playerIdx={0} claimed={false} onClose={() => {}} />);
  expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument();
});

test('a looked-at card can be revealed on its own, and the plan is left exactly as it was', async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={onClose} />);
  await lookAt(3, user);
  await user.click(within(rows()[0]).getByRole('button', { name: /^bottom$/i }));
  await user.click(within(rows()[1]).getByRole('button', { name: /^reveal beast within/i }));
  expect(useAppStore.getState().revealCards).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().revealCards).toHaveBeenCalledWith(0, ['b'], 'library');
  expect(onClose).not.toHaveBeenCalled(); // still looking
  expect(tags()).toEqual(['Bottom', 'Top · 1', 'Top · 2']); // nothing else changed
  expect(within(rows()[1]).getByRole('button', { name: /^reveal beast within/i })).toHaveTextContent(
    /revealed/i,
  ); // the look says so: the table's banner sits under this sheet
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  expect(useAppStore.getState().arrangeTop).toHaveBeenCalledWith(0, ['a', 'b', 'c'], {
    top: ['b', 'c'],
    bottom: ['a'],
    graveyard: [],
    hand: [],
  });
});

test('a double tap on a card’s Reveal reveals it once; a deliberate second press reveals it again', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(2, user);
  const button = () => within(rows()[0]).getByRole('button', { name: /^reveal alpha strike/i });
  doubleTap(button());
  expect(useAppStore.getState().revealCards).toHaveBeenCalledTimes(1); // one line in the feed, not two
  // Another card straight afterwards is another reveal, not the tail of that double tap.
  fireEvent.click(within(rows()[1]).getByRole('button', { name: /^reveal beast within/i }));
  expect(useAppStore.getState().revealCards).toHaveBeenCalledTimes(2);
  expect(useAppStore.getState().revealCards).toHaveBeenLastCalledWith(0, ['b'], 'library');
  await act(() => new Promise((r) => setTimeout(r, 650)));
  await user.click(button()); // the table asked to see the first one again
  expect(useAppStore.getState().revealCards).toHaveBeenCalledTimes(3);
  expect(useAppStore.getState().revealCards).toHaveBeenLastCalledWith(0, ['a'], 'library');
});

test('in a look, a build behind the table cannot reveal a card either', async () => {
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(2, user);
  act(() =>
    useAppStore.setState({ online: { code: 'KQ7M2X', status: { kind: 'stale-build' }, mySeat: 0 } }),
  );
  expect(within(rows()[0]).getByRole('button', { name: /^reveal alpha strike/i })).toBeDisabled();
});

// ---- tap to zoom ----

const BIG: CardInstance[] = [
  { iid: 'za', cardId: 'z-a', name: 'Zephyr Charge' },
  { iid: 'zb', cardId: 'z-b', name: 'Zealous Guardian' },
];

/** A library whose cards this device has full records for. */
async function withRecords() {
  const { getCardById } = await import('../data/scryfall');
  vi.mocked(getCardById).mockImplementation(async (id: string) =>
    id === 'z-b'
      ? {
          id: 'z-b',
          name: 'Zealous Guardian',
          nameLower: 'zealous guardian',
          typeLine: 'Creature — Kithkin Soldier',
          oracleText: 'Flash\nPersist',
          manaCost: '{G/W}',
          power: '1',
          toughness: '1',
          colors: ['G', 'W'],
          imageNormal: 'https://img.example/z-b.jpg',
          imageArtCrop: null,
          isToken: false,
          isBasicLand: false,
        }
      : undefined,
  );
  libraryBecomes(BIG);
}

test('tapping a card’s face opens it large with its rules text, and closing changes nothing', async () => {
  await withRecords();
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(2, user);
  await user.click(within(rows()[0]).getByRole('button', { name: /^bottom$/i })); // a plan already under way
  expect(screen.queryByRole('heading', { name: 'Zealous Guardian' })).not.toBeInTheDocument(); // buttons do not zoom

  await user.click(within(rows()[1]).getByRole('button', { name: /enlarge zealous guardian/i }));
  const zoom = screen.getByRole('heading', { name: 'Zealous Guardian' }).closest('.sheet') as HTMLElement;
  expect(await within(zoom).findByText('Creature — Kithkin Soldier', { exact: false })).toBeInTheDocument();
  expect(within(zoom).getByText(/Flash\s+Persist/)).toBeInTheDocument();
  expect(within(zoom).getByRole('img', { name: 'Zealous Guardian' })).toHaveAttribute(
    'src',
    'https://img.example/z-b.jpg',
  );

  await act(() => new Promise((r) => setTimeout(r, 400))); // read it for a moment
  await user.click(within(zoom).getByRole('button', { name: 'close' }));
  expect(screen.queryByRole('heading', { name: 'Zealous Guardian' })).not.toBeInTheDocument();
  expect(tags()).toEqual(['Bottom', 'Top']); // back in the look, exactly as it was left
  expect(useAppStore.getState().arrangeTop).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /^done$/i }));
  expect(useAppStore.getState().arrangeTop).toHaveBeenCalledWith(0, ['za', 'zb'], {
    top: ['zb'],
    bottom: ['za'],
    graveyard: [],
    hand: [],
  });
});

test('a double tap on a face opens the zoom and leaves it open: the second half does not tap it shut', async () => {
  await withRecords();
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(2, user);
  fireEvent.click(within(rows()[1]).getByRole('button', { name: /enlarge zealous guardian/i }));
  // The second tap of the pair lands wherever the zoom now is — often on its backdrop.
  const backdrop = screen.getByRole('heading', { name: 'Zealous Guardian' }).closest('.modal-backdrop')!;
  fireEvent.click(backdrop);
  expect(screen.getByRole('heading', { name: 'Zealous Guardian' })).toBeInTheDocument();
  await act(() => new Promise((r) => setTimeout(r, 400)));
  fireEvent.click(backdrop); // a deliberate tap outside, a moment later, does close it
  expect(screen.queryByRole('heading', { name: 'Zealous Guardian' })).not.toBeInTheDocument();
});

test('a card this device has no record of still opens, by name', async () => {
  await withRecords();
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(1, user);
  await user.click(screen.getByRole('button', { name: /enlarge zephyr charge/i }));
  const zoom = screen.getByRole('heading', { name: 'Zephyr Charge' }).closest('.sheet') as HTMLElement;
  expect(await within(zoom).findByText(/no card text/i)).toBeInTheDocument();
});

test('the zoom closes by itself when its card leaves the look, and does not come back with it', async () => {
  await withRecords();
  const user = userEvent.setup();
  render(<LibrarySheet playerIdx={0} claimed onClose={() => {}} />);
  await lookAt(2, user);
  await user.click(within(rows()[0]).getByRole('button', { name: /enlarge zephyr charge/i }));
  expect(screen.getByRole('heading', { name: 'Zephyr Charge' })).toBeInTheDocument();
  libraryBecomes(BIG.slice(1)); // Zephyr Charge was drawn elsewhere
  expect(screen.queryByRole('heading', { name: 'Zephyr Charge' })).not.toBeInTheDocument();
  expect(rows()).toHaveLength(1); // the look itself goes on with what is left
  libraryBecomes(BIG); // …and put back on top: a closed zoom stays closed
  expect(screen.queryByRole('heading', { name: 'Zephyr Charge' })).not.toBeInTheDocument();
});
