import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type {
  BoardItem,
  CardInstance,
  CardRecord,
  GameConfig,
  GameState,
  SeatCards,
} from '../lib/types';
import { useAppStore } from '../state/store';
import LandsRow from './LandsRow';

function record(id: string, name: string, typeLine: string, oracleText: string): CardRecord {
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
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

const forestCard = record('forest-1', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)');

const VRECORDS: Record<string, CardRecord> = {
  'c-forest': record('c-forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  'c-tower': record('c-tower', 'Command Tower', 'Land', '{T}: Add one mana of any color.'),
  'c-exploration': record(
    'c-exploration',
    'Exploration',
    'Enchantment',
    'You may play an additional land on each of your turns.',
  ),
  'c-rites': record(
    'c-rites',
    'Rites of Flourishing',
    'Enchantment',
    "At the beginning of each player's draw step, that player draws an additional card.\nEach player may play an additional land on each of their turns.",
  ),
  'c-fastbond': record(
    'c-fastbond',
    'Fastbond',
    'Enchantment',
    "You may play any number of lands on each of your turns.\nWhenever you play a land, if it wasn't the first land you played this turn, Fastbond deals 1 damage to you.",
  ),
  'c-elves': record('c-elves', 'Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.'),
};

vi.mock('../data/scryfall', () => ({
  findBasicLand: vi.fn(async (name: string) => (name === 'Forest' ? forestCard : undefined)),
  getCardById: vi.fn(async (id: string) => VRECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  loadNameIndex: vi.fn(async () => []),
}));

vi.mock('../data/images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/images')>()),
  randomBasicArt: vi.fn(async (name: string) =>
    name === 'Forest'
      ? { normal: 'https://img.example/forest-variant.jpg', artCrop: 'https://img.example/forest-variant-art.jpg' }
      : undefined,
  ),
}));

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
  ],
};

function landItem(name: string, oracleText: string, count: number): BoardItem {
  return {
    id: `land-${name}`,
    cardId: name,
    name,
    imageNormal: null,
    imageArtCrop: null,
    typeLine: 'Land',
    oracleText,
    basePower: null,
    baseToughness: null,
    count,
    counters: {},
    color: null,
    zone: 'lands',
  };
}

beforeEach(() => {
  useAppStore.setState({ game: createGame(config) });
});

test('quick-adding a basic creates a lands-zone stack with a random art variant', async () => {
  const added: BoardItem[] = [];
  useAppStore.setState({ addItem: vi.fn((_i: number, item: BoardItem) => added.push(item)) });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /add forest/i }));
  expect(added).toHaveLength(1);
  expect(added[0].name).toBe('Forest');
  expect(added[0].zone).toBe('lands');
  expect(added[0].imageNormal).toBe('https://img.example/forest-variant.jpg');
});

test('quick-adding a basic you already have bumps the stack instead', async () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [landItem('Forest', '({T}: Add {G}.)', 3)] };
  const changeCount = vi.fn();
  useAppStore.setState({ game, changeCount });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: /add forest/i }));
  expect(changeCount).toHaveBeenCalledWith(0, 'land-Forest', 1);
});

test('the mana summary tallies the lands zone', () => {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    board: [
      landItem('Forest', '({T}: Add {G}.)', 4),
      landItem('Command Tower', '{T}: Add one mana of any color.', 2),
    ],
  };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByText(/6 lands/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/4 green sources/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/2 any-color sources/i)).toBeInTheDocument();
});

test('board-zone mana sources join the color pips but not the land total', () => {
  const game = createGame(config);
  const elves: BoardItem = {
    ...landItem('Llanowar Elves', '{T}: Add {G}.', 2),
    id: 'tok-elves',
    zone: 'board',
  };
  const bear: BoardItem = { ...landItem('Bear', '', 1), id: 'tok-bear', zone: 'board', manaMode: 'G' };
  game.players[0] = {
    ...game.players[0],
    board: [landItem('Forest', '({T}: Add {G}.)', 3), elves, bear],
  };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByText(/3 lands/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/6 green sources/i)).toBeInTheDocument();
});

