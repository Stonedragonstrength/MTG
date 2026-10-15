import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { movesBetween, type CardMove } from '../lib/moves';
import type { CardZone, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import '../styles/flights.css';

/** How long one card takes to fly; cards moved together leave one by one. */
export const FLY_MS = 520;
const STAGGER_MS = 70;
/** More than this in one move (a mulligan, a big search) and the rest just appear. */
const MAX_FLIGHTS = 10;

/** The journeys worth seeing. (A commander's arrival has a moment of its
 * own; cards going back into the library are shuffled out of sight.) */
const FLIES = new Set([
  'library>hand',
  'library>battlefield',
  'library>graveyard',
  'hand>battlefield',
  'hand>graveyard',
  'hand>exile',
  'battlefield>hand',
  'battlefield>graveyard',
  'battlefield>exile',
  'graveyard>battlefield',
  'graveyard>hand',
  'exile>battlefield',
  'exile>hand',
]);

interface Spot {
  rect: DOMRect;
  img: string | null;
  /** How far the zone it lies in is turned (a seat on a side or across). */
  angle: number;
}

interface Flight {
  key: string;
  from: Spot;
  to: Spot;
  face: string | null;
  delay: number;
  target: HTMLElement | null;
}

const PILES: Partial<Record<CardZone, string>> = {
  library: '.dock-library',
  graveyard: '.dock-grave',
  exile: '.dock-exile',
  command: '.dock-command',
  hand: '.hand-tray, .dock-hand',
};

const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'));

function angleOf(el: Element): number {
  const zone = el.closest('.zone');
  if (!zone) return 0;
  const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(zone).transform || '');
  if (!m) return 0;
  const [a, b] = m[1].split(',').map(Number);
  return Math.round((Math.atan2(b, a) * 180) / Math.PI);
}

const spotOf = (el: Element): Spot => ({
  rect: el.getBoundingClientRect(),
  img: el.querySelector('img')?.getAttribute('src') ?? null,
  angle: angleOf(el),
});

/** Where everything is drawn right now: each card by its instance, each pile by seat. */
function snapshot(): Map<string, Spot> {
  const spots = new Map<string, Spot>();
  document.querySelectorAll('.zone').forEach((zone) => {
    const seat = /\bseat-(\d+)\b/.exec(zone.className)?.[1];
    if (seat === undefined) return;
    zone.querySelectorAll('[data-iid]').forEach((el) => spots.set(el.getAttribute('data-iid')!, spotOf(el)));
    zone.querySelectorAll('[data-iids]').forEach((el) => {
      const spot = spotOf(el);
      for (const iid of el.getAttribute('data-iids')!.split(' ')) spots.set(iid, spot);
    });
    for (const [z, sel] of Object.entries(PILES)) {
      const el = zone.querySelector(sel);
      if (el) spots.set(`${z}:${seat}`, spotOf(el));
    }
  });
  return spots;
}

/** Where a card that moved is drawn now: itself, else its new zone's pile. */
function landing(m: CardMove): HTMLElement | null {
  const zone = document.querySelector(`.zone.seat-${m.seat}`);
  if (!zone) return null;
  if (m.to === 'hand' || m.to === 'battlefield') {
    const el = zone.querySelector<HTMLElement>(`[data-iid="${esc(m.iid)}"], [data-iids~="${esc(m.iid)}"]`);
    if (el) return el;
  }
  const sel = PILES[m.to];
  return sel ? zone.querySelector<HTMLElement>(sel) : null;
}

/** Sizes as the card lies, not as its box on the screen: a card turned a
 * quarter has a box as wide as the card is tall. */
const upright = (s: Spot) =>
  Math.abs(s.angle) % 180 === 90 ? { w: s.rect.height, h: s.rect.width } : { w: s.rect.width, h: s.rect.height };

