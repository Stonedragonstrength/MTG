import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import { useCombatAim } from './components/useCombat';
import { _resetBackStack } from './lib/backstack';
import { liveCombat } from './lib/combat';
import { createGame } from './lib/game';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState } from './lib/types';
import { useAppStore } from './state/store';

// A whole combat on a two-player table, played on the screen the players touch: the REAL app,
// the real store and the real engine. Only the card database is stood in for.

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
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear', ['2', '2']),
  'c-giant': rec('c-giant', 'Hill Giant', 'Creature — Giant', ['3', '3']),
  'c-angel': rec('c-angel', 'Serra Angel', 'Creature — Angel', ['4', '4'], 'Flying, vigilance'),
  'c-wall': rec('c-wall', 'Wall of Omens', 'Creature — Wall', ['0', '4'], 'Defender'),
  'c-ogre': rec('c-ogre', 'Gray Ogre', 'Creature — Ogre', ['2', '2']),
  'c-forest': rec('c-forest', 'Forest', 'Basic Land — Forest', null, '({T}: Add {G}.)'),
};

vi.mock('./data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
  importBulkData: vi.fn(async () => 0),
}));

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

const onField = (iid: string, cardId: string, row: 'front' | 'lands' = 'front'): CardInstance => ({
  iid,
  cardId,
  name: RECORDS[cardId].name,
  row,
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

/** Nathan's turn. Nathan: a giant, an angel (vigilance), an ogre, a Forest and two soldiers.
 * Sam: a bear and a wall. */
function table(): GameState {
  const g = createGame(config);
  const seat = (battlefield: CardInstance[]) => ({
    library: [{ iid: `lib-${battlefield[0].iid}`, cardId: 'c-forest', name: 'Forest' }],
    hand: [],
    battlefield,
    graveyard: [],
    exile: [],
    command: [],
    mulligans: 0,
    deckName: 'Test',
    kept: true,
  });
  return {
    ...g,
    turnNumber: 4,
    players: [
      {
        ...g.players[0],
        board: [soldiers],
        cards: seat([onField('giant', 'c-giant'), onField('angel', 'c-angel'), onField('ogre', 'c-ogre'), onField('forest', 'c-forest', 'lands')]),
      },
      { ...g.players[1], cards: seat([onField('bear', 'c-bear'), onField('wall', 'c-wall')]) },
    ],
  };
}

const realInit = useAppStore.getState().init;
const store = () => useAppStore.getState();
const fight = () => liveCombat(store().game!);
const lives = () => store().game!.players.map((p) => p.life);
const feed = () => (store().game!.feed ?? []).map((f) => f.text);
const tappedOf = (seat: number) =>
  store()
    .game!.players[seat].cards!.battlefield.filter((c) => c.tapped)
    .map((c) => c.name);
const say = () => document.querySelector('.combat-say')?.textContent ?? null;
const focusedSeat = () => /seat-\d/.exec(document.querySelector('.zone--focused')!.className)![0];

/** A tap the way the table's cards hear it (they act when the finger lifts). */
function tap(el: Element) {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
}
async function sleep(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

beforeEach(() => {
  _resetBackStack();
  useCombatAim.setState({ combatId: null, target: null, attack: null });
  useAppStore.setState({
    // Boot straight into the game: the card database is "already downloaded".
    init: async () => {
      useAppStore.setState({ setupDone: true });
    },
    game: table(),
    inGame: true,
    online: null,
    log: [],
  });
});

afterEach(() => {
  cleanup(); // the screen first: nothing should re-render for the reset below
  useAppStore.setState({ init: realInit, game: null, inGame: false });
  document.querySelectorAll('.tap-shield').forEach((el) => el.remove());
});

test('a whole combat on a two-player table: declare, block, review, apply — and Undo steps back through it', async () => {
  render(<App />);

  // ---- 0. the Attack button rides the active seat's lands line
  const attack = await screen.findByRole('button', { name: 'attack' });
  expect(attack.closest('.zone')!.className).toContain('seat-0');
  expect(document.querySelector('.combat-bar')).toBeNull();
  await screen.findByRole('button', { name: 'tap Hill Giant' }); // nothing is a pick yet
  fireEvent.click(attack);

  // ---- 1. attackers, on Nathan's board
  expect(say()).toBe('Nathan: pick attackers');
  expect(focusedSeat()).toBe('seat-0');
  expect(screen.getByRole('button', { name: 'in combat' })).toBeDisabled();
  tap(await screen.findByRole('button', { name: 'attack with Hill Giant' }));
  tap(screen.getByRole('button', { name: 'attack with Serra Angel' }));
  tap(screen.getByRole('button', { name: /^Soldier/ }));
  tap(screen.getByRole('button', { name: /^Soldier/ }));
  tap(screen.getByRole('button', { name: /^Soldier/ })); // only two of them: the third tap adds nothing
  expect(tappedOf(0)).toEqual([]); // picking taps nothing
  tap(screen.getByRole('button', { name: 'Forest' })); // mana can be tapped mid-combat
  expect(tappedOf(0)).toEqual(['Forest']);
  expect(feed()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Attack (4)' }));

  // ---- 2. blockers: the big board is Sam's now
  await waitFor(() => expect(say()).toBe('Sam: block 4 from Nathan'));
  expect(focusedSeat()).toBe('seat-1');
  expect(tappedOf(0)).toEqual(['Hill Giant', 'Forest']); // the angel has vigilance
  expect(store().game!.players[0].board[0].tapped).toBe(2);
  expect(document.querySelector('.zone.seat-1 .chip-attack')).toHaveTextContent('⚔ 4');
  const sam = within(document.querySelector<HTMLElement>('.zone.seat-1')!);
  expect([...document.querySelectorAll('.strip-tile .strip-name')].map((el) => el.textContent)).toEqual([
    'Hill Giant',
    'Serra Angel',
    'Soldier',
  ]);
  tap(await sam.findByRole('button', { name: 'block with Wall of Omens' })); // the wall takes the lit one: the giant
  tap(sam.getByRole('button', { name: /^attacker 3: Soldier/ }));
  tap(sam.getByRole('button', { name: 'block with Grizzly Bears' })); // the bear takes a soldier
  expect(sam.getByRole('button', { name: /Wall of Omens blocks/ }).querySelector('.combat-mark')).toHaveTextContent('🛡1');
  expect(sam.getByRole('button', { name: /Grizzly Bears blocks/ }).querySelector('.combat-mark')).toHaveTextContent('🛡3');
  fireEvent.click(sam.getByRole('button', { name: 'Done (2)' }));

  // ---- 3. damage: back on Nathan's board
  expect(say()).toBe('Nathan’s attack: the damage');
  expect(focusedSeat()).toBe('seat-0');
  // the angel's 4 and one soldier's 1 get through; the other soldier dies to the bear
  await waitFor(() =>
    expect([...document.querySelectorAll('.combat-result li')].map((li) => li.textContent)).toEqual([
      'Sam −5',
      'Nathan: Soldier dies',
    ]),
  );
  expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument(); // a death: it goes through Review
  fireEvent.click(screen.getByRole('button', { name: 'Review…' }));
  const sheet = within(document.querySelector<HTMLElement>('.sheet')!);
  expect(sheet.getByLabelText('damage to Sam', { selector: '.review-value' })).toHaveTextContent('5');
  expect(sheet.getByLabelText("Nathan's Soldier dying", { selector: '.review-value' })).toHaveTextContent('1 dies');
  // For its first moment the sheet takes no tap as an answer: the other half of the tap on Review…
  fireEvent.click(sheet.getByRole('button', { name: 'Apply' }));
  expect(fight()?.step).toBe('damage');
  await sleep(400);
  // The table knows better than the app: a trick finished off the giant's blocker — the wall dies too.
  fireEvent.click(sheet.getByRole('checkbox', { name: "Sam's Wall of Omens dies" }));
  fireEvent.click(sheet.getByRole('button', { name: 'Apply' }));

  // ---- applied: life, graveyard and the feed are right, the bar is gone, the button is back
  expect(lives()).toEqual([40, 35]);
  expect(store().game!.players[1].cards!.graveyard.map((c) => c.name)).toEqual(['Wall of Omens']);
  expect(store().game!.players[0].board[0]).toMatchObject({ count: 1, tapped: 1 });
  expect(feed()).toEqual([
    'Nathan attacks Sam with 4 creatures',
    'Sam blocks 2 attackers',
    'Combat: Sam takes 5 · Wall of Omens and Soldier die',
  ]);
  expect(fight()).toBeNull();
  expect(document.querySelector('.sheet')).toBeNull();
  expect(document.querySelector('.combat-bar')).toBeNull();
  expect(document.querySelector('.chip-attack')).toBeNull();
  expect(screen.getByRole('button', { name: 'attack' })).toBeEnabled();

  // ---- Undo steps back through it, one move at a time
  const undo = () => fireEvent.click(screen.getByRole('button', { name: 'undo' }));
  undo(); // the apply
  expect(lives()).toEqual([40, 40]);
  expect(store().game!.players[1].cards!.graveyard).toEqual([]);
  expect(say()).toBe('Nathan’s attack: the damage');
  undo(); // Sam's Done
  expect(say()).toBe('Sam: block 4 from Nathan');
  expect(focusedSeat()).toBe('seat-1');
  expect(screen.getByRole('button', { name: 'Done (2)' })).toBeInTheDocument();
  undo(); // the bear's block
  expect(screen.getByRole('button', { name: 'Done (1)' })).toBeInTheDocument();
  undo(); // the wall's block
  expect(screen.getByRole('button', { name: 'No blocks' })).toBeInTheDocument();
  undo(); // the declaration: the attackers stand back up
  expect(say()).toBe('Nathan: pick attackers');
  expect(focusedSeat()).toBe('seat-0');
  expect(tappedOf(0)).toEqual(['Forest']);
  expect(screen.getByRole('button', { name: 'Attack (4)' })).toBeInTheDocument();
  undo(); // the Forest
  for (let i = 0; i < 4; i++) undo(); // the four picks
  expect(screen.getByRole('button', { name: 'Attack (0)' })).toBeInTheDocument();
  undo(); // the Attack press itself
  expect(document.querySelector('.combat-bar')).toBeNull();
  expect(store().game!.combat).toBeUndefined();
  expect(screen.getByRole('button', { name: 'attack' })).toBeEnabled();
});
