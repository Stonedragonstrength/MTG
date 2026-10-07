import { useState } from 'react';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';

const DOT: Record<string, string> = {
  connecting: 'pill-dot--amber',
  live: 'pill-dot--green',
  offline: 'pill-dot--red',
  'stale-build': 'pill-dot--amber',
  ended: 'pill-dot--grey',
};

/** The online table's heartbeat: status dot + code + device count,
 * screen-oriented so every seat can read it. Tap for the table sheet. */
export default function TablePill() {
  const online = useAppStore((s) => s.online);
  const game = useAppStore((s) => s.game);
  const setMySeat = useAppStore((s) => s.setMySeat);
  const decks = useAppStore((s) => s.decks);
  const seedSeatFromDeck = useAppStore((s) => s.seedSeatFromDeck);
  const leaveOnlineTable = useAppStore((s) => s.leaveOnlineTable);
  const exitToHome = useAppStore((s) => s.exitToHome);
  const endGame = useAppStore((s) => s.endGame);
  const [open, setOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (!online) return null;
  const peers = online.status.kind === 'live' ? online.status.peers : null;
  // A cards table where your own seat was never dealt in: the join sheet
  // asks once, this is the standing way to answer later.
  const mySeat = online.mySeat;
  const deckless =
    mySeat !== null && game?.config.mode === 'cards' && game.players[mySeat]?.cards === undefined;

  if (online.status.kind === 'stale-build') {
    return (
      <div className="table-banner" role="status">
        Table updated — refresh the app to keep playing.
      </div>
    );
  }

  return (
    <>
      <button className="table-pill" onClick={() => setOpen(true)} aria-label="online table">
        <span className={`pill-dot ${DOT[online.status.kind]}`} />
        {online.code}
        {peers !== null && <span className="pill-peers">· {peers}</span>}
      </button>
      {open && (
        <Sheet title="Online table" onClose={() => setOpen(false)}>
          <p className="table-code-big">{online.code}</p>
          <p className="hint">
            Friends join from their own device: Home → Join table → this code.
            {peers !== null ? ` ${peers} device${peers === 1 ? '' : 's'} connected.` : ''}
          </p>
          <div className="modal-actions">
            <button
              onClick={() => {
                const text = `Join my MTG table: code ${online.code} at https://mtg.stonedragonstrengthtraining.com`;
                if (navigator.share) void navigator.share({ text }).catch(() => {});
                else void navigator.clipboard?.writeText(text);
              }}
            >
              Share code
            </button>
          </div>
          {game && (
            <div className="detail-section">
              <span className="section-label">Your seat</span>
              <div className="chip-row">
                {game.config.profiles.map((p, i) => (
                  <button
                    key={p.id}
                    className={`chip${online.mySeat === i ? ' chip--recent' : ''}`}
                    aria-pressed={online.mySeat === i}
                    onClick={() => setMySeat(online.mySeat === i ? null : i)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {deckless && decks.length > 0 && (
            <div className="detail-section">
              <span className="section-label">Bring a deck</span>
              <p className="hint">Your seat has no cards yet — pick one of your decks to shuffle up.</p>
              <div className="chip-row">
                {decks.map((d) => (
                  <button
                    key={d.id}
                    className="chip"
                    onClick={() => {
                      seedSeatFromDeck(mySeat, d);
                      setOpen(false);
                    }}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="modal-actions">
            <button
              className="ghost"
              onClick={() => {
                leaveOnlineTable();
                exitToHome();
                setOpen(false);
              }}
            >
              Leave table
            </button>
            {confirmEnd ? (
              <button
                className="danger"
                onClick={() => {
                  endGame();
                  setOpen(false);
                }}
              >
                Really end for everyone?
              </button>
            ) : (
              <button className="danger" onClick={() => setConfirmEnd(true)}>
                End for everyone
              </button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
