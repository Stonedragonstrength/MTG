import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import HandCardSheet from './HandCardSheet';
import HandTray from './HandTray';
import PileSheet from './PileSheet';
import XCostSheet from './XCostSheet';

// The screens that offer what a spell's price allows: the hand's gate on
// the table's price, Cycle on a held card, Flashback in the graveyard, the
// overload switch on the cast sheet.

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

function rec(id: string, name: string, typeLine: string, manaCost: string, oracleText = '', more: Partial<CardRecord> = {}): CardRecord {
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
    isBasicLand: typeLine.startsWith('Basic Land'),
    ...more,
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-island': rec('c-island', 'Island', 'Basic Land — Island', '', '({T}: Add {U}.)'),
  'c-mountain': rec('c-mountain', 'Mountain', 'Basic Land — Mountain', '', '({T}: Add {R}.)'),
  'c-ruby': rec('c-ruby', 'Ruby Medallion', 'Artifact', '{2}', 'Red spells you cast cost {1} less to cast.'),
  'c-giant': rec('c-giant', 'Hill Giant', 'Creature — Giant', '{3}{R}', '', { colors: ['R'] }),
  'c-bears': rec('c-bears', 'Grizzly Bears', 'Creature — Bear', '{1}{G}', '', { colors: ['G'] }),
  'c-cruise': rec('c-cruise', 'Treasure Cruise', 'Sorcery', '{7}{U}', 'Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)\nDraw three cards.', { colors: ['U'] }),
  'c-cave': rec('c-cave', 'Forgotten Cave', 'Land', '', 'Forgotten Cave enters tapped.\n{T}: Add {R}.\nCycling {R} ({R}, Discard this card: Draw a card.)'),
  'c-abom': rec(
    'c-abom',
    'Twisted Abomination',
    'Creature — Zombie Mutant',
    '{5}{B}',
    '{B}: Regenerate Twisted Abomination.\nSwampcycling {2} ({2}, Discard this card: Search your library for a Swamp card, reveal it, put it into your hand, then shuffle.)',
  ),
  'c-looting': rec('c-looting', 'Faithless Looting', 'Sorcery', '{R}', 'Draw two cards, then discard two cards.\nFlashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)'),
  'c-rift': rec(
    'c-rift',
    'Cyclonic Rift',
    'Instant',
    '{1}{U}',
    'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of "target" with "each.")',
    { colors: ['U'] },
  ),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
  findCardsNamed: vi.fn(async () => []),
}));

const c = (iid: string, cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId,
  name: RECORDS[cardId].name,
  ...(/Land/.test(RECORDS[cardId].typeLine) ? { row: 'lands' as const } : {}),
  ...more,
});

function table(seat: { hand?: CardInstance[]; battlefield?: CardInstance[]; graveyard?: CardInstance[] }): GameState {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: {
      library: [],
      hand: seat.hand ?? [],
      battlefield: seat.battlefield ?? [],
      graveyard: seat.graveyard ?? [],
      exile: [],
      command: [],
      mulligans: 0,
      deckName: 'Test',
      kept: true,
    },
  };
  return g;
}

const playCard = vi.fn(async () => {});
const cycleCard = vi.fn(async () => {});
const castFromGraveyard = vi.fn(async () => {});

beforeEach(() => {
  playCard.mockClear();
  cycleCard.mockClear();
  castFromGraveyard.mockClear();
  useAppStore.setState({ online: null, playCard, cycleCard, castFromGraveyard, moveVirtualCard: vi.fn() });
});

/** A deliberate tap, well after a sheet has opened. */
function tap(el: Element) {
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(click, 'timeStamp', { value: Date.now() + 1000 });
  fireEvent(el, click);
}