function FlightCard({ flight, onDone }: { flight: Flight; onDone: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const to = upright(flight.to);
  const from = upright(flight.from);
  useLayoutEffect(() => {
    const el = ref.current;
    const target = flight.target;
    if (!el || typeof el.animate !== 'function') {
      onDone(flight.key);
      return;
    }
    // The card waits where it lands until the flight gets there.
    if (target) target.style.visibility = 'hidden';
    const fx = flight.from.rect.left + flight.from.rect.width / 2;
    const fy = flight.from.rect.top + flight.from.rect.height / 2;
    const tx = flight.to.rect.left + flight.to.rect.width / 2;
    const ty = flight.to.rect.top + flight.to.rect.height / 2;
    const dx = fx - tx;
    const dy = fy - ty;
    const s0 = Math.max(0.2, from.w / (to.w || 1));
    const at = (x: number, y: number, s: number, r: number) =>
      `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`;
    const lift = Math.min(60, Math.hypot(dx, dy) * 0.15);
    const anim = el.animate(
      [
        { transform: at(dx, dy, s0, flight.from.angle), opacity: 0.6 },
        {
          transform: at(dx * 0.42, dy * 0.42 - lift, Math.max(s0, 1) * 1.08, (flight.from.angle + flight.to.angle) / 2 + 5),
          opacity: 1,
          offset: 0.55,
        },
        { transform: at(0, 0, 1, flight.to.angle), opacity: 1 },
      ],
      { duration: FLY_MS, delay: flight.delay, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)', fill: 'both' },
    );
    anim.onfinish = () => {
      if (target) target.style.visibility = '';
      onDone(flight.key);
    };
    return () => {
      // Taken away mid-flight: the card is simply where it landed.
      anim.onfinish = null;
      anim.cancel();
      if (target) target.style.visibility = '';
    };
    // One flight, one animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      className={flight.face ? 'flight-card' : 'flight-card flight-card--back'}
      style={{
        left: flight.to.rect.left + flight.to.rect.width / 2,
        top: flight.to.rect.top + flight.to.rect.height / 2,
        width: to.w,
        height: to.h,
      }}
    >
      {flight.face && <img src={flight.face} alt="" />}
    </div>
  );
}

/** Cards travel: a drawn card slides from the library into the hand, a
 * played one flies from the hand onto the battlefield, a dead one drops
 * into the graveyard. Read off the table (every device sees every move),
 * drawn from where each card was at the last look to where it is now.
 * Nothing here can be tapped. */
export default function CardFlights() {
  const game = useAppStore((s) => s.game);
  const prev = useRef<GameState | null>(null);
  const spots = useRef<Map<string, Spot>>(new Map());
  const [flights, setFlights] = useState<Flight[]>([]);
  const seq = useRef(0);

  // Where things are, looked at again whenever they may have moved: after
  // every change has settled, on every resize, and just before every tap
  // (a tap is what moves cards).
  useEffect(() => {
    const look = () => {
      spots.current = snapshot();
    };
    document.addEventListener('pointerdown', look, true);
    window.addEventListener('resize', look);
    return () => {
      document.removeEventListener('pointerdown', look, true);
      window.removeEventListener('resize', look);
    };
  }, []);

  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = game;
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (was && game && was !== game && !still) {
      const moves = movesBetween(was, game).filter((m) => FLIES.has(`${m.from}>${m.to}`));
      const next: Flight[] = [];
      for (const m of moves.slice(0, MAX_FLIGHTS)) {
        const from = spots.current.get(m.iid) ?? spots.current.get(`${m.from}:${m.seat}`);
        const target = landing(m);
        if (!from || !target) continue;
        const to = spotOf(target);
        // A drawn card flies face down: the hand it goes to is its owner's alone.
        const face = m.from === 'library' && m.to === 'hand' ? null : (to.img ?? from.img);
        const own = target.matches('[data-iid], [data-iids]');
        next.push({ key: `f${++seq.current}`, from, to, face, delay: next.length * STAGGER_MS, target: own ? target : null });
      }
      if (next.length > 0) setFlights((f) => [...f, ...next]);
    }
    // Look again once the board has settled into its new places.
    const t = window.setTimeout(() => {
      spots.current = snapshot();
    }, FLY_MS + 150);
    if (spots.current.size === 0) spots.current = snapshot();
    return () => window.clearTimeout(t);
  }, [game]);

  if (flights.length === 0) return null;
  return (
    <div className="card-flights" aria-hidden="true">
      {flights.map((f) => (
        <FlightCard key={f.key} flight={f} onDone={(key) => setFlights((all) => all.filter((x) => x.key !== key))} />
      ))}
    </div>
  );
}
