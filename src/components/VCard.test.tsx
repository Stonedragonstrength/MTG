import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import VCard from './VCard';

const draw = (counters?: Record<string, number>) =>
  render(
    <VCard
      card={{ iid: 'q1', cardId: 'c-quint', name: 'Quintorius Kand', ...(counters ? { counters } : {}) }}
      art={null}
      sick={false}
      look={null}
      names={['Nathan']}
      onTap={() => {}}
      onDetail={() => {}}
    />,
  );

test('a planeswalker wears its loyalty over the printed one', () => {
  draw({ loyalty: 5 });
  expect(screen.getByRole('img', { name: 'loyalty 5' })).toHaveTextContent('5');
});

test('no loyalty kept, no badge', () => {
  draw();
  expect(screen.queryByRole('img', { name: /loyalty/ })).not.toBeInTheDocument();
});
