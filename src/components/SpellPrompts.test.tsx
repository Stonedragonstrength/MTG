import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { _resetBackStack } from '../lib/backstack';
import { createGame } from '../lib/game';
import { spellPrompts } from '../lib/spellEffects';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState, Reveal } from '../lib/types';
import { useAppStore } from '../state/store';
import RevealBanner from './RevealBanner';
import SpellTargetSheet from './SpellTargetSheet';

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
    colors: ['R'],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-bolt': rec('c-bolt', 'Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.'),
  'c-helix': rec('c-helix', 'Lightning Helix', 'Instant', 'Lightning Helix deals 3 damage to any target and you gain 3 life.'),
  'c-counter': rec('c-counter', 'Counterspell', 'Instant', 'Counter target spell.'),
  'c-divination': rec('c-divination', 'Divination', 'Sorcery', 'Draw two cards.'),
  'c-alarm': rec('c-alarm', 'Raise the Alarm', 'Instant', 'Create two 1/1 white Soldier creature tokens.'),
  'c-hunt': rec('c-hunt', 'Call of the Hunt', 'Sorcery', 'Create a 2/2 green Wolf creature token.'),
  'c-wrath': rec('c-wrath', 'Wrath of God', 'Sorcery', "Destroy all creatures. They can't be regenerated."),
  'c-murder': rec('c-murder', 'Murder', 'Instant', 'Destroy target creature.'),
  'c-burst': rec('c-burst', 'Burst of Strength', 'Instant', 'Put a +1/+1 counter on target creature.'),
  'c-blaze': rec('c-blaze', 'Blaze', 'Sorcery', 'Blaze deals X damage to any target.'),
  'c-charm': rec('c-charm', 'Healing Charm', 'Instant', 'Choose one —\n• You gain 4 life.\n• Draw two cards.'),
  'c-pact': rec(
    'c-pact',
    'Scholar’s Pact',
    'Sorcery',
    'Choose one —\n• Draw two cards. You lose 2 life.\n• You gain 4 life.',
  ),
  'c-command': rec(
    'c-command',
    'Elder Command',
    'Instant',
    'Choose two —\n• You gain 4 life.\n• Draw two cards.\n• Each opponent loses 2 life.',
  ),
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear', '', '2'),
  'c-giant': rec('c-giant', 'Hill Giant', 'Creature — Giant', '', '3'),
  'c-forest': rec('c-forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
};

const SOLDIER: CardRecord = {
  ...rec('t-soldier', 'Soldier', 'Token Creature — Soldier', '', '1'),
  colors: ['W'],
  isToken: true,
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
  findCardsNamed: vi.fn(async (name: string) => (name === 'Soldier' ? [SOLDIER] : [])),
}));

const card = (iid: string, cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({
  iid,
  cardId,
  name: RECORDS[cardId].name,
  ...more,
});

const seat = (battlefield: CardInstance[], library: CardInstance[] = []) => ({
  library,
  hand: [],
  battlefield,
  graveyard: [],
  exile: [],
  command: [],
  mulligans: 0,
  deckName: 'Test',
});

let made = 0;
const cast = (cardId: string, over: Partial<Reveal> = {}): Reveal => ({
  id: `sp-${++made}`,
  seat: 0,
  from: 'cast',
  cards: [{ cardId, name: RECORDS[cardId].name }],
  t: Date.now(),
  ...over,
});

/** Nathan: a bear, a Forest, three cards in his library. Sam: a giant and
 * a bear. Alex: nothing. `shown` is the spell Nathan has just cast. */
function table(shown: Reveal): GameState {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: seat(
      [card('bear', 'c-bear'), card('forest', 'c-forest', { row: 'lands' })],
      [card('l1', 'c-forest'), card('l2', 'c-forest'), card('l3', 'c-forest')],
    ),
  };
  g.players[1] = { ...g.players[1], cards: seat([card('giant', 'c-giant'), card('sbear', 'c-bear')]) };
  return { ...g, reveal: shown };
}

function casts(cardId: string, over: Partial<Reveal> = {}) {
  act(() => useAppStore.setState({ game: table(cast(cardId, over)) }));
  render(<RevealBanner />);
}

const game = () => useAppStore.getState().game!;
const feed = () => (game().feed ?? []).map((e) => e.text);
const banner = () => screen.queryByRole('status');
const prompts = () => screen.queryAllByRole('button').filter((b) => b.className.includes('spell-prompt'));
const labels = () => prompts().map((b) => b.textContent);
/** Lets card records, token cards and the store's own reads land (off the clock). */
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setImmediate(r))));
};
const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** A deliberate tap, a moment after whatever it lands on came up. */
function tap(el: Element) {
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(click, 'timeStamp', { value: Date.now() + 1000 });
  fireEvent(el, click);
}

