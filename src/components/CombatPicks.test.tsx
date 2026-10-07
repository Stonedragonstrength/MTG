import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../data/settings';
import { liveCombat } from '../lib/combat';
import { createGame } from '../lib/game';
import type { BoardItem, CardInstance, CardRecord, CombatUnit, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldRow from './BattlefieldRow';
import BoardStrip from './BoardStrip';
import CombatBar from './CombatBar';
import { useCombatAim } from './useCombat';

// Picking attackers and blockers right on the battlefield: the real rows, the real bar and
// the real store. Only the card database is stood in for.

function rec(id: string, name: string, typeLine: string, pt: [string, string] | null, oracleText = ''): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '{1}',
    power: pt ? pt[0] : null,
    toughness: pt ? pt[1] : null,
    colors: [],
    colorIdentity: [],
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear', ['2', '2']),
  'c-giant': rec('c-giant', 'Hill Giant', 'Creature — Giant', ['3', '3']),
  'c-angel': rec('c-angel', 'Serra Angel', 'Creature — Angel', ['4', '4'], 'Flying, vigilance'),
  'c-wall': rec('c-wall', 'Wall of Omens', 'Creature — Wall', ['0', '4'], 'Defender'),
  'c-ring': rec('c-ring', 'Sol Ring', 'Artifact', null, '{T}: Add {C}{C}.'),
  'c-ogre': rec('c-ogre', 'Gray Ogre', 'Creature — Ogre', ['2', '2']),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));
vi.mock('../data/rules', () => ({ getGlossary: vi.fn(async () => []) }));
vi.mock('../data/synergy', () => ({
  findCommandersFor: vi.fn(async () => []),
  findSynergiesFor: vi.fn(async () => []),
}));

const NAMES = ['Nathan', 'Sam', 'Alex'];

function config(seats: number): GameConfig {
  return {
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    mode: 'cards',
    profiles: NAMES.slice(0, seats).map((name, i) => ({ id: `p${i}`, name, avatarUrl: null, commanderName: null })),
  };
}

const onField = (iid: string, cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId,
  name: RECORDS[cardId].name,
  row: 'front',
  ...more,
});

const tokens = (id: string, name: string, count: number, more: Partial<BoardItem> = {}): BoardItem => ({
  id,
  cardId: null,
  name,
  imageNormal: null,
  imageArtCrop: null,
  typeLine: 'Token Creature',
  oracleText: '',
  basePower: 1,
  baseToughness: 1,
  count,
  counters: {},
  color: null,
  zone: 'board',
  ...more,
});

const seatCards = (battlefield: CardInstance[]) => ({
  library: [],
  hand: [],
  battlefield,
  graveyard: [],
  exile: [],
  command: [],
  mulligans: 0,
  deckName: 'Test',
});

/** Nathan: a bear, a tapped giant, an angel that arrived this turn, a wall, a Sol Ring; four
 * soldiers (one tapped) and two treasures. Sam: a bear, a tapped ogre, three saprolings.
 * With three seats Alex sits there too, with nothing. */
function table(seats = 2): GameState {
  const g = createGame(config(seats));
  return {
    ...g,
    players: g.players.map((p, i) => {
      if (i === 0)
        return {
          ...p,
          board: [
            tokens('soldiers', 'Soldier', 4, { tapped: 1 }),
            tokens('treasure', 'Treasure', 2, { basePower: null, baseToughness: null, typeLine: 'Token Artifact — Treasure' }),
          ],
          cards: seatCards([
            onField('bear', 'c-bear'),
            onField('giant', 'c-giant', { tapped: true }),
            onField('angel', 'c-angel', { sick: true }),
            onField('wall', 'c-wall'),
            onField('ring', 'c-ring'),
          ]),
        };
      if (i === 1)
        return {
          ...p,
          board: [tokens('saprolings', 'Saproling', 3)],
          cards: seatCards([onField('sbear', 'c-bear'), onField('ogre', 'c-ogre', { tapped: true })]),
        };
      return { ...p, cards: seatCards([]) };
    }),
  };
}

const card = (id: string): CombatUnit => ({ kind: 'card', id });
const stack = (id: string): CombatUnit => ({ kind: 'stack', id });
const store = () => useAppStore.getState();
const fight = () => liveCombat(store().game!);
const attacks = () => (fight()?.attacks ?? []).map((a) => `${a.unit.id}${a.n ? ` x${a.n}` : ''}>${a.target}`);
const blocks = () =>
  (fight()?.attacks ?? []).map((a) => `${a.unit.id}: ${(a.blockers ?? []).map((b) => `${b.id}${b.n ? ` x${b.n}` : ''}`).join(',')}`);

