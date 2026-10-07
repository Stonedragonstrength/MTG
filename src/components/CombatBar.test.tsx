import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../data/settings';
import { liveCombat } from '../lib/combat';
import { adjustLife, createGame } from '../lib/game';
import type { BoardItem, CardInstance, CardRecord, CombatUnit, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import CombatBar, { CombatBoundary } from './CombatBar';
import { useCombatAim, useTableRecords } from './useCombat';

// The combat bar through the real store: what it says and offers in each step.

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
  'c-wurm': rec('c-wurm', 'Craw Wurm', 'Creature — Wurm', ['6', '4']),
  'c-angel': rec('c-angel', 'Serra Angel', 'Creature — Angel', ['4', '4'], 'Flying, vigilance'),
  'c-hawk': rec('c-hawk', 'Vampire Nighthawk', 'Creature — Vampire Shaman', ['2', '3'], 'Flying\nDeathtouch\nLifelink'),
  'c-wall': rec('c-wall', 'Wall of Omens', 'Creature — Wall', ['0', '4'], 'Defender'),
  'c-goyf': rec('c-goyf', 'Tarmogoyf', 'Creature — Lhurgoyf', ['*', '1+*']),
  'c-uprising': rec('c-uprising', "Garruk's Uprising", 'Enchantment', null, 'Creatures you control have trample.'),
  'c-ring': rec('c-ring', 'Sol Ring', 'Artifact', null, '{T}: Add {C}{C}.'),
};

/** Card ids whose lookup is held back, to stand in for a device still reading its database. */
const slow = new Map<string, () => void>();

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => {
    if (slow.has(id)) await new Promise<void>((arrived) => slow.set(id, arrived));
    return RECORDS[id];
  }),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

const NAMES = ['Nathan', 'Sam', 'Alex', 'Kim'];

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
  name: RECORDS[cardId]?.name ?? iid,
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

/** Nathan: a bear, a giant, an angel, a nighthawk, a wall, a tapped wurm, a Sol Ring, Garruk's
 * Uprising and five soldiers. Sam: a bear, a wall and two saprolings. The others: one knight each. */
function table(seats = 2, nathan: CardInstance[] | null = null): GameState {
  const g = createGame(config(seats));
  return {
    ...g,
    players: g.players.map((p, i) => {
      if (i === 0)
        return {
          ...p,
          board: [tokens('soldiers', 'Soldier', 5)],
          cards: seatCards(
            nathan ?? [
              onField('bear', 'c-bear'),
              onField('giant', 'c-giant'),
              onField('angel', 'c-angel'),
              onField('hawk', 'c-hawk'),
              onField('wall', 'c-wall'),
              onField('wurm', 'c-wurm', { tapped: true }),
              onField('ring', 'c-ring'),
              onField('uprising', 'c-uprising'),
            ],
          ),
        };
      if (i === 1)
        return {
          ...p,
          board: [tokens('saprolings', 'Saproling', 2)],
          cards: seatCards([onField('sbear', 'c-bear'), onField('swall', 'c-wall')]),
        };
      return { ...p, board: [tokens(`knight-${i}`, 'Knight', 1, { basePower: 2, baseToughness: 2 })] };
    }),
  };
}

const card = (id: string): CombatUnit => ({ kind: 'card', id });
const stack = (id: string): CombatUnit => ({ kind: 'stack', id });
const store = () => useAppStore.getState();
const fight = () => liveCombat(store().game!);
const attacks = () => (fight()?.attacks ?? []).map((a) => `${a.unit.id}${a.n ? ` x${a.n}` : ''}>${a.target}`);
const feed = () => (store().game!.feed ?? []).map((f) => f.text);
const buttons = (container: HTMLElement) =>
  [...container.querySelectorAll('.combat-actions button')].map((b) => b.textContent);

