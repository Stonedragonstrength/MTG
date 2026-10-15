import { useState, type PointerEvent } from 'react';
import type { GameRecord } from '../lib/types';

/** A color per seat, in seat order — the categorical slots of the dataviz
 * palette stepped for a dark panel, checked against `--recap-surface`. */
export const SEAT_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500'];

const W = 600;
const H = 180;
const PAD = { l: 34, r: 92, t: 12, b: 24 };
const LABEL_GAP = 13;

/** Round gridline values between `lo` and `hi`: 0 always, then even steps. */
function ticks(lo: number, hi: number): number[] {
  const span = hi - lo || 1;
  const step = [5, 10, 20, 25, 50, 100].find((s) => span / s <= 4) ?? Math.ceil(span / 4);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

/** End labels' heights, pushed apart until none overlap. */
function spread(ys: { seat: number; y: number }[]): Map<number, number> {
  const sorted = [...ys].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].y - sorted[i - 1].y < LABEL_GAP) sorted[i] = { ...sorted[i], y: sorted[i - 1].y + LABEL_GAP };
  return new Map(sorted.map((s) => [s.seat, s.y]));
}

/** Everyone's life over the game, turn by turn. Tap (or point) anywhere
 * on it to read every total at that turn; "Table" shows the numbers. */
export default function LifeChart({ record }: { record: GameRecord }) {
  const [at, setAt] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const pts = record.lives;
  if (pts.length < 2) return null;
  const all = pts.flatMap((p) => p.life);
  const hi = Math.max(...all, 1);
  const lo = Math.min(0, ...all);
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (pts.length - 1);
  const y = (v: number) => PAD.t + ((hi - v) * (H - PAD.t - PAD.b)) / (hi - lo || 1);
  const name = (seat: number) => record.players[seat]?.name ?? '?';
  // A turn number under the first point of each round, thinned to fit.
  const rounds = pts.flatMap((p, i) => (i === 0 || p.turn !== pts[i - 1].turn ? [i] : []));
  const every = Math.ceil(rounds.length / 8);
  const last = pts[pts.length - 1];
  const ends = spread(last.life.map((v, seat) => ({ seat, y: y(v) })));

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / (box.width || 1)) * W;
    const i = Math.round(((vx - PAD.l) / (W - PAD.l - PAD.r)) * (pts.length - 1));
    setAt(Math.max(0, Math.min(pts.length - 1, i)));
  };
  const shown = at !== null ? pts[at] : null;

  return (
    <figure className="life-chart">
      <figcaption className="life-chart-head">
        <span>Life, turn by turn</span>
        <button type="button" className="life-chart-toggle" onClick={() => setTable((t) => !t)}>
          {table ? 'Chart' : 'Table'}
        </button>
      </figcaption>
      {table ? (
        <div className="life-table-wrap">
          <table className="life-table">
            <thead>
              <tr>
                <th>Turn</th>
                {record.players.map((p, seat) => (
                  <th key={seat}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pts.map((p, i) => (
                <tr key={i}>
                  <td>
                    {i === pts.length - 1 ? 'End' : `${p.turn} · ${name(p.active)}`}
                  </td>
                  {p.life.map((v, seat) => (
                    <td key={seat}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="life-chart-plot">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Life totals over ${pts.length} turns`}
            onPointerDown={pick}
            onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons ? pick(e) : undefined)}
            onPointerLeave={(e) => (e.pointerType === 'mouse' ? setAt(null) : undefined)}
          >
            {ticks(lo, hi).map((v) => (
              <g key={v} className={v === 0 ? 'life-chart-zero' : 'life-chart-grid'}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
                <text x={PAD.l - 6} y={y(v)} dy="0.32em" textAnchor="end">
                  {v}
                </text>
              </g>
            ))}
            {rounds
              .filter((_, k) => k % every === 0)
              .map((i) => (
                <text key={i} className="life-chart-x" x={x(i)} y={H - 6} textAnchor="middle">
                  {pts[i].turn}
                </text>
              ))}
            {shown && <line className="life-chart-cross" x1={x(at!)} x2={x(at!)} y1={PAD.t} y2={H - PAD.b} />}
            {record.players.map((_, seat) => (
              <polyline
                key={seat}
                className="life-chart-line"
                stroke={SEAT_COLORS[seat % SEAT_COLORS.length]}
                points={pts.map((p, i) => `${x(i)},${y(p.life[seat])}`).join(' ')}
              />
            ))}
            {record.players.map((_, seat) => (
              <g key={seat}>
                <circle
                  className="life-chart-dot"
                  cx={x(shown ? at! : pts.length - 1)}
                  cy={y((shown ?? last).life[seat])}
                  r={4}
                  fill={SEAT_COLORS[seat % SEAT_COLORS.length]}
                />
                <text className="life-chart-label" x={W - PAD.r + 10} y={ends.get(seat)} dy="0.32em">
                  {name(seat)}
                </text>
              </g>
            ))}
          </svg>
          {shown && (
            <div
              className="life-chart-readout"
              style={{ left: `${(x(at!) / W) * 100}%` }}
              data-side={x(at!) > W / 2 ? 'left' : 'right'}
            >
              <div className="life-chart-readout-head">
                {at === pts.length - 1 ? 'The end' : `Turn ${shown.turn} · ${name(shown.active)}`}
              </div>
              {shown.life.map((v, seat) => (
                <div key={seat} className="life-chart-readout-row">
                  <i style={{ background: SEAT_COLORS[seat % SEAT_COLORS.length] }} />
                  <strong>{v}</strong> {name(seat)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="life-chart-legend">
        {record.players.map((p, seat) => (
          <span key={seat}>
            <i style={{ background: SEAT_COLORS[seat % SEAT_COLORS.length] }} />
            {p.name}
          </span>
        ))}
      </div>
    </figure>
  );
}
