import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetBackStack } from '../lib/backstack';
import Sheet from './Sheet';
import { useLongPress } from './useLongPress';

beforeEach(() => {
  _resetBackStack();
  // Only the four timer functions: fake-indexeddb needs the real setImmediate.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  // jsdom has no pointer capture; this shows what the shield asks for.
  Element.prototype.setPointerCapture = vi.fn();
});

const shields = () => Array.from(document.querySelectorAll<HTMLElement>('.tap-shield'));

afterEach(() => {
  cleanup(); // a sheet still open closes here, and that raises a shield too…
  vi.runAllTimers(); // …which must lift on this test's clock, not during the next test
  vi.useRealTimers();
  shields().forEach((left) => left.remove()); // one a failed test left up stays that test's failure
});

/** A sheet the way screens hold one: closing it stops rendering it. */
function Closable() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <Sheet title="Test sheet" onClose={() => setOpen(false)}>
      <p>body</p>
    </Sheet>
  );
}

/** Opens a sheet and closes it again; hands back the shield that leaves over the board. */
function closeASheet(): HTMLElement {
  const { unmount } = render(
    <Sheet title="Closing sheet" onClose={() => {}}>
      <p>body</p>
    </Sheet>,
  );
  unmount();
  const shield = shields().at(-1);
  if (!shield) throw new Error('the closing sheet left no shield');
  return shield;
}

/** jsdom has no PointerEvent: a bare event carrying the two fields the shield reads. */
function pointer(type: 'pointerdown' | 'pointerup' | 'pointercancel', pointerId = 1, isPrimary = true) {
  return Object.assign(new Event(type, { bubbles: true }), { pointerId, isPrimary });
}

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

// A tap acts when the finger lifts (useLongPress), so a sheet it opens is on screen
// before that same tap's click arrives — and a touch screen aims the click at what
// lies under the finger by then: the new sheet. Measured in Chrome with a finger: on
// the backdrop the click closed the sheet again, on a link or a button it pressed that.

/** A card that opens its sheet on a tap, the way a card in the Curation does. */
function TapOpens({ onMore = () => {} }: { onMore?: () => void }) {
  const [open, setOpen] = useState(false);
  const gesture = useLongPress(
    () => setOpen(true),
    () => {},
  );
  return (
    <>
      <button {...gesture}>card</button>
      {open && (
        <Sheet title="Card view" onClose={() => setOpen(false)}>
          <a href="#edhrec">EDHREC ↗</a>
          <button onClick={onMore}>Goes well with…</button>
        </Sheet>
      )}
    </>
  );
}

/** A finger comes down on `el` and lifts again: all a page hears of it before the click. */
function press(el: Element) {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
}

/** The click that ends a press. A finger's or a mouse's counts the taps; a keyboard's carries 0. */
const pressClick = (el: Element) => fireEvent.click(el, { detail: 1 });

test('the tap that opens a sheet does not close it again when its click lands on the backdrop', () => {
  render(<TapOpens />);
  press(screen.getByRole('button', { name: 'card' })); // the sheet is up…
  pressClick(document.querySelector('.modal-backdrop')!); // …when that same tap's click arrives
  expect(screen.getByText('Card view')).toBeInTheDocument();
});

test('nor does that click press a button or follow a link that came up under the finger', () => {
  const onMore = vi.fn();
  render(<TapOpens onMore={onMore} />);
  press(screen.getByRole('button', { name: 'card' }));
  const more = screen.getByRole('button', { name: 'Goes well with…' });
  pressClick(more);
  expect(onMore).not.toHaveBeenCalled();
  // A link is followed unless its click is cancelled: the page hears "false" back.
  expect(pressClick(screen.getByRole('link', { name: 'EDHREC ↗' }))).toBe(false);
  press(more); // the next tap begins on the sheet: this one is meant for it
  pressClick(more);
  expect(onMore).toHaveBeenCalledTimes(1);
});

test('a press on the dimmed backdrop still closes the sheet', () => {
  render(<TapOpens />);
  press(screen.getByRole('button', { name: 'card' }));
  const backdrop = document.querySelector('.modal-backdrop')!;
  press(backdrop);
  pressClick(backdrop);
  expect(screen.queryByText('Card view')).not.toBeInTheDocument();
});

test('a keyboard click has no press to wait for: it counts on a sheet that has only just opened', () => {
  const onMore = vi.fn();
  render(<TapOpens onMore={onMore} />);
  press(screen.getByRole('button', { name: 'card' }));
  fireEvent.click(screen.getByRole('button', { name: 'Goes well with…' })); // Enter on the button
  expect(onMore).toHaveBeenCalledTimes(1);
});

// A tap that closes a sheet is often the first half of a double tap. The second
// half must not act on the board the sheet was covering.

test('a closing sheet leaves a shield over the board until the screen has been quiet for a moment', () => {
  render(<Closable />);
  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  expect(screen.queryByText('Test sheet')).not.toBeInTheDocument();
  expect(shields()).toHaveLength(1);
  expect(shields()[0].parentElement).toBe(document.body); // a transformed ancestor would trap it
  vi.advanceTimersByTime(300); // where the second half of a double tap lands
  expect(shields()).toHaveLength(1);
  vi.advanceTimersByTime(700); // a deliberate tap a second later reaches the board
  expect(shields()).toHaveLength(0);
});

