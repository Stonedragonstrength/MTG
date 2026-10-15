import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import CommanderSheet from './CommanderSheet';
import HandCardSheet from './HandCardSheet';
import PayWithSheet from './PayWithSheet';

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
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: `https://img.example/${id}-art.jpg`,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
    ...more,
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-forest': rec('c-forest', 'Forest', 'Basic Land — Forest', { oracleText: '({T}: Add {G}.)' }),
  'c-island': rec('c-island', 'Island', 'Basic Land — Island', { oracleText: '({T}: Add {U}.)' }),
  'c-ring': rec('c-ring', 'Sol Ring', 'Artifact', { oracleText: '{T}: Add {C}{C}.' }),
  'c-pool': rec('c-pool', 'Breeding Pool', 'Land — Forest Island', { oracleText: '({T}: Add {G} or {U}.)' }),
  'c-cult': rec('c-cult', 'Cultivate', 'Sorcery', { manaCost: '{2}{G}' }),
  'c-hydra': rec('c-hydra', 'Hungering Hydra', 'Creature — Hydra', { manaCost: '{X}{G}' }),
  'c-tatyova': rec('c-tatyova', 'Tatyova, Benthic Druid', 'Legendary Creature — Merfolk Druid', {
    manaCost: '{3}{G}{U}',
  }),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

const land = (iid: string, kind: 'forest' | 'island', more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId: `c-${kind}`,
  name: kind === 'forest' ? 'Forest' : 'Island',
  row: 'lands',
  ...more,
});

/** Nathan: three Forests, three Islands (one tapped out), a Sol Ring and a
 * Breeding Pool; Cultivate, a Hydra and a Forest in hand; Tatyova at home. */
function table(): GameState {
  const g = createGame(config);
  return {
    ...g,
    players: [
      {
        ...g.players[0],
        cards: {
          library: [],
          hand: [
            { iid: 'h-cult', cardId: 'c-cult', name: 'Cultivate' },
            { iid: 'h-hydra', cardId: 'c-hydra', name: 'Hungering Hydra' },
            { iid: 'h-forest', cardId: 'c-forest', name: 'Forest' },
          ],
          battlefield: [
            land('f1', 'forest'),
            land('f2', 'forest'),
            land('f3', 'forest'),
            land('i1', 'island'),
            land('i2', 'island'),
            land('i3', 'island', { tapped: true, spent: 1 }),
            { iid: 'ring', cardId: 'c-ring', name: 'Sol Ring' },
            { iid: 'pool', cardId: 'c-pool', name: 'Breeding Pool', row: 'lands' },
          ],
          graveyard: [],
          exile: [],
          command: [{ iid: 'cmd', cardId: 'c-tatyova', name: 'Tatyova, Benthic Druid' }],
          mulligans: 0,
          deckName: 'Test',
          cmd: { cmd: 0 },
        },
      },
      g.players[1],
    ],
  };
}

const playCard = vi.fn(async () => {});
const castCommander = vi.fn();

beforeEach(() => {
  playCard.mockClear();
  castCommander.mockClear();
  useAppStore.setState({ game: table(), online: null, playCard, castCommander });
});

/** The tile of one kind of source, by the name on it (the live one: a
 * tile for the tapped-out copies of the same card comes after it). */
const tile = (name: string) =>
  screen.getAllByText(name, { selector: '.pay-name', exact: false })[0].closest('.pay-tile') as HTMLElement;
const paid = () => document.querySelector('.pay-tally')!.textContent;

async function open() {
  const onClose = vi.fn();
  render(<PayWithSheet playerIdx={0} iid="h-cult" from="hand" onClose={onClose} />);
  await screen.findByRole('button', { name: 'pay with Sol Ring' }); // the cards are read
  return onClose;
}