/** A tap the way the table's cards hear it (useLongPress acts on the pointer pair). */
function tap(el: Element) {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
}
async function sleep(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function hold(el: Element) {
  fireEvent.pointerDown(el);
  await sleep(650);
  fireEvent.pointerUp(el);
}

beforeEach(() => {
  useAppStore.setState({ game: table(), online: null, settings: { ...DEFAULT_SETTINGS } });
  useCombatAim.setState({ combatId: null, target: null, attack: null });
});

/** Nathan's side of the table while he picks attackers, with every card read. */
async function attackersUp(seats = 2) {
  useAppStore.setState({ game: table(seats) });
  store().startCombat();
  const view = render(
    <>
      <CombatBar playerIdx={0} />
      <BattlefieldRow playerIdx={0} />
      <BoardStrip playerIdx={0} />
    </>,
  );
  await screen.findByRole('button', { name: 'Serra Angel cannot attack' }); // its record is in: it reads as sick
  return view;
}

/** Sam's side while he chooses blockers: Nathan's bear, wall and two soldiers are coming. */
async function blockersUp() {
  store().startCombat();
  store().setAttacker(card('bear'), 1, 1);
  store().setAttacker(card('wall'), 1, 1);
  store().setAttacker(stack('soldiers'), 1, 2);
  await store().confirmAttackers();
  expect(fight()).toMatchObject({ step: 'blockers', defender: 1 });
  const view = render(
    <>
      <CombatBar playerIdx={1} />
      <BattlefieldRow playerIdx={1} />
      <BoardStrip playerIdx={1} />
    </>,
  );
  await screen.findByRole('button', { name: 'Gray Ogre cannot block' });
  return view;
}

describe('picking attackers on the cards', () => {
  test('a tap on a creature sends it at the opponent and it wears the mark; a second tap takes it back', async () => {
    const { container } = await attackersUp();
    const bear = screen.getByRole('button', { name: 'attack with Grizzly Bears' });
    tap(bear);
    expect(attacks()).toEqual(['bear>1']);
    const picked = screen.getByRole('button', { name: /Grizzly Bears attacks/ });
    expect(picked).toHaveAttribute('aria-pressed', 'true');
    expect(picked.className).toContain('vcard--attacking');
    expect(picked.querySelector('.combat-mark--attack')).toHaveTextContent('⚔'); // two players: no initial needed
    expect(store().game!.players[0].cards!.battlefield.find((c) => c.iid === 'bear')!.tapped).toBeUndefined(); // not tapped yet
    tap(picked);
    expect(attacks()).toEqual([]);
    expect(container.querySelector('.combat-mark')).toBeNull();
  });

  test('a creature that cannot attack is dimmed and ignores the tap: tapped, or summoning sick', async () => {
    await attackersUp();
    for (const name of ['Hill Giant', 'Serra Angel']) {
      const cannot = screen.getByRole('button', { name: `${name} cannot attack` });
      expect(cannot.className).toContain('vcard--cant');
      tap(cannot);
    }
    expect(attacks()).toEqual([]);
    expect(screen.getByRole('button', { name: 'attack with Grizzly Bears' }).className).not.toContain('vcard--cant');
  });

  test('the hold is the way round: the card sheet offers "Attack anyway" and a plain Untap', async () => {
    await attackersUp();
    await hold(screen.getByRole('button', { name: 'Hill Giant cannot attack' }));
    const sheet = within(document.querySelector<HTMLElement>('.sheet')!);
    expect(sheet.getByText('Combat')).toBeInTheDocument();
    fireEvent.click(sheet.getByRole('button', { name: 'Untap' }));
    expect(store().game!.players[0].cards!.battlefield.find((c) => c.iid === 'giant')!.tapped).toBeUndefined();
    expect(attacks()).toEqual([]); // a plain untap is not a pick

    await hold(screen.getByRole('button', { name: 'Serra Angel cannot attack' }));
    fireEvent.click(within(document.querySelector<HTMLElement>('.sheet')!).getByRole('button', { name: 'Attack anyway' }));
    expect(attacks()).toEqual(['angel>1']);
    expect(document.querySelector('.sheet')).toBeNull(); // it closed on the pick
    // …and once it is in, the same sheet stands it down again
    await hold(screen.getByRole('button', { name: /Serra Angel attacks/ }));
    fireEvent.click(within(document.querySelector<HTMLElement>('.sheet')!).getByRole('button', { name: 'Stop attacking' }));
    expect(attacks()).toEqual([]);
  });

  test('a creature that can attack is offered a plain "Attack" in its sheet, and a plain Tap for crewing or paying', async () => {
    await attackersUp();
    await hold(screen.getByRole('button', { name: 'attack with Grizzly Bears' }));
    const sheet = within(document.querySelector<HTMLElement>('.sheet')!);
    expect(sheet.getByRole('button', { name: 'Attack' })).toBeInTheDocument();
    fireEvent.click(sheet.getByRole('button', { name: 'Tap' }));
    expect(store().game!.players[0].cards!.battlefield.find((c) => c.iid === 'bear')!.tapped).toBe(true);
    expect(attacks()).toEqual([]);
  });

  test('only creatures change meaning: a mana rock in the front row is not dimmed and still taps', async () => {
    await attackersUp();
    const ring = screen.getByRole('button', { name: 'tap Sol Ring' });
    expect(ring.className).toBe('vcard');
    tap(ring);
    expect(store().game!.players[0].cards!.battlefield.find((c) => c.iid === 'ring')!.tapped).toBe(true);
    expect(attacks()).toEqual([]);
  });

  test('in a pod the lit chip is where a tap points; each attacker wears its target, and a creature pointed elsewhere is re-pointed', async () => {
    await attackersUp(3);
    const chip = (name: string) => screen.getByRole('button', { name: new RegExp(`^attack ${name}`) });
    expect(chip('Sam')).toHaveAttribute('aria-pressed', 'true'); // the first is lit by default
    expect(chip('Alex')).toHaveAttribute('aria-pressed', 'false');
    tap(screen.getByRole('button', { name: 'attack with Grizzly Bears' }));
    expect(attacks()).toEqual(['bear>1']);
    expect(screen.getByRole('button', { name: /Grizzly Bears attacks/ }).querySelector('.combat-mark')).toHaveTextContent('⚔S');

    fireEvent.click(chip('Alex'));
    expect(chip('Alex')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Sam')).toHaveAttribute('aria-pressed', 'false');
    tap(screen.getByRole('button', { name: 'attack with Wall of Omens' }));
    tap(screen.getByRole('button', { name: /Grizzly Bears attacks/ })); // pointed at Sam: re-pointed, not taken back
    expect(attacks()).toEqual(['bear>2', 'wall>2']);
    expect(screen.getByRole('button', { name: /Grizzly Bears attacks/ }).querySelector('.combat-mark')).toHaveTextContent('⚔A');
    expect(chip('Alex')).toHaveTextContent('⚔ 2');
    expect(chip('Sam')).toHaveTextContent('⚔ 0');
    tap(screen.getByRole('button', { name: /Grizzly Bears attacks/ })); // pointed at the lit one: taken back
    expect(attacks()).toEqual(['wall>2']);
  });

  test('a stack: the row under it becomes a pick stepper, the remove control is gone, and a tap stops at the last free copy', async () => {
    const { container } = await attackersUp();
    const soldiers = () => screen.getByRole('button', { name: /^Soldier, 1 of 4 tapped/ });
    // no way to delete a token with a slipped tap while picking
    expect(screen.queryByRole('button', { name: 'remove one Soldier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove Soldier stack/ })).not.toBeInTheDocument();
    expect(container.querySelector('.pick-stepper .pick-count')).toHaveTextContent('0 attacking');
    expect(screen.getByRole('button', { name: 'one fewer Soldier attacking' })).toBeDisabled();

    for (let i = 0; i < 6; i++) tap(soldiers()); // four copies, one tapped: three may go
    expect(attacks()).toEqual(['soldiers x3>1']);
    expect(container.querySelector('.pick-stepper .pick-count')).toHaveTextContent('3 attacking');
    expect(screen.getByRole('button', { name: 'one more Soldier attacking' })).toBeDisabled();
    expect(soldiers().querySelector('.combat-mark--attack')).toHaveTextContent('⚔×3');
    expect(store().game!.players[0].board[0].count).toBe(4); // nothing was removed

    fireEvent.click(screen.getByRole('button', { name: 'one fewer Soldier attacking' }));
    expect(attacks()).toEqual(['soldiers x2>1']);
    fireEvent.click(screen.getByRole('button', { name: 'one more Soldier attacking' }));
    expect(attacks()).toEqual(['soldiers x3>1']);
  });

  test('a stack that is no creature keeps its count buttons and its ordinary tap — only the remove control steps aside', async () => {
    await attackersUp();
    fireEvent.click(screen.getByRole('button', { name: 'add one Treasure' }));
    expect(store().game!.players[0].board[1].count).toBe(3);
    expect(screen.queryByRole('button', { name: /remove Treasure stack/ })).not.toBeInTheDocument();
    tap(screen.getByRole('button', { name: 'Treasure' }));
    expect(store().game!.players[0].board[1].tapped).toBe(1);
    expect(attacks()).toEqual([]);
  });

  test('the hold on a stack offers one more copy anyway, and tapping or untapping one the plain way', async () => {
    await attackersUp();
    const soldiers = () => screen.getByRole('button', { name: /^Soldier/ });
    for (let i = 0; i < 3; i++) tap(soldiers());
    await hold(soldiers());
    const sheet = within(document.querySelector<HTMLElement>('.sheet')!);
    fireEvent.click(sheet.getByRole('button', { name: 'One more attacks anyway' })); // the tapped copy
    expect(attacks()).toEqual(['soldiers x4>1']);
    expect(sheet.queryByRole('button', { name: /One more attacks/ })).not.toBeInTheDocument(); // every copy is in
    fireEvent.click(sheet.getByRole('button', { name: 'Untap one' }));
    expect(store().game!.players[0].board[0].tapped).toBe(0);
    fireEvent.click(sheet.getByRole('button', { name: 'One fewer attacks' }));
    expect(attacks()).toEqual(['soldiers x3>1']);
  });

  test('outside a fight nothing has changed: a tap taps, the stack has its count row and its remove control', async () => {
    render(
      <>
        <BattlefieldRow playerIdx={0} />
        <BoardStrip playerIdx={0} />
      </>,
    );
    tap(await screen.findByRole('button', { name: 'tap Grizzly Bears' }));
    expect(store().game!.players[0].cards!.battlefield.find((c) => c.iid === 'bear')!.tapped).toBe(true);
    expect(screen.getByRole('button', { name: 'remove one Soldier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove Soldier stack/ })).toBeInTheDocument();
    expect(document.querySelector('.pick-stepper')).toBeNull();
  });

  test('the other players’ creatures are not picked by anybody while attackers are chosen', async () => {
    store().startCombat();
    render(<BattlefieldRow playerIdx={1} />);
    tap(await screen.findByRole('button', { name: 'tap Grizzly Bears' }));
    expect(store().game!.players[1].cards!.battlefield.find((c) => c.iid === 'sbear')!.tapped).toBe(true);
    expect(attacks()).toEqual([]);
  });

  test('on the phone’s hand view there is no picking: a tap on a creature taps it, fight or no fight', async () => {
    store().startCombat();
    render(<BattlefieldRow playerIdx={0} picks={false} />);
    tap(await screen.findByRole('button', { name: 'tap Grizzly Bears' }));
    expect(store().game!.players[0].cards!.battlefield.find((c) => c.iid === 'bear')!.tapped).toBe(true);
    expect(attacks()).toEqual([]);
  });
});

describe('picking blockers on the cards', () => {
  test('a tap puts one of your creatures in front of the lit attacker — the first by default — and it wears that number', async () => {
    await blockersUp();
    tap(screen.getByRole('button', { name: 'block with Grizzly Bears' }));
    expect(blocks()).toEqual(['bear: sbear', 'wall: ', 'soldiers: ']);
    const blocker = screen.getByRole('button', { name: /Grizzly Bears blocks/ });
    expect(blocker.className).toContain('vcard--blocking');
    expect(blocker.querySelector('.combat-mark--block')).toHaveTextContent('🛡1');
    tap(blocker); // already there: taken back
    expect(blocks()).toEqual(['bear: ', 'wall: ', 'soldiers: ']);
  });

  test('lighting another tile moves where a tap points; a blocker pointed elsewhere moves', async () => {
    await blockersUp();
    tap(screen.getByRole('button', { name: 'block with Grizzly Bears' }));
    tap(screen.getByRole('button', { name: /^attacker 2: Wall of Omens/ }));
    expect(screen.getByRole('button', { name: /^attacker 2:/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^attacker 1:/ })).toHaveAttribute('aria-pressed', 'false');
    tap(screen.getByRole('button', { name: /Grizzly Bears blocks/ }));
    expect(blocks()).toEqual(['bear: ', 'wall: sbear', 'soldiers: ']);
    expect(screen.getByRole('button', { name: /Grizzly Bears blocks/ }).querySelector('.combat-mark--block')).toHaveTextContent('🛡2');
  });

  test('a tapped creature cannot block: dimmed, the tap ignored, "Block anyway" behind the hold', async () => {
    await blockersUp();
    const ogre = screen.getByRole('button', { name: 'Gray Ogre cannot block' });
    expect(ogre.className).toContain('vcard--cant');
    tap(ogre);
    expect(blocks()).toEqual(['bear: ', 'wall: ', 'soldiers: ']);
    await hold(ogre);
    fireEvent.click(within(document.querySelector<HTMLElement>('.sheet')!).getByRole('button', { name: 'Block anyway' }));
    expect(blocks()).toEqual(['bear: ogre', 'wall: ', 'soldiers: ']);
  });

  test('a blocking stack has the same stepper ("n blocking"); each copy takes the next free attacking copy and no more', async () => {
    const { container } = await blockersUp();
    tap(screen.getByRole('button', { name: /^attacker 3: Soldier/ })); // two soldiers attack
    const saps = () => screen.getByRole('button', { name: /^Saproling/ });
    expect(container.querySelector('.pick-stepper .pick-count')).toHaveTextContent('0 blocking');
    expect(screen.queryByRole('button', { name: /remove Saproling stack/ })).not.toBeInTheDocument();
    for (let i = 0; i < 4; i++) tap(saps());
    expect(blocks()).toEqual(['bear: ', 'wall: ', 'soldiers: saprolings x2']); // one blocker per attacking copy
    expect(container.querySelector('.pick-stepper .pick-count')).toHaveTextContent('2 blocking');
    expect(saps().querySelector('.combat-mark--block')).toHaveTextContent('🛡3×2');
    // the third saproling can still stand somewhere else
    tap(screen.getByRole('button', { name: /^attacker 1: Grizzly Bears/ }));
    tap(saps());
    tap(saps()); // …and that was the last free copy
    expect(blocks()).toEqual(['bear: saprolings', 'wall: ', 'soldiers: saprolings x2']);
    expect(screen.getByRole('button', { name: 'one more Saproling blocking' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'one fewer Saproling blocking' }));
    expect(blocks()).toEqual(['bear: ', 'wall: ', 'soldiers: saprolings x2']);
  });

  test('the attacker’s own creatures keep their marks while the defender chooses, and are nobody’s picks', async () => {
    store().startCombat();
    store().setAttacker(card('bear'), 1, 1);
    await store().confirmAttackers();
    render(<BattlefieldRow playerIdx={0} />);
    const bear = await screen.findByRole('button', { name: 'tap Grizzly Bears' });
    await waitFor(() => expect(bear.querySelector('.combat-mark--attack')).not.toBeNull());
    expect(bear.className).toContain('vcard--attacking');
    expect(bear.className).toContain('vcard--tapped'); // the declaration tapped it
  });
});

describe('the damage, on the board', () => {
  test('creatures about to die are marked where they stand, on both sides', async () => {
    store().startCombat();
    store().setAttacker(card('bear'), 1, 1);
    store().setAttacker(stack('soldiers'), 1, 2);
    await store().confirmAttackers();
    store().setBlocker(1, card('bear'), card('sbear'), 1); // the bears trade
    store().setBlocker(1, stack('soldiers'), stack('saprolings'), 1); // one soldier and one saproling trade
    store().finishBlocks(1);
    expect(fight()?.step).toBe('damage');
    const { container } = render(
      <>
        <div data-testid="nathan">
          <BattlefieldRow playerIdx={0} />
          <BoardStrip playerIdx={0} />
        </div>
        <div data-testid="sam">
          <BattlefieldRow playerIdx={1} />
          <BoardStrip playerIdx={1} />
        </div>
      </>,
    );
    await waitFor(() => expect(container.querySelectorAll('.vcard--dying')).toHaveLength(2));
    const nathan = screen.getByTestId('nathan');
    const sam = screen.getByTestId('sam');
    expect(nathan.querySelector('.vcard--dying')).toHaveAttribute('aria-label', 'tap Grizzly Bears');
    expect(nathan.querySelector('.thumb--dying .combat-mark--dies')).toHaveTextContent('☠×1');
    expect(sam.querySelector('.vcard--dying .combat-mark--dies')).toHaveTextContent('☠');
    expect(sam.querySelector('.thumb--dying .combat-mark--dies')).toHaveTextContent('☠×1');
    // nothing is picked at this step: a tap is a tap again
    expect(container.querySelector('.pick-stepper')).toBeNull();
  });
});