test('land stacks render with their counts', () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [landItem('Forest', '({T}: Add {G}.)', 5)] };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByText('×5')).toBeInTheDocument();
});

test('tapping a land stack marks one source used', async () => {
  const tapItem = vi.fn();
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [landItem('Forest', '({T}: Add {G}.)', 5)] };
  useAppStore.setState({ game, tapItem });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: 'Forest' }));
  expect(tapItem).toHaveBeenCalledWith(0, 'land-Forest', 1);
});

test('tapping a one-shot source spends it instead', async () => {
  const changeCount = vi.fn();
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    board: [landItem('Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.', 3)],
  };
  useAppStore.setState({ game, changeCount });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: 'Treasure' }));
  expect(changeCount).toHaveBeenCalledWith(0, 'land-Treasure', -1);
});

test('the untap button appears when only a board creature is tapped', () => {
  const game = createGame(config);
  const creature: BoardItem = {
    ...landItem('Soldier', '', 2),
    id: 'tok-1',
    zone: 'board',
    tapped: 1,
  };
  game.players[0] = { ...game.players[0], board: [creature] };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByRole('button', { name: /untap all/i })).toBeInTheDocument();
});

test('untap all readies the row', async () => {
  const untapAll = vi.fn();
  const game = createGame(config);
  const tapped = { ...landItem('Forest', '({T}: Add {G}.)', 5), tapped: 3 };
  game.players[0] = { ...game.players[0], board: [tapped] };
  useAppStore.setState({ game, untapAll });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByLabelText(/forest, 3 of 5 tapped/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /untap all/i }));
  expect(untapAll).toHaveBeenCalledWith(0);
});

function seatWith(battlefield: CardInstance[]): SeatCards {
  return {
    library: [],
    hand: [],
    battlefield,
    graveyard: [],
    exile: [],
    command: [],
    mulligans: 0,
    deckName: 'Stompy',
  };
}

test('virtual deck lands stack with an m-of-n tapped badge and feed the summary', async () => {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: seatWith([
      { iid: 'i1', cardId: 'c-forest', name: 'Forest', row: 'lands' },
      { iid: 'i2', cardId: 'c-forest', name: 'Forest', row: 'lands', tapped: true },
      { iid: 'i3', cardId: 'c-tower', name: 'Command Tower', row: 'lands' },
      { iid: 'i4', cardId: 'c-bear', name: 'Grizzly Bears', row: 'front' },
    ]),
  };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByText(/3 lands/i)).toBeInTheDocument(); // counts before records resolve
  expect(screen.getByLabelText('Forest, 1 of 2 tapped')).toBeInTheDocument();
  expect(await screen.findByLabelText(/2 green sources/i)).toBeInTheDocument();
  expect(await screen.findByLabelText(/1 any-color sources/i)).toBeInTheDocument();
  expect(screen.queryByText(/grizzly bears/i)).not.toBeInTheDocument(); // front row stays off the shelf
});

test('tapping a virtual land stack taps its first untapped copy', async () => {
  const tapVirtualCard = vi.fn();
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: seatWith([
      { iid: 'i-a', cardId: 'c-forest', name: 'Forest', row: 'lands', tapped: true },
      { iid: 'i-b', cardId: 'c-forest', name: 'Forest', row: 'lands' },
    ]),
  };
  useAppStore.setState({ game, tapVirtualCard });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: 'Forest, 1 of 2 tapped' }));
  expect(tapVirtualCard).toHaveBeenCalledWith(0, 'i-b', true); // directed: never a toggle
});

