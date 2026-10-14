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
const equipCard = vi.fn(async () => {});

beforeEach(() => {
  attachVirtualCard.mockClear();
  equipCard.mockClear();
  useAppStore.setState({ game: table(), online: null, attachVirtualCard, equipCard });
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
  expect(attachVirtualCard).toHaveBeenCalledWith(0, 'fear', { seat: 0, kind: 'card', id: 'giant' });
  expect(onClose).toHaveBeenCalled();
});

test('an opponent’s tab lists their creatures — cards and stacks — and a tap puts it on one of those', async () => {
  render(<AttachSheet playerIdx={0} iid="fear" onClose={() => {}} />);
  tap(screen.getByRole('tab', { name: 'Sam' }));
  await waitFor(() => expect(rows()).toEqual(['put it on Grizzly Bears', 'put it on Soldier ×2']));
  tap(screen.getByRole('button', { name: 'put it on Soldier ×2' }));
  expect(attachVirtualCard).toHaveBeenCalledWith(0, 'fear', { seat: 1, kind: 'stack', id: 'soldiers' });
  attachVirtualCard.mockClear();
  tap(screen.getByRole('button', { name: 'put it on Grizzly Bears' }));
  expect(attachVirtualCard).toHaveBeenCalledWith(0, 'fear', { seat: 1, kind: 'card', id: 'sbear' });
});

test('a player with nothing it can go on says so', async () => {
  render(<AttachSheet playerIdx={0} iid="fear" onClose={() => {}} />);
  tap(screen.getByRole('tab', { name: 'Alex' }));
  expect(await screen.findByText('Nothing here it can go on.')).toBeInTheDocument();
});

test('the sheet says what size it gives; there is nothing to switch on, and no counters are asked for', async () => {
  render(<AttachSheet playerIdx={0} iid="might" onClose={() => {}} />);
  expect(await screen.findByText(/It gives \+2\/\+2 to what it is on/)).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  tap(await screen.findByRole('button', { name: 'put it on Grizzly Bears' }));
  expect(attachVirtualCard).toHaveBeenLastCalledWith(0, 'might', { seat: 0, kind: 'card', id: 'bear' });
});

test('a card that changes no size says nothing about one', async () => {
  render(<AttachSheet playerIdx={0} iid="fear" onClose={() => {}} />);
  await screen.findByRole('button', { name: 'put it on Hill Giant' });
  expect(screen.queryByText(/It gives/)).not.toBeInTheDocument();
});

test('the creature wears what is on it: its badge says how much bigger it is, and loses it with the card', async () => {
  RECORDS['c-splitter'] = rec('c-splitter', 'Bonesplitter', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {1}');
  const start = table();
  start.players[0].cards!.battlefield.push(card('splitter', 'c-splitter'));
  let g = attachCard(start, 0, 'splitter', { seat: 0, kind: 'card', id: 'bear' });
  useAppStore.setState({ game: g });
  render(<BattlefieldRow playerIdx={0} />);
  const bear = await screen.findByRole('button', { name: 'tap Grizzly Bears' });
  await waitFor(() => expect(bear.querySelector('.vcard-counter')).toHaveTextContent('+2/+0'));
  // An Aura on top of it, and a +1/+1 counter: one badge, added up.
  g = attachCard(g, 0, 'might', { seat: 0, kind: 'card', id: 'bear' });
  g.players[0].cards!.battlefield = g.players[0].cards!.battlefield.map((c) =>
    c.iid === 'bear' ? { ...c, counters: { p1p1: 1 } } : c,
  );
  act(() => useAppStore.setState({ game: { ...g } }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'tap Grizzly Bears' }).querySelector('.vcard-counter')).toHaveTextContent('+5/+3'));
  // The giant wears nothing and has no badge.
  expect(screen.getByRole('button', { name: 'tap Hill Giant' }).querySelector('.vcard-counter')).toBeNull();
  // Taken off, the size goes with them (the counter stays).
  act(() => useAppStore.setState({ game: attachCard(attachCard(g, 0, 'splitter', null), 0, 'might', null) }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'tap Grizzly Bears' }).querySelector('.vcard-counter')).toHaveTextContent('+1/+1'));
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

// ---- paying to equip ----

