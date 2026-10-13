import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { buildSeatCards, moveCard, seedSeat } from '../lib/cards';
import { addCard, changeCardCount, createDeck, setCommander } from '../lib/deck';
import { createGame } from '../lib/game';
import type { CardRecord, GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldCardSheet from './BattlefieldCardSheet';

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

function gameWithBear() {
  let deck = setCommander(createDeck('Stompy'), RECORDS['c-cmd']);
  deck = addCard(deck, RECORDS['c-bear']);
  deck = changeCardCount(deck, 'c-bear', 9);
  const g = seedSeat(createGame(config), 0, buildSeatCards(deck, 42));
  const iid = g.players[0].cards!.hand[0].iid;
  return { g: moveCard(g, 0, iid, 'hand', 'battlefield', { row: 'front' }), iid };
}

beforeEach(() => {
  useAppStore.setState({ online: null });
});

test('shows the card by its iid', async () => {
  const { g, iid } = gameWithBear();
  useAppStore.setState({ game: g });
  render(<BattlefieldCardSheet playerIdx={0} iid={iid} onClose={() => {}} />);
  expect(await screen.findByRole('heading', { name: 'Grizzly Bears' })).toBeInTheDocument();
});

test('closes itself when the card leaves the zone instead of lurking', async () => {
  const { g, iid } = gameWithBear();
  useAppStore.setState({ game: g });
  const onClose = vi.fn();
  const { rerender } = render(
    <BattlefieldCardSheet playerIdx={0} iid={iid} onClose={onClose} />,
  );
  // A peer's device moves the card away (remote op applies locally):
  useAppStore.setState({ game: moveCard(g, 0, iid, 'battlefield', 'graveyard') });
  rerender(<BattlefieldCardSheet playerIdx={0} iid={iid} onClose={onClose} />);
  expect(onClose).toHaveBeenCalled();
});

/** A partner pair: one commander on the battlefield, the other still home. */
async function pairGame() {
  const { setPartner } = await import('../lib/deck');
  let deck = setPartner(
    setCommander(createDeck('Pair'), RECORDS['c-cmd']),
    rec('c-partner', 'Tymna', 'Legendary Creature — Human'),
  );
  deck = addCard(deck, RECORDS['c-bear']);
  deck = changeCardCount(deck, 'c-bear', 9);
  const g = seedSeat(createGame(config), 0, buildSeatCards(deck, 42));
  const [first] = g.players[0].cards!.command;
  const bear = g.players[0].cards!.hand[0].iid;
  let next = moveCard(g, 0, first.iid, 'command', 'battlefield', { row: 'front' });
  next = moveCard(next, 0, bear, 'hand', 'battlefield', { row: 'front' });
  return { g: next, commander: first.iid, bear };
}

test('a commander can go home even while its partner sits in the command zone', async () => {
  const { g, commander } = await pairGame();
  const commanderDiedAction = vi.fn();
  useAppStore.setState({ game: g, commanderDiedAction });
  const { default: userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();
  render(<BattlefieldCardSheet playerIdx={0} iid={commander} onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: /to command/i }));
  expect(commanderDiedAction).toHaveBeenCalledWith(0, commander);
});

test('an ordinary card is never offered the command zone', async () => {
  const { g, bear } = await pairGame();
  // even with the command zone emptied out
  g.players[0] = { ...g.players[0], cards: { ...g.players[0].cards!, command: [] } };
  useAppStore.setState({ game: g });
  render(<BattlefieldCardSheet playerIdx={0} iid={bear} onClose={() => {}} />);
  await screen.findByRole('heading', { name: 'Grizzly Bears' });
  expect(screen.queryByRole('button', { name: /to command/i })).not.toBeInTheDocument();
});

// ---- the plain tap, and where the card is kept ----

test('the plain tap is always in the sheet — the way back from a tap made by mistake — and says which way', async () => {
  const { fireEvent } = await import('@testing-library/react');
  const { g, iid } = gameWithBear();
  const tapVirtualCard = vi.fn();
  useAppStore.setState({ game: g, tapVirtualCard });
  const onClose = vi.fn();
  const first = render(<BattlefieldCardSheet playerIdx={0} iid={iid} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tap' }));
  expect(tapVirtualCard).toHaveBeenLastCalledWith(0, iid, true);
  expect(onClose).toHaveBeenCalled();
  first.unmount();

  const { tapCard } = await import('../lib/cards');
  useAppStore.setState({ game: tapCard(g, 0, iid, true) });
  render(<BattlefieldCardSheet playerIdx={0} iid={iid} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Untap' }));
  expect(tapVirtualCard).toHaveBeenLastCalledWith(0, iid, false);
});

test('"Keep it" offers the places the card is not drawn in, and pins it where the player says', async () => {
  const { fireEvent, waitFor } = await import('@testing-library/react');
  const { g, iid } = gameWithBear();
  const moveVirtualCard = vi.fn();
  useAppStore.setState({ game: g, moveVirtualCard });
  render(<BattlefieldCardSheet playerIdx={0} iid={iid} onClose={() => {}} />);
  // A creature is drawn in the field: the two shelves are on offer, the field is not.
  await waitFor(() => expect(screen.getByRole('button', { name: 'With the lands' })).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'On the side shelf' })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'On the battlefield' })).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'On the side shelf' }));
  expect(moveVirtualCard).toHaveBeenLastCalledWith(0, iid, 'battlefield', 'battlefield', { row: 'side' });
  fireEvent.click(screen.getByRole('button', { name: 'With the lands' }));
  expect(moveVirtualCard).toHaveBeenLastCalledWith(0, iid, 'battlefield', 'battlefield', { row: 'lands' });
});

test('a card kept on a shelf by hand is offered the way back to the battlefield', async () => {
  const { fireEvent } = await import('@testing-library/react');
  const { g, iid } = gameWithBear();
  const moveVirtualCard = vi.fn();
  useAppStore.setState({
    game: moveCard(g, 0, iid, 'battlefield', 'battlefield', { row: 'lands' }),
    moveVirtualCard,
  });
  render(<BattlefieldCardSheet playerIdx={0} iid={iid} onClose={() => {}} />);
  expect(screen.queryByRole('button', { name: 'With the lands' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'On the battlefield' }));
  expect(moveVirtualCard).toHaveBeenLastCalledWith(0, iid, 'battlefield', 'battlefield', { row: 'field' });
});