test('a fully tapped virtual stack ignores taps and surfaces untap-all', async () => {
  const tapVirtualCard = vi.fn();
  const untapAll = vi.fn();
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: seatWith([{ iid: 'i-a', cardId: 'c-forest', name: 'Forest', row: 'lands', tapped: true }]),
  };
  useAppStore.setState({ game, tapVirtualCard, untapAll });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  await user.click(screen.getByRole('button', { name: 'Forest, 1 of 1 tapped' }));
  expect(tapVirtualCard).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /untap all/i }));
  expect(untapAll).toHaveBeenCalledWith(0);
});

test('a virtual seat hides the quick-add basics — deck lands carry the mana now', () => {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: seatWith([{ iid: 'i1', cardId: 'c-forest', name: 'Forest', row: 'lands' }]),
  };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.queryByRole('button', { name: /add forest/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /add a land/i })).not.toBeInTheDocument();
});

test('a deck seat reads how much mana is ready: untapped lands plus what floats', async () => {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: seatWith([
      { iid: 'i1', cardId: 'c-forest', name: 'Forest', row: 'lands' }, // fresh
      { iid: 'i2', cardId: 'c-forest', name: 'Forest', row: 'lands', tapped: true }, // tapped by hand
      { iid: 'i3', cardId: 'c-forest', name: 'Forest', row: 'lands', tapped: true, spent: 1 }, // paid away
    ]),
  };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(await screen.findByLabelText('2 mana ready')).toBeInTheDocument();
});

// ---- turn rules: the land drop readout, and mana a fresh creature cannot make yet ----

const FOREST: CardInstance = { iid: 'i1', cardId: 'c-forest', name: 'Forest', row: 'lands' };

/** A two-player game where seat 0 holds these cards; `over` adjusts the game itself. */
function cardsGame(seat: SeatCards, over: Partial<GameState> = {}): GameState {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], cards: seat };
  return { ...game, ...over };
}

test('the active deck seat reads its land drop next to its mana', () => {
  useAppStore.setState({ game: cardsGame(seatWith([FOREST])) });
  render(<LandsRow playerIdx={0} />);
  const readout = screen.getByLabelText('0 of 1 land plays used');
  expect(readout).toHaveTextContent('land 0/1');
  expect(readout.className).toBe('land-plays');
});

test('it counts the lands played from hand this turn', () => {
  const seat = { ...seatWith([FOREST]), landPlays: { turn: 1, active: 0, n: 1 } };
  useAppStore.setState({ game: cardsGame(seat) });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByLabelText('1 of 1 land plays used')).toHaveTextContent('land 1/1');
});

test('a land played last turn is not on this turn’s readout', () => {
  const seat = { ...seatWith([FOREST]), landPlays: { turn: 1, active: 0, n: 1 } };
  useAppStore.setState({ game: cardsGame(seat, { turnNumber: 2 }) });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByLabelText('0 of 1 land plays used')).toBeInTheDocument();
});

test('a permanent that grants land drops raises what the readout allows', async () => {
  const exploration: CardInstance = { iid: 'e1', cardId: 'c-exploration', name: 'Exploration', row: 'front' };
  useAppStore.setState({ game: cardsGame(seatWith([FOREST, exploration])) });
  render(<LandsRow playerIdx={0} />);
  expect(await screen.findByLabelText('0 of 2 land plays used')).toHaveTextContent('land 0/2');
});

test('so does another seat’s Rites of Flourishing', async () => {
  const game = cardsGame(seatWith([FOREST]));
  game.players[1] = {
    ...game.players[1],
    cards: seatWith([{ iid: 'r1', cardId: 'c-rites', name: 'Rites of Flourishing', row: 'front' }]),
  };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(await screen.findByLabelText('0 of 2 land plays used')).toBeInTheDocument();
});

test('Fastbond reads as no limit', async () => {
  const fastbond: CardInstance = { iid: 'x1', cardId: 'c-fastbond', name: 'Fastbond', row: 'front' };
  const seat = { ...seatWith([FOREST, fastbond]), landPlays: { turn: 1, active: 0, n: 3 } };
  useAppStore.setState({ game: cardsGame(seat) });
  render(<LandsRow playerIdx={0} />);
  expect(await screen.findByLabelText('3 land plays used, no limit')).toHaveTextContent('land 3/∞');
});

