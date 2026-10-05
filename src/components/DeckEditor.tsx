import { useState } from 'react';
import { changeCardCount, deckSize, groupCards, manaCurve } from '../lib/deck';
import type { DeckCard } from '../lib/types';
import { useAppStore } from '../state/store';
import DeckCardSheet from './DeckCardSheet';
import DeckEntrySheet from './DeckEntrySheet';

/** The bars read relative to the deck's own tallest bucket. */
function CurveBar({ curve }: { curve: number[] }) {
  const max = Math.max(1, ...curve);
  return (
    <div className="deck-curve" aria-label="mana curve">
      {curve.map((n, mv) => (
        <div key={mv} className="deck-curve-col" title={`${mv === 7 ? '7+' : mv} mana: ${n}`}>
          <div
            className="deck-curve-bar"
            style={{ height: `${Math.round((n / max) * 100)}%` }}
          />
          <span className="deck-curve-label">{mv === 7 ? '7+' : mv}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  deckId: string;
  onBack: () => void;
}

export default function DeckEditor({ deckId, onBack }: Props) {
  const deck = useAppStore((s) => s.decks.find((d) => d.id === deckId));
  const saveDeck = useAppStore((s) => s.saveDeck);
  const deleteDeck = useAppStore((s) => s.deleteDeck);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<DeckCard | null>(null);

  if (!deck) return null;
  const groups = groupCards(deck.cards);
  const size = deckSize(deck);

  return (
    <div className="screen deck-editor">
      <header className="screen-header">
        <button className="ghost" onClick={onBack}>
          ‹ Decks
        </button>
        <input
          className="deck-name-input"
          aria-label="deck name"
          value={deck.name}
          onChange={(e) => void saveDeck({ ...deck, name: e.target.value })}
        />
        <span className={`deck-size${size === 100 ? ' deck-size--full' : ''}`}>
          {size} / 100
        </span>
      </header>

      <div className="deck-hero">
        {deck.commander?.imageNormal && (
          <img className="deck-commander-img" src={deck.commander.imageNormal} alt="" />
        )}
        <div className="deck-hero-info">
          {deck.commander && <span className="deck-commander-name">{deck.commander.name}</span>}
          <span className="profile-pips">
            {deck.colors.map((c) => (
              <span key={c} className={`mana-pip mana-pip--mini mana-${c}`} />
            ))}
          </span>
          <CurveBar curve={manaCurve(deck.cards)} />
        </div>
      </div>

      <button className="primary deck-add-btn" onClick={() => setAdding(true)}>
        + Add cards
      </button>

      {groups.map((group) => (
        <section key={group.label} className="deck-group">
          <h2 className="deck-group-title">
            {group.label}
            <span className="deck-group-count">
              {group.cards.reduce((sum, c) => sum + c.count, 0)}
            </span>
          </h2>
          {group.cards.map((card) => (
            <div key={card.cardId} className="deck-row">
              <button className="deck-row-name" onClick={() => setViewing(card)}>
                {card.name}
              </button>
              <span className="deck-row-cost">{card.manaCost}</span>
              <div className="stepper stepper--tight">
                <button
                  aria-label={`one fewer ${card.name}`}
                  onClick={() => void saveDeck(changeCardCount(deck, card.cardId, -1))}
                >
                  −
                </button>
                <span>×{card.count}</span>
                <button
                  aria-label={`one more ${card.name}`}
                  onClick={() => void saveDeck(changeCardCount(deck, card.cardId, 1))}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </section>
      ))}

      <footer className="deck-footer">
        <button
          className="danger"
          onClick={() => {
            void deleteDeck(deck.id);
            onBack();
          }}
        >
          Delete deck
        </button>
      </footer>

      {adding && <DeckEntrySheet deckId={deck.id} onClose={() => setAdding(false)} />}
      {viewing && <DeckCardSheet card={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
