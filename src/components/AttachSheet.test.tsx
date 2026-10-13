import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { attachCard } from '../lib/cards';
import { createGame } from '../lib/game';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import AttachSheet from './AttachSheet';
import BattlefieldCardSheet from './BattlefieldCardSheet';
import BattlefieldRow from './BattlefieldRow';
import SideShelf from './SideShelf';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: [
    { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
    { id: 'p2', name: 'Alex', avatarUrl: null, commanderName: null },
  ],
};

function rec(id: string, name: string, typeLine: string, oracleText = '', pt: string | null = null): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '{1}',
    power: pt,
    toughness: pt,
    colors: [],
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear', '', '2'),
  'c-giant': rec('c-giant', 'Hill Giant', 'Creature — Giant', '', '3'),
  'c-forest': rec('c-forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  'c-fear': rec('c-fear', 'Fear', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has fear.'),
  'c-might': rec('c-might', "Giant's Might", 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2.'),
  'c-greaves': rec('c-greaves', 'Lightning Greaves', 'Artifact — Equipment', 'Equipped creature has haste and shroud.\nEquip {0}'),
  'c-curse': rec('c-curse', 'Curse of Opulence', 'Enchantment — Aura Curse', 'Enchant player'),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

const card = (iid: string, cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId,
  name: RECORDS[cardId].name,
  row: 'front',
  ...more,
});

const soldiers: BoardItem = {
  id: 'soldiers',
  cardId: null,
  name: 'Soldier',
  imageNormal: null,
  imageArtCrop: null,
  typeLine: 'Token Creature — Soldier',
  oracleText: '',
  basePower: 1,
  baseToughness: 1,
  count: 2,
  counters: {},
  color: null,
  zone: 'board',
};

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

/** Nathan: a bear, a giant, a Forest, Fear, Giant's Might, Greaves and a Curse.
 * Sam: a bear and two soldiers. Alex: nothing. */
function table(): GameState {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: seat([
      card('bear', 'c-bear'),
      card('giant', 'c-giant'),
      card('forest', 'c-forest', { row: 'lands' }),
      card('fear', 'c-fear'),
      card('might', 'c-might'),
      card('greaves', 'c-greaves'),
      card('curse', 'c-curse'),
    ]),
  };
  g.players[1] = { ...g.players[1], board: [soldiers], cards: seat([card('sbear', 'c-bear')]) };
  return g;
}

const attachVirtualCard = vi.fn();

beforeEach(() => {
  attachVirtualCard.mockClear();
  useAppStore.setState({ game: table(), online: null, attachVirtualCard });
});

/** A deliberate tap, a moment after the sheet opened (for its first moment it takes none). */
function tap(el: Element) {
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(click, 'timeStamp', { value: Date.now() + 1000 });
  fireEvent(el, click);
}
const rows = () => screen.getAllByRole('button', { name: /^put it on /i }).map((b) => b.getAttribute('aria-label'));