test('the readout belongs to the player whose turn it is: nobody else shows one', () => {
  useAppStore.setState({ game: cardsGame(seatWith([FOREST]), { activePlayerIndex: 1 }) });
  render(<LandsRow playerIdx={0} />);
  expect(screen.queryByLabelText(/land plays used/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText('1 mana ready')).toBeInTheDocument(); // the mana readout stays
});

test('tracker seats show no land readout, even on their own turn', () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [landItem('Forest', '({T}: Add {G}.)', 3)] };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.queryByLabelText(/land plays used/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/^land \d/)).not.toBeInTheDocument();
});

test('a mana creature counts as ready mana, but not on the turn it arrives', async () => {
  const elves = (sick: boolean): CardInstance => ({
    iid: 'e1',
    cardId: 'c-elves',
    name: 'Llanowar Elves',
    row: 'front',
    ...(sick ? { sick: true as const } : {}),
  });
  // First the elf that has been there a while: once it counts, both records are read.
  useAppStore.setState({ game: cardsGame(seatWith([FOREST, elves(false)])) });
  const settled = render(<LandsRow playerIdx={0} />);
  expect(await screen.findByLabelText('2 mana ready')).toBeInTheDocument();
  settled.unmount();

  useAppStore.setState({ game: cardsGame(seatWith([FOREST, elves(true)])) });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByLabelText('1 mana ready')).toBeInTheDocument(); // the Forest alone
});

test('a tapped front-row card surfaces untap-all too', () => {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: seatWith([{ iid: 'b1', cardId: 'c-bear', name: 'Grizzly Bears', row: 'front', tapped: true }]),
  };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByRole('button', { name: /untap all/i })).toBeInTheDocument();
});

test('tracker seats show no mana-ready readout', () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [landItem('Forest', '({T}: Add {G}.)', 3)] };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.queryByLabelText(/mana ready/i)).not.toBeInTheDocument();
});

test('holding a virtual land stack opens its card sheet', async () => {
  const game = createGame(config);
  game.players[0] = {
    ...game.players[0],
    cards: seatWith([{ iid: 'i-a', cardId: 'c-tower', name: 'Command Tower', row: 'lands' }]),
  };
  useAppStore.setState({ game });
  const user = userEvent.setup();
  render(<LandsRow playerIdx={0} />);
  const stack = screen.getByRole('button', { name: 'Command Tower' });
  await user.pointer({ keys: '[MouseLeft>]', target: stack });
  await new Promise((r) => setTimeout(r, 650));
  await user.pointer({ keys: '[/MouseLeft]', target: stack });
  expect(await screen.findByRole('heading', { name: 'Command Tower' })).toBeInTheDocument();
});

// ---- combat on the cards: the Attack button rides the lands line ----

/** A creature tile, as a tracker seat keeps them. */
const knights: BoardItem = { ...landItem('Knight', '', 2), id: 'tok-knight', zone: 'board', basePower: 2, baseToughness: 2 };
const ELF: CardInstance = { iid: 'e1', cardId: 'c-elves', name: 'Llanowar Elves', row: 'front' };

test('the active seat with a creature on the tablet has "⚔ Attack" on its lands line, and pressing it opens the fight', async () => {
  useAppStore.setState({ game: cardsGame(seatWith([FOREST, ELF])) });
  const user = userEvent.setup();
  const { container } = render(<LandsRow playerIdx={0} />);
  const attack = screen.getByRole('button', { name: 'attack' });
  expect(attack).toHaveTextContent('⚔ Attack');
  expect(attack.parentElement).toBe(container.querySelector('.mana-summary')); // in the line, like the dice: never positioned
  await user.click(attack);
  const { liveCombat } = await import('../lib/combat');
  expect(liveCombat(useAppStore.getState().game!)).toMatchObject({ step: 'attackers', active: 0 });
});

