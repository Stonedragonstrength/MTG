import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

function Bomb(): never {
  throw new Error('render exploded');
}

test('a render crash shows a recovery screen instead of a white page', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>,
  );
  expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /start fresh/i })).toBeInTheDocument();
  spy.mockRestore();
});

test('renders children normally when nothing throws', () => {
  render(
    <ErrorBoundary>
      <div>all good</div>
    </ErrorBoundary>,
  );
  expect(screen.getByText('all good')).toBeInTheDocument();
});
