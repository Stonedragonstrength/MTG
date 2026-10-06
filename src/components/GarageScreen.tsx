import { useState } from 'react';
import { groupCards } from '../lib/deck';
import { normalize } from '../lib/fuzzy';
import type { DeckCard, GarageCard } from '../lib/types';
import { useAppStore } from '../state/store';
import DeckCardSheet from './DeckCardSheet';

interface Props {
  onBack: () => void;
}

/** The curation (né garage): every card you've swiped or pasted, your
 * whole physical collection, browsable and countable. */
export default function GarageScreen({ onBack }: Props) {
  const garage = useAppStore((s) => s.garage);
  const setGarageCount = useAppStore((s) => s.setGarageCount);
  const [filter, setFilter] = useState('');
  const [viewing, setViewing] = useState<GarageCard | null>(null);

  const total = garage.reduce((sum, g) => sum + g.count, 0);
  const shown = filter.trim()
    ? garage.filter((g) => normalize(g.name).includes(normalize(filter)))
    : garage;

  // groupCards speaks DeckCard; a garage row quacks close enough.
  const asDeckCards: DeckCard[] = shown.map((g) => ({
    cardId: g.cardId,
    name: g.name,
    typeLine: g.typeLine,
    manaCost: '',
    imageNormal: g.imageNormal,
    count: g.count,
  }));
  const groups = groupCards(asDeckCards);

  return (
    <div className="screen deck-editor">
      <header className="screen-header">
        <button className="ghost" onClick={onBack}>
          ‹ Home
        </button>
        <h1>Curation</h1>
        <span className="deck-size">{total} cards</span>
      </header>

      <input
        type="search"
        placeholder="Filter the collection…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {garage.length === 0 ? (
        <p className="hint">
          Empty so far — every card you swipe or paste into a deck joins the curation
          automatically.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="deck-group">
            <h2 className="deck-group-title">
              {group.label}
              <span className="deck-group-count">
                {group.cards.reduce((sum, c) => sum + c.count, 0)}
              </span>
            </h2>
            {group.cards.map((card) => (
              <div key={card.cardId} className="deck-row">
                <button
                  className="deck-row-name"
                  onClick={() => setViewing(garage.find((g) => g.cardId === card.cardId) ?? null)}
                >
                  {card.name}
                </button>
                <div className="stepper stepper--tight">
                  <button
                    aria-label={`one fewer ${card.name}`}
                    onClick={() => void setGarageCount(card.cardId, card.count - 1)}
                  >
                    −
                  </button>
                  <span>×{card.count}</span>
                  <button
                    aria-label={`one more ${card.name}`}
                    onClick={() => void setGarageCount(card.cardId, card.count + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </section>
        ))
      )}

      {viewing && (
        <DeckCardSheet
          card={{
            cardId: viewing.cardId,
            name: viewing.name,
            typeLine: viewing.typeLine,
            manaCost: '',
            imageNormal: viewing.imageNormal,
            count: viewing.count,
          }}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