test('while its fight is on the button keeps its place and only says so: it cannot be pressed', async () => {
  useAppStore.setState({ game: cardsGame(seatWith([FOREST, ELF])) });
  const user = userEvent.setup();
  const { container } = render(<LandsRow playerIdx={0} />);
  const before = [...container.querySelector('.mana-summary')!.children].map((el) => el.className);
  await user.click(screen.getByRole('button', { name: 'attack' }));
  const during = screen.getByRole('button', { name: 'in combat' });
  expect(during).toHaveTextContent('⚔ In combat');
  expect(during).toBeDisabled();
  expect(during.className).toBe('attack-btn');
  expect([...container.querySelector('.mana-summary')!.children].map((el) => el.className)).toEqual(before); // nothing joined or left the line
  const fight = useAppStore.getState().game!.combat;
  await user.click(during);
  expect(useAppStore.getState().game!.combat).toBe(fight); // a second press starts nothing
  // called off: the button is back
  const { act } = await import('@testing-library/react');
  act(() => useAppStore.getState().cancelCombat());
  expect(screen.getByRole('button', { name: 'attack' })).toBeEnabled();
});

test('a tracker seat attacks with its creature tiles', () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [landItem('Forest', '({T}: Add {G}.)', 3), knights] };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  expect(screen.getByRole('button', { name: 'attack' })).toBeInTheDocument();
});

test('no creature on the tablet, no button: lands, a mana rock and a treasure are nothing to attack with', async () => {
  const treasure: BoardItem = { ...landItem('Treasure', '', 2), id: 'tok-treasure', zone: 'board' };
  const game = cardsGame(seatWith([FOREST, { iid: 'x1', cardId: 'c-exploration', name: 'Exploration', row: 'front' }]));
  game.players[0] = { ...game.players[0], board: [treasure] };
  useAppStore.setState({ game });
  render(<LandsRow playerIdx={0} />);
  // Once the enchantment is read (until then it is taken on trust) there is nothing to attack with.
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'attack' })).not.toBeInTheDocument());
});

test('a front-row card this device cannot read is taken on trust: what the app cannot read never blocks a play', async () => {
  useAppStore.setState({
    game: cardsGame(seatWith([FOREST, { iid: 'm1', cardId: 'c-not-in-this-database', name: 'Mystery', row: 'front' }])),
  });
  render(<LandsRow playerIdx={0} />);
  expect(await screen.findByLabelText('1 mana ready')).toBeInTheDocument(); // the lookups have answered
  expect(screen.getByRole('button', { name: 'attack' })).toBeInTheDocument();
});

test('only the player whose turn it is may attack, and never a defeated one', () => {
  const game = createGame(config);
  game.players[0] = { ...game.players[0], board: [knights] };
  game.players[1] = { ...game.players[1], board: [{ ...knights, id: 'tok-knight-b' }] };
  useAppStore.setState({ game });
  const other = render(<LandsRow playerIdx={1} />);
  expect(screen.queryByRole('button', { name: 'attack' })).not.toBeInTheDocument();
  other.unmount();
  game.players[0] = { ...game.players[0], eliminated: true };
  useAppStore.setState({ game: { ...game } });
  render(<LandsRow playerIdx={0} />);
  expect(screen.queryByRole('button', { name: 'attack' })).not.toBeInTheDocument();
});

test('the phone’s hand view has no Attack button: the fight is declared on the table', () => {
  useAppStore.setState({ game: cardsGame(seatWith([FOREST, ELF])) });
  render(<LandsRow playerIdx={0} attackButton={false} />);
  expect(screen.queryByRole('button', { name: 'attack' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /dice roller/i })).toBeInTheDocument(); // the rest of the line is as it was
});
