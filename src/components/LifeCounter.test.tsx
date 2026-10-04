import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import LifeCounter from './LifeCounter';

test('shows the life total', () => {
  render(<LifeCounter life={40} onAdjust={() => {}} />);
  expect(screen.getByText('40')).toBeInTheDocument();
});

test('tapping the top half gains 1 life, bottom half loses 1', async () => {
  const user = userEvent.setup();
  const onAdjust = vi.fn();
  render(<LifeCounter life={40} onAdjust={onAdjust} />);
  await user.click(screen.getByRole('button', { name: /gain life/i }));
  expect(onAdjust).toHaveBeenCalledWith(1);
  await user.click(screen.getByRole('button', { name: /lose life/i }));
  expect(onAdjust).toHaveBeenCalledWith(-1);
});

test('a press cancelled by scrolling fires nothing, even after the hold delay', async () => {
  const onAdjust = vi.fn();
  render(<LifeCounter life={40} onAdjust={onAdjust} />);
  const gain = screen.getByRole('button', { name: /gain life/i });

  fireEvent.pointerDown(gain);
  fireEvent.pointerCancel(gain);
  await new Promise((r) => setTimeout(r, 650));

  expect(onAdjust).not.toHaveBeenCalled();
});

test('holding the top half gains 5 life', async () => {
  const onAdjust = vi.fn();
  render(<LifeCounter life={40} onAdjust={onAdjust} />);
  const user = userEvent.setup();
  const gain = screen.getByRole('button', { name: /gain life/i });

  await user.pointer({ keys: '[MouseLeft>]', target: gain });
  await new Promise((r) => setTimeout(r, 650));
  await user.pointer({ keys: '[/MouseLeft]', target: gain });

  expect(onAdjust).toHaveBeenCalledTimes(1);
  expect(onAdjust).toHaveBeenCalledWith(5);
});
