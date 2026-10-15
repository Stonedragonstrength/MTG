import { useEffect, useState } from 'react';
import { commanderStandings, lasted, playerStandings, shortName } from '../lib/history';
import type { GameRecord } from '../lib/types';
import { useAppStore } from '../state/store';
import GameRecap from './GameRecap';
import Sheet from './Sheet';
import { useConfirmTap } from './useConfirmTap';
import '../styles/victory.css';

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const titleOf = (rec: GameRecord) => {
  const w = rec.winner !== null ? rec.players[rec.winner] : null;
  return w ? `${w.name} won` : 'A draw';
};

interface Props {
  onBack: () => void;
}

/** Every finished game on this device: who wins most, which commanders
 * win most, and each game's recap. */
export default function HistoryScreen({ onBack }: Props) {
  const games = useAppStore((s) => s.games);
  const removedGames = useAppStore((s) => s.removedGames);
  const restoreGame = useAppStore((s) => s.restoreGame);
  const [open, setOpen] = useState<GameRecord | null>(null);
  const [removed, setRemoved] = useState<GameRecord[]>([]);

  // The shelf of games taken out, read again whenever one leaves or comes back.
  const listed = games.map((g) => g.id).join(',');
  useEffect(() => {
    let cancelled = false;
    void removedGames().then((rows) => {
      if (!cancelled) setRemoved(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [removedGames, listed]);

  const players = playerStandings(games);
  const commanders = commanderStandings(games).slice(0, 8);
  const most = Math.max(1, ...players.map((p) => p.wins));

  return (
    <div className="screen history">
      <header className="screen-header">
        <button className="ghost" onClick={onBack}>
          ‹ Home
        </button>
        <h1>History</h1>
        <span className="history-count">
          {games.length} {games.length === 1 ? 'game' : 'games'}
        </span>
      </header>

      {games.length === 0 ? (
        <p className="history-empty">
          No finished games yet. A game lands here when one player is left standing — or when it is
          ended with End → Who won?
        </p>
      ) : (
        <>
          <div className="history-boards">
            <section className="history-card">
              <h2 className="history-card-title">Players</h2>
              <ol className="standings">
                {players.map((p, i) => (
                  <li key={p.key} className="standing">
                    <span className="standing-rank">{i + 1}</span>
                    {p.image ? (
                      <img className="standing-avatar" src={p.image} alt="" loading="lazy" />
                    ) : (
                      <span className="standing-avatar standing-avatar--empty" />
                    )}
                    <span className="standing-name">{p.name}</span>
                    <span className="standing-bar" aria-hidden="true">
                      <i style={{ width: `${(p.wins / most) * 100}%` }} />
                    </span>
                    <span className="standing-score">
                      <strong>{p.wins}</strong> {p.wins === 1 ? 'win' : 'wins'} · {p.games} played
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            {commanders.length > 0 && (
              <section className="history-card">
                <h2 className="history-card-title">Commanders</h2>
                <ol className="standings">
                  {commanders.map((c) => (
                    <li key={c.key} className="standing standing--commander">
                      {c.image ? (
                        <img className="standing-card" src={c.image} alt="" loading="lazy" />
                      ) : (
                        <span className="standing-card standing-card--empty" />
                      )}
                      <span className="standing-name">{shortName(c.name)}</span>
                      <span className="standing-score" aria-label={`${c.wins} won, ${c.games - c.wins} lost`}>
                        <strong>{c.wins}</strong>–{c.games - c.wins}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          <section className="history-games">
            <h2 className="history-card-title">Games</h2>
            {games.map((rec) => {
              const w = rec.winner !== null ? rec.players[rec.winner] : null;
              const time = lasted(rec);
              return (
                <button key={rec.id} className="history-game" onClick={() => setOpen(rec)}>
                  {w?.commanderImage ? (
                    <img className="history-game-card" src={w.commanderImage} alt="" loading="lazy" />
                  ) : (
                    <span className="history-game-card history-game-card--empty">{w ? '🏆' : '⚖'}</span>
                  )}
                  <span className="history-game-text">
                    <span className="history-game-title">{titleOf(rec)}</span>
                    <span className="history-game-meta">
                      {DAY.format(rec.endedAt)} · turn {rec.turns}
                      {time && ` · ${time}`}
                      {rec.online && ' · online'}
                    </span>
                    <span className="history-game-players">{rec.players.map((p) => p.name).join(' · ')}</span>
                  </span>
                </button>
              );
            })}
          </section>
        </>
      )}

      {removed.length > 0 && (
        <section className="history-games history-removed">
          <h2 className="history-card-title">Taken out of the history</h2>
          {removed.map((rec) => (
            <div key={rec.id} className="deck-row">
              <span className="deck-row-title">
                <span className="deck-row-cardname">{titleOf(rec)}</span>
                <span className="deck-row-type">
                  {DAY.format(rec.endedAt)} · {rec.players.map((p) => p.name).join(' · ')}
                </span>
              </span>
              <button className="ghost" aria-label={`restore ${titleOf(rec)}`} onClick={() => void restoreGame(rec.id)}>
                Restore
              </button>
            </div>
          ))}
        </section>
      )}

      {open && <GameSheet rec={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function GameSheet({ rec, onClose }: { rec: GameRecord; onClose: () => void }) {
  const removeGame = useAppStore((s) => s.removeGame);
  const removing = useConfirmTap();
  return (
    <Sheet
      title={`${titleOf(rec)} · ${DAY.format(rec.endedAt)}`}
      size="roomy"
      onClose={onClose}
      footer={
        <button
          className={removing.armed ? 'danger' : 'ghost'}
          onClick={(e) => {
            if (!removing.confirms(e)) return;
            void removeGame(rec.id);
            onClose();
          }}
        >
          {removing.armed ? 'Really remove it?' : 'Remove from history'}
        </button>
      }
    >
      <GameRecap record={rec} />
    </Sheet>
  );
}
