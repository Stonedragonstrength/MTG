import { useEffect, useState } from 'react';
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

interface Props {
  onBack: () => void;
  /** Open this deck's editor straight away (e.g. one just started from a
   * Curation suggestion). */
  initialOpenId?: string;
}

export default function DecksScreen({ onBack, initialOpenId }: Props) {
  const decks = useAppStore((s) => s.decks);
  const saveDeck = useAppStore((s) => s.saveDeck);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [picking, setPicking] = useState(false);

  // Back from inside a deck returns to the deck list, not out of the app.
  useEffect(() => {
    if (!openId) return;
    return registerBack(() => setOpenId(null));
  }, [openId]);

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