beforeEach(() => {
  _resetBackStack();
  useAppStore.setState({ game: null, online: null });
  // Only the timers and the page's stopwatch: fake-indexeddb needs the real setImmediate.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
});

afterEach(() => {
  cleanup();
  vi.runAllTimers();
  vi.useRealTimers();
  document.querySelectorAll('.tap-shield').forEach((left) => left.remove());
});

test('a cast spell offers what it does as buttons; one it cannot read offers none', async () => {
  casts('c-helix');
  await settle();
  expect(labels()).toEqual(['Deal 3 damage…', 'Gain 3 life']);
  cleanup();
  casts('c-counter');
  await settle();
  expect(banner()).toHaveTextContent('Counterspell');
  expect(labels()).toEqual([]);
});

test('a one-tap effect is done on the tap, its button goes quiet, and the banner stays for the rest', async () => {
  casts('c-helix');
  await settle();
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Gain 3 life' }));
  expect(game().players[0].life).toBe(43);
  expect(feed()).toContain('Nathan gains 3 life from Lightning Helix');
  expect(banner()).not.toBeNull(); // a tap on a button is not a tap on the banner
  const done = screen.getByRole('button', { name: '✓ Gain 3 life' });
  expect(done).toBeDisabled();
  fireEvent.click(done);
  expect(game().players[0].life).toBe(43); // not twice
});

test('a tap in the banner’s first moment presses nothing', async () => {
  casts('c-helix');
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Gain 3 life' }));
  expect(game().players[0].life).toBe(40);
  expect(banner()).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Gain 3 life' })).toBeEnabled();
});

test('an effect with a target opens the list on the first opponent; a tap on a row applies it', async () => {
  casts('c-bolt');
  await settle();
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Deal 3 damage…' }));
  await settle();
  expect(screen.getByRole('heading', { name: 'Lightning Bolt: Deal 3 damage' })).toBeInTheDocument();
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Mine', 'Sam', 'Alex']);
  expect(screen.getByRole('tab', { name: 'Sam' })).toHaveAttribute('aria-selected', 'true');
  const rows = () => within(document.querySelector('.attach-list')!).getAllByRole('button').map((b) => b.textContent);
  expect(rows()).toEqual(['Sam · 40 life', 'Hill Giant3/3dies', 'Grizzly Bears2/2dies']);
  tap(screen.getByRole('tab', { name: 'Mine' }));
  expect(rows()).toEqual(['Nathan · 40 life', 'Grizzly Bears2/2dies']); // creatures, not the Forest
  tap(screen.getByRole('tab', { name: 'Sam' }));
  tap(screen.getByRole('button', { name: 'Hill Giant — dies' }));
  await settle();
  expect(screen.queryByRole('heading', { name: /Lightning Bolt:/ })).toBeNull();
  expect(game().players[1].cards!.graveyard.map((c) => c.iid)).toEqual(['giant']);
  expect(feed()).toContain('Nathan’s Lightning Bolt deals 3 to Sam’s Hill Giant (3/3), which dies');
  // Its one button is used: the banner puts itself away a moment later.
  expect(screen.getByRole('button', { name: '✓ Deal 3 damage' })).toBeDisabled();
  expect(banner()).not.toBeNull();
  pass(1_100);
  expect(banner()).toBeNull();
});

test('a player is the first row, and hitting them is one tap', async () => {
  casts('c-bolt');
  await settle();
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Deal 3 damage…' }));
  tap(screen.getByRole('button', { name: 'Sam · 40 life' }));
  expect(game().players[1].life).toBe(37);
  expect(feed()).toContain('Nathan’s Lightning Bolt deals 3 to Sam');
});

test('a tap on the list too soon after it opens picks nothing, and closing it leaves the button to press again', async () => {
  casts('c-bolt');
  await settle();
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Deal 3 damage…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sam · 40 life' })); // the same tap, still arriving
  expect(game().players[1].life).toBe(40);
  tap(screen.getByRole('button', { name: 'Not now' }));
  expect(screen.queryByRole('tab')).toBeNull();
  expect(banner()).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Deal 3 damage…' })).toBeEnabled();
});

test('while a button waits the cast stays twenty seconds, not seven', async () => {
  casts('c-bolt');
  await settle();
  pass(19_000);
  expect(banner()).not.toBeNull();
  pass(2_000);
  expect(banner()).toBeNull();
});

