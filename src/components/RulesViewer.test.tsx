import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import RulesViewer from './RulesViewer';

vi.mock('../data/rules', () => ({
  getGlossary: vi.fn(async () => [
    {
      term: 'Deathtouch',
      definition:
        'A keyword ability that causes damage to destroy creatures. See rule 702.2, "Deathtouch."',
    },
    { term: 'Defender', definition: 'A keyword ability that stops a creature from attacking.' },
    { term: 'Absorb', definition: 'A keyword ability that prevents damage.' },
  ]),
  searchRules: vi.fn(async (q: string) =>
    q === '702.2' ? [{ number: '702.2', text: 'Deathtouch is a static ability.' }] : [],
  ),
}));

test('the full glossary is browsable immediately, no typing needed', async () => {
  render(<RulesViewer onClose={() => {}} />);
  expect(await screen.findByRole('button', { name: 'Absorb' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deathtouch' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Defender' })).toBeInTheDocument();
});

test('search filters terms and tapping one shows the definition beside the list', async () => {
  const user = userEvent.setup();
  render(<RulesViewer onClose={() => {}} />);
  await user.type(await screen.findByPlaceholderText(/search terms/i), 'death');
  expect(screen.queryByRole('button', { name: 'Defender' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Deathtouch' }));
  expect(await screen.findByText(/causes damage to destroy/i)).toBeInTheDocument();
  // the term list stays visible next to the definition
  expect(screen.getByRole('button', { name: 'Deathtouch' })).toBeInTheDocument();
});

test('rule references inside a definition jump to that rule', async () => {
  const user = userEvent.setup();
  render(<RulesViewer onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: 'Deathtouch' }));
  await user.click(await screen.findByRole('button', { name: /702\.2/ }));
  expect(await screen.findByText(/static ability/i)).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /rules/i })).toHaveAttribute('aria-selected', 'true');
});

test('rules tab searches the comprehensive rules', async () => {
  const user = userEvent.setup();
  render(<RulesViewer onClose={() => {}} />);
  await user.click(screen.getByRole('tab', { name: /rules/i }));
  await user.type(screen.getByPlaceholderText(/search rules/i), '702.2');
  expect(await screen.findByText(/static ability/i)).toBeInTheDocument();
});

test('the sheet has a close control', async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<RulesViewer onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: /close/i }));
  expect(onClose).toHaveBeenCalled();
});
