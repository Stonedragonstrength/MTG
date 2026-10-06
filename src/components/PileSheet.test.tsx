import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { buildSeatCards, moveCard, seedSeat } from '../lib/cards';
import { addCard, changeCardCount, createDeck, setCommander } from '../lib/deck';
import { createGame } from '../lib/game';
import type { CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import PileSheet from './PileSheet';

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

function rec(id: string, name: string, typeLine: string): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText: '',
    manaCost: '{1}',
    power: null,
    toughness: null,
    colors: [],
    colorIdentity: ['G'],
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-cmd': rec('c-cmd', 'Ashaya', 'Legendary Creature — Elemental'),
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear'),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

/** Commander cast then wiped to the graveyard: command zone empty. */
function strandedCommander(): { g: GameState; iid: string } {
  let deck = setCommander(createDeck('Stompy'), RECORDS['c-cmd']);
  deck = addCard(deck, RECORDS['c-bear']);
  deck = changeCardCount(deck, 'c-bear', 9);
  const seeded = seedSeat(createGame(config), 0, buildSeatCards(deck, 42));
  const iid = seeded.players[0].cards!.command[0].iid;
  const cast = moveCard(seeded, 0, iid, 'command', 'battlefield', { row: 'front' });
  return { g: moveCard(cast, 0, iid, 'battlefield', 'graveyard'), iid };
}

beforeEach(() => {
  useAppStore.setState({
    online: null,
    moveVirtualCard: vi.fn(),
    castCommander: vi.fn(),
    commanderReturned: vi.fn(),
  });
});

test('a graveyard row offers Command while the command zone is empty', async () => {
  const { g, iid } = strandedCommander();
  useAppStore.setState({ game: g });
  const user = userEvent.setup();
  render(<PileSheet playerIdx={0} zone="graveyard" onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /^command$/i }));
  expect(useAppStore.getState().commanderReturned).toHaveBeenCalledWith(0, iid, 'graveyard');
});

test('no Command offer while the commander still sits in its zone', () => {
  let deck = setCommander(createDeck('Stompy'), RECORDS['c-cmd']);
  deck = addCard(deck, RECORDS['c-bear']);
  deck = changeCardCount(deck, 'c-bear', 9);
  let g = seedSeat(createGame(config), 0, buildSeatCards(deck, 42));
  const bear = g.players[0].cards!.library[0].iid;
  g = moveCard(g, 0, bear, 'library', 'graveyard');
  useAppStore.setState({ game: g });
  render(<PileSheet playerIdx={0} zone="graveyard" onClose={() => {}} />);
  expect(screen.queryByRole('button', { name: /^command$/i })).not.toBeInTheDocument();
});
