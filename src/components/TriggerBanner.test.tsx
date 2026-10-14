import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import TriggerBanner from './TriggerBanner';
import { _resetTriggers, useTriggers } from './useTriggers';

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

function rec(id: string, name: string, typeLine: string, oracleText = '', more: Partial<CardRecord> = {}): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
    ...more,
  };
}

const SOLDIER = rec('t-soldier', 'Soldier', 'Token Creature — Soldier', '', { power: '1', toughness: '1', colors: ['W'], isToken: true });
const RECORDS: Record<string, CardRecord> = {
  storm: rec('storm', 'Encroaching Dragonstorm', 'Enchantment', "When a Dragon you control enters, return this enchantment to its owner's hand."),
  dragon: rec('dragon', 'Shivan Dragon', 'Creature — Dragon', 'Flying', { power: '5', toughness: '5' }),
  bear: rec('bear', 'Grizzly Bears', 'Creature — Bear', '', { power: '2', toughness: '2' }),
  warden: rec('warden', 'Soul Warden', 'Creature — Human Cleric', 'Whenever another creature enters, you gain 1 life.'),
  visionary: rec('visionary', 'Elvish Visionary', 'Creature — Elf Shaman', 'When this creature enters, draw a card.'),
  priest: rec('priest', 'Suture Priest', 'Creature — Phyrexian Cleric', 'Whenever another creature you control enters, you may gain 1 life.'),
  cobra: rec('cobra', 'Lotus Cobra', 'Creature — Snake', 'Landfall — Whenever a land you control enters, add one mana of any color.'),
  forest: rec('forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  rally: rec('rally', 'Endless Rally', 'Enchantment', 'Whenever a creature you control enters, create a 1/1 white Soldier creature token.'),
  [SOLDIER.id]: SOLDIER,
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
  findCardsNamed: vi.fn(async (name: string) => (name === 'Soldier' ? [SOLDIER] : [])),
}));

const card = (iid: string, cardId: string): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name });

/** Nathan's side: those cards on the battlefield, those in hand, a library of Forests. */
function start(battlefield: CardInstance[], hand: CardInstance[] = [], board: BoardItem[] = []) {
  useAppStore.getState().startGame(config);
  const g = useAppStore.getState().game!;
  const game: GameState = {
    ...g,
    players: [
      {
        ...g.players[0],
        board,
        cards: {
          library: [card('l1', 'forest'), card('l2', 'forest'), card('l3', 'forest')],
          hand,
          battlefield,
          graveyard: [],
          exile: [],
          command: [],
          mulligans: 0,
          deckName: 'Test',
          kept: true,
        },
      },
      g.players[1],
    ],
  };
  useAppStore.setState({ game });
}

const mine = () => useAppStore.getState().game!.players[0];
const shown = () => useTriggers.getState().shown;
/** A while for the lookups behind a trigger to answer: nothing more is coming. */
const quiet = () => act(() => new Promise((r) => setTimeout(r, 60)));

beforeEach(() => {
  _resetTriggers();
});

