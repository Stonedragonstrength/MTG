import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { CardInstance, CardRecord, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import DiscoverSheet from './DiscoverSheet';

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

function rec(id: string, name: string, typeLine: string, manaCost: string, oracleText = ''): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost,
    power: null,
    toughness: null,
    colors: [],
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const RECORDS: Record<string, CardRecord> = {
  forest: rec('forest', 'Forest', 'Basic Land — Forest', ''),
  giant: rec('giant', 'Hill Giant', 'Creature — Giant', '{3}{R}'),
  bolt: rec('bolt', 'Lightning Bolt', 'Instant', '{R}', 'Lightning Bolt deals 3 damage to any target.'),
  bear: rec('bear', 'Grizzly Bears', 'Creature — Bear', '{1}{G}'),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

const card = (iid: string, cardId: string): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name });

/** Nathan's library, top first. */
function start(library: CardInstance[]) {
  useAppStore.getState().startGame(config);
  const g = useAppStore.getState().game!;
  useAppStore.setState({
    game: {
      ...g,
      players: g.players.map((p, i) =>
        i === 0
          ? { ...p, cards: { library, hand: [], battlefield: [], graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'Test', kept: true } }
          : p,
      ),
    },
  });
}
const mine = () => useAppStore.getState().game!.players[0].cards!;
const lastFeed = () => useAppStore.getState().game!.feed?.at(-1)?.text;
/** The sheet takes no tap in its first moment on screen. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 400)));

test('Discover 3: the cards come up until one it may take — Cast casts it free, the others go under the library', async () => {
  start([card('l1', 'forest'), card('l2', 'giant'), card('l3', 'bolt'), card('l4', 'bear')]);
  const onClose = vi.fn();
  render(<DiscoverSheet playerIdx={0} n={3} source="Daring Discovery" onClose={onClose} />);
  expect(screen.getByRole('heading', { name: 'Discover 3 · Daring Discovery' })).toBeInTheDocument();
  expect(await screen.findByText('Lightning Bolt')).toBeInTheDocument();
  const others = screen.getByRole('list', { name: 'turned over' });
  expect(within(others).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Forest', 'Hill Giant']);
  expect(mine().library.map((c) => c.iid)).toEqual(['l1', 'l2', 'l3', 'l4']); // nothing moved yet

  await settle();
  await userEvent.click(screen.getByRole('button', { name: 'Cast Lightning Bolt' }));
  expect(onClose).toHaveBeenCalledWith(true);
  expect(mine().graveyard.map((c) => c.iid)).toEqual(['l3']);
  expect(mine().library[0].iid).toBe('l4');
  expect(mine().library.slice(1).map((c) => c.iid).sort()).toEqual(['l1', 'l2']);
  expect(useAppStore.getState().game!.reveal).toMatchObject({ from: 'cast', cards: [{ name: 'Lightning Bolt' }] });
  expect(lastFeed()).toBe('Nathan: Daring Discovery — discover 3: casts Lightning Bolt (Forest, Hill Giant to the bottom)');
});

test('…or the card goes into its player’s hand', async () => {
  start([card('l1', 'forest'), card('l3', 'bolt'), card('l4', 'bear')]);
  const onClose = vi.fn();
  render(<DiscoverSheet playerIdx={0} n={3} source="Daring Discovery" onClose={onClose} />);
  await screen.findByText('Lightning Bolt');
  await settle();
  await userEvent.click(screen.getByRole('button', { name: 'Put it into your hand' }));
  expect(onClose).toHaveBeenCalledWith(true);
  expect(mine().hand.map((c) => c.iid)).toEqual(['l3']);
  expect(mine().library.map((c) => c.iid)).toEqual(['l4', 'l1']);
  expect(mine().graveyard).toEqual([]);
  expect(lastFeed()).toBe('Nathan: Daring Discovery — discover 3: Lightning Bolt into their hand (Forest to the bottom)');
});

test('"discover X" asks for X first; closed without an answer, nothing has happened', async () => {
  start([card('l1', 'forest'), card('l2', 'giant'), card('l3', 'bolt')]);
  const onClose = vi.fn();
  render(<DiscoverSheet playerIdx={0} n={null} source="Hurl into History" onClose={onClose} />);
  expect(screen.getByRole('heading', { name: 'Discover X · Hurl into History' })).toBeInTheDocument();
  await settle();
  await userEvent.click(within(screen.getByRole('group', { name: 'X' })).getByRole('button', { name: '4' }));
  expect(screen.getByRole('heading', { name: 'Discover 4 · Hurl into History' })).toBeInTheDocument();
  expect(await screen.findByText('Hill Giant')).toBeInTheDocument(); // mana value 4: 4 or less
  await userEvent.click(screen.getByRole('button', { name: 'close' }));
  expect(onClose).toHaveBeenCalledWith(false);
  expect(mine().library.map((c) => c.iid)).toEqual(['l1', 'l2', 'l3']);
});

test('nothing to find: every card goes back to the bottom, shuffled', async () => {
  start([card('l1', 'forest'), card('l2', 'giant')]);
  const onClose = vi.fn();
  render(<DiscoverSheet playerIdx={0} n={2} source="Daring Discovery" onClose={onClose} />);
  expect(await screen.findByText(/No nonland card with mana value 2 or less/)).toBeInTheDocument();
  await settle();
  await userEvent.click(screen.getByRole('button', { name: 'Shuffle them back' }));
  expect(onClose).toHaveBeenCalledWith(true);
  expect(mine().library.map((c) => c.iid).sort()).toEqual(['l1', 'l2']);
  expect(lastFeed()).toBe('Nathan: Daring Discovery — discover 2 finds nothing (the library is shuffled)');
});
