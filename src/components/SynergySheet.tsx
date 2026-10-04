import { useEffect, useState } from 'react';
import { findSynergiesFor, type SynergyHit } from '../data/synergy';
import { edhrecUrl } from '../lib/edhrec';
import Sheet from './Sheet';

interface Props {
  cardId: string;
  cardName: string;
  isCommander: boolean;
  onClose: () => void;
}

/** Offline theme matches for a card, with the real stats a tap away. */
export default function SynergySheet({ cardId, cardName, isCommander, onClose }: Props) {
  const [hits, setHits] = useState<SynergyHit[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    findSynergiesFor(cardId, 24).then((results) => {
      if (!cancelled) setHits(results);
    });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  return (
    <Sheet title={`Goes well with ${cardName}`} onClose={onClose} size="wide">
      <p className="hint">
        Theme matches from your offline database — rough ideas, not deck stats.{' '}
        <a href={edhrecUrl(cardName, isCommander)} target="_blank" rel="noreferrer">
          See real data on EDHREC ↗
        </a>
      </p>
      {hits === null ? (
        <p className="hint">Reading 36,000 cards…</p>
      ) : hits.length === 0 ? (
        <p className="hint">No strong theme matches found for this card.</p>
      ) : (
        <div className="preview-grid">
          {hits.map(({ card, shared }) => (
            <div key={card.id} className="preview-card">
              {card.imageNormal ? (
                <img src={card.imageNormal} alt={card.name} loading="lazy" />
              ) : (
                <span className="preview-placeholder" />
              )}
              <span className="preview-name">{card.name}</span>
              <span className="shared-chips">
                {shared.slice(0, 3).map((theme) => (
                  <span key={theme} className="player-chip">
                    {theme.replace('tribal:', '')}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
