import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import { spellPrompts } from '../lib/spellEffects';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldCardSheet from './BattlefieldCardSheet';
import CrewSheet from './CrewSheet';
import SpellTargetSheet from './SpellTargetSheet';

// Crew from the card's hold sheet; ward's question in a spell's target list.

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

function rec(id: string, name: string, typeLine: string, oracleText = '', size: [string, string] | null = null): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '{2}',
    power: size?.[0] ?? null,
    toughness: size?.[1] ?? null,
    colors: [],
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-island': rec('c-island', 'Island', 'Basic Land — Island', '({T}: Add {U}.)'),
  'c-copter': rec('c-copter', "Smuggler's Copter", 'Artifact — Vehicle', 'Flying\nCrew 3', ['3', '3']),
  'c-bears': rec('c-bears', 'Grizzly Bears', 'Creature — Bear', '', ['2', '2']),
  'c-elves': rec('c-elves', 'Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.', ['1', '1']),
  'c-throne': rec('c-throne', 'Roaming Throne', 'Artifact Creature — Golem', 'Ward {2}', ['4', '4']),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
  findCardsNamed: vi.fn(async () => []),
}));

const c = (iid: string, cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name, ...more });

function table(mine: CardInstance[], theirs: CardInstance[] = []): GameState {
  const g = createGame(config);
  const seat = (bf: CardInstance[]) => ({ library: [], hand: [], battlefield: bf, graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'Test' });
  return { ...g, players: [{ ...g.players[0], cards: seat(mine) }, { ...g.players[1], cards: seat(theirs) }] };
}

/** A deliberate tap, well after a sheet has opened. */
function tap(el: Element) {
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(click, 'timeStamp', { value: Date.now() + 1000 });
  fireEvent(el, click);
}

const crewVehicle = vi.fn();
const payWard = vi.fn(async () => {});
const counterSpell = vi.fn();

beforeEach(() => {
  crewVehicle.mockClear();
  payWard.mockClear();
  counterSpell.mockClear();
  useAppStore.setState({ online: null, crewVehicle, payWard, counterSpell });
});

test('a Vehicle’s hold sheet offers "Crew 3…"', async () => {
  useAppStore.setState({ game: table([c('v', 'c-copter'), c('b', 'c-bears')]) });
  render(<BattlefieldCardSheet playerIdx={0} iid="v" onClose={() => {}} />);
  expect(await screen.findByRole('button', { name: 'Crew 3…' })).toBeInTheDocument();
});

test('the crew list adds up power; Crew taps the ones picked', async () => {
  useAppStore.setState({ game: table([c('v', 'c-copter'), c('b', 'c-bears'), c('e', 'c-elves'), c('t', 'c-bears', { tapped: true })]) });
  const onClose = vi.fn();
  render(<CrewSheet playerIdx={0} iid="v" crew={3} onClose={onClose} />);
  const bears = await screen.findByRole('button', { name: 'crew with Grizzly Bears' });
  // The tapped Bears cannot crew: one row of them only.
  expect(screen.getAllByRole('button', { name: 'crew with Grizzly Bears' })).toHaveLength(1);
  tap(bears);
  expect(screen.getByText('Power 2 of 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Crew anyway' })).toBeInTheDocument();
  tap(screen.getByRole('button', { name: 'crew with Llanowar Elves' }));
  expect(screen.getByText('Power 3 of 3')).toBeInTheDocument();
  tap(screen.getByRole('button', { name: /^Crew$/ }));
  expect(crewVehicle).toHaveBeenCalledWith(0, 'v', [
    { kind: 'card', id: 'b', n: 1 },
    { kind: 'card', id: 'e', n: 1 },
  ]);
  expect(onClose).toHaveBeenCalled();
});

const murder = spellPrompts({ typeLine: 'Instant', oracleText: 'Destroy target creature.' })[0];

test('pointing a spell at somebody else’s creature with ward asks for its price: paid, it goes ahead', async () => {
  const g = table([c('i1', 'c-island', { row: 'lands' }), c('i2', 'c-island', { row: 'lands' })], [c('t', 'c-throne'), c('b', 'c-bears')]);
  useAppStore.setState({ game: { ...g, stack: [{ id: 's1', seat: 0, iid: 'm', cardId: 'murder', name: 'Murder', to: 'graveyard', turn: g.turnNumber, active: g.activePlayerIndex, reveal: 'r1' }], reveal: { id: 'r1', seat: 0, from: 'cast', cards: [{ cardId: 'murder', name: 'Murder' }], t: Date.now() } } });
  const onPick = vi.fn();
  render(<SpellTargetSheet caster={0} spell="Murder" revealId="r1" prompt={murder} onPick={onPick} onClose={() => {}} />);
  const throne = await screen.findByRole('button', { name: 'Roaming Throne' });
  expect(throne).toHaveTextContent('ward {2}');
  tap(throne);
  expect(onPick).not.toHaveBeenCalled();
  expect(screen.getByText(/Murder is countered unless Nathan pays/)).toBeInTheDocument();
  tap(screen.getByRole('button', { name: 'Pay {2}' }));
  expect(payWard).toHaveBeenCalledWith(0, { mana: 2, life: 0 }, 'Roaming Throne', 'Murder');
  // Paid first, then the spell does it.
  await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith({ seat: 1, kind: 'card', id: 't' }));
});

test('not paid, the spell is countered by the ward', async () => {
  const g = table([], [c('t', 'c-throne')]);
  useAppStore.setState({ game: { ...g, stack: [{ id: 's1', seat: 0, iid: 'm', cardId: 'murder', name: 'Murder', to: 'graveyard', turn: g.turnNumber, active: g.activePlayerIndex, reveal: 'r1' }], reveal: { id: 'r1', seat: 0, from: 'cast', cards: [{ cardId: 'murder', name: 'Murder' }], t: Date.now() } } });
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<SpellTargetSheet caster={0} spell="Murder" revealId="r1" prompt={murder} onPick={onPick} onClose={onClose} />);
  tap(await screen.findByRole('button', { name: 'Roaming Throne' }));
  expect(screen.getByText('Your untapped mana can’t cover it.')).toBeInTheDocument();
  tap(screen.getByRole('button', { name: 'Don’t pay' }));
  expect(counterSpell).toHaveBeenCalledWith(1, "Roaming Throne's ward", 's1');
  expect(onPick).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test('your own creature with ward asks nothing', async () => {
  useAppStore.setState({ game: table([c('t', 'c-throne')]) });
  const onPick = vi.fn();
  const pump = spellPrompts({ typeLine: 'Instant', oracleText: 'Target creature gets +3/+3 until end of turn.' })[0];
  render(<SpellTargetSheet caster={0} spell="Giant Growth" prompt={pump} onPick={onPick} onClose={() => {}} />);
  tap(await screen.findByRole('button', { name: /Roaming Throne/ }));
  expect(onPick).toHaveBeenCalledWith({ seat: 0, kind: 'card', id: 't' });
});
