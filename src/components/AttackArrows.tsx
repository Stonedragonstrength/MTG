import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { liveCombat } from '../lib/combat';
import type { CombatState, CombatUnit } from '../lib/types';
import { useAppStore } from '../state/store';
import '../styles/arrows.css';

export interface Point {
  x: number;
  y: number;
}

interface Arrow {
  key: string;
  d: string;
  blocked: boolean;
}

/** Arrows shorter than this are left out: both ends fell back to one place. */
const MIN_LENGTH = 40;
/** The head stops short of what it points at, so a life total stays readable. */
const STOP_SHORT = 24;
/** How long the arrows follow the board after a change (it slides and turns). */
const FOLLOW_FRAMES = 40;

const round = (n: number) => Math.round(n * 10) / 10;

/** A gentle curve from `a` to `b`, ending a little short of `b`. */
export function arrowPath(a: Point, b: Point, bend = 0.16): string | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < MIN_LENGTH) return null;
  const end = { x: b.x - (dx / len) * STOP_SHORT, y: b.y - (dy / len) * STOP_SHORT };
  // The bend: off the middle of the line, square to it.
  const c = { x: (a.x + end.x) / 2 - dy * bend, y: (a.y + end.y) / 2 + dx * bend };
  return `M ${round(a.x)} ${round(a.y)} Q ${round(c.x)} ${round(c.y)} ${round(end.x)} ${round(end.y)}`;
}

const middle = (el: Element): Point => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'));

/** Where a fighting unit is drawn: its card or stack, else its seat's zone. */
function unitAt(seat: number, unit: CombatUnit): Element | null {
  const zone = document.querySelector(`.zone.seat-${seat}`);
  if (!zone) return null;
  const sel = unit.kind === 'card' ? `[data-iid="${esc(unit.id)}"]` : `[data-stack="${esc(unit.id)}"]`;
  return zone.querySelector(sel) ?? zone;
}

/** What an attack points at: its first blocker, the planeswalker it attacks, or the player's life total. */
function targetOf(seat: number, blocker: CombatUnit | undefined, walker: string | undefined): Element | null {
  const zone = document.querySelector(`.zone.seat-${seat}`);
  if (!zone) return null;
  if (blocker) return unitAt(seat, blocker);
  if (walker) return zone.querySelector(`[data-iid="${esc(walker)}"]`) ?? zone.querySelector('.life-counter') ?? zone;
  return zone.querySelector('.life-counter') ?? zone;
}

function measure(fight: CombatState): Arrow[] {
  const out: Arrow[] = [];
  (fight.attacks ?? []).forEach((a, i) => {
    const from = unitAt(fight.active, a.unit);
    const to = targetOf(a.target, a.blockers?.[0], a.walker);
    if (!from || !to) return;
    const d = arrowPath(middle(from), middle(to));
    if (d) out.push({ key: `${a.unit.kind}:${a.unit.id}:${a.target}:${i}`, d, blocked: !!a.blockers?.length || !!a.blocked });
  });
  return out;
}

/** While a fight is on, a glowing arrow runs from each attacker to what it
 * attacks — the player's life total, a planeswalker, or the creature that
 * blocked it — so the whole table reads the attack at a glance. Drawn over
 * the board, never in the way of a tap. */
export default function AttackArrows() {
  const game = useAppStore((s) => s.game);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [resized, setResized] = useState(0);
  const last = useRef('');

  useEffect(() => {
    const on = () => setResized((n) => n + 1);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  // Any move can move the cards: follow the board after every change.
  useLayoutEffect(() => {
    const fight = game ? liveCombat(game) : null;
    const show = (next: Arrow[]) => {
      const key = JSON.stringify(next);
      if (key === last.current) return;
      last.current = key;
      setArrows(next);
    };
    if (!fight?.attacks?.length) {
      show([]);
      return;
    }
    let frames = 0;
    let raf = 0;
    const follow = () => {
      show(measure(fight));
      if (++frames < FOLLOW_FRAMES && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    };
  }, [game, resized]);

  if (arrows.length === 0) return null;
  return (
    <svg className="attack-arrows" data-testid="attack-arrows" aria-hidden="true">
      <defs>
        <marker id="arrow-head" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff7a5c" />
        </marker>
        <marker id="arrow-head-blocked" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#e8c86a" />
        </marker>
      </defs>
      {arrows.map((a) => (
        <g key={a.key} className={a.blocked ? 'attack-arrow attack-arrow--blocked' : 'attack-arrow'}>
          <path className="attack-arrow-glow" d={a.d} />
          <path
            className="attack-arrow-line"
            d={a.d}
            markerEnd={`url(#${a.blocked ? 'arrow-head-blocked' : 'arrow-head'})`}
          />
        </g>
      ))}
    </svg>
  );
}
