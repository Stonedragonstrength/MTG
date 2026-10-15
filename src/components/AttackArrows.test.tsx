import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createGame } from '../lib/game';
import type { CombatState, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import AttackArrows, { arrowPath } from './AttackArrows';

describe('arrowPath', () => {
  test('a curve from one point to just short of the other', () => {
    expect(arrowPath({ x: 0, y: 0 }, { x: 200, y: 0 })).toBe('M 0 0 Q 88 32 176 0');
  });

  test('nothing when the two ends are on top of each other', () => {
    expect(arrowPath({ x: 10, y: 10 }, { x: 20, y: 20 })).toBeNull();
  });
});

/** An element that says it is laid out at (x, y), w × h. */
function laid(el: HTMLElement, x: number, y: number, w = 40, h = 40) {
  el.getBoundingClientRect = () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) }) as DOMRect;
  return el;
}

function table(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="zone seat-0"><button data-iid="bear"></button><div data-stack="tok"></div></div>
    <div class="zone seat-1"><span class="life-counter"></span><button data-iid="wall"></button><button data-iid="jace"></button></div>`;
  document.body.appendChild(root);
  laid(root.querySelector('.seat-0')!, 0, 400, 800, 400);
  laid(root.querySelector('[data-iid="bear"]')!, 100, 500);
  laid(root.querySelector('[data-stack="tok"]')!, 300, 500);
  laid(root.querySelector('.seat-1')!, 0, 0, 800, 60);
  laid(root.querySelector('.seat-1 .life-counter')!, 600, 10);
  laid(root.querySelector('[data-iid="wall"]')!, 200, 10);
  laid(root.querySelector('[data-iid="jace"]')!, 400, 10);
  return root;
}

function fighting(attacks: CombatState['attacks']): GameState {
  const g = createGame({
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    profiles: [
      { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
    ],
  });
  return { ...g, combat: { id: 'f1', turn: g.turnNumber, active: 0, step: 'blockers', attacks, defender: 1 } };
}

let root: HTMLElement;
beforeEach(() => {
  root = table();
});
afterEach(() => root.remove());

describe('the arrows on the board', () => {
  test('one per attack: at the life total, at a planeswalker, at the blocker', () => {
    useAppStore.setState({
      game: fighting([
        { unit: { kind: 'card', id: 'bear' }, target: 1 },
        { unit: { kind: 'stack', id: 'tok' }, target: 1, walker: 'jace' },
        { unit: { kind: 'card', id: 'bear' }, target: 1, blockers: [{ kind: 'card', id: 'wall' }] },
      ]),
    });
    render(<AttackArrows />);
    const svg = screen.getByTestId('attack-arrows');
    const lines = [...svg.querySelectorAll('.attack-arrow-line')].map((p) => p.getAttribute('d'));
    expect(lines).toHaveLength(3);
    // From the bear's middle (120, 520) towards the life total's (620, 30).
    expect(lines[0]).toMatch(/^M 120 520 Q/);
    expect(svg.querySelectorAll('.attack-arrow--blocked')).toHaveLength(1);
  });

  test('none without a fight', () => {
    useAppStore.setState({ game: fighting(undefined) });
    render(<AttackArrows />);
    expect(screen.queryByTestId('attack-arrows')).toBeNull();
  });

  test('they go when the fight does', () => {
    useAppStore.setState({ game: fighting([{ unit: { kind: 'card', id: 'bear' }, target: 1 }]) });
    render(<AttackArrows />);
    expect(screen.getByTestId('attack-arrows')).toBeInTheDocument();
    act(() => useAppStore.setState((s) => ({ game: { ...s.game!, combat: { ...s.game!.combat!, step: 'done' } } })));
    expect(screen.queryByTestId('attack-arrows')).toBeNull();
  });
});
