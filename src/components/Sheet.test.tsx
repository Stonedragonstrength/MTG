import { render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { _resetBackStack } from '../lib/backstack';
import Sheet from './Sheet';

beforeEach(() => {
  _resetBackStack();
});

test('the tablet back button closes the sheet instead of the app', () => {
  const onClose = vi.fn();
  render(
    <Sheet title="Test sheet" onClose={onClose}>
      <p>body</p>
    </Sheet>,
  );
  expect(screen.getByText('Test sheet')).toBeInTheDocument();
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});
