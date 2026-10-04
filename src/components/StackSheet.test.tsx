import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import StackSheet from './StackSheet';

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
