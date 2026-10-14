import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { keywordsNow } from '../lib/attach';
import { isSummoningSick } from '../lib/keywords';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import TriggerBanner from './TriggerBanner';
import { _resetTriggers, useTriggers } from './useTriggers';

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

function rec(id: string, name: string, typeLine: string, oracleText = '', more: Partial<CardRecord> = {}): CardRecord {
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
    isBasicLand: false,
    ...more,
  };
}

const SOLDIER = rec('t-soldier', 'Soldier', 'Token Creature — Soldier', '', { power: '1', toughness: '1', colors: ['W'], isToken: true });
const RECORDS: Record<string, CardRecord> = {
  storm: rec('storm', 'Encroaching Dragonstorm', 'Enchantment', "When a Dragon you control enters, return this enchantment to its owner's hand."),
  dragon: rec('dragon', 'Shivan Dragon', 'Creature — Dragon', 'Flying', { power: '5', toughness: '5' }),
  bear: rec('bear', 'Grizzly Bears', 'Creature — Bear', '', { power: '2', toughness: '2' }),
  warden: rec('warden', 'Soul Warden', 'Creature — Human Cleric', 'Whenever another creature enters, you gain 1 life.'),
  visionary: rec('visionary', 'Elvish Visionary', 'Creature — Elf Shaman', 'When this creature enters, draw a card.'),
  priest: rec('priest', 'Suture Priest', 'Creature — Phyrexian Cleric', 'Whenever another creature you control enters, you may gain 1 life.'),
  cobra: rec('cobra', 'Lotus Cobra', 'Creature — Snake', 'Landfall — Whenever a land you control enters, add one mana of any color.'),
  forest: rec('forest', 'Forest', 'Basic Land — Forest', '({T}: Add {G}.)'),
  rally: rec('rally', 'Endless Rally', 'Enchantment', 'Whenever a creature you control enters, create a 1/1 white Soldier creature token.'),
  [SOLDIER.id]: SOLDIER,
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
  findCardsNamed: vi.fn(async (name: string) => (name === 'Soldier' ? [SOLDIER] : [])),
}));

const card = (iid: string, cardId: string): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name });

/** Nathan's side: those cards on the battlefield, those in hand, a library of Forests. */
function start(battlefield: CardInstance[], hand: CardInstance[] = [], board: BoardItem[] = []) {
  useAppStore.getState().startGame(config);
  const g = useAppStore.getState().game!;
  const game: GameState = {
    ...g,
    players: [
      {
        ...g.players[0],
        board,
        cards: {
          library: [card('l1', 'forest'), card('l2', 'forest'), card('l3', 'forest')],
          hand,
          battlefield,
          graveyard: [],
          exile: [],
          command: [],
          mulligans: 0,
          deckName: 'Test',
          kept: true,
        },
      },
      g.players[1],
    ],
  };
  useAppStore.setState({ game });
}

const mine = () => useAppStore.getState().game!.players[0];
const shown = () => useTriggers.getState().shown;
/** A while for the lookups behind a trigger to answer: nothing more is coming. */
const quiet = () => act(() => new Promise((r) => setTimeout(r, 60)));

beforeEach(() => {
  _resetTriggers();
});

