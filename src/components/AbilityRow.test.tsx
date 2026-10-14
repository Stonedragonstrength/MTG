import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { createGame } from '../lib/game';
import type { CardInstance, CardRecord, GameConfig, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldCardSheet from './BattlefieldCardSheet';

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

function rec(id: string, name: string, typeLine: string, oracleText: string, pt: [string, string] | null = null): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '',
    power: pt?.[0] ?? null,
    toughness: pt?.[1] ?? null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const RECORDS: Record<string, CardRecord> = {
  'c-mountain': rec('c-mountain', 'Mountain', 'Basic Land — Mountain', '({T}: Add {R}.)'),
  'c-swallower': rec('c-swallower', 'Ember Swallower', 'Creature — Elemental', '{5}{R}{R}: Monstrosity 3.\nWhen this creature becomes monstrous, each player sacrifices three lands.', ['4', '5']),
  'c-shade': rec('c-shade', 'Fire Shade', 'Creature — Shade', '{R}: This creature gets +1/+0 until end of turn.', ['1', '1']),
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

const card = (iid: string, cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name, ...more });

function table(mountains: number, creatures: CardInstance[]): GameState {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: {
      library: [],
      hand: [],
      battlefield: [...Array.from({ length: mountains }, (_, i) => card(`m${i}`, 'c-mountain', { row: 'lands' })), ...creatures],
      graveyard: [],
      exile: [],
      command: [],
      mulligans: 0,
      deckName: 'Test',
    },
  };
  return g;
}

const activateAbility = vi.fn(async () => {});
beforeEach(() => {
  activateAbility.mockClear();
  useAppStore.setState({ online: null, activateAbility });
});

test('a creature’s own ability is on its sheet: what it costs, what it does, and Use — paid from the lands', async () => {
  useAppStore.setState({ game: table(7, [card('e1', 'c-swallower')]) });
  render(<BattlefieldCardSheet playerIdx={0} iid="e1" onClose={() => {}} />);
  expect(await screen.findByText('Abilities')).toBeInTheDocument();
  const row = screen.getByText('Monstrosity 3').closest('.ability-row') as HTMLElement;
  expect(within(row).getByRole('img', { name: '5 of any color' })).toBeInTheDocument();
  await waitFor(() => expect(within(row).getByRole('button', { name: 'Use' })).toBeEnabled());
  fireEvent.click(within(row).getByRole('button', { name: 'Use' }));
  expect(activateAbility).toHaveBeenCalledWith(0, 'e1', '0:monstrosity', {});
});

test('short of mana it says so, and goes ahead without paying', async () => {
  useAppStore.setState({ game: table(2, [card('e1', 'c-swallower')]) });
  render(<BattlefieldCardSheet playerIdx={0} iid="e1" onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Use without paying' }));
  expect(activateAbility).toHaveBeenCalledWith(0, 'e1', '0:monstrosity', { free: true });
});

test('monstrous already: Monstrosity says why it does nothing, and cannot be pressed', async () => {
  useAppStore.setState({ game: table(7, [card('e1', 'c-swallower', { counters: { p1p1: 3, monstrous: 1 } })]) });
  render(<BattlefieldCardSheet playerIdx={0} iid="e1" onClose={() => {}} />);
  expect(await screen.findByRole('button', { name: 'It is monstrous already.' })).toBeDisabled();
});

test('a creature with nothing of the kind has no Abilities section', async () => {
  const g = table(1, [card('e1', 'c-swallower')]);
  useAppStore.setState({ game: g });
  render(<BattlefieldCardSheet playerIdx={0} iid="m0" onClose={() => {}} />);
  await screen.findByRole('heading', { name: 'Mountain' });
  expect(screen.queryByText('Abilities')).not.toBeInTheDocument();
});
