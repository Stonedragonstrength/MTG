import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import RulesViewer from './RulesViewer';

vi.mock('../data/rules', () => ({
  getGlossary: vi.fn(async () => [
    { term: 'Deathtouch', definition: 'A keyword ability that causes damage to destroy creatures.' },
    { term: 'Defender', definition: 'A keyword ability that stops a creature from attacking.' },
  ]),
  searchRules: vi.fn(async (q: string) =>
    q === '702.2' ? [{ number: '702.2', text: 'Deathtouch is a static ability.' }] : [],
  ),
}));

test('glossary search filters terms and shows the definition on tap', async () => {
  const user = userEvent.setup();
  render(<RulesViewer onClose={() => {}} />);
  await user.type(await screen.findByPlaceholderText(/search terms/i), 'death');
  const term = await screen.findByRole('button', { name: 'Deathtouch' });
  expect(screen.queryByRole('button', { name: 'Defender' })).not.toBeInTheDocument();
  await user.click(term);
  expect(await screen.findByText(/causes damage to destroy/i)).toBeInTheDocument();
});

test('rules tab searches the comprehensive rules', async () => {
  const user = userEvent.setup();
  render(<RulesViewer onClose={() => {}} />);
  await user.click(screen.getByRole('tab', { name: /rules/i }));
  await user.type(screen.getByPlaceholderText(/search rules/i), '702.2');
  expect(await screen.findByText(/static ability/i)).toBeInTheDocument();
  expect(screen.getByText('702.2')).toBeInTheDocument();
});
