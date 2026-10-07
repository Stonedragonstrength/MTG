import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { _resetBackStack } from '../lib/backstack';
import type { CardRecord } from '../lib/types';
import CardZoomSheet from './CardZoomSheet';
import Sheet from './Sheet';

const BEARS: CardRecord = {
  id: 'c-bears',
  name: 'Grizzly Bears',
  nameLower: 'grizzly bears',
  typeLine: 'Creature — Bear',
  oracleText: 'Trample\nWhen Grizzly Bears enters, draw a card.',
  manaCost: '{1}{G}',
  power: '2',
  toughness: '2',
  colors: ['G'],
  imageNormal: 'https://img.example/c-bears.jpg',
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
};

const shields = () => Array.from(document.querySelectorAll<HTMLElement>('.tap-shield'));

beforeEach(() => {
  _resetBackStack();
  // Only the four timer functions: fake-indexeddb needs the real setImmediate.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  cleanup(); // a sheet still open closes here, and that raises shields too…
  vi.runAllTimers(); // …which must lift on this test's clock
  vi.useRealTimers();
  shields().forEach((left) => left.remove());
});

test('shows the whole card: its image, name, type line with power and cost, and rules text', () => {
  render(<CardZoomSheet name="Grizzly Bears" record={BEARS} onClose={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Grizzly Bears' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Grizzly Bears' })).toHaveAttribute('src', BEARS.imageNormal);
  const type = screen.getByText('Creature — Bear', { exact: false });
  expect(type).toHaveTextContent('2/2');
  expect(type).toHaveTextContent('{1}{G}');
  expect(screen.getByText(/Trample\s+When Grizzly Bears enters, draw a card\./)).toBeInTheDocument();
});

test('a card with no power or cost shows neither', () => {
  render(
    <CardZoomSheet
      name="Forest"
      record={{ ...BEARS, name: 'Forest', typeLine: 'Basic Land — Forest', power: null, toughness: null, manaCost: '', oracleText: '' }}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText('Basic Land — Forest')).toHaveTextContent(/^Basic Land — Forest$/);
});

test('a card this device has no record of opens by name, and says the text is missing', () => {
  const { container } = render(<CardZoomSheet name="Mystery Card" record={null} onClose={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Mystery Card' })).toBeInTheDocument();
  expect(document.querySelector('.zoom-face')).toHaveAttribute('data-name', 'Mystery Card'); // the name on a frame
  expect(document.querySelector('.zoom-face img')).toBeNull();
  expect(screen.getByText(/no card text/i)).toBeInTheDocument();
  expect(container).toBeEmptyDOMElement(); // all of it lives in the sheet's portal
});

test('while the record is still being looked up it claims nothing: no text, and no "missing" either', () => {
  render(<CardZoomSheet name="Slow Card" record={undefined} onClose={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Slow Card' })).toBeInTheDocument();
  expect(screen.queryByText(/no card text/i)).not.toBeInTheDocument();
});

/** This file's clock, with the page's own stopwatch on it too. (A clock that
 * is already faked keeps the list it was installed with, so: off, then on.) */
const clockWithStopwatch = () => {
  vi.useRealTimers();
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
  });
};

test('✕ asks to close and changes nothing else', () => {
  clockWithStopwatch();
  const onClose = vi.fn();
  render(<CardZoomSheet name="Grizzly Bears" record={BEARS} onClose={onClose} />);
  vi.advanceTimersByTime(400); // read for a moment
  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

// A double tap on a card's face opens the zoom with its first half. The second
// half lands wherever the zoom now is — its backdrop, as often as not.

test('the double tap that opened it cannot also close it: a close asked for in its first moment is ignored', () => {
  clockWithStopwatch();
  const onClose = vi.fn();
  render(<CardZoomSheet name="Grizzly Bears" record={BEARS} onClose={onClose} />);
  const backdrop = document.querySelector('.modal-backdrop')!;
  fireEvent.click(backdrop);
  vi.advanceTimersByTime(200);
  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  expect(onClose).not.toHaveBeenCalled();
  vi.advanceTimersByTime(200); // 400 ms after it opened: a tap outside is a tap outside again
  fireEvent.click(backdrop);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('the back button closes it at once, however soon it is pressed', () => {
  clockWithStopwatch();
  const onClose = vi.fn();
  render(<CardZoomSheet name="Grizzly Bears" record={BEARS} onClose={onClose} />);
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

// It closes back onto the sheet it was opened from. The second half of a double
// tap must not press that sheet's buttons — or its backdrop, which would close it.

test('closing it shields the sheet underneath, not just the board', () => {
  const css = document.createElement('style');
  css.textContent = readFileSync(resolve(process.cwd(), 'src/styles/screens.css'), 'utf8');
  document.head.appendChild(css);
  try {
    const under = vi.fn();
    const view = render(
      <Sheet title="Library" onClose={() => {}}>
        <button onClick={under}>Graveyard</button>
        <CardZoomSheet name="Grizzly Bears" record={BEARS} onClose={() => {}} />
      </Sheet>,
    );
    expect(shields()).toHaveLength(0);
    view.rerender(
      <Sheet title="Library" onClose={() => {}}>
        <button onClick={under}>Graveyard</button>
      </Sheet>,
    );
    const layer = (el: Element) => Number(getComputedStyle(el).zIndex);
    const backdrop = document.querySelector('.modal-backdrop')!; // the library sheet's, still open
    const over = shields().filter((s) => layer(s) > layer(backdrop));
    expect(over).toHaveLength(1);
    expect(over[0].parentElement).toBe(document.body);
    vi.advanceTimersByTime(300); // where the second half of a double tap lands
    expect(over[0]).toBeInTheDocument();
    vi.advanceTimersByTime(700); // a deliberate tap a moment later reaches the sheet again
    expect(shields()).toHaveLength(0);
    expect(under).not.toHaveBeenCalled();
  } finally {
    css.remove();
  }
});