test('the hand’s gate prices on the table: Ruby Medallion lights Hill Giant on three Mountains', async () => {
  const mountains = [c('m1', 'c-mountain'), c('m2', 'c-mountain'), c('m3', 'c-mountain')];
  useAppStore.setState({ game: table({ hand: [c('h1', 'c-giant')], battlefield: mountains }) });
  const { unmount } = render(<HandTray playerIdx={0} />);
  const dim = await screen.findByRole('button', { name: /play hill giant/i });
  await vi.waitFor(() => expect(dim.className).toContain('hand-card--poor'));
  unmount();
  useAppStore.setState({ game: table({ hand: [c('h1', 'c-giant')], battlefield: [...mountains, c('ruby', 'c-ruby')] }) });
  render(<HandTray playerIdx={0} />);
  const lit = await screen.findByRole('button', { name: /play hill giant/i });
  await vi.waitFor(() => expect(lit.className).not.toContain('hand-card--poor'));
});

test('delve: Treasure Cruise lights up on one Island and seven cards in the graveyard', async () => {
  const graveyard = Array.from({ length: 7 }, (_, i) => c(`g${i}`, 'c-bears'));
  useAppStore.setState({ game: table({ hand: [c('h1', 'c-cruise')], battlefield: [c('i1', 'c-island')], graveyard }) });
  render(<HandTray playerIdx={0} />);
  const card = await screen.findByRole('button', { name: /play treasure cruise/i });
  await vi.waitFor(() => expect(card.className).not.toContain('hand-card--poor'));
});

test('a card with cycling offers "Cycle {R}" when held', async () => {
  useAppStore.setState({ game: table({ hand: [c('h1', 'c-cave')] }) });
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<HandCardSheet playerIdx={0} iid="h1" onClose={onClose} />);
  await user.click(await screen.findByRole('button', { name: 'Cycle {R}' }));
  expect(cycleCard).toHaveBeenCalledWith(0, 'h1', 0);
  expect(onClose).toHaveBeenCalled();
});

test('typecycling: once the card has gone, the library search for a Swamp comes up', async () => {
  useAppStore.setState({ game: table({ hand: [c('h1', 'c-abom')] }) });
  cycleCard.mockImplementationOnce(async () => {
    useAppStore.setState({ game: table({ graveyard: [c('h1', 'c-abom')] }) });
  });
  const onSearch = vi.fn();
  const user = userEvent.setup();
  render(<HandCardSheet playerIdx={0} iid="h1" onSearch={onSearch} onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: 'Swampcycling {2}' }));
  await vi.waitFor(() => expect(onSearch).toHaveBeenCalled());
  expect(onSearch.mock.calls[0][0]).toMatchObject({ what: 'a Swamp card', to: ['hand'] });
  expect(onSearch.mock.calls[0][1]).toBe('Twisted Abomination');
});

test('the graveyard offers Flashback on a card that has it', async () => {
  useAppStore.setState({ game: table({ graveyard: [c('g1', 'c-looting'), c('g2', 'c-bears')], battlefield: [c('m1', 'c-mountain')] }) });
  const user = userEvent.setup();
  render(<PileSheet playerIdx={0} zone="graveyard" onClose={() => {}} />);
  // One Mountain is not {2}{R}: it says so, and casts all the same.
  await user.click(await screen.findByRole('button', { name: 'flashback anyway Faithless Looting' }));
  expect(castFromGraveyard).toHaveBeenCalledWith(0, 'g1');
  expect(screen.queryByRole('button', { name: /flashback.*grizzly/i })).not.toBeInTheDocument();
});

test('the cast sheet asks whether Cyclonic Rift is overloaded, and casts it that way', async () => {
  const islands = Array.from({ length: 7 }, (_, i) => c(`i${i}`, 'c-island'));
  useAppStore.setState({ game: table({ hand: [c('h1', 'c-rift')], battlefield: islands }) });
  render(<XCostSheet playerIdx={0} iid="h1" from="hand" onClose={() => {}} />);
  const toggle = await screen.findByRole('switch', { name: 'Overload {6}{U}' });
  await vi.waitFor(() => expect(screen.getByText('Costs 2 · 7 ready')).toBeInTheDocument());
  tap(toggle);
  expect(screen.getByText('Costs 7 · 7 ready')).toBeInTheDocument();
  tap(screen.getByRole('button', { name: /^cast$/i }));
  expect(playCard).toHaveBeenCalledWith(0, 'h1', { way: 'overload' });
});
