import { useEffect, useRef, useState } from 'react';
import { registerBack } from '../lib/backstack';
import { createDeck, deckSize, setCommander } from '../lib/deck';
import { isCommanderLegal } from '../lib/game';
import { COLOR_HEX } from '../lib/mana';
import type { Deck } from '../lib/types';
import { useAppStore } from '../state/store';
import AvatarPicker from './AvatarPicker';
import DeckEditor from './DeckEditor';

function deckAccent(deck: Deck): string {
  return deck.colors.length === 1 ? COLOR_HEX[deck.colors[0]] : 'var(--accent)';
}

function timeAgo(t: number): string {
  const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

interface Props {
  onBack: () => void;
  /** Open this deck's editor straight away (e.g. one just started from a
   * Curation suggestion). */
  initialOpenId?: string;
}

export default function DecksScreen({ onBack, initialOpenId }: Props) {
  const decks = useAppStore((s) => s.decks);
  const saveDeck = useAppStore((s) => s.saveDeck);
  const removedDecks = useAppStore((s) => s.removedDecks);
  const restoreDeck = useAppStore((s) => s.restoreDeck);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [picking, setPicking] = useState(false);
  const [removed, setRemoved] = useState<Deck[]>([]);
  const shelved = useRef(0); // how many the shelf shows now

  // The safety shelf: a deletion travels to every device, so deleted decks
  // wait here for a Restore. Read again whenever a deck joins or leaves the
  // list — one deleted on another device leaves it when the sync lands —
  // but not on every edit: the editor saves on each keystroke.
  const listed = decks
    .map((d) => d.id)
    .sort()
    .join(',');
  useEffect(() => {
    let cancelled = false;
    void removedDecks().then((rows) => {
      // Empty, and still empty: nothing to redraw.
      if (cancelled || (rows.length === 0 && shelved.current === 0)) return;
      shelved.current = rows.length;
      setRemoved(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [removedDecks, listed]);

  // A deck that is open from the very first render must not claim the back
  // button before the screen that opened Decks has: effects run child
  // first, which would put "leave Decks" ABOVE "close the deck". So the
  // deck's claim waits one commit.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Back from inside a deck returns to the deck list, not out of the app.
  useEffect(() => {
    if (!openId || !mounted) return;
    return registerBack(() => setOpenId(null));
  }, [openId, mounted]);

  if (openId) return <DeckEditor deckId={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="screen decks">
      <header className="screen-header">
        <button className="ghost" onClick={onBack}>
          ‹ Home
        </button>
        <h1>Decks</h1>
      </header>

      <div className="profile-grid">
        {decks.map((deck) => (
          <button
            key={deck.id}
            className="profile-card"
            style={{ borderColor: deckAccent(deck) }}
            aria-label={`open deck ${deck.name}`}
            onClick={() => setOpenId(deck.id)}
          >
            <span className={`deck-tile-arts${deck.partner ? ' deck-tile-arts--pair' : ''}`}>
              {deck.commander?.imageNormal && (
                <img
                  className="profile-commander-card"
                  src={deck.commander.imageNormal}
                  alt=""
                  loading="lazy"
                />
              )}
              {deck.partner?.imageNormal && (
                <img
                  className="profile-commander-card"
                  src={deck.partner.imageNormal}
                  alt=""
                  loading="lazy"
                />
              )}
            </span>
            <span className="profile-name">{deck.name}</span>
            <span className="deck-tile-count">{deckSize(deck)} cards</span>
            {deck.colors.length > 0 && (
              <span className="profile-pips">
                {deck.colors.map((c) => (
                  <span key={c} className={`mana-pip mana-pip--mini mana-${c}`} />
                ))}
              </span>
            )}
          </button>
        ))}
        <button
          className="profile-card profile-card--add"
          aria-label="new deck"
          onClick={() => setPicking(true)}
        >
          <span className="profile-add-plus">+</span>
          <span className="profile-name">New deck</span>
        </button>
        <button
          className="profile-card profile-card--add"
          aria-label="start from cards"
          onClick={() => {
            const deck = createDeck('Untitled deck');
            void saveDeck(deck);
            setOpenId(deck.id);
          }}
        >
          <span className="profile-add-plus">🂠</span>
          <span className="profile-name">Start from cards</span>
          <span className="deck-tile-count">find the commander later</span>
        </button>
      </div>

      {removed.length > 0 && (
        <section className="deck-group decks-removed">
          <h2 className="deck-group-title">Recently deleted</h2>
          <p className="hint">
            Accidents park here — Restore brings the whole deck back, on every device.
          </p>
          {removed.map((deck) => (
            <div key={deck.id} className="deck-row">
              <span className="deck-row-title">
                <span className="deck-row-cardname">{deck.name}</span>
                <span className="deck-row-type">
                  {deckSize(deck)} cards · {timeAgo(deck.updatedAt)}
                </span>
              </span>
              <button
                className="ghost"
                aria-label={`restore deck ${deck.name}`}
                onClick={() => void restoreDeck(deck.id)}
              >
                Restore
              </button>
            </div>
          ))}
        </section>
      )}

      {picking && (
        <AvatarPicker
          title="Pick commander"
          filter={isCommanderLegal}
          onPick={(card) => {
            const deck = setCommander(createDeck(card.name), card);
            void saveDeck(deck);
            setPicking(false);
            setOpenId(deck.id);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
