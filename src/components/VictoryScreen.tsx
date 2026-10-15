import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { findCardByName } from '../data/scryfall';
import { lasted, recordOf, shortName } from '../lib/history';
import { playVictory } from '../lib/sound';
import { useAppStore } from '../state/store';
import GameRecap from './GameRecap';
import '../styles/victory.css';

/** Taps this soon after the screen appears are the end of the move that
 * decided the game (a count-down on the life buttons), never an answer. */
export const VICTORY_SETTLE_MS = 1200;
const SPARKS = 14;

interface Props {
  /** The winner's edge of the table: the screen turns to face them. */
  edge: string;
  flipped: boolean;
  onHide: () => void;
}

/** The game is over: the winner, big, over their commander's art, and the
 * recap. Rematch deals the same table again; Home ends the game (it is
 * already in the history); the board can still be looked at. */
export default function VictoryScreen({ edge, flipped, onHide }: Props) {
  const game = useAppStore((s) => s.game);
  const online = useAppStore((s) => s.online);
  const decks = useAppStore((s) => s.decks);
  const soundOn = useAppStore((s) => s.settings.soundOn);
  const rematch = useAppStore((s) => s.rematch);
  const endGame = useAppStore((s) => s.endGame);
  const undo = useAppStore((s) => s.undo);
  const canUndo = useAppStore((s) => s.canUndo);
  const [ready, setReady] = useState(false);
  const [art, setArt] = useState<string | null>(null);

  const record = useMemo(
    () =>
      game
        ? recordOf(game, {
            now: Date.now(),
            online: !!online,
            deckNames: Object.fromEntries(decks.map((d) => [d.id, d.name])),
          })
        : null,
    [game, online, decks],
  );
  const winner = record && record.winner !== null ? record.players[record.winner] : null;
  const commander = winner?.commanderName ?? null;

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), VICTORY_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, []);

  // The commander's art fills the screen behind the winner.
  useEffect(() => {
    let live = true;
    setArt(null);
    if (commander)
      findCardByName(commander)
        .then((card) => {
          if (live) setArt(card?.imageArtCrop ?? null);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [commander]);

  const id = record?.id;
  useEffect(() => {
    if (!id || !soundOn) return;
    const t = window.setTimeout(playVictory, 350);
    return () => window.clearTimeout(t);
    // Once per game shown, not on every redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!record) return null;
  const time = lasted(record);
  const backdrop = art ?? winner?.commanderImage ?? winner?.avatarUrl ?? null;
  const style = { ...(flipped ? { '--flip': '180deg' } : {}) } as CSSProperties;

  return (
    <div className="victory" role="dialog" aria-modal="true" aria-label="Game over">
      <div className={`victory-panel victory-panel--${edge}`} style={style}>
        {backdrop && (
          <div
            className={art ? 'victory-art' : 'victory-art victory-art--soft'}
            style={{ backgroundImage: `url("${backdrop}")` }}
          />
        )}
        <div className="victory-shade" />
        <div className="victory-sparks" aria-hidden="true">
          {Array.from({ length: SPARKS }, (_, i) => (
            <i key={i} style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
        <div className="victory-body">
          <div className="victory-hero">
            {winner?.commanderImage ? (
              <div className="victory-card-wrap">
                <div className="victory-rays" aria-hidden="true" />
                <img className="victory-card" src={winner.commanderImage} alt={commander ?? ''} />
              </div>
            ) : winner?.avatarUrl ? (
              <div className="victory-card-wrap">
                <div className="victory-rays" aria-hidden="true" />
                <img className="victory-avatar" src={winner.avatarUrl} alt="" />
              </div>
            ) : null}
            <div className="victory-title">
              <span className="victory-kicker">{winner ? 'Victory' : 'Draw'}</span>
              <h2 className="victory-name">{winner ? winner.name : 'Nobody wins'}</h2>
              <p className="victory-sub">
                {winner ? 'wins' : 'everyone fell'} on turn {record.turns}
                {time && ` · ${time}`}
              </p>
              {winner && commander && (
                <p className="victory-with">
                  with {shortName(commander)}
                  {winner.partnerName && ` & ${shortName(winner.partnerName)}`}
                  {winner.deckName && <span className="victory-deck"> · {winner.deckName}</span>}
                </p>
              )}
            </div>
          </div>
          <div className="victory-recap">
            <GameRecap record={record} />
          </div>
        </div>
        <div className={ready ? 'victory-actions victory-actions--ready' : 'victory-actions'}>
          {!online && (
            <button className="primary" disabled={!ready} onClick={rematch}>
              Rematch
            </button>
          )}
          <button disabled={!ready} onClick={() => endGame()}>
            Home
          </button>
          <button className="ghost" disabled={!ready} onClick={onHide}>
            Look at the board
          </button>
          {canUndo() && (
            <button className="ghost victory-undo" disabled={!ready} onClick={undo}>
              ↩ Undo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
