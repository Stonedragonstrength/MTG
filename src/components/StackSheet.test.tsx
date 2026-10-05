import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { CardRecord } from '../lib/types';
import StackSheet from './StackSheet';

const bolt: CardRecord = {
  id: 'c-bolt',
  name: 'Lightning Bolt',
  nameLower: 'lightning bolt',
  typeLine: 'Instant',
  oracleText: 'Lightning Bolt deals 3 damage to any target.',
  manaCost: '{R}',
  power: null,
  toughness: null,
  colors: ['R'],
  colorIdentity: ['R'],
  imageNormal: 'https://img.example/bolt.jpg',
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
};

const greaves: CardRecord = {
  ...bolt,
  id: 'c-greaves',
  name: 'Lightning Greaves',
  nameLower: 'lightning greaves',
  typeLine: 'Artifact — Equipment',
  oracleText: 'Equipped creature has haste and shroud.',
  manaCost: '{2}',
};

vi.mock('../data/scryfall', () => ({
  loadNameIndex: vi.fn(async () => [
    { id: 'c-bolt', name: 'Lightning Bolt' },
    { id: 'c-greaves', name: 'Lightning Greaves' },
  ]),
  getCardById: vi.fn(async (id: string) =>
    id === 'c-bolt' ? bolt : id === 'c-greaves' ? greaves : undefined,
  ),
  findCardByName: vi.fn(async () => undefined),
  findBasicLand: vi.fn(async () => undefined),
}));

async function addSpell(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.type(screen.getByPlaceholderText(/spell or ability/i), name);
  await user.click(screen.getByRole('button', { name: /add to stack/i }));
}

test('the last thing added sits on top', async () => {
  const user = userEvent.setup();
  render(<StackSheet onClose={() => {}} />);
  await addSpell(user, 'Lightning Bolt');
  await addSpell(user, 'Counterspell');
  const items = screen.getAllByTestId('stack-item');
  expect(items[0].textContent).toContain('Counterspell');
  expect(items[0].textContent).toContain('resolves first');
  expect(items[1].textContent).toContain('Lightning Bolt');
});

test('resolve pops the top of the stack', async () => {
  const user = userEvent.setup();
  render(<StackSheet onClose={() => {}} />);
  await addSpell(user, 'Lightning Bolt');
  await addSpell(user, 'Counterspell');
  await user.click(screen.getByRole('button', { name: /resolve top/i }));
  const items = screen.getAllByTestId('stack-item');
  expect(items).toHaveLength(1);
  expect(items[0].textContent).toContain('Lightning Bolt');
});

test('countering removes a specific spell anywhere in the stack', async () => {
  const user = userEvent.setup();
  render(<StackSheet onClose={() => {}} />);
  await addSpell(user, 'Lightning Bolt');
  await addSpell(user, 'Counterspell');
  await user.click(screen.getByRole('button', { name: /remove lightning bolt/i }));
  const items = screen.getAllByTestId('stack-item');
  expect(items).toHaveLength(1);
  expect(items[0].textContent).toContain('Counterspell');
});

test('an empty stack explains itself', () => {
  render(<StackSheet onClose={() => {}} />);
  expect(screen.getByText(/stack is empty/i)).toBeInTheDocument();
});

test('typing suggests real card names and tapping one adds it', async () => {
  const user = userEvent.setup();
  render(<StackSheet onClose={() => {}} />);
  await user.type(screen.getByPlaceholderText(/spell or ability/i), 'lightn');
  await user.click(await screen.findByRole('button', { name: 'Lightning Bolt' }));
  const items = screen.getAllByTestId('stack-item');
  expect(items[0].textContent).toContain('Lightning Bolt');
});

test('a category chip narrows the suggestions', async () => {
  const user = userEvent.setup();
  render(<StackSheet onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: /^artifact$/i }));
  await user.type(screen.getByPlaceholderText(/spell or ability/i), 'lightn');
  expect(await screen.findByRole('button', { name: 'Lightning Greaves' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Lightning Bolt' })).not.toBeInTheDocument();
});

test('spells added from suggestions become one-tap recents', async () => {
  const user = userEvent.setup();
  render(<StackSheet onClose={() => {}} />);
  await user.type(screen.getByPlaceholderText(/spell or ability/i), 'lightn');
  await user.click(await screen.findByRole('button', { name: 'Lightning Bolt' }));
  await user.click(screen.getByRole('button', { name: /resolve top/i }));
  await user.click(await screen.findByRole('button', { name: /lightning bolt \(recent\)/i }));
  const items = screen.getAllByTestId('stack-item');
  expect(items[0].textContent).toContain('Lightning Bolt');
});

test('tapping a stack entry shows its rules text', async () => {
  const user = userEvent.setup();
  render(<StackSheet onClose={() => {}} />);
  await user.type(screen.getByPlaceholderText(/spell or ability/i), 'lightn');
  await user.click(await screen.findByRole('button', { name: 'Lightning Bolt' }));
  await user.click(screen.getByRole('button', { name: /lightning bolt — details/i }));
  expect(await screen.findByText(/deals 3 damage to any target/i)).toBeInTheDocument();
});