test('it opens with what the table would tap already lit, and says the cost is covered', async () => {
  await open();
  expect(screen.getByRole('heading', { name: 'Pay for Cultivate' })).toBeInTheDocument();
  // The cost, as the card prints it.
  expect(screen.getByRole('img', { name: '2 of any color' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'green' })).toBeInTheDocument();
  // Sol Ring's two and a Forest for the green.
  expect(screen.getByRole('button', { name: 'pay with Sol Ring' })).toHaveAttribute('aria-pressed', 'true');
  expect(tile('Forest')).toHaveTextContent('paying with 1');
  expect(tile('Island')).toHaveTextContent('not used');
  expect(screen.getByRole('button', { name: 'pay with Breeding Pool' })).toHaveAttribute('aria-pressed', 'false');
  expect(paid()).toBe('3 of 3 paidgreen is covered');
  expect(screen.getByRole('button', { name: 'Cast Cultivate' })).toBeInTheDocument();
});

test('each tile shows the land small, how many there are, and what it taps for', async () => {
  await open();
  expect(tile('Forest')).toHaveTextContent('×3');
  expect(tile('Forest').querySelector('img.pay-art')).toHaveAttribute('src', 'https://img.example/c-forest-art.jpg');
  expect(within(tile('Sol Ring')).getAllByRole('img', { name: 'makes colorless' })).toHaveLength(2);
  expect(within(tile('Breeding Pool')).getByRole('img', { name: 'makes green' })).toBeInTheDocument();
  expect(within(tile('Breeding Pool')).getByRole('img', { name: 'makes blue' })).toBeInTheDocument();
  // Two Islands can still pay; the third is tapped out and says so.
  expect(tile('Island')).toHaveTextContent('×2');
  expect(screen.getByText('already tapped').closest('.pay-tile')).toHaveTextContent('Island');
});

test('change what is lit and Cast taps exactly that', async () => {
  const user = userEvent.setup();
  const onClose = await open();
  await user.click(screen.getByRole('button', { name: 'pay with Sol Ring' })); // keep the Ring
  expect(paid()).toBe('1 of 3 paid2 more to go');
  expect(screen.getByRole('button', { name: 'Cast anyway' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'one more Island' }));
  await user.click(screen.getByRole('button', { name: 'one more Island' }));
  expect(tile('Island')).toHaveTextContent('paying with 2');
  expect(paid()).toBe('3 of 3 paidgreen is covered');
  await user.click(screen.getByRole('button', { name: 'Cast Cultivate' }));
  expect(playCard).toHaveBeenCalledWith(0, 'h-cult', { using: { f1: 1, i1: 1, i2: 1 } });
  expect(onClose).toHaveBeenCalled();
});

test('one too many is said; taking it off again is one press', async () => {
  const user = userEvent.setup();
  await open();
  await user.click(screen.getByRole('button', { name: 'one more Island' }));
  expect(paid()).toBe('3 of 3 paid1 more than it needs');
  await user.click(screen.getByRole('button', { name: 'one fewer Island' }));
  expect(paid()).toBe('3 of 3 paidgreen is covered');
});

test('the wrong color is named', async () => {
  const user = userEvent.setup();
  await open();
  await user.click(screen.getByRole('button', { name: 'one fewer Forest' }));
  await user.click(screen.getByRole('button', { name: 'one more Island' }));
  expect(paid()).toBe('2 of 3 paid1 more to go · still needs green');
});

test("the app's pick comes back with one press", async () => {
  const user = userEvent.setup();
  await open();
  expect(screen.queryByRole('button', { name: /app’s pick/i })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'pay with Sol Ring' }));
  await user.click(screen.getByRole('button', { name: /app’s pick/i }));
  expect(screen.getByRole('button', { name: 'pay with Sol Ring' })).toHaveAttribute('aria-pressed', 'true');
  expect(paid()).toBe('3 of 3 paidgreen is covered');
});