test('a Dragon entering sends the Dragonstorm back to hand by itself, and the banner says so', async () => {
  start([card('s1', 'storm')], [card('h1', 'dragon')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(mine().cards!.hand.map((c) => c.name)).toEqual(['Encroaching Dragonstorm']));
  expect(mine().cards!.battlefield.map((c) => c.name)).toEqual(['Shivan Dragon']);
  expect(useAppStore.getState().game!.feed?.at(-1)?.text).toBe('Encroaching Dragonstorm returns to Nathan’s hand');

  render(<TriggerBanner />);
  const banner = screen.getByRole('status', { name: 'triggered' });
  expect(within(banner).getByText('Encroaching Dragonstorm')).toBeInTheDocument();
  expect(within(banner).getByText('Shivan Dragon entered')).toBeInTheDocument();
  expect(within(banner).getByRole('button', { name: '✓ Return it to hand' })).toBeDisabled();
});

test('a bear entering does not: the Dragonstorm waits for a Dragon', async () => {
  start([card('s1', 'storm')], [card('h1', 'bear')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await quiet();
  expect(mine().cards!.battlefield.map((c) => c.name)).toEqual(['Encroaching Dragonstorm', 'Grizzly Bears']);
  expect(shown()).toEqual([]);
});

test('"When this creature enters, draw a card": the card is drawn as it lands', async () => {
  start([], [card('h1', 'visionary')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(mine().cards!.hand.map((c) => c.iid)).toEqual(['l1']));
  expect(shown()[0].acts).toMatchObject([{ label: 'Draw 1', done: true }]);
});

test('three tokens entering at once gain Soul Warden’s life three times', async () => {
  start([card('w1', 'warden')]);
  act(() => useAppStore.getState().addItem(0, { id: 'soldiers', cardId: SOLDIER.id, name: 'Soldier', imageNormal: null, imageArtCrop: null, typeLine: SOLDIER.typeLine, oracleText: '', basePower: 1, baseToughness: 1, count: 3, counters: {}, color: null, zone: 'board' }));
  await waitFor(() => expect(mine().life).toBe(43));
  expect(shown()[0]).toMatchObject({ because: 'Soldier ×3 entered', acts: [{ label: 'Gain 3 life', done: true }] });
});

test('"you may" waits for its button; a tap on it does it', async () => {
  start([card('p1', 'priest')], [card('h1', 'bear')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(shown()).toHaveLength(1));
  expect(mine().life).toBe(40);
  render(<TriggerBanner />);
  const gain = screen.getByRole('button', { name: 'Gain 1 life' });
  expect(gain).toBeEnabled();
  await act(() => new Promise((r) => setTimeout(r, 400))); // a tap in its first moment is not taken
  await userEvent.click(gain);
  expect(mine().life).toBe(41);
  expect(screen.getByRole('button', { name: '✓ Gain 1 life' })).toBeDisabled();
});

test('a card waiting for something else is shown even with nothing to press: the trigger people forget', async () => {
  start([card('c1', 'cobra')], [card('h1', 'forest')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(shown()).toHaveLength(1));
  render(<TriggerBanner />);
  expect(screen.getByText('Lotus Cobra')).toBeInTheDocument();
  expect(screen.getByText('Forest entered')).toBeInTheDocument();
  expect(screen.getByText(/add one mana of any color/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('an Undo of what entered takes its trigger away', async () => {
  start([card('p1', 'priest')], [card('h1', 'bear')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(shown()).toHaveLength(1));
  act(() => useAppStore.getState().undo());
  expect(shown()).toEqual([]);
});

test('a card coming back by an Undo has not entered: nothing goes off', async () => {
  start([card('w1', 'warden'), card('b1', 'bear')]);
  act(() => useAppStore.getState().moveVirtualCard(0, 'b1', 'battlefield', 'graveyard'));
  act(() => useAppStore.getState().undo());
  await quiet();
  expect(mine().cards!.battlefield.map((c) => c.iid)).toEqual(['w1', 'b1']);
  expect(shown()).toEqual([]);
  expect(mine().life).toBe(40);
});

test('triggers setting off triggers stop by themselves after a few rounds; the next waits for a tap', async () => {
  start([card('r1', 'rally')], [card('h1', 'bear')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(mine().board.find((it) => it.name === 'Soldier')?.count).toBe(4));
  await quiet();
  expect(mine().board.find((it) => it.name === 'Soldier')?.count).toBe(4);
  const last = shown().at(-1)!;
  expect(last.acts).toMatchObject([{ label: 'Make a Soldier', done: false }]);
});

test('a tap on the banner puts it away', async () => {
  start([card('c1', 'cobra')], [card('h1', 'forest')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(shown()).toHaveLength(1));
  render(<TriggerBanner />);
  await act(() => new Promise((r) => setTimeout(r, 400)));
  await userEvent.click(screen.getByRole('status', { name: 'triggered' }));
  expect(screen.queryByRole('status', { name: 'triggered' })).not.toBeInTheDocument();
});

// ---- more than entering ----

Object.assign(RECORDS, {
  arena: rec('arena', 'Phyrexian Arena', 'Enchantment', 'At the beginning of your upkeep, you draw a card and you lose 1 life.'),
  cutthroat: rec('cutthroat', 'Zulaport Cutthroat', 'Creature — Human Rogue', 'Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.'),
  hellrider: rec('hellrider', 'Hellrider', 'Creature — Devil', 'Whenever you attack, each opponent loses 1 life.'),
  prayer: rec('prayer', 'Prayerful Monk', 'Creature — Human Monk', 'Whenever you cast a noncreature spell, you gain 1 life.'),
  bolt: rec('bolt', 'Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.'),
  wish: rec('wish', 'Dying Wish', 'Creature — Spirit', "When this creature dies, return it to its owner's hand."),
});
const theirs = () => useAppStore.getState().game!.players[1];

test('"At the beginning of your upkeep, you draw a card and you lose 1 life" happens when the turn comes round — and the turn’s own draw is still owed', async () => {
  start([card('a1', 'arena')]);
  act(() => useAppStore.getState().passTurn()); // Sam's turn: not Nathan's upkeep
  await quiet();
  expect(mine().cards!.hand).toEqual([]);
  act(() => useAppStore.getState().passTurn()); // Nathan's again
  await waitFor(() => expect(mine().cards!.hand.map((c) => c.iid)).toEqual(['l1']));
  await waitFor(() => expect(mine().life).toBe(39));
  const g = useAppStore.getState().game!;
  expect(mine().cards!.drew?.turn === g.turnNumber && mine().cards!.drew?.active === 0).toBe(false);
  expect(shown()[0]).toMatchObject({ because: 'Nathan’s turn began' });
});

test('a creature dying sets off the cards watching deaths', async () => {
  start([card('z1', 'cutthroat'), card('b1', 'bear')]);
  act(() => useAppStore.getState().sacrificeCard(0, 'b1'));
  await waitFor(() => expect(theirs().life).toBe(39));
  await waitFor(() => expect(mine().life).toBe(41));
  expect(shown()[0]).toMatchObject({ because: 'Grizzly Bears died' });
});

test('"When this creature dies, return it to its owner’s hand": back from the graveyard by itself', async () => {
  start([card('w1', 'wish')]);
  act(() => useAppStore.getState().moveVirtualCard(0, 'w1', 'battlefield', 'graveyard'));
  await waitFor(() => expect(mine().cards!.hand.map((c) => c.iid)).toEqual(['w1']));
  expect(useAppStore.getState().game!.feed?.at(-1)?.text).toBe('Dying Wish returns to Nathan’s hand');
});

test('declaring an attack sets off "whenever you attack"', async () => {
  start([card('h1', 'hellrider'), card('b1', 'bear')]);
  act(() => useAppStore.getState().startCombat());
  act(() => useAppStore.getState().setAttacker({ kind: 'card', id: 'b1' }, 1, 1));
  await quiet();
  expect(theirs().life).toBe(40); // picked is not declared
  await act(() => useAppStore.getState().confirmAttackers());
  await waitFor(() => expect(theirs().life).toBe(39));
});

test('casting a noncreature spell sets off the cards waiting for one; a creature spell does not', async () => {
  start([card('p1', 'prayer')], [card('h1', 'bolt'), card('h2', 'bear')]);
  await act(() => useAppStore.getState().playCard(0, 'h2'));
  await quiet();
  expect(mine().life).toBe(40);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(mine().life).toBe(41));
  expect(shown().at(-1)).toMatchObject({ because: 'Lightning Bolt was cast' });
});

// ---- combat damage and life gained ----

Object.assign(RECORDS, {
  pridemate: rec('pridemate', "Ajani's Pridemate", 'Creature — Cat Soldier', 'Whenever you gain life, put a +1/+1 counter on this creature.'),
  blade: rec('blade', 'Scholar’s Blade', 'Artifact — Equipment', 'Whenever equipped creature deals combat damage to a player, you draw a card.\nEquip {2}'),
});
const counter = (iid: string) => mine().cards!.battlefield.find((c) => c.iid === iid)?.counters?.p1p1 ?? 0;

test('three taps on + are one gain of 3: "whenever you gain life" goes off once', async () => {
  start([card('a1', 'pridemate')]);
  act(() => {
    useAppStore.getState().adjustLife(0, 1);
    useAppStore.getState().adjustLife(0, 1);
    useAppStore.getState().adjustLife(0, 1);
  });
  await waitFor(() => expect(counter('a1')).toBe(1), { timeout: 3000 });
  await act(() => new Promise((r) => setTimeout(r, 1500)));
  expect(counter('a1')).toBe(1);
  expect(shown()).toHaveLength(1);
  expect(shown()[0]).toMatchObject({ because: 'Nathan gained 3 life' });
});

test('a + taken back by a − is no gain at all', async () => {
  start([card('a1', 'pridemate')]);
  act(() => {
    useAppStore.getState().adjustLife(0, 1);
    useAppStore.getState().adjustLife(0, -1);
  });
  await act(() => new Promise((r) => setTimeout(r, 1600)));
  expect(counter('a1')).toBe(0);
  expect(shown()).toEqual([]);
});

test('an unblocked creature hitting a player sets off what it wears: the Equipment draws', async () => {
  start([card('b1', 'bear'), { ...card('e1', 'blade'), on: { seat: 0, kind: 'card', id: 'b1' } }]);
  const store = () => useAppStore.getState();
  act(() => store().startCombat());
  act(() => store().setAttacker({ kind: 'card', id: 'b1' }, 1, 1));
  await act(() => store().confirmAttackers());
  act(() => store().finishBlocks(1)); // Sam blocks nothing
  await quiet();
  expect(mine().cards!.hand).toEqual([]);
  act(() => store().applyCombat({ players: [{ seat: 1, life: -2 }], deaths: [] }));
  await waitFor(() => expect(mine().cards!.hand.map((c) => c.iid)).toEqual(['l1']));
  expect(shown().at(-1)).toMatchObject({ because: 'Grizzly Bears dealt combat damage to a player' });
});

test('a blocked creature hits nobody: nothing goes off', async () => {
  start([card('b1', 'bear'), { ...card('e1', 'blade'), on: { seat: 0, kind: 'card', id: 'b1' } }]);
  const g = useAppStore.getState().game!;
  useAppStore.setState({
    game: { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, cards: { ...mine().cards!, library: [], hand: [], battlefield: [card('w9', 'bear')] } } : p)) },
  });
  const store = () => useAppStore.getState();
  act(() => store().startCombat());
  act(() => store().setAttacker({ kind: 'card', id: 'b1' }, 1, 1));
  await act(() => store().confirmAttackers());
  act(() => store().setBlocker(1, { kind: 'card', id: 'b1' }, { kind: 'card', id: 'w9' }, 1));
  act(() => store().finishBlocks(1));
  act(() => store().applyCombat({ players: [], deaths: [] }));
  await quiet();
  expect(mine().cards!.hand).toEqual([]);
});

test('a trampler’s damage past its blocker is a hit: Apply passes it on, and what it wears goes off', async () => {
  start([card('b1', 'bear'), { ...card('e1', 'blade'), on: { seat: 0, kind: 'card', id: 'b1' } }]);
  const g = useAppStore.getState().game!;
  useAppStore.setState({
    game: { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, cards: { ...mine().cards!, library: [], hand: [], battlefield: [card('w9', 'bear')] } } : p)) },
  });
  const store = () => useAppStore.getState();
  // Each step's card lookups are let finish before the next: started all at
  // once, vitest can hand a dynamic import the real card module instead of
  // the mock above, and then nothing is read.
  act(() => store().startCombat());
  await quiet();
  act(() => store().setAttacker({ kind: 'card', id: 'b1' }, 1, 1));
  await act(() => store().confirmAttackers());
  await quiet();
  act(() => store().setBlocker(1, { kind: 'card', id: 'b1' }, { kind: 'card', id: 'w9' }, 1));
  act(() => store().finishBlocks(1));
  await quiet();
  // Blocked, yet 3 went through (the review says which attacker it was).
  act(() => store().applyCombat({ players: [{ seat: 1, life: -3 }], deaths: [] }, [{ kind: 'card', id: 'b1' }]));
  await waitFor(() => expect(mine().cards!.hand.map((c) => c.iid)).toEqual(['l1']));
});

// ---- until end of turn, by a trigger ----

Object.assign(RECORDS, {
  guide: rec('guide', 'Chasm Guide', 'Creature — Human Scout Ally', 'Rally — Whenever this creature or another Ally you control enters, creatures you control gain haste until end of turn.'),
  banner: rec('banner', 'Rallying Banner', 'Enchantment', 'Whenever you attack, creatures you control get +1/+0 until end of turn.'),
});

test('"creatures you control gain haste until end of turn": what arrived this turn may attack this turn', async () => {
  start([{ ...card('b1', 'bear'), sick: true }], [card('h1', 'guide')]);
  const bear = () => mine().cards!.battlefield.find((c) => c.iid === 'b1')!;
  expect(isSummoningSick(bear(), RECORDS.bear, [], keywordsNow(useAppStore.getState().game!, { seat: 0, kind: 'card', id: 'b1' }, RECORDS))).toBe(true);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(bear().boost?.keywords).toEqual(['haste']));
  const g = useAppStore.getState().game!;
  expect(isSummoningSick(bear(), RECORDS.bear, [], keywordsNow(g, { seat: 0, kind: 'card', id: 'b1' }, RECORDS))).toBe(false);
});

test('"Whenever you attack, creatures you control get +1/+0 until end of turn" happens by itself', async () => {
  start([card('k1', 'banner'), card('b1', 'bear')]);
  const store = () => useAppStore.getState();
  act(() => store().startCombat());
  await quiet();
  act(() => store().setAttacker({ kind: 'card', id: 'b1' }, 1, 1));
  await act(() => store().confirmAttackers());
  await waitFor(() => expect(mine().cards!.battlefield.find((c) => c.iid === 'b1')?.boost).toMatchObject({ power: 1, toughness: 0 }));
  expect(useAppStore.getState().game!.feed?.at(-1)?.text).toBe('Nathan’s Rallying Banner: creatures Nathan controls get +1/+0 until end of turn');
});

// ---- held in exile until it leaves ----

Object.assign(RECORDS, {
  oring: rec('oring', 'Oblivion Ring', 'Enchantment', "When this enchantment enters, exile another target nonland permanent.\nWhen this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control."),
  light: rec('light', 'Banishing Light', 'Enchantment', 'When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.'),
});

/** Sam's side: a bear. */
function samHas(iids: CardInstance[]) {
  const g = useAppStore.getState().game!;
  useAppStore.setState({
    game: { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, cards: { ...mine().cards!, library: [], hand: [], battlefield: iids } } : p)) },
  });
}
const sam = () => useAppStore.getState().game!.players[1].cards!;

test('Oblivion Ring: what it exiles is held; when it leaves, the card comes back by itself', async () => {
  start([], [card('h1', 'oring')]);
  samHas([card('s1', 'bear')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(shown()).toHaveLength(1));
  const row = shown()[0];
  expect(row.acts).toMatchObject([{ label: 'Exile a nonland permanent…', done: false, holds: true }]);
  // Its player picks Sam's bear.
  act(() => useTriggers.getState().carryOut(row.key, row.acts[0].key, { seat: 1, kind: 'card', id: 's1' }));
  await waitFor(() => expect(sam().exile.map((c) => [c.iid, c.held])).toEqual([['s1', { seat: 0, iid: 'h1' }]]));
  expect(useAppStore.getState().game!.feed?.at(-1)?.text).toBe('Nathan’s Oblivion Ring exiles Sam’s Grizzly Bears until it leaves the battlefield');
  // The ring is destroyed: the bear is back on Sam's side.
  await quiet();
  act(() => useAppStore.getState().moveVirtualCard(0, 'h1', 'battlefield', 'graveyard'));
  await waitFor(() => expect(sam().battlefield.map((c) => c.iid)).toEqual(['s1']));
  expect(sam().exile).toEqual([]);
  expect(sam().battlefield[0]).not.toHaveProperty('held');
  expect(useAppStore.getState().game!.feed?.at(-1)?.text).toBe('Grizzly Bears returns to the battlefield (Oblivion Ring left)');
});

test('Banishing Light ("until this leaves the battlefield") lets go the same way', async () => {
  start([], [card('h1', 'light')]);
  samHas([card('s1', 'bear')]);
  await act(() => useAppStore.getState().playCard(0, 'h1'));
  await waitFor(() => expect(shown()).toHaveLength(1));
  const row = shown()[0];
  act(() => useTriggers.getState().carryOut(row.key, row.acts[0].key, { seat: 1, kind: 'card', id: 's1' }));
  await waitFor(() => expect(sam().exile.map((c) => c.iid)).toEqual(['s1']));
  await quiet();
  act(() => useAppStore.getState().returnToHand(0, 'h1'));
  await waitFor(() => expect(sam().battlefield.map((c) => c.iid)).toEqual(['s1']));
  expect(shown().at(-1)).toMatchObject({ because: 'It left the battlefield', acts: [{ label: 'Return Grizzly Bears', done: true }] });
});

test('a card exiled by hand is held by nothing: the ring leaving brings nothing back', async () => {
  start([card('r1', 'oring')]);
  samHas([card('s1', 'bear')]);
  act(() => useAppStore.getState().moveVirtualCard(1, 's1', 'battlefield', 'exile'));
  await quiet();
  act(() => useAppStore.getState().moveVirtualCard(0, 'r1', 'battlefield', 'graveyard'));
  await quiet();
  expect(sam().exile.map((c) => c.iid)).toEqual(['s1']);
});

// ---- becoming monstrous, and Renown ----

Object.assign(RECORDS, {
  cyclops: rec('cyclops', 'Gluttonous Cyclops', 'Creature — Cyclops', '{5}{R}{R}: Monstrosity 3.\nWhen this creature becomes monstrous, you gain 3 life.', { power: '5', toughness: '4' }),
  maulers: rec('maulers', 'Rhox Maulers', 'Creature — Rhino Soldier', 'Trample\nRenown 2 (When this creature deals combat damage to a player, if it isn’t renowned, put two +1/+1 counters on it and it becomes renowned.)', { power: '4', toughness: '4' }),
});

test('"When this creature becomes monstrous" goes off as Monstrosity is used', async () => {
  start([card('c1', 'cyclops')]);
  const key = (await import('../lib/abilities')).abilitiesOf(RECORDS.cyclops)[0].key;
  await act(() => useAppStore.getState().activateAbility(0, 'c1', key, { free: true }));
  await waitFor(() => expect(mine().life).toBe(43));
  expect(shown()[0]).toMatchObject({ because: 'It became monstrous' });
});

test('Renown: the first hit on a player makes it renowned with its counters; the next does nothing more', async () => {
  start([card('r1', 'maulers')]);
  const store = () => useAppStore.getState();
  const hit = async () => {
    act(() => store().startCombat());
    await quiet();
    act(() => store().setAttacker({ kind: 'card', id: 'r1' }, 1, 1));
    await act(() => store().confirmAttackers());
    await quiet();
    act(() => store().finishBlocks(1));
    await quiet();
    act(() => store().applyCombat({ players: [{ seat: 1, life: -4 }], deaths: [] }, [{ kind: 'card', id: 'r1' }]));
  };
  await hit();
  const maulers = () => mine().cards!.battlefield.find((c) => c.iid === 'r1')!;
  await waitFor(() => expect(maulers().counters).toEqual({ p1p1: 2, renowned: 1 }));
  // A second fight that turn: renowned already.
  await quiet();
  act(() => store().untapAll(0));
  await hit();
  await act(() => new Promise((r) => setTimeout(r, 200)));
  expect(maulers().counters).toEqual({ p1p1: 2, renowned: 1 });
});

// ---- Undying, Persist, Evolve, Training ----

Object.assign(RECORDS, {
  geist: rec('geist', 'Geralf’s Messenger', 'Creature — Zombie', 'This creature enters tapped.\nUndying (When this creature dies, if it had no +1/+1 counters on it, return it to the battlefield under its owner’s control with a +1/+1 counter on it.)', { power: '3', toughness: '2' }),
  kitchen: rec('kitchen', 'Kitchen Finks', 'Creature — Ouphe', 'When this creature enters, you gain 2 life.\nPersist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner’s control with a -1/-1 counter on it.)', { power: '3', toughness: '2' }),
  shapeshifter: rec('shapeshifter', 'Cloudfin Raptor', 'Creature — Bird Mutant', 'Flying\nEvolve (Whenever a creature you control enters, if that creature has greater power or toughness than this creature, put a +1/+1 counter on this creature.)', { power: '0', toughness: '1' }),
  trainee: rec('trainee', 'Hopeful Initiate', 'Creature — Human Warlock', 'Training (Whenever this creature attacks with another creature with greater power, put a +1/+1 counter on this creature.)', { power: '1', toughness: '2' }),
  giantcard: rec('giantcard', 'Hill Giant', 'Creature — Giant', '', { power: '3', toughness: '3' }),
  mite: rec('mite', 'Mite', 'Creature — Insect', '', { power: '0', toughness: '1' }),
});
const field = () => mine().cards!.battlefield;
const on = (iid: string) => field().find((c) => c.iid === iid);

test('Undying: a creature that dies without a +1/+1 counter comes back with one; with one, it stays dead', async () => {
  start([card('u1', 'geist')]);
  act(() => useAppStore.getState().sacrificeCard(0, 'u1'));
  await waitFor(() => expect(on('u1')?.counters).toEqual({ p1p1: 1 }));
  expect(useAppStore.getState().game!.feed?.at(-1)?.text).toBe('Geralf’s Messenger returns to the battlefield with a +1/+1 counter (undying)');
  await quiet();
  act(() => useAppStore.getState().sacrificeCard(0, 'u1'));
  await quiet();
  await act(() => new Promise((r) => setTimeout(r, 100)));
  expect(on('u1')).toBeUndefined();
  expect(mine().cards!.graveyard.map((c) => c.iid)).toEqual(['u1']);
});

test('Persist: back with a -1/-1 counter, and it counts against its size', async () => {
  start([card('k1', 'kitchen')]);
  act(() => useAppStore.getState().moveVirtualCard(0, 'k1', 'battlefield', 'graveyard'));
  await waitFor(() => expect(on('k1')?.counters).toEqual({ m1m1: 1 }));
  const { readUnit } = await import('../lib/combatEngine');
  const g = useAppStore.getState().game!;
  const finks = readUnit(g, 0, { kind: 'card', id: 'k1' }, RECORDS);
  expect([finks?.power, finks?.toughness]).toEqual([2, 1]);
});

test('Evolve: a bigger creature coming in grows it; a smaller one does not', async () => {
  start([card('e1', 'shapeshifter')], [card('h1', 'giantcard'), card('h2', 'mite')]);
  await act(() => useAppStore.getState().playCard(0, 'h2')); // 0/1 is not bigger than 0/1
  await quiet();
  await act(() => new Promise((r) => setTimeout(r, 100)));
  expect(on('e1')?.counters).toBeUndefined();
  await act(() => useAppStore.getState().playCard(0, 'h1')); // 3/3 is
  await waitFor(() => expect(on('e1')?.counters).toEqual({ p1p1: 1 }));
});

test('Training: attacking beside a creature with greater power gives it a counter', async () => {
  start([card('t1', 'trainee'), card('g1', 'giantcard')]);
  const store = () => useAppStore.getState();
  act(() => store().startCombat());
  await quiet();
  act(() => store().setAttacker({ kind: 'card', id: 't1' }, 1, 1));
  act(() => store().setAttacker({ kind: 'card', id: 'g1' }, 1, 1));
  await act(() => store().confirmAttackers());
  await waitFor(() => expect(on('t1')?.counters).toEqual({ p1p1: 1 }));
});

test('Training alone does nothing', async () => {
  start([card('t1', 'trainee')]);
  const store = () => useAppStore.getState();
  act(() => store().startCombat());
  await quiet();
  act(() => store().setAttacker({ kind: 'card', id: 't1' }, 1, 1));
  await act(() => store().confirmAttackers());
  await quiet();
  await act(() => new Promise((r) => setTimeout(r, 100)));
  expect(on('t1')?.counters).toBeUndefined();
  expect(shown()).toEqual([]);
});