test('a Dragon entering sends the Dragonstorm back to hand by itself, and the banner says so', async () => {
  start([card('s1', 'storm')], [card('h1', 'dragon')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(mine().cards!.hand.map((c) => c.name)).toEqual(['Encroaching Dragonstorm']));
  expect(mine().cards!.battlefield.map((c) => c.name)).toEqual(['Shivan Dragon']);
  expect(useAppStore.getState().game!.feed?.at(-1)?.text).toBe('Encroaching Dragonstorm returns to Nathan’s hand');

  render(<TriggerBanner />);
  const banner = screen.getByRole('status', { name: 'triggered' });
  expect(within(banner).getByText('Encroaching Dragonstorm')).toBeInTheDocument();
  expect(within(banner).getByText('Shivan Dragon entered')).toBeInTheDocument();
  expect(within(banner).getByRole('button', { name: '✓ Return it to hand' })).toBeDisabled();
});

test('a bear entering does not: the Dragonstorm waits for a Dragon', async () => {
  start([card('s1', 'storm')], [card('h1', 'bear')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await quiet();
  expect(mine().cards!.battlefield.map((c) => c.name)).toEqual(['Encroaching Dragonstorm', 'Grizzly Bears']);
  expect(shown()).toEqual([]);
});

test('"When this creature enters, draw a card": the card is drawn as it lands', async () => {
  start([], [card('h1', 'visionary')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(mine().cards!.hand.map((c) => c.iid)).toEqual(['l1']));
  expect(shown()[0].acts).toMatchObject([{ label: 'Draw 1', done: true }]);
});

test('three tokens entering at once gain Soul Warden’s life three times', async () => {
  start([card('w1', 'warden')]);
  act(() => useAppStore.getState().addItem(0, { id: 'soldiers', cardId: SOLDIER.id, name: 'Soldier', imageNormal: null, imageArtCrop: null, typeLine: SOLDIER.typeLine, oracleText: '', basePower: 1, baseToughness: 1, count: 3, counters: {}, color: null, zone: 'board' }));
  await waitFor(() => expect(mine().life).toBe(43));
  expect(shown()[0]).toMatchObject({ because: 'Soldier ×3 entered', acts: [{ label: 'Gain 3 life', done: true }] });
});

test('"you may" waits for its button; a tap on it does it', async () => {
  start([card('p1', 'priest')], [card('h1', 'bear')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(shown()).toHaveLength(1));
  expect(mine().life).toBe(40);
  render(<TriggerBanner />);
  const gain = screen.getByRole('button', { name: 'Gain 1 life' });
  expect(gain).toBeEnabled();
  await act(() => new Promise((r) => setTimeout(r, 400))); // a tap in its first moment is not taken
  await userEvent.click(gain);
  expect(mine().life).toBe(41);
  expect(screen.getByRole('button', { name: '✓ Gain 1 life' })).toBeDisabled();
});

test('a card waiting for something else is shown even with nothing to press: the trigger people forget', async () => {
  start([card('c1', 'cobra')], [card('h1', 'forest')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(shown()).toHaveLength(1));
  render(<TriggerBanner />);
  expect(screen.getByText('Lotus Cobra')).toBeInTheDocument();
  expect(screen.getByText('Forest entered')).toBeInTheDocument();
  expect(screen.getByText(/add one mana of any color/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('an Undo of what entered takes its trigger away', async () => {
  start([card('p1', 'priest')], [card('h1', 'bear')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(shown()).toHaveLength(1));
  act(() => useAppStore.getState().undo());
  expect(shown()).toEqual([]);
});

test('a card coming back by an Undo has not entered: nothing goes off', async () => {
  start([card('w1', 'warden'), card('b1', 'bear')]);
  act(() => useAppStore.getState().moveVirtualCard(0, 'b1', 'battlefield', 'graveyard'));
  act(() => useAppStore.getState().undo());
  await quiet();
  expect(mine().cards!.battlefield.map((c) => c.iid)).toEqual(['w1', 'b1']);
  expect(shown()).toEqual([]);
  expect(mine().life).toBe(40);
});

test('triggers setting off triggers stop by themselves after a few rounds; the next waits for a tap', async () => {
  start([card('r1', 'rally')], [card('h1', 'bear')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(mine().board.find((it) => it.name === 'Soldier')?.count).toBe(4));
  await quiet();
  expect(mine().board.find((it) => it.name === 'Soldier')?.count).toBe(4);
  const last = shown().at(-1)!;
  expect(last.acts).toMatchObject([{ label: 'Make a Soldier', done: false }]);
});

test('a tap on the banner puts it away', async () => {
  start([card('c1', 'cobra')], [card('h1', 'forest')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(shown()).toHaveLength(1));
  render(<TriggerBanner />);
  await act(() => new Promise((r) => setTimeout(r, 400)));
  await userEvent.click(screen.getByRole('status', { name: 'triggered' }));
  expect(screen.queryByRole('status', { name: 'triggered' })).not.toBeInTheDocument();
});