RECORDS['c-splitter'] = rec('c-splitter', 'Bonesplitter', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {1}');
RECORDS['c-blade'] = rec(
  'c-blade',
  'Blackblade Reforged',
  'Legendary Artifact — Equipment',
  'Equipped creature gets +1/+1 for each land you control.\nEquip legendary creature {1}\nEquip {7}',
);
RECORDS['c-king'] = rec('c-king', 'Kenrith, the Returned King', 'Legendary Creature — Human Noble', '', '5');
RECORDS['c-maul'] = rec(
  'c-maul',
  'Maul of the Skyclaves',
  'Artifact — Equipment',
  'When this Equipment enters, attach it to target creature you control.\nEquipped creature gets +2/+2.\nEquip {2}{W}{W}',
);

/** The table with more cards on Nathan's side, and his one Forest tapped out when asked. */
function equipTable(more: CardInstance[], forestTapped = false): GameState {
  const g = table();
  const mine = g.players[0].cards!;
  mine.battlefield = [
    ...mine.battlefield.map((c) => (c.iid === 'forest' && forestTapped ? { ...c, tapped: true, spent: 1 } : c)),
    ...more,
  ];
  return g;
}
const costLine = () => screen.getByRole('group', { name: 'equip cost' });

test('an Equipment says what equipping costs; with the mana ready a tap on a creature equips and pays', async () => {
  useAppStore.setState({ game: equipTable([card('splitter', 'c-splitter')]) });
  const onClose = vi.fn();
  render(<AttachSheet playerIdx={0} iid="splitter" onClose={onClose} />);
  await waitFor(() => expect(within(costLine()).getByText('Your lands pay for it.')).toBeInTheDocument());
  expect(within(costLine()).getByRole('img', { name: '1 of any color' })).toBeInTheDocument();
  tap(screen.getByRole('button', { name: 'put it on Grizzly Bears' }));
  expect(equipCard).toHaveBeenCalledWith(0, 'splitter', { seat: 0, kind: 'card', id: 'bear' });
  expect(attachVirtualCard).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test('without the mana the creatures are dimmed and refuse; "Equip anyway" puts it on without paying', async () => {
  useAppStore.setState({ game: equipTable([card('splitter', 'c-splitter')], true) });
  const onClose = vi.fn();
  render(<AttachSheet playerIdx={0} iid="splitter" onClose={onClose} />);
  await waitFor(() => expect(within(costLine()).getByText('Not enough mana ready.')).toBeInTheDocument());
  const bear = screen.getByRole('button', { name: 'put it on Grizzly Bears' });
  expect(bear).toHaveAttribute('aria-disabled', 'true');
  tap(bear);
  expect(equipCard).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  tap(screen.getByRole('button', { name: 'Equip anyway' }));
  expect(within(costLine()).getByText('Not paying for it.')).toBeInTheDocument();
  expect(bear).not.toHaveAttribute('aria-disabled');
  tap(bear);
  expect(equipCard).toHaveBeenCalledWith(0, 'splitter', { seat: 0, kind: 'card', id: 'bear' }, { free: true });
  expect(onClose).toHaveBeenCalled();
});

test('"Don’t pay" equips for nothing while the mana is there, and "Pay for it" takes that back', async () => {
  useAppStore.setState({ game: equipTable([card('splitter', 'c-splitter')]) });
  render(<AttachSheet playerIdx={0} iid="splitter" onClose={() => {}} />);
  tap(await screen.findByRole('button', { name: 'Don’t pay' }));
  expect(within(costLine()).getByText('Not paying for it.')).toBeInTheDocument();
  tap(screen.getByRole('button', { name: 'Pay for it' }));
  expect(within(costLine()).getByText('Your lands pay for it.')).toBeInTheDocument();
  tap(screen.getByRole('button', { name: 'Don’t pay' }));
  tap(screen.getByRole('button', { name: 'put it on Hill Giant' }));
  expect(equipCard).toHaveBeenCalledWith(0, 'splitter', { seat: 0, kind: 'card', id: 'giant' }, { free: true });
});

test('Equip {0} has nothing to pay: the cost is shown, and no switch', async () => {
  render(<AttachSheet playerIdx={0} iid="greaves" onClose={() => {}} />);
  await waitFor(() => expect(within(costLine()).getByRole('img', { name: '0 of any color' })).toBeInTheDocument());
  expect(within(costLine()).queryByRole('button')).not.toBeInTheDocument();
  tap(screen.getByRole('button', { name: 'put it on Grizzly Bears' }));
  expect(equipCard).toHaveBeenCalledWith(0, 'greaves', { seat: 0, kind: 'card', id: 'bear' });
});

test('an Equipment that attaches itself as it enters owes nothing the turn it arrives', async () => {
  useAppStore.setState({ game: equipTable([card('maul', 'c-maul', { sick: true })]) });
  render(<AttachSheet playerIdx={0} iid="maul" onClose={() => {}} />);
  await waitFor(() => expect(within(costLine()).getByText(/attaches itself as it comes in/)).toBeInTheDocument());
  tap(screen.getByRole('button', { name: 'put it on Grizzly Bears' }));
  expect(equipCard).toHaveBeenCalledWith(0, 'maul', { seat: 0, kind: 'card', id: 'bear' }, { free: true });
});

test('…but a turn later, or told to pay, it costs what it prints', async () => {
  useAppStore.setState({ game: equipTable([card('maul', 'c-maul')]) });
  render(<AttachSheet playerIdx={0} iid="maul" onClose={() => {}} />);
  // {2}{W}{W} against one Forest.
  await waitFor(() => expect(within(costLine()).getByText('Not enough mana ready.')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'put it on Grizzly Bears' })).toHaveAttribute('aria-disabled', 'true');
});

test('the creature it is on already costs nothing to tap: the sheet closes and nothing is paid', async () => {
  const g = attachCard(equipTable([card('splitter', 'c-splitter')], true), 0, 'splitter', { seat: 0, kind: 'card', id: 'bear' });
  useAppStore.setState({ game: g });
  const onClose = vi.fn();
  render(<AttachSheet playerIdx={0} iid="splitter" onClose={onClose} />);
  const here = await screen.findByRole('button', { name: 'Grizzly Bears — it is on this now' });
  await waitFor(() => expect(within(costLine()).getByText('Not enough mana ready.')).toBeInTheDocument());
  expect(here).not.toHaveAttribute('aria-disabled');
  // Moving it costs again: the giant is dimmed.
  expect(screen.getByRole('button', { name: 'put it on Hill Giant' })).toHaveAttribute('aria-disabled', 'true');
  tap(here);
  expect(equipCard).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test('two equip abilities: each creature pays the cheapest it may use, and its row says which', async () => {
  useAppStore.setState({ game: equipTable([card('blade', 'c-blade'), card('king', 'c-king')]) });
  render(<AttachSheet playerIdx={0} iid="blade" onClose={() => {}} />);
  await waitFor(() => expect(within(costLine()).getByText(/Equip legendary creature/)).toBeInTheDocument());
  const king = await screen.findByRole('button', { name: 'put it on Kenrith, the Returned King' });
  const bear = screen.getByRole('button', { name: 'put it on Grizzly Bears' });
  // One Forest pays {1} for the legend, not {7} for the bear.
  await waitFor(() => expect(bear).toHaveAttribute('aria-disabled', 'true'));
  expect(king).not.toHaveAttribute('aria-disabled');
  expect(within(king).getByRole('img', { name: '1 of any color' })).toBeInTheDocument();
  expect(within(bear).getByRole('img', { name: '7 of any color' })).toBeInTheDocument();
  expect(within(costLine()).getByText('Your lands pay for it.')).toBeInTheDocument();
});

test('an Aura was paid for when it was cast: no cost, no switch, the plain attach', async () => {
  render(<AttachSheet playerIdx={0} iid="might" onClose={() => {}} />);
  await screen.findByRole('button', { name: 'put it on Grizzly Bears' });
  expect(screen.queryByRole('group', { name: 'equip cost' })).not.toBeInTheDocument();
  tap(screen.getByRole('button', { name: 'put it on Grizzly Bears' }));
  expect(attachVirtualCard).toHaveBeenCalledWith(0, 'might', { seat: 0, kind: 'card', id: 'bear' });
  expect(equipCard).not.toHaveBeenCalled();
});

test('an unattached Aura’s sheet offers Attach…, says where Auras with no host go, and opens the list in its place', async () => {
  render(<BattlefieldCardSheet playerIdx={0} iid="fear" onClose={() => {}} />);
  expect(await screen.findByText('Not on anything')).toBeInTheDocument();
  expect(screen.getByText(/goes to the graveyard/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Attach…' }));
  expect(await screen.findByRole('heading', { name: 'Attach Fear' })).toBeInTheDocument();
  expect(screen.getAllByRole('heading')).toHaveLength(1); // one sheet, not two
});
