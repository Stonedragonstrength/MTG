import { act, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import LifeCounter, { FLOAT_MERGE_MS } from './LifeCounter';

const noop = () => {};

test('a change of life floats up off the number, and taps a moment apart add up', () => {
  const { rerender } = render(<LifeCounter life={40} onAdjust={noop} />);
  expect(screen.queryByTestId('life-float')).toBeNull();
  rerender(<LifeCounter life={39} onAdjust={noop} />);
  expect(screen.getByTestId('life-float')).toHaveTextContent('−1');
  expect(screen.getByTestId('life-float')).toHaveClass('life-float--down');
  rerender(<LifeCounter life={37} onAdjust={noop} />);
  expect(screen.getByTestId('life-float')).toHaveTextContent('−3');
});

test('a correction straight back shows nothing', () => {
  const { rerender } = render(<LifeCounter life={40} onAdjust={noop} />);
  rerender(<LifeCounter life={39} onAdjust={noop} />);
  rerender(<LifeCounter life={40} onAdjust={noop} />);
  expect(screen.queryByTestId('life-float')).toBeNull();
});

test('a gain floats up green', () => {
  const { rerender } = render(<LifeCounter life={20} onAdjust={noop} />);
  rerender(<LifeCounter life={23} onAdjust={noop} />);
  expect(screen.getByTestId('life-float')).toHaveTextContent('+3');
  expect(screen.getByTestId('life-float')).toHaveClass('life-float--up');
});

test("a commander's hit carries its player's face", () => {
  const faces = { p1: 'face-of-p1.png' };
  const { rerender } = render(<LifeCounter life={40} onAdjust={noop} gauges={{}} faces={faces} />);
  rerender(<LifeCounter life={35} onAdjust={noop} gauges={{ p1: 5 }} faces={faces} />);
  const float = screen.getByTestId('life-float');
  expect(float).toHaveTextContent('−5');
  expect(float.querySelector('img')).toHaveAttribute('src', 'face-of-p1.png');
});

test('a change after the moment has passed starts a number of its own', async () => {
  const { rerender } = render(<LifeCounter life={40} onAdjust={noop} />);
  rerender(<LifeCounter life={38} onAdjust={noop} />);
  await act(() => new Promise((r) => setTimeout(r, FLOAT_MERGE_MS + 50)));
  rerender(<LifeCounter life={37} onAdjust={noop} />);
  expect(screen.getByTestId('life-float')).toHaveTextContent('−1');
});