test('a "choose one" spell is done with the option taken: the other goes quiet and the banner leaves', async () => {
  casts('c-charm');
  await settle();
  expect(labels()).toEqual(['Gain 4 life', 'Draw 2']);
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Gain 4 life' }));
  expect(game().players[0].life).toBe(44);
  const other = screen.getByRole('button', { name: 'Draw 2' });
  expect(other).toBeDisabled();
  expect(other.className).toContain('spell-prompt--off');
  fireEvent.click(other);
  expect(game().players[0].cards!.hand).toHaveLength(0); // the option not taken does nothing
  expect(banner()).not.toBeNull();
  pass(1_100);
  expect(banner()).toBeNull(); // no twenty seconds of waiting for a button nobody will press
});

test('the option taken is finished first: its second effect waits to be pressed', async () => {
  casts('c-pact');
  await settle();
  expect(labels()).toEqual(['Draw 2', 'Lose 2 life', 'Gain 4 life']);
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Draw 2' }));
  await settle();
  expect(screen.getByRole('button', { name: 'Lose 2 life' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Gain 4 life' })).toBeDisabled();
  pass(2_000);
  expect(banner()).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Lose 2 life' }));
  expect(game().players[0].life).toBe(38);
  pass(1_100);
  expect(banner()).toBeNull();
});

test('a "choose two" spell closes after the second option', async () => {
  casts('c-command');
  await settle();
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Gain 4 life' }));
  expect(screen.getByRole('button', { name: 'Draw 2' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Each opponent loses 2' })).toBeEnabled();
  pass(2_000);
  expect(banner()).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Each opponent loses 2' }));
  expect(game().players[1].life).toBe(38);
  expect(screen.getByRole('button', { name: 'Draw 2' })).toBeDisabled();
  pass(1_100);
  expect(banner()).toBeNull();
});

test('a spell with nothing to offer still goes after seven', async () => {
  casts('c-counter');
  await settle();
  pass(6_000);
  expect(banner()).not.toBeNull();
  pass(2_000);
  expect(banner()).toBeNull();
});

test('drawing draws for the caster', async () => {
  casts('c-divination');
  await settle();
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Draw 2' }));
  expect(game().players[0].cards!.hand.map((c) => c.iid)).toEqual(['l1', 'l2']);
});

test('tokens arrive as one stack, and more of them join it', async () => {
  casts('c-alarm');
  await settle();
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Make 2 Soldiers' }));
  expect(game().players[0].board).toMatchObject([{ cardId: 't-soldier', name: 'Soldier', count: 2, sick: 2 }]);
  cleanup();
  act(() => useAppStore.setState({ game: { ...game(), reveal: cast('c-alarm') } }));
  render(<RevealBanner />);
  await settle();
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Make 2 Soldiers' }));
  expect(game().players[0].board).toMatchObject([{ count: 4 }]);
  expect(game().players[0].board).toHaveLength(1);
});

test('a token this device has no card for gets no button', async () => {
  casts('c-hunt');
  await settle();
  expect(banner()).toHaveTextContent('Call of the Hunt');
  expect(labels()).toEqual([]);
});

test('a sweeper clears the table in one tap', async () => {
  casts('c-wrath');
  await settle();
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Destroy all creatures' }));
  await settle();
  expect(game().players[0].cards!.battlefield.map((c) => c.iid)).toEqual(['forest']);
  expect(game().players[1].cards!.battlefield).toEqual([]);
  expect(feed()).toContain('Nathan’s Wrath of God destroys all creatures (3)');
});

test('an X spell offers its effect for the X it was cast for', async () => {
  casts('c-blaze', { x: 4 });
  await settle();
  expect(labels()).toEqual(['Deal 4 damage…']);
  cleanup();
  casts('c-blaze');
  await settle();
  expect(labels()).toEqual([]);
});

test('at an online table only the caster’s own device offers the buttons', async () => {
  const online = (mySeat: number | null) =>
    ({ code: 'KQ7M2X', status: { kind: 'connected' }, mySeat }) as never;
  act(() => useAppStore.setState({ online: online(1) }));
  casts('c-bolt');
  await settle();
  expect(banner()).toHaveTextContent('Lightning Bolt');
  expect(labels()).toEqual([]);
  cleanup();
  act(() => useAppStore.setState({ online: online(0) }));
  casts('c-bolt');
  await settle();
  expect(labels()).toEqual(['Deal 3 damage…']);
  cleanup();
  act(() => useAppStore.setState({ online: online(null) })); // the shared tablet, hosting
  casts('c-bolt');
  await settle();
  expect(labels()).toEqual(['Deal 3 damage…']);
});

test('a reveal that is not a cast has no buttons', async () => {
  act(() => useAppStore.setState({ game: table(cast('c-bolt', { from: 'hand' })) }));
  render(<RevealBanner />);
  await settle();
  expect(banner()).toHaveTextContent(/reveals/);
  expect(labels()).toEqual([]);
});

// ---- the list by itself ----

const promptOf = (cardId: string) => spellPrompts(RECORDS[cardId])[0];

test('what helps opens on the caster’s own side, what hurts on the first opponent’s', async () => {
  const shown = cast('c-burst');
  act(() => useAppStore.setState({ game: table(shown) }));
  const onPick = vi.fn();
  render(<SpellTargetSheet caster={shown.seat} spell={shown.cards[0].name} revealId={shown.id}prompt={promptOf('c-burst')} onPick={onPick} onClose={() => {}} />);
  await settle();
  expect(screen.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true');
  tap(screen.getByRole('button', { name: 'Grizzly Bears' }));
  expect(onPick).toHaveBeenCalledWith({ seat: 0, kind: 'card', id: 'bear' });
  cleanup();
  render(<SpellTargetSheet caster={shown.seat} spell={shown.cards[0].name} revealId={shown.id}prompt={promptOf('c-murder')} onPick={onPick} onClose={() => {}} />);
  await settle();
  expect(screen.getByRole('tab', { name: 'Sam' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('button', { name: /life$/ })).toBeNull(); // a creature spell cannot hit a player
  tap(screen.getByRole('tab', { name: 'Alex' }));
  expect(screen.getByText('Nothing here it can be pointed at.')).toBeInTheDocument();
});

test('a token stack is one row, and counters only go on a stack of one', async () => {
  const shown = cast('c-murder');
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
  const g = table(shown);
  g.players[1] = { ...g.players[1], board: [soldiers] };
  act(() => useAppStore.setState({ game: g }));
  render(<SpellTargetSheet caster={shown.seat} spell={shown.cards[0].name} revealId={shown.id}prompt={promptOf('c-murder')} onPick={() => {}} onClose={() => {}} />);
  await settle();
  expect(screen.getByRole('button', { name: 'Soldier ×2' })).toBeInTheDocument();
  cleanup();
  render(<SpellTargetSheet caster={shown.seat} spell={shown.cards[0].name} revealId={shown.id}prompt={promptOf('c-burst')} onPick={() => {}} onClose={() => {}} />);
  await settle();
  tap(screen.getByRole('tab', { name: 'Sam' }));
  expect(screen.getByRole('button', { name: 'Hill Giant' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Soldier/ })).toBeNull();
});

test('the list closes itself when the cast it belongs to is no longer the one on the table', async () => {
  const shown = cast('c-murder');
  act(() => useAppStore.setState({ game: table(shown) }));
  const onClose = vi.fn();
  render(<SpellTargetSheet caster={shown.seat} spell={shown.cards[0].name} revealId={shown.id}prompt={promptOf('c-murder')} onPick={() => {}} onClose={onClose} />);
  await settle();
  expect(onClose).not.toHaveBeenCalled();
  act(() => useAppStore.setState({ game: { ...game(), reveal: cast('c-bolt') } }));
  expect(onClose).toHaveBeenCalled();
  expect(screen.queryByRole('tab')).toBeNull();
});

test('a spell that searches the library opens the list: the card found goes where the spell says, the rest is shuffled', async () => {
  RECORDS['c-growth'] = rec(
    'c-growth',
    'Rampant Growth',
    'Sorcery',
    'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
  );
  casts('c-growth');
  await settle();
  expect(labels()).toEqual(['Search library…']);
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Search library…' }));
  await settle();
  const forest = screen.getByRole('button', { name: 'take Forest' });
  expect(forest).toHaveTextContent('×3');
  fireEvent.pointerDown(forest);
  fireEvent.pointerUp(forest);
  tap(screen.getByRole('button', { name: 'Done · shuffle the rest' }));
  const mine = game().players[0].cards!;
  expect(mine.library).toHaveLength(2);
  expect(mine.battlefield.find((c) => c.iid === 'l1')).toMatchObject({ tapped: true, row: 'lands' });
  expect(feed()).toContain(
    'Nathan searches their library (Rampant Growth), puts Forest onto the battlefield tapped and shuffles',
  );
  // One move at the table, and the spell has nothing left to ask.
  expect(screen.getByRole('button', { name: '✓ Search library' })).toBeDisabled();
});

test('closing the list unsearched leaves the button to press again', async () => {
  RECORDS['c-growth'] = rec(
    'c-growth',
    'Rampant Growth',
    'Sorcery',
    'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
  );
  casts('c-growth');
  await settle();
  pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Search library…' }));
  await settle();
  tap(screen.getByRole('button', { name: /close/i }));
  expect(game().players[0].cards!.library).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Search library…' })).toBeEnabled();
});
