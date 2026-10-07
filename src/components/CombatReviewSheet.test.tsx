import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../data/settings';
import { liveCombat } from '../lib/combat';
import { createGame } from '../lib/game';
import type { BoardItem, CardInstance, CardRecord, CombatUnit, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import CombatReviewSheet from './CombatReviewSheet';
import { useTableRecords } from './useCombat';

// Review through the real store: what the sheet shows, what a change does, and that Apply
// carries exactly what it shows.

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
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-bear': rec('c-bear', 'Grizzly Bears', 'Creature — Bear', ['2', '2']),
  'c-giant': rec('c-giant', 'Hill Giant', 'Creature — Giant', ['3', '3']),
  'c-hawk': rec('c-hawk', 'Vampire Nighthawk', 'Creature — Vampire Shaman', ['2', '3'], 'Flying\nDeathtouch\nLifelink'),
  'c-wall': rec('c-wall', 'Wall of Omens', 'Creature — Wall', ['0', '4'], 'Defender'),
  'c-atraxa': rec('c-atraxa', "Atraxa, Praetors' Voice", 'Legendary Creature — Phyrexian Angel Horror', ['4', '4'], 'Flying, vigilance, deathtouch, lifelink'),
  'c-skith': rec('c-skith', 'Skithiryx, the Blight Dragon', 'Legendary Creature — Phyrexian Dragon Skeleton', ['4', '4'], 'Flying\nInfect'),
  'c-wurm': rec('c-wurm', 'Craw Wurm', 'Creature — Wurm', ['6', '4']),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
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

const tokens = (id: string, name: string, count: number): BoardItem => ({
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
});

/** Nathan: Atraxa (his commander), a bear, a giant, a nighthawk, Skithiryx and four soldiers.
 * Sam: a bear, a wall, a wurm and two saprolings. Alex, when he is there: nothing on the tablet. */
function table(seats = 2): GameState {
  const g = createGame(config(seats));
  const seat = (battlefield: CardInstance[], cmd?: Record<string, number>) => ({
    library: [],
    hand: [],
    battlefield,
    graveyard: [],
    exile: [],
    command: [],
    mulligans: 0,
    deckName: 'Test',
    ...(cmd ? { cmd } : {}),
  });
  return {
    ...g,
    players: g.players.map((p, i) => {
      if (i === 0)
        return {
          ...p,
          board: [tokens('soldiers', 'Soldier', 4)],
          cards: seat(
            [
              onField('atraxa', 'c-atraxa'),
              onField('bear', 'c-bear'),
              onField('giant', 'c-giant'),
              onField('hawk', 'c-hawk'),
              onField('skith', 'c-skith'),
            ],
            { atraxa: 0 },
          ),
        };
      if (i === 1)
        return {
          ...p,
          board: [tokens('saprolings', 'Saproling', 2)],
          cards: seat([onField('sbear', 'c-bear'), onField('wall', 'c-wall'), onField('wurm', 'c-wurm')]),
        };
      return p; // a tracker seat with nothing on the tablet: its blockers are paper
    }),
  };
}

const card = (id: string): CombatUnit => ({ kind: 'card', id });
const stack = (id: string): CombatUnit => ({ kind: 'stack', id });
const store = () => useAppStore.getState();
const fight = () => liveCombat(store().game!);
const lives = () => store().game!.players.map((p) => p.life);
const graveyard = (seat: number) => store().game!.players[seat].cards!.graveyard.map((c) => c.name);

async function sleep(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

beforeEach(() => {
  useAppStore.setState({ game: table(), online: null, settings: { ...DEFAULT_SETTINGS } });
});

/** Declares `attackers` (unit → target), lets Sam block with `blocks`, and opens Review at
 * the damage step with every card read and the sheet's first quiet moment over. */
async function review(
  attackers: [CombatUnit, number, number?][],
  blocks: () => void = () => {},
  onClose: () => void = () => {},
) {
  store().startCombat();
  for (const [unit, target, n] of attackers) store().setAttacker(unit, target, n ?? 1);
  await store().confirmAttackers();
  blocks();
  while (fight()?.step === 'blockers') store().finishBlocks(fight()!.defender!);
  expect(fight()?.step).toBe('damage');
  const want = new Set(store().game!.players.flatMap((p) => (p.cards?.battlefield ?? []).map((c) => c.cardId)));
  const records = renderHook(() => useTableRecords());
  await waitFor(() => expect(Object.keys(records.result.current)).toHaveLength(want.size));
  records.unmount();
  const view = render(<CombatReviewSheet onClose={onClose} />);
  await sleep(400);
  return view;
}

const value = (what: string) => screen.getByLabelText(what, { selector: '.review-value' }).textContent;
const apply = () => fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

describe('what it shows', () => {
  test('per defender, one stepper for each commander hitting them and one for all the others: their sum is the life lost', async () => {
    await review([
      [card('atraxa'), 1],
      [card('bear'), 1],
      [card('giant'), 1],
    ]);
    expect(screen.getByText('Sam loses 9')).toBeInTheDocument();
    expect(value("damage to Sam from Atraxa, Praetors' Voice")).toBe('4');
    expect(value('damage to Sam')).toBe('5');
    expect(screen.getByText('From all the other attackers')).toBeInTheDocument();
    // lifelink is in the fight: the attacking player's gain is there
    expect(value('life gained by Nathan')).toBe('4');
    // no infect, no toxic: no poison stepper
    expect(screen.queryByLabelText('poison for Sam', { selector: '.review-value' })).not.toBeInTheDocument();
  });

  test('without a commander or lifelink in the fight there is one stepper, and nothing about gains', async () => {
    await review([[card('bear'), 1]]);
    expect(screen.getByText('Damage')).toBeInTheDocument();
    expect(value('damage to Sam')).toBe('2');
    expect(screen.queryByText('Life gained')).not.toBeInTheDocument();
  });

  test('poison has a stepper when infect is in the fight', async () => {
    await review([[card('skith'), 1]]);
    expect(screen.getByText('Sam loses 0')).toBeInTheDocument();
    expect(value('poison for Sam')).toBe('4');
    fireEvent.click(screen.getByRole('button', { name: 'more poison for Sam' }));
    apply();
    expect(store().game!.players[1].counters.poison).toBe(5);
    expect(lives()).toEqual([40, 40]);
  });

  test('EVERY attacker and blocker is listed with a "dies" tick, pre-set by the engine', async () => {
    await review(
      [
        [card('bear'), 1],
        [card('giant'), 1],
        [stack('soldiers'), 1, 3],
      ],
      () => {
        store().setBlocker(1, card('giant'), card('sbear'), 1); // the giant kills the bear
        store().setBlocker(1, card('bear'), card('wall'), 1); // the wall stops the other bear
        store().setBlocker(1, stack('soldiers'), stack('saprolings'), 2); // two trades
      },
    );
    const ticked = (name: string) => (screen.getByRole('checkbox', { name }) as HTMLInputElement).checked;
    expect(ticked("Nathan's Grizzly Bears dies")).toBe(false);
    expect(ticked("Nathan's Hill Giant dies")).toBe(false);
    expect(ticked("Sam's Grizzly Bears dies")).toBe(true);
    expect(ticked("Sam's Wall of Omens dies")).toBe(false);
    expect(value("Nathan's Soldier dying")).toBe('2 die');
    expect(value("Sam's Saproling dying")).toBe('2 die');
    // attackers first, each followed by what stood in its way
    expect([...document.querySelectorAll('.review-unit-name')].map((el) => el.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      '⚔ Grizzly Bears 2/2',
      '🛡 Wall of Omens 0/4',
      '⚔ Hill Giant 3/3',
      '🛡 Grizzly Bears 2/2',
      '⚔ Soldier 1/1 ×3',
      '🛡 Saproling 1/1 ×2',
    ]);
  });
});

describe('what a change does', () => {
  test('a death can be taken away, and one can be added: Apply carries exactly what the sheet shows', async () => {
    await review(
      [
        [card('bear'), 1],
        [card('giant'), 1],
      ],
      () => store().setBlocker(1, card('giant'), card('sbear'), 1),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: "Sam's Grizzly Bears dies" })); // a trick saved it
    fireEvent.click(screen.getByRole('checkbox', { name: "Nathan's Hill Giant dies" })); // …and killed the giant
    apply();
    expect(graveyard(0)).toEqual(['Hill Giant']);
    expect(graveyard(1)).toEqual([]);
    expect(lives()).toEqual([40, 38]); // the unblocked bear's 2
    expect(store().game!.feed!.at(-1)!.text).toBe('Combat: Sam takes 2 · Hill Giant dies');
    expect(fight()).toBeNull();
  });

  test('left alone, Apply applies the engine’s own result', async () => {
    await review(
      [
        [card('bear'), 1],
        [card('giant'), 1],
      ],
      () => store().setBlocker(1, card('giant'), card('sbear'), 1),
    );
    apply();
    expect(graveyard(0)).toEqual([]);
    expect(graveyard(1)).toEqual(['Grizzly Bears']);
    expect(lives()).toEqual([40, 38]);
  });

  test('the steppers move the damage and the gain, and never go below nothing', async () => {
    await review([
      [card('bear'), 1],
      [card('hawk'), 1],
    ]);
    expect(value('damage to Sam')).toBe('4');
    fireEvent.click(screen.getByRole('button', { name: 'more damage to Sam' })); // an anthem the app does not read
    fireEvent.click(screen.getByRole('button', { name: 'more damage to Sam' }));
    expect(value('damage to Sam')).toBe('6');
    expect(screen.getByText('Sam loses 6')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'more life gained by Nathan' }));
    expect(value('life gained by Nathan')).toBe('3');
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: 'less life gained by Nathan' }));
    expect(value('life gained by Nathan')).toBe('0');
    expect(screen.getByRole('button', { name: 'less life gained by Nathan' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'more life gained by Nathan' }));
    expect(value('life gained by Nathan')).toBe('1'); // back up from nothing, not from below it
    apply();
    expect(lives()).toEqual([41, 34]);
  });

  test('a stack’s dead are a number between nothing and the copies that fought', async () => {
    await review([[stack('soldiers'), 1, 3]], () => store().setBlocker(1, stack('soldiers'), stack('saprolings'), 1));
    expect(value("Nathan's Soldier dying")).toBe('1 dies');
    const more = screen.getByRole('button', { name: "one more of Nathan's Soldier dies" });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(value("Nathan's Soldier dying")).toBe('3 die');
    expect(more).toBeDisabled(); // only three attacked
    fireEvent.click(screen.getByRole('button', { name: "one fewer of Sam's Saproling dies" }));
    expect(screen.getByRole('button', { name: "one fewer of Sam's Saproling dies" })).toBeDisabled();
    apply();
    expect(store().game!.players[0].board[0]).toMatchObject({ count: 1 });
    expect(store().game!.players[0].board[0].tapped ?? 0).toBe(0); // the one that stayed home is not left tapped
    expect(store().game!.players[1].board[0]).toMatchObject({ count: 2 });
  });

  test('a dying commander has a second tick, "to the command zone (+2)", on by default', async () => {
    await review([[card('atraxa'), 1]], () => store().setBlocker(1, card('atraxa'), card('wurm'), 1)); // 6 damage: she dies
    expect(screen.getByRole('checkbox', { name: "Nathan's Atraxa, Praetors' Voice dies" })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Atraxa, Praetors' Voice goes to the command zone/ })).toBeChecked();
    expect(screen.getByText('to the command zone (+2)')).toBeInTheDocument();
    apply();
    expect(store().game!.players[0].cards!.command.map((c) => c.name)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(store().game!.players[0].cards!.cmd).toEqual({ atraxa: 1 });
    expect(graveyard(0)).toEqual([]);
  });

  test('…and with that tick off she goes to the graveyard; a creature that is no commander has no such tick', async () => {
    await review([[card('atraxa'), 1]], () => store().setBlocker(1, card('atraxa'), card('wurm'), 1));
    fireEvent.click(screen.getByRole('checkbox', { name: /goes to the command zone/ }));
    expect(screen.getAllByRole('checkbox', { name: /goes to the command zone/ })).toHaveLength(1); // not the wurm
    apply();
    expect(graveyard(0)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(store().game!.players[0].cards!.cmd).toEqual({ atraxa: 0 });
  });

  test('the second tick is only there while she dies', async () => {
    await review([[card('atraxa'), 1]]);
    expect(screen.queryByRole('checkbox', { name: /goes to the command zone/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: "Nathan's Atraxa, Praetors' Voice dies" }));
    expect(screen.getByRole('checkbox', { name: /goes to the command zone/ })).toBeChecked();
  });

  test('ANY attack can be ticked "blocked": a defender with nothing on the tablet never got to say so', async () => {
    useAppStore.setState({ game: table(3) });
    await review([
      [card('giant'), 2],
      [card('bear'), 2],
      [stack('soldiers'), 2, 2],
    ]);
    expect(fight()!.attacks!.some((a) => a.blocked || a.blockers)).toBe(false); // Alex was skipped as a defender
    expect(value('damage to Alex')).toBe('7');
    const giant = screen.getByRole('checkbox', { name: "Nathan's Hill Giant was blocked (Alex)" });
    expect(giant).not.toBeChecked();
    fireEvent.click(giant);
    expect(value('damage to Alex')).toBe('4'); // its 3 came off
    fireEvent.click(screen.getByRole('checkbox', { name: "Nathan's Soldier was blocked (Alex)" }));
    expect(value('damage to Alex')).toBe('2');
    fireEvent.click(giant); // not blocked after all
    expect(value('damage to Alex')).toBe('5');
    apply();
    expect(lives()).toEqual([40, 40, 35]);
  });

  test('an attack the tablet’s own blockers stopped is ticked and cannot be unticked', async () => {
    await review([[card('bear'), 1]], () => store().setBlocker(1, card('bear'), card('wall'), 1));
    const tick = screen.getByRole('checkbox', { name: "Nathan's Grizzly Bears was blocked" });
    expect(tick).toBeChecked();
    expect(tick).toBeDisabled();
  });

  test('it says so when the result would defeat a player', async () => {
    const g = table();
    useAppStore.setState({ game: { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, life: 3 } : p)) } });
    await review([[card('giant'), 1]]);
    expect(screen.getByRole('alert')).toHaveTextContent('This defeats Sam.');
    fireEvent.click(screen.getByRole('button', { name: 'less damage to Sam' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // 2 of his 3: he lives
  });
});

describe('when its fight is gone', () => {
  test('it closes itself for real once the result is applied', async () => {
    const onClose = vi.fn();
    await review([[card('bear'), 1]], undefined, onClose);
    expect(onClose).not.toHaveBeenCalled();
    apply();
    expect(onClose).toHaveBeenCalled();
    expect(document.querySelector('.sheet')).toBeNull();
  });

  test('…and when another device calls the fight off, or an Undo takes it back to the blockers', async () => {
    const onClose = vi.fn();
    await review([[card('bear'), 1]], undefined, onClose);
    act(() => store().undo()); // back to Sam choosing blockers
    expect(fight()?.step).toBe('blockers');
    expect(onClose).toHaveBeenCalled();
    expect(document.querySelector('.sheet')).toBeNull();
  });

  test('Back closes it and changes nothing', async () => {
    const onClose = vi.fn();
    await review([[card('bear'), 1]], undefined, onClose);
    const before = store().game;
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalled();
    expect(store().game).toBe(before);
  });

  test('a tap that arrives the moment it opens is nobody’s answer', async () => {
    store().startCombat();
    store().setAttacker(card('bear'), 1, 1);
    await store().confirmAttackers();
    store().finishBlocks(1);
    render(<CombatReviewSheet onClose={() => {}} />);
    fireEvent.click(within(document.querySelector<HTMLElement>('.sheet')!).getByRole('button', { name: 'Apply' }));
    expect(fight()?.step).toBe('damage'); // the other half of the tap that pressed Review
  });
});
