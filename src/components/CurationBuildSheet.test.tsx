import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { CardRecord, Deck, GarageCard } from '../lib/types';
import { useAppStore } from '../state/store';
import CurationBuildSheet from './CurationBuildSheet';

function record(id: string, name: string, typeLine: string, identity: string[], oracleText = ''): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: '',
    power: null,
    toughness: null,
    colors: identity,
    colorIdentity: identity,
    imageNormal: `https://img.example/${id}.jpg`,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const RECORDS: Record<string, CardRecord> = {
  elves: record('elves', 'Llanowar Elves', 'Creature — Elf Druid', ['G'], '{T}: Add {G}.'),
  bolt: record('bolt', 'Lightning Bolt', 'Instant', ['R'], 'Lightning Bolt deals 3 damage to any target.'),
  ashaya: record('ashaya', 'Ashaya, Soul of the Wild', 'Legendary Creature — Elemental', ['G']),
};
const krenko = record('krenko', 'Krenko, Mob Boss', 'Legendary Creature — Goblin', ['R']);

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => []),
  getCardById: vi.fn(async (id: string) => RECORDS[id]),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

vi.mock('../data/synergy', () => ({
  findCommandersFor: vi.fn(async () => [
    { card: krenko, score: 12, shared: ['tokens'] },
    { card: RECORDS.ashaya, score: 10, shared: ['ramp', 'lands'] },
  ]),
  findSynergiesFor: vi.fn(async () => []),
  findPartnersFor: vi.fn(async () => []),
}));

function row(cardId: string, name: string, count: number): GarageCard {
  return {
    cardId,
    name,
    typeLine: RECORDS[cardId]?.typeLine ?? 'x',
    imageNormal: null,
    count,
    updatedAt: 1,
    deleted: false,
    dirty: 0,
  };
}

let saved: Deck[];

beforeEach(() => {
  saved = [];
  useAppStore.setState({
    garage: [row('elves', 'Llanowar Elves', 3), row('bolt', 'Lightning Bolt', 2), row('ashaya', 'Ashaya', 1)],
    decks: [],
    saveDeck: vi.fn(async (d: Deck) => {
      saved.push(d);
    }),
  });
});

test('suggests commanders for the collection, owned ones first, with what you own for each', async () => {
  render(<CurationBuildSheet onClose={() => {}} />);
  const names = (await screen.findAllByRole('button', { name: /^start a deck with /i })).map((b) =>
    b.getAttribute('aria-label'),
  );
  // Ashaya scores a little lower but is IN the collection: 10 x 1.5 beats 12.
  expect(names).toEqual([
    'start a deck with Ashaya, Soul of the Wild',
    'start a deck with Krenko, Mob Boss',
  ]);
  expect(screen.getByText(/in your collection/i)).toBeInTheDocument();
  expect(screen.getByText(/you own 4 cards in its colors/i)).toBeInTheDocument(); // 3 elves + Ashaya
  expect(screen.getByText(/you own 2 cards in its colors/i)).toBeInTheDocument(); // the bolts
});

test('picking one starts a deck around that commander and hands back its id', async () => {
  const onStarted = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<CurationBuildSheet onClose={onClose} onStarted={onStarted} />);
  await user.click(await screen.findByRole('button', { name: /start a deck with Krenko/i }));
  expect(saved).toHaveLength(1);
  expect(saved[0].commander?.name).toBe('Krenko, Mob Boss');
  expect(saved[0].colors).toEqual(['R']);
  expect(onStarted).toHaveBeenCalledWith(saved[0].id);
});

test('an empty collection says so instead of scanning', async () => {
  useAppStore.setState({ garage: [] });
  render(<CurationBuildSheet onClose={() => {}} />);
  expect(await screen.findByText(/nothing in the curation yet/i)).toBeInTheDocument();
});