function tap(el: Element) {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
}
/** A click that happens at a moment of our choosing (ms). */
function clickAt(button: HTMLElement, at: number) {
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(click, 'timeStamp', { value: at });
  fireEvent(button, click);
}
async function sleep(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
/** Waits until this device has an answer for every card on the table (the session keeps them). */
async function everyCardRead() {
  const want = new Set(store().game!.players.flatMap((p) => (p.cards?.battlefield ?? []).map((c) => c.cardId)));
  const { result, unmount } = renderHook(() => useTableRecords());
  await waitFor(() => expect(Object.keys(result.current)).toHaveLength(want.size));
  unmount();
}

beforeEach(() => {
  slow.clear();
  useAppStore.setState({ game: table(), online: null, settings: { ...DEFAULT_SETTINGS } });
  useCombatAim.setState({ combatId: null, target: null, attack: null });
});

/** Nathan declares the giant, the angel, the goyf-less bear and three soldiers at Sam; Sam is up. */
async function samBlocks(seats = 2) {
  if (seats !== 2) useAppStore.setState({ game: table(seats) });
  store().startCombat();
  store().setAttacker(card('giant'), 1, 1);
  store().setAttacker(card('angel'), 1, 1);
  store().setAttacker(card('hawk'), 1, 1);
  store().setAttacker(stack('soldiers'), 1, 3);
  await store().confirmAttackers();
}

describe('no fight, or somebody else’s move', () => {
  test('there is no bar', async () => {
    const idle = render(<CombatBar playerIdx={0} />);
    expect(idle.container).toBeEmptyDOMElement();
    idle.unmount();
    store().startCombat();
    const { container } = render(<CombatBar playerIdx={1} />); // Nathan is picking attackers: not Sam's bar
    expect(container).toBeEmptyDOMElement();
  });
});

describe('attackers', () => {
  test('it opens with a sentence naming the seat and the job, and counts the attackers on its button', async () => {
    store().startCombat();
    const { container } = render(<CombatBar playerIdx={0} />);
    expect(container.querySelector('.combat-say')).toHaveTextContent('Nathan: pick attackers');
    expect(buttons(container)).toEqual(['Cancel', 'All attack', 'Attack (0)']);
    act(() => store().setAttacker(card('bear'), 1, 1));
    act(() => store().setAttacker(stack('soldiers'), 1, 3));
    expect(screen.getByRole('button', { name: 'Attack (4)' })).toBeInTheDocument();
  });

  test('with two players there are no chips', () => {
    store().startCombat();
    const { container } = render(<CombatBar playerIdx={0} />);
    expect(container.querySelector('.combat-chips')).toBeNull();
  });

  test('in a pod there is one chip per living opponent, one always lit, each counting what is coming at them', () => {
    useAppStore.setState({ game: adjustLife(table(4), 2, -40) }); // Alex is out
    store().startCombat();
    const { container } = render(<CombatBar playerIdx={0} />);
    const chips = [...container.querySelectorAll<HTMLElement>('.combat-chip')];
    expect(chips.map((c) => c.querySelector('.combat-chip-name')!.textContent)).toEqual(['Sam', 'Kim']);
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    fireEvent.click(chips[1]);
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    act(() => store().setAttacker(stack('soldiers'), 3, 2));
    expect(chips[1]).toHaveTextContent('⚔ 2');
    expect(chips[0]).toHaveTextContent('⚔ 0');
  });

  test('"All attack" adds every creature a tap could add that is not attacking yet — never one with defender — in one move', async () => {
    store().startCombat();
    store().setAttacker(card('bear'), 1, 1);
    await everyCardRead(); // the wall reads as a defender, the ring as no creature
    render(<CombatBar playerIdx={0} />);
    const all = screen.getByRole('button', { name: 'All attack' });
    fireEvent.click(all);
    // not the wall (defender), not the tapped wurm, not the ring or the enchantment
    expect(attacks()).toEqual(['bear>1', 'giant>1', 'angel>1', 'hawk>1', 'soldiers x5>1']);
    expect(all).toBeDisabled(); // nothing left to add
    act(() => store().undo());
    expect(attacks()).toEqual(['bear>1']); // one press, one Undo
  });

  test('"All attack" waits until the seat’s cards are read: a card taken on trust is not sent in with the rest', async () => {
    // A mana rock this device is still looking up: a single tap would take it on trust as a creature.
    RECORDS['c-late-rock'] = rec('c-late-rock', 'Mind Stone', 'Artifact', null, '{T}: Add {C}.');
    slow.set('c-late-rock', () => {});
    useAppStore.setState({ game: table(2, [onField('bear', 'c-bear'), { ...onField('rock', 'c-bear'), cardId: 'c-late-rock', name: 'Mind Stone' }]) });
    store().startCombat();
    render(<CombatBar playerIdx={0} />);
    const all = screen.getByRole('button', { name: 'All attack' });
    await sleep(60);
    expect(all).toBeDisabled();
    const arrived = slow.get('c-late-rock')!;
    slow.delete('c-late-rock');
    await act(async () => arrived());
    await waitFor(() => expect(all).toBeEnabled());
    fireEvent.click(all);
    expect(attacks()).toEqual(['bear>1', 'soldiers x5>1']); // not the rock
    delete RECORDS['c-late-rock'];
  });

  test('Cancel ends it at once and without a word: nobody else has done anything yet', () => {
    store().startCombat();
    store().setAttacker(card('bear'), 1, 1);
    const { container } = render(<CombatBar playerIdx={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fight()).toBeNull();
    expect(feed()).toEqual([]);
    expect(container).toBeEmptyDOMElement(); // the bar is gone
  });

  test('"Attack (0)" is a cancel', async () => {
    store().startCombat();
    const { container } = render(<CombatBar playerIdx={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Attack (0)' }));
    await waitFor(() => expect(fight()).toBeNull());
    expect(feed()).toEqual([]);
    expect(container).toBeEmptyDOMElement();
  });

  test('"Attack (n)" declares it: the attackers tap and the first defender is up', async () => {
    store().startCombat();
    store().setAttacker(card('bear'), 1, 1);
    render(<CombatBar playerIdx={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Attack (1)' }));
    await waitFor(() => expect(fight()).toMatchObject({ step: 'blockers', defender: 1 }));
    expect(feed()).toEqual(['Nathan attacks Sam with 1 creature']);
    expect(store().game!.players[0].cards!.battlefield[0].tapped).toBe(true);
  });
});

describe('blockers', () => {
  test('it opens with who blocks how many from whom, in the defender’s zone only', async () => {
    await samBlocks();
    const attacker = render(<CombatBar playerIdx={0} />);
    expect(attacker.container).toBeEmptyDOMElement();
    attacker.unmount();
    const { container } = render(<CombatBar playerIdx={1} />);
    expect(container.querySelector('.combat-say')).toHaveTextContent('Sam: block 6 from Nathan');
    expect(buttons(container)).toEqual(['Cancel', 'Blocked ✋', 'No blocks']);
  });

  test('the strip: one numbered tile per attack — a stack is one tile — with art, size, keyword marks and who is in its way', async () => {
    await samBlocks();
    const { container } = render(<CombatBar playerIdx={1} />);
    await waitFor(() => expect(container.querySelectorAll('.strip-art img')).toHaveLength(3)); // the cards are read
    const tiles = [...container.querySelectorAll<HTMLElement>('.strip-tile')];
    expect(tiles.map((t) => t.querySelector('.strip-no')!.textContent)).toEqual(['1', '2', '3', '4']);
    expect(tiles.map((t) => t.querySelector('.strip-name')!.textContent)).toEqual([
      'Hill Giant',
      'Serra Angel',
      'Vampire Nighthawk',
      'Soldier',
    ]);
    expect(tiles.map((t) => t.querySelector('.strip-size strong')!.textContent)).toEqual(['3/3', '4/4', '2/3', '1/1']);
    const marks = (t: HTMLElement) => [...t.querySelectorAll('.strip-mark')].map((m) => m.textContent);
    // Garruk's Uprising hands everyone trample: a granted keyword is drawn like a printed one
    expect(marks(tiles[0])).toEqual(['tramp']);
    expect(marks(tiles[1])).toEqual(['fly', 'tramp', 'vig']);
    expect(marks(tiles[2])).toEqual(['fly', 'death', 'life', 'tramp']);
    expect(tiles.map((t) => t.querySelector('.strip-way')!.textContent)).toEqual([
      'not blocked',
      'not blocked',
      'not blocked',
      '×3 · 0 blocked',
    ]);
    expect(tiles[0].querySelector('img')).toHaveAttribute('src', 'https://img.example/c-giant.jpg');

    act(() => store().setBlocker(1, card('giant'), card('swall'), 1));
    act(() => store().setBlocker(1, card('giant'), stack('saprolings'), 1));
    act(() => store().setBlocker(1, stack('soldiers'), stack('saprolings'), 1));
    const ways = () => [...container.querySelectorAll('.strip-way')].map((w) => w.textContent);
    expect(ways()).toEqual(['← Wall of Omens, Saproling', 'not blocked', 'not blocked', '×3 · 1 blocked']);
  });

  test('a creature the app cannot read shows "?" for its size', async () => {
    useAppStore.setState({ game: table(2, [onField('goyf', 'c-goyf')]) });
    store().startCombat();
    store().setAttacker(card('goyf'), 1, 1);
    await store().confirmAttackers();
    const { container } = render(<CombatBar playerIdx={1} />);
    await waitFor(() => expect(container.querySelector('.strip-art img')).not.toBeNull());
    expect(container.querySelector('.strip-size strong')).toHaveTextContent('?');
  });

  test('one tile is always lit, the first by default; a tap moves the light', async () => {
    await samBlocks();
    const { container } = render(<CombatBar playerIdx={1} />);
    const lit = () => [...container.querySelectorAll('.strip-tile')].map((t) => t.getAttribute('aria-pressed'));
    expect(lit()).toEqual(['true', 'false', 'false', 'false']);
    tap(container.querySelectorAll('.strip-tile')[2]);
    expect(lit()).toEqual(['false', 'false', 'true', 'false']);
    expect(container.querySelectorAll('.strip-tile--lit')).toHaveLength(1);
    expect(fight()!.attacks!.every((a) => !a.blockers && !a.blocked)).toBe(true); // lighting changes nothing in the game
  });

  test('a hold on a tile shows that card large, and changes nothing', async () => {
    await samBlocks();
    const { container } = render(<CombatBar playerIdx={1} />);
    await waitFor(() => expect(container.querySelectorAll('.strip-art img')).toHaveLength(3));
    const before = store().game;
    const angel = container.querySelectorAll('.strip-tile')[1];
    fireEvent.pointerDown(angel);
    await sleep(650);
    fireEvent.pointerUp(angel);
    const sheet = within(document.querySelector<HTMLElement>('.sheet')!);
    expect(sheet.getByRole('heading', { name: 'Serra Angel' })).toBeInTheDocument();
    expect(sheet.getByText('Flying, vigilance')).toBeInTheDocument();
    expect(sheet.queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['close']); // read-only
    expect(store().game).toBe(before);
    expect([...container.querySelectorAll('.strip-tile')].map((t) => t.getAttribute('aria-pressed'))[0]).toBe('true'); // the hold did not move the light
  });

  test('"Blocked ✋" marks the lit attacker as stopped by a card that is not on the tablet, and takes the mark off again', async () => {
    await samBlocks();
    const { container } = render(<CombatBar playerIdx={1} />);
    const paper = screen.getByRole('button', { name: /not on the tablet/ });
    expect(paper).toHaveTextContent('Blocked ✋');
    expect(paper).toHaveAttribute('aria-pressed', 'false');
    tap(container.querySelectorAll('.strip-tile')[1]); // the angel
    fireEvent.click(paper);
    expect(fight()!.attacks!.map((a) => a.blocked ?? false)).toEqual([false, true, false, false]);
    expect(paper).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.strip-way')[1]).toHaveTextContent('← ✋ paper');
    expect(screen.getByRole('button', { name: 'Done (1)' })).toBeInTheDocument();
    tap(container.querySelectorAll('.strip-tile')[0]); // another tile: the button follows the light
    expect(paper).toHaveAttribute('aria-pressed', 'false');
    tap(container.querySelectorAll('.strip-tile')[1]);
    fireEvent.click(paper);
    expect(fight()!.attacks!.some((a) => a.blocked)).toBe(false);
    expect(screen.getByRole('button', { name: 'No blocks' })).toBeInTheDocument();
  });

  test('"No blocks" becomes "Done (n)" as attackers are stopped, and either one moves the fight on', async () => {
    await samBlocks();
    render(<CombatBar playerIdx={1} />);
    act(() => store().setBlocker(1, card('giant'), card('swall'), 1));
    act(() => store().setBlocker(1, stack('soldiers'), stack('saprolings'), 2));
    fireEvent.click(screen.getByRole('button', { name: 'Done (3)' }));
    expect(fight()).toMatchObject({ step: 'damage' });
    expect(feed().at(-1)).toBe('Sam blocks 3 attackers');
  });

  test('the next defender gets the bar after the first: each in turn', async () => {
    useAppStore.setState({ game: table(3) });
    store().startCombat();
    store().setAttacker(card('giant'), 1, 1);
    store().setAttacker(card('bear'), 2, 1);
    await store().confirmAttackers();
    const sam = render(<CombatBar playerIdx={1} />);
    const alex = render(<CombatBar playerIdx={2} />);
    expect(alex.container).toBeEmptyDOMElement();
    fireEvent.click(within(sam.container).getByRole('button', { name: 'No blocks' }));
    expect(sam.container).toBeEmptyDOMElement();
    expect(alex.container.querySelector('.combat-say')).toHaveTextContent('Alex: block 1 from Nathan');
    expect(alex.container.querySelectorAll('.strip-tile')).toHaveLength(1);
  });

  test('a defender who was defeated while choosing still has the bar: somebody has to press Done for them', async () => {
    await samBlocks();
    act(() => store().adjustLife(1, -40));
    expect(store().game!.players[1].eliminated).toBe(true);
    render(<CombatBar playerIdx={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'No blocks' }));
    expect(fight()).toMatchObject({ step: 'damage' });
  });

  test('Cancel now throws away other players’ work, so it asks in place — and one double tap cannot answer', async () => {
    await samBlocks();
    render(<CombatBar playerIdx={1} />);
    clickAt(screen.getByRole('button', { name: 'Cancel' }), 5000);
    expect(fight()).not.toBeNull();
    const asking = screen.getByRole('button', { name: 'Really call it off?' });
    clickAt(asking, 5150); // the other half of the same double tap
    expect(fight()).not.toBeNull();
    clickAt(asking, 6000); // a deliberate answer
    expect(fight()).toBeNull();
    expect(feed().at(-1)).toBe('Nathan calls off the attack');
    expect(store().game!.players[0].cards!.battlefield.some((c) => c.iid !== 'wurm' && c.tapped)).toBe(false); // the attackers stand back up
  });

  test('a question nobody answers stands down again', async () => {
    await samBlocks();
    vi.useFakeTimers();
    try {
      render(<CombatBar playerIdx={1} />);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('button', { name: 'Really call it off?' })).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(5100);
      });
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(fight()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('damage', () => {
  /** …Sam blocks nothing, or what `blocks` says, and the fight waits at damage. */
  async function atDamage(blocks: () => void = () => {}) {
    await samBlocks();
    blocks();
    store().finishBlocks(1);
    expect(fight()).toMatchObject({ step: 'damage' });
  }

  test('the bar is back with the attacker and shows the result, one line per defender', async () => {
    await atDamage();
    const sam = render(<CombatBar playerIdx={1} />);
    expect(sam.container).toBeEmptyDOMElement();
    sam.unmount();
    const { container } = render(<CombatBar playerIdx={0} />);
    expect(container.querySelector('.combat-say')).toHaveTextContent('Nathan’s attack: the damage');
    // 3 + 4 + 2 + 3 soldiers = 12 to Sam; the nighthawk's lifelink gains Nathan 2
    await waitFor(() =>
      expect([...container.querySelectorAll('.combat-result li')].map((li) => li.textContent)).toEqual([
        'Sam −12',
        'Nathan +2 life',
      ]),
    );
  });

  test('plain damage keeps a one-tap Apply beside Review', async () => {
    await atDamage();
    const { container } = render(<CombatBar playerIdx={0} />);
    await screen.findByRole('button', { name: 'Apply' });
    expect(buttons(container)).toEqual(['Cancel', 'Review…', 'Apply']);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(store().game!.players.map((p) => p.life)).toEqual([42, 28]);
    expect(feed().at(-1)).toBe('Combat: Sam takes 12 · Nathan gains 2');
    expect(fight()).toBeNull();
    expect(container).toBeEmptyDOMElement(); // the bar is gone
  });

  test('a result that kills a creature has no one-tap Apply: Review is the main button, and the dead are named', async () => {
    await atDamage(() => store().setBlocker(1, card('giant'), card('sbear'), 1)); // the giant kills Sam's bear
    const { container } = render(<CombatBar playerIdx={0} />);
    await screen.findByRole('button', { name: 'Review…' });
    expect(buttons(container)).toEqual(['Cancel', 'Review…']);
    expect(screen.getByRole('button', { name: 'Review…' }).className).toContain('primary');
    // the giant has trample from the Uprising: 2 to the bear, 1 over
    expect(container.querySelector('.combat-result li')).toHaveTextContent('Sam −10 · Grizzly Bears dies');
  });

  test('a result that defeats a player has no one-tap Apply either, and says so', async () => {
    useAppStore.setState({ game: adjustLife(table(), 1, -30) }); // Sam is at 10
    await atDamage();
    const { container } = render(<CombatBar playerIdx={0} />);
    await screen.findByRole('button', { name: 'Review…' });
    expect(buttons(container)).toEqual(['Cancel', 'Review…']);
    expect(container.querySelector('.combat-flag--defeat')).toHaveTextContent('this defeats Sam');
  });

  test('Review opens the sheet, and Apply lives inside it', async () => {
    await atDamage(() => store().setBlocker(1, card('giant'), card('sbear'), 1));
    render(<CombatBar playerIdx={0} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review…' }));
    const sheet = within(document.querySelector<HTMLElement>('.sheet')!);
    expect(sheet.getByRole('heading', { name: 'Review the damage' })).toBeInTheDocument();
    expect(sheet.getByRole('checkbox', { name: "Sam's Grizzly Bears dies" })).toBeChecked();
    await sleep(400); // the sheet takes no tap as an answer for its first moment
    fireEvent.click(sheet.getByRole('button', { name: 'Apply' }));
    expect(fight()).toBeNull();
    expect(store().game!.players[1].cards!.graveyard.map((c) => c.name)).toEqual(['Grizzly Bears']);
    expect(document.querySelector('.sheet')).toBeNull(); // it closed with its fight
  });

  test('what the engine flagged is on the bar', async () => {
    useAppStore.setState({ game: table(2, [onField('goyf', 'c-goyf'), onField('bear', 'c-bear')]) });
    store().startCombat();
    store().setAttacker(card('goyf'), 1, 1);
    store().setAttacker(card('bear'), 1, 1);
    await store().confirmAttackers();
    store().finishBlocks(1);
    const { container } = render(<CombatBar playerIdx={0} />);
    await waitFor(() => expect(container.querySelector('.combat-flag')).not.toBeNull());
    expect([...container.querySelectorAll('.combat-result li')].map((li) => li.textContent)).toEqual([
      'Sam −2',
      '1 creature not read (Tarmogoyf)',
    ]);
  });

  test('until every card in the fight has been read here it says "Reading the cards…" and nothing can be applied', async () => {
    await atDamage();
    // Sam's wall is a card this device is still looking up.
    const game = store().game!;
    useAppStore.setState({
      game: {
        ...game,
        players: game.players.map((p, i) =>
          i === 1
            ? { ...p, cards: { ...p.cards!, battlefield: [...p.cards!.battlefield, onField('late', 'c-late')] } }
            : p,
        ),
      },
    });
    RECORDS['c-late'] = rec('c-late', 'Late Arrival', 'Creature — Spirit', ['1', '1']);
    slow.set('c-late', () => {});
    const { container } = render(<CombatBar playerIdx={0} />);
    await sleep(60);
    expect(container.querySelector('.combat-result')).toHaveTextContent('Reading the cards…');
    expect(buttons(container)).toEqual(['Cancel']);
    // …the answer arrives
    const arrived = slow.get('c-late')!;
    slow.delete('c-late');
    await act(async () => arrived());
    await screen.findByRole('button', { name: 'Apply' });
    expect(container.querySelector('.combat-result')).not.toHaveTextContent('Reading the cards…');
    delete RECORDS['c-late'];
  });

  test('Cancel means "no damage happens": it asks in place, then stands the attackers back up', async () => {
    await atDamage();
    render(<CombatBar playerIdx={0} />);
    clickAt(screen.getByRole('button', { name: 'Cancel' }), 1000);
    clickAt(screen.getByRole('button', { name: 'Really call it off?' }), 1900);
    expect(fight()).toBeNull();
    expect(store().game!.players.map((p) => p.life)).toEqual([40, 40]);
    expect(store().game!.players[0].cards!.battlefield.find((c) => c.iid === 'giant')!.tapped).toBeUndefined();
    expect(store().game!.players[0].board[0].tapped).toBe(0);
  });
});

describe('a bar that throws', () => {
  function Bomb(): never {
    throw new Error('this fight cannot be drawn');
  }

  test('falls back to a way out — "Cancel combat" — instead of taking the table down', async () => {
    await samBlocks();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <div data-testid="zone">
        <CombatBoundary>
          <Bomb />
        </CombatBoundary>
        <span>the rest of the zone</span>
      </div>,
    );
    expect(screen.getByText('the rest of the zone')).toBeInTheDocument(); // nothing else went down with it
    fireEvent.click(screen.getByRole('button', { name: 'Cancel combat' }));
    expect(fight()).toBeNull();
    expect(feed().at(-1)).toBe('Nathan calls off the attack');
    expect(store().game!.players[0].cards!.battlefield.some((c) => c.iid !== 'wurm' && c.tapped)).toBe(false);
    spy.mockRestore();
  });
});