test('the back button closes a sheet behind the same shield', () => {
  render(<Closable />);
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.queryByText('Test sheet')).not.toBeInTheDocument();
  expect(shields()).toHaveLength(1);
});

test('a press that lands on the shield keeps it up until the finger lifts', () => {
  const shield = closeASheet();
  fireEvent(shield, pointer('pointerdown', 7));
  expect(shield.setPointerCapture).toHaveBeenCalledWith(7); // the release comes here, wherever it happens
  vi.advanceTimersByTime(5000); // held far longer than the quiet moment
  expect(shield).toBeInTheDocument();
  fireEvent(shield, pointer('pointerup', 7));
  vi.advanceTimersByTime(300); // the click that follows, or a third tap, is swallowed too
  expect(shield).toBeInTheDocument();
  vi.advanceTimersByTime(700);
  expect(shields()).toHaveLength(0);
});

test('a press the browser takes over (a scroll) ends like a lifted finger', () => {
  const shield = closeASheet();
  fireEvent(shield, pointer('pointerdown'));
  vi.advanceTimersByTime(5000);
  expect(shield).toBeInTheDocument();
  fireEvent(shield, pointer('pointercancel'));
  vi.advanceTimersByTime(1000);
  expect(shields()).toHaveLength(0);
});

test('with two fingers on the shield it waits for the last one to lift', () => {
  const shield = closeASheet();
  fireEvent(shield, pointer('pointerdown', 1));
  fireEvent(shield, pointer('pointerdown', 2, false));
  fireEvent(shield, pointer('pointerup', 2, false));
  vi.advanceTimersByTime(5000); // the first finger is still down
  expect(shield).toBeInTheDocument();
  fireEvent(shield, pointer('pointerup', 1));
  vi.advanceTimersByTime(1000);
  expect(shields()).toHaveLength(0);
});

test('a finger the browser never reports as lifted cannot leave the board deaf for good', () => {
  const shield = closeASheet();
  fireEvent(shield, pointer('pointerdown', 1)); // …and no pointerup or pointercancel ever comes
  vi.advanceTimersByTime(60_000);
  expect(shield).toBeInTheDocument();
  fireEvent(shield, pointer('pointerdown', 2)); // the next touch is a first finger again
  fireEvent(shield, pointer('pointerup', 2));
  vi.advanceTimersByTime(1000);
  expect(shields()).toHaveLength(0);
});

describe('stacking, as the app stylesheet has it', () => {
  // jsdom cannot hit-test, but it does read a stylesheet: enough to tell who lies over whom.
  let css: HTMLStyleElement;
  beforeEach(() => {
    css = document.createElement('style');
    css.textContent = readFileSync(resolve(process.cwd(), 'src/styles/screens.css'), 'utf8');
    document.head.appendChild(css);
  });
  afterEach(() => css.remove());
  const layer = (el: Element) => Number(getComputedStyle(el).zIndex);

  test('the shield lies over the highest thing the board shows', () => {
    const banner = document.createElement('div');
    banner.className = 'table-banner'; // nothing on the board is stacked higher
    document.body.appendChild(banner);
    try {
      expect(layer(closeASheet())).toBeGreaterThan(layer(banner));
    } finally {
      banner.remove();
    }
  });

  test('a sheet that opens while the shield is up is not obstructed by it', () => {
    const shield = closeASheet();
    const draw = vi.fn();
    render(
      <Sheet title="Next sheet" onClose={() => {}}>
        <button onClick={draw}>Draw</button>
      </Sheet>,
    );
    const backdrop = document.querySelector('.modal-backdrop')!;
    expect(shield).toBeInTheDocument(); // still up…
    expect(layer(shield)).toBeLessThan(layer(backdrop)); // …and underneath
    expect(shield.contains(backdrop)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    expect(draw).toHaveBeenCalledTimes(1);
  });
});

test('closing several sheets in a row leaves no shield behind', () => {
  closeASheet();
  vi.advanceTimersByTime(100);
  closeASheet();
  vi.advanceTimersByTime(100);
  closeASheet();
  expect(shields().length).toBeGreaterThan(0);
  vi.advanceTimersByTime(1000);
  expect(shields()).toHaveLength(0);
});

test('a sheet that closes while a finger is on the shield does not cut that press short', () => {
  const shield = closeASheet();
  fireEvent(shield, pointer('pointerdown'));
  closeASheet(); // the back button, say, closes another one meanwhile
  vi.advanceTimersByTime(5000);
  expect(shield).toBeInTheDocument(); // still held: its release must not reach the board
  expect(shields()).toHaveLength(1); // and nothing else piled up meanwhile
  fireEvent(shield, pointer('pointerup'));
  vi.advanceTimersByTime(1000);
  expect(shields()).toHaveLength(0);
});

test("StrictMode's rehearsal unmount in development leaves no shield behind for good", () => {
  render(
    <StrictMode>
      <Closable />
    </StrictMode>,
  );
  vi.advanceTimersByTime(1000);
  expect(shields()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'close' })); // the sheet itself still works
  expect(shields()).toHaveLength(1);
  vi.advanceTimersByTime(1000);
  expect(shields()).toHaveLength(0);
});