test('Back casts nothing', async () => {
  const user = userEvent.setup();
  const onClose = await open();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(playCard).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test('hold a hand card: "Pay with…" is there for a spell, not for a land, and Back returns to it', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<HandCardSheet playerIdx={0} iid="h-cult" onClose={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Pay with…' }));
  expect(await screen.findByRole('heading', { name: 'Pay for Cultivate' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  expect(playCard).not.toHaveBeenCalled();
  unmount();

  render(<HandCardSheet playerIdx={0} iid="h-forest" onClose={vi.fn()} />);
  await screen.findByText('Basic Land — Forest');
  expect(screen.queryByRole('button', { name: 'Pay with…' })).not.toBeInTheDocument();
});

test('a card with X is asked how much first, and the lands are chosen for that X', async () => {
  const user = userEvent.setup();
  render(<HandCardSheet playerIdx={0} iid="h-hydra" onClose={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Pay with…' }));
  await screen.findByRole('button', { name: 'raise X' });
  await new Promise((resolve) => setTimeout(resolve, 400)); // the cast sheet lets taps settle first
  await user.click(screen.getByRole('button', { name: 'raise X' }));
  await user.click(screen.getByRole('button', { name: 'raise X' }));
  await user.click(screen.getByRole('button', { name: 'Pay with…' }));
  expect(await screen.findByRole('heading', { name: 'Pay for Hungering Hydra' })).toBeInTheDocument();
  expect(paid()).toBe('3 of 3 paidgreen is covered'); // X = 2, and the green
  await user.click(screen.getByRole('button', { name: 'Cast Hungering Hydra' }));
  expect(playCard).toHaveBeenCalledWith(0, 'h-hydra', { x: 2, using: { f1: 1, ring: 1 } });
});

test('a commander is paid for the same way, from its own sheet', async () => {
  const user = userEvent.setup();
  render(<CommanderSheet playerIdx={0} iid="cmd" onClose={vi.fn()} />);
  await new Promise((resolve) => setTimeout(resolve, 400)); // it opens under the finger: taps settle first
  await user.click(await screen.findByRole('button', { name: 'Pay with…' }));
  expect(await screen.findByRole('heading', { name: 'Pay for Tatyova, Benthic Druid' })).toBeInTheDocument();
  expect(paid()).toBe('5 of 5 paidgreen and blue are covered');
  await user.click(screen.getByRole('button', { name: 'Cast Tatyova' }));
  expect(castCommander).toHaveBeenCalledWith(0, 'cmd', { using: expect.any(Object) });
  const using = castCommander.mock.calls[0][2].using as Record<string, number>;
  expect(Object.values(using).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(4);
});

test('mana kept for creature spells is no help with a sorcery, and says what it is kept for', async () => {
  RECORDS['c-zig'] = rec('c-zig', 'Ancient Ziggurat', 'Land', {
    oracleText: '{T}: Add one mana of any color. Spend this mana only to cast a creature spell.',
  });
  RECORDS['c-cavern'] = rec('c-cavern', 'Cavern of Souls', 'Land', {
    oracleText:
      "{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered.",
  });
  const g = table();
  const seat = g.players[0].cards!;
  useAppStore.setState({
    game: {
      ...g,
      players: [
        {
          ...g.players[0],
          cards: {
            ...seat,
            battlefield: [
              { iid: 'z', cardId: 'c-zig', name: 'Ancient Ziggurat', row: 'lands' },
              { iid: 'c', cardId: 'c-cavern', name: 'Cavern of Souls', row: 'lands' },
              land('f1', 'forest'),
            ],
          },
        },
        g.players[1],
      ],
    },
  });
  render(<PayWithSheet playerIdx={0} iid="h-cult" from="hand" onClose={() => {}} />);
  await screen.findByRole('button', { name: 'pay with Ancient Ziggurat' });
  expect(tile('Ancient Ziggurat').className).toContain('pay-tile--kept');
  expect(within(tile('Ancient Ziggurat')).getByText('only to cast a creature spell')).toBeTruthy();
  // The Cavern still makes {C} for it.
  expect(tile('Cavern of Souls').className).not.toContain('pay-tile--kept');
  expect(within(tile('Cavern of Souls')).getByText('any color only to cast a creature spell of the chosen type')).toBeTruthy();
  // Cultivate {2}{G}: the table cannot pay it; lighting all three pays two of the three.
  expect(paid()).toMatch(/^0 of 3 paid/);
  const user = userEvent.setup();
  for (const name of ['Forest', 'Cavern of Souls', 'Ancient Ziggurat']) await user.click(screen.getByRole('button', { name: `pay with ${name}` }));
  expect(paid()).toMatch(/^2 of 3 paid/);
});
