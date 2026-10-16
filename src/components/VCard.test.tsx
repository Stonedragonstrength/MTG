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

test('a god wears its devotion against its number, and goes grey below it', () => {
  const god = (now: number) =>
    render(
      <VCard
        card={{ iid: 'n1', cardId: 'c-nylea', name: 'Nylea, God of the Hunt' }}
        art="nylea.jpg"
        sick={false}
        look={null}
        names={['Nathan']}
        god={{ need: { kind: 'devotion', colors: ['G'], needs: 5 }, now, creature: now >= 5 }}
        onTap={() => {}}
        onDetail={() => {}}
      />,
    );
  const asleep = god(3);
  expect(screen.getByRole('img', { name: 'devotion to green 3 of 5, not a creature' })).toHaveTextContent('3/5');
  expect(screen.getByRole('button')).toHaveClass('vcard--dormant');
  expect(screen.getByRole('button')).toHaveAccessibleName('tap Nylea, God of the Hunt, not a creature');
  asleep.unmount();
  god(5);
  expect(screen.getByRole('img', { name: 'devotion to green 5 of 5' })).toHaveClass('devotion-badge--awake');
  expect(screen.getByRole('button')).not.toHaveClass('vcard--dormant');
});

test('the counters a card keeps mana in are on its corner: a Mana Battery’s charge counters', () => {
  draw({ charge: 3 });
  expect(screen.getByRole('img', { name: '3 charge counters' })).toHaveTextContent('charge 3');
});
