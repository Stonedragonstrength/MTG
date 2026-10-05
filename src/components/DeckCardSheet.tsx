import { useEffect, useState } from 'react';
import { getCardById } from '../data/scryfall';
import { edhrecUrl } from '../lib/edhrec';
import type { CardRecord, DeckCard } from '../lib/types';
import Sheet from './Sheet';
import SynergySheet from './SynergySheet';

interface Props {
  card: DeckCard;
  onClose: () => void;
}

/** The battlefield detail sheet's little sibling: art, rules text,
 * EDHREC and synergies — read-only, for browsing the deck list. */
export default function DeckCardSheet({ card, onClose }: Props) {
  const [full, setFull] = useState<CardRecord | null>(null);
  const [synergiesOpen, setSynergiesOpen] = useState(false);

  useEffect(() => {
    getCardById(card.cardId).then((c) => setFull(c ?? null));
  }, [card.cardId]);

  const isCommanderish = /Legendary.*Creature/.test(card.typeLine);

  return (
    <Sheet title={card.name} onClose={onClose}>
      <div className="card-hero">
        {(full?.imageNormal ?? card.imageNormal) && (
          <img
            className="card-image"
            src={full?.imageNormal ?? card.imageNormal ?? undefined}
            alt={card.name}
          />
        )}
        <p className="type-line">{card.typeLine}</p>
        <p className="card-links">
          <a href={edhrecUrl(card.name, isCommanderish)} target="_blank" rel="noreferrer">
            EDHREC ↗
          </a>
          <button className="ghost" onClick={() => setSynergiesOpen(true)}>
            Goes well with…
          </button>
        </p>
        {full?.oracleText && <p className="oracle-text">{full.oracleText}</p>}
      </div>
      {synergiesOpen && (
        <SynergySheet
          cardId={card.cardId}
          cardName={card.name}
          isCommander={isCommanderish}
          onClose={() => setSynergiesOpen(false)}
        />
      )}
    </Sheet>
  );
}
