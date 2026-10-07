import { act, render, screen, within } from '@testing-library/react';
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
