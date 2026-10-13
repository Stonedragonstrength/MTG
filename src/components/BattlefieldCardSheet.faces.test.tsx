import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flipCard } from '../lib/cards';
import { backId, backView, frontId, isBackId } from '../lib/faces';
import { createGame } from '../lib/game';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldCardSheet from './BattlefieldCardSheet';
import VCard from './VCard';

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

function rec(id: string, name: string, typeLine: string, more: Partial<CardRecord> = {}): CardRecord {
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
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
    ...more,
  };
}

const DELVER = 'Delver of Secrets // Insectile Aberration';

const delverRecord = (id: string) =>
  rec(id, DELVER, 'Creature — Human Wizard // Creature — Human Insect', {
    back: {
      name: 'Insectile Aberration',
      typeLine: 'Creature — Human Insect',
      oracleText: 'Flying',
      manaCost: '',
      power: '3',
      toughness: '2',
      colors: ['U'],
      imageNormal: 'https://img.example/aberration.jpg',
      imageArtCrop: null,
    },
  });

const RECORDS: Record<string, CardRecord> = {
  'c-delver': delverRecord('c-delver'),
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear'),
  'c-fire': rec('c-fire', 'Fire // Ice', 'Instant // Instant', { back: null }),
};

/** Known to this device only by name: another device's printing of Delver. */
const DRIFTED = delverRecord('c-delver-here');

// The real lookup, as far as faces go: a back id reads the card's back view.
vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => {
    const front = RECORDS[frontId(id)];
    return front && isBackId(id) ? backView(front) : front;
  }),
  findCardByName: vi.fn(async (name: string) => (name === 'Drifted Delver' ? DRIFTED : undefined)),
  findBasicLand: vi.fn(async () => undefined),
}));

const seat = (battlefield: CardInstance[]) => ({
  library: [],
  hand: [],
  battlefield,
  graveyard: [],
  exile: [],
  command: [],
  mulligans: 0,
  deckName: 'Test',
});

function table(): GameState {
  const g = createGame(config);
  return {
    ...g,
    players: [
      {
        ...g.players[0],
        cards: seat([
          { iid: 'delver', cardId: 'c-delver', name: DELVER },
          { iid: 'bear', cardId: 'c-bear', name: 'Grizzly Bears' },
          { iid: 'fire', cardId: 'c-fire', name: 'Fire // Ice' },
          { iid: 'drifted', cardId: backId('c-delver-elsewhere'), name: 'Drifted Delver' },
        ]),
      },
      { ...g.players[1], cards: seat([]) },
    ],
  };
}

const realTransform = useAppStore.getState().transformCard;

beforeEach(() => {
  useAppStore.setState({ online: null, game: table(), transformCard: realTransform });
});

afterEach(cleanup);

test('a double-faced card offers Transform: one press turns it over and closes the sheet', async () => {
  const transformCard = vi.fn(async () => {});
  useAppStore.setState({ transformCard });
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<BattlefieldCardSheet playerIdx={0} iid="delver" onClose={onClose} />);
  expect(await screen.findByText('Front face up: Delver of Secrets')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Transform' }));
  expect(transformCard).toHaveBeenCalledWith(0, 'delver');
  expect(onClose).toHaveBeenCalled();
});

test('on its back the sheet shows the back face, and offers the way back', async () => {
  useAppStore.setState({ game: flipCard(table(), 0, 'delver', true) });
  const transformCard = vi.fn(async () => {});
  useAppStore.setState({ transformCard });
  const user = userEvent.setup();
  render(<BattlefieldCardSheet playerIdx={0} iid="delver" onClose={() => {}} />);
  expect(await screen.findByText('Creature — Human Insect')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: DELVER })).toHaveAttribute('src', 'https://img.example/aberration.jpg');
  expect(screen.getByText('On its back: Insectile Aberration')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Transform' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Transform back' }));
  expect(transformCard).toHaveBeenCalledWith(0, 'delver');
});

test('the press really turns the card, through the store', async () => {
  const user = userEvent.setup();
  render(<BattlefieldCardSheet playerIdx={0} iid="delver" onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: 'Transform' }));
  await vi.waitFor(() =>
    expect(useAppStore.getState().game!.players[0].cards!.battlefield[0].cardId).toBe(backId('c-delver')),
  );
});

test('a single-faced card and a split card have nothing to turn', async () => {
  const { unmount } = render(<BattlefieldCardSheet playerIdx={0} iid="bear" onClose={() => {}} />);
  expect(await screen.findByText('Creature — Bear')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /transform/i })).toBeNull();
  unmount();
  render(<BattlefieldCardSheet playerIdx={0} iid="fire" onClose={() => {}} />);
  expect(await screen.findByText('Instant // Instant')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /transform/i })).toBeNull();
});

test('a card on its back that this device only knows by name still reads as its back face', async () => {
  render(<BattlefieldCardSheet playerIdx={0} iid="drifted" onClose={() => {}} />);
  expect(await screen.findByText('Creature — Human Insect')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Transform back' })).toBeInTheDocument();
});

test('on the board a card on its back wears a mark, and one on its front does not', () => {
  const props = { art: null, sick: false, look: null, names: ['Nathan', 'Sam'], onTap: () => {}, onDetail: () => {} };
  const { rerender } = render(<VCard card={{ iid: 'd', cardId: backId('c-delver'), name: DELVER }} {...props} />);
  expect(screen.getByLabelText('on its back face')).toBeInTheDocument();
  rerender(<VCard card={{ iid: 'd', cardId: 'c-delver', name: DELVER }} {...props} />);
  expect(screen.queryByLabelText('on its back face')).toBeNull();
});
