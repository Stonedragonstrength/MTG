import { hitLine, recapRows } from '../lib/history';
import type { GameRecord } from '../lib/types';
import LifeChart, { SEAT_COLORS } from './LifeChart';
import '../styles/victory.css';

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** What happened in a finished game: everyone's place and how they went
 * out, the biggest hit, and life over the game. The victory screen and the
 * history both show it. */
export default function GameRecap({ record }: { record: GameRecord }) {
  const rows = recapRows(record);
  const hit = hitLine(record);
  return (
    <div className="recap">
      <ol className="recap-rows">
        {rows.map((r) => {
          const won = record.winner === r.seat;
          return (
            <li key={r.seat} className={won ? 'recap-row recap-row--winner' : 'recap-row'}>
              <span className="recap-place" aria-label={won ? 'winner' : `${ordinal(r.place)} place`}>
                {won ? '🏆' : ordinal(r.place)}
              </span>
              <i className="recap-key" style={{ background: SEAT_COLORS[r.seat % SEAT_COLORS.length] }} />
              <span className="recap-name">{r.name}</span>
              <span className="recap-what">{r.what}</span>
              {r.when && <span className="recap-when">{r.when}</span>}
            </li>
          );
        })}
      </ol>
      {hit && (
        <p className="recap-hit">
          <span className="recap-hit-label">Biggest hit</span> {hit}
        </p>
      )}
      <LifeChart record={record} />
    </div>
  );
}