test('an Aura is offered the creatures on its controller’s side first, with a tab for every other player', async () => {
  render(<AttachSheet playerIdx={0} iid="fear" onClose={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Attach Fear' })).toBeInTheDocument();
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Mine', 'Sam', 'Alex']);
  expect(screen.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true');
  await waitFor(() => expect(rows()).toEqual(['put it on Grizzly Bears', 'put it on Hill Giant']));
  // Not the Forest (it enchants creatures), not itself, not the other Auras lying about.
});

test('a tap on a row attaches it there and closes the sheet', async () => {
  const onClose = vi.fn();
  render(<AttachSheet playerIdx={0} iid="fear" onClose={onClose} />);
  tap(await screen.findByRole('button', { name: 'put it on Hill Giant' }));
  expect(attachVirtualCard).toHaveBeenCalledWith(0, 'fear', { seat: 0, kind: 'card', id: 'giant' }, 0);
  expect(onClose).toHaveBeenCalled();
});

test('an opponent’s tab lists their creatures — cards and stacks — and a tap puts it on one of those', async () => {
  render(<AttachSheet playerIdx={0} iid="fear" onClose={() => {}} />);
  tap(screen.getByRole('tab', { name: 'Sam' }));
  await waitFor(() => expect(rows()).toEqual(['put it on Grizzly Bears', 'put it on Soldier ×2']));
  tap(screen.getByRole('button', { name: 'put it on Soldier ×2' }));
  expect(attachVirtualCard).toHaveBeenCalledWith(0, 'fear', { seat: 1, kind: 'stack', id: 'soldiers' }, 0);
  attachVirtualCard.mockClear();
  tap(screen.getByRole('button', { name: 'put it on Grizzly Bears' }));
  expect(attachVirtualCard).toHaveBeenCalledWith(0, 'fear', { seat: 1, kind: 'card', id: 'sbear' }, 0);
});

test('a player with nothing it can go on says so', async () => {
  render(<AttachSheet playerIdx={0} iid="fear" onClose={() => {}} />);
  tap(screen.getByRole('tab', { name: 'Alex' }));
  expect(await screen.findByText('Nothing here it can go on.')).toBeInTheDocument();
});

test('a plain +N/+N is offered as counters on the creature: on unless the player says no', async () => {
  render(<AttachSheet playerIdx={0} iid="might" onClose={() => {}} />);
  const box = await screen.findByRole('checkbox', { name: /\+2\/\+2 as counters/i });
  expect(box).toBeChecked();
  tap(await screen.findByRole('button', { name: 'put it on Grizzly Bears' }));
  expect(attachVirtualCard).toHaveBeenLastCalledWith(0, 'might', { seat: 0, kind: 'card', id: 'bear' }, 2);
  tap(box); // a deliberate tap, like the rows': the sheet's first moment takes none
  expect(box).not.toBeChecked();
  tap(screen.getByRole('button', { name: 'put it on Hill Giant' }));
  expect(attachVirtualCard).toHaveBeenLastCalledWith(0, 'might', { seat: 0, kind: 'card', id: 'giant' }, 0);
});

test('a card with no such boost offers no counters', async () => {
  render(<AttachSheet playerIdx={0} iid="fear" onClose={() => {}} />);
  await screen.findByRole('button', { name: 'put it on Hill Giant' });
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

test('an Equipment that is on something shows where, and can be taken off or moved', async () => {
  useAppStore.setState({ game: attachCard(table(), 0, 'greaves', { seat: 0, kind: 'card', id: 'bear' }) });
  const onClose = vi.fn();
  render(<AttachSheet playerIdx={0} iid="greaves" onClose={onClose} />);
  expect(screen.getByRole('heading', { name: 'Equip Lightning Greaves' })).toBeInTheDocument();
  const here = await screen.findByRole('button', { name: 'Grizzly Bears — it is on this now' });
  expect(here).toHaveAttribute('aria-pressed', 'true');
  expect(within(here).getByText('on it')).toBeInTheDocument();
  tap(screen.getByRole('button', { name: 'Take it off' }));
  expect(attachVirtualCard).toHaveBeenCalledWith(0, 'greaves', null);
  expect(onClose).toHaveBeenCalled();
});

test('unattached, the way out is "Leave it unattached": nothing changes', async () => {
  const onClose = vi.fn();
  render(<AttachSheet playerIdx={0} iid="greaves" onClose={onClose} />);
  tap(screen.getByRole('button', { name: 'Leave it unattached' }));
  expect(attachVirtualCard).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test('an Aura that enchants a player has nothing on the board to go on', async () => {
  render(<AttachSheet playerIdx={0} iid="curse" onClose={() => {}} />);
  expect(await screen.findByText(/it enchants a player/i)).toBeInTheDocument();
});

test('the tap that opened it does not pick a row; and it closes for real when its card leaves', async () => {
  const onClose = vi.fn();
  render(<AttachSheet playerIdx={0} iid="fear" onClose={onClose} />);
  fireEvent.click(await screen.findByRole('button', { name: 'put it on Hill Giant' })); // at once: the same gesture
  expect(attachVirtualCard).not.toHaveBeenCalled();
  const g = useAppStore.getState().game!;
  const mine = g.players[0].cards!;
  act(() =>
    useAppStore.setState({
      game: { ...g, players: [{ ...g.players[0], cards: { ...mine, battlefield: mine.battlefield.filter((c) => c.iid !== 'fear') } }, g.players[1], g.players[2]] },
    }),
  );
  expect(onClose).toHaveBeenCalled();
});

// ---- on the board ----

test('what sits on a creature is drawn tucked under it, and is no longer on the side shelf', async () => {
  let g = attachCard(table(), 0, 'greaves', { seat: 0, kind: 'card', id: 'bear' });
  g = attachCard(g, 0, 'fear', { seat: 0, kind: 'card', id: 'bear' });
  useAppStore.setState({ game: g });
  const { container } = render(
    <>
      <BattlefieldRow playerIdx={0} />
      <SideShelf playerIdx={0} />
    </>,
  );
  const bear = await screen.findByRole('button', { name: 'tap Grizzly Bears' });
  const host = bear.closest('.vcard-host')!;
  expect(within(host as HTMLElement).getByRole('button', { name: 'Lightning Greaves, on Grizzly Bears' })).toBeInTheDocument();
  expect(within(host as HTMLElement).getByRole('button', { name: 'Fear, on Grizzly Bears' })).toBeInTheDocument();
  // The giant carries nothing: no frame, no minis.
  expect(screen.getByRole('button', { name: 'tap Hill Giant' }).closest('.vcard-host')).toBeNull();
  // The shelf keeps only what is unattached.
  await waitFor(() => expect(container.querySelectorAll('.bf-side .vcard')).toHaveLength(2));
  expect(screen.queryByRole('button', { name: /Lightning Greaves$/ })).not.toBeInTheDocument();
  // An Aura lying unattached offers to be attached on a tap.
  expect(screen.getByRole('button', { name: "attach Giant's Might" })).toBeInTheDocument();
});

test('a tap on a tucked card brings it up: its own sheet, where it can be taken off', async () => {
  useAppStore.setState({ game: attachCard(table(), 0, 'greaves', { seat: 0, kind: 'card', id: 'bear' }) });
  render(<BattlefieldRow playerIdx={0} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Lightning Greaves, on Grizzly Bears' }));
  expect(await screen.findByRole('heading', { name: 'Lightning Greaves' })).toBeInTheDocument();
  expect(screen.getByText('On Grizzly Bears')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Take it off' }));
  expect(attachVirtualCard).toHaveBeenCalledWith(0, 'greaves', null);
});

test('another player’s Aura on your creature shows on YOUR creature, and its sheet is theirs', async () => {
  // Sam's seat is drawn; Nathan's Fear sits on Sam's bear.
  useAppStore.setState({ game: attachCard(table(), 0, 'fear', { seat: 1, kind: 'card', id: 'sbear' }) });
  render(<BattlefieldRow playerIdx={1} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Fear, on Grizzly Bears' }));
  expect(await screen.findByRole('heading', { name: 'Fear' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Take it off' }));
  expect(attachVirtualCard).toHaveBeenCalledWith(0, 'fear', null); // Nathan's card, taken off by whoever is at the table
});

test('a host’s own sheet lists what is on it, each with a way off', async () => {
  let g = attachCard(table(), 0, 'greaves', { seat: 0, kind: 'card', id: 'bear' });
  g = attachCard(g, 0, 'might', { seat: 0, kind: 'card', id: 'bear' }, 2);
  useAppStore.setState({ game: g });
  render(<BattlefieldCardSheet playerIdx={0} iid="bear" onClose={() => {}} />);
  expect(await screen.findByText('On this card')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: "take Giant's Might off" }));
  expect(attachVirtualCard).toHaveBeenCalledWith(0, 'might', null);
  // The bear itself is no Aura: it is offered nothing to attach to.
  expect(screen.queryByRole('button', { name: /attach…|equip…/i })).not.toBeInTheDocument();
});

test('an unattached Aura’s sheet offers Attach…, says where Auras with no host go, and opens the list in its place', async () => {
  render(<BattlefieldCardSheet playerIdx={0} iid="fear" onClose={() => {}} />);
  expect(await screen.findByText('Not on anything')).toBeInTheDocument();
  expect(screen.getByText(/goes to the graveyard/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Attach…' }));
  expect(await screen.findByRole('heading', { name: 'Attach Fear' })).toBeInTheDocument();
  expect(screen.getAllByRole('heading')).toHaveLength(1); // one sheet, not two
});
