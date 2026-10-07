import { useEffect, useState } from 'react';
import { getCardById } from '../data/scryfall';
import { findCommandersFor } from '../data/synergy';
import { rankBuildable, type Buildable, type OwnedRow } from '../lib/buildable';
import { createDeck, setCommander } from '../lib/deck';
import { deckThemeProfile } from '../lib/themes';
import type { CardRecord } from '../lib/types';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';

interface Props {
  onClose: () => void;
  /** Called with the new deck's id once a suggestion is picked. */
  onStarted?: (deckId: string) => void;
}

/** "What can I build?" — reads the themes running through the whole
 * collection and ranks commanders that lean into them, saying how many of
 * your own cards each could use. Picking one starts the deck. */
export default function CurationBuildSheet({ onClose, onStarted }: Props) {
  const garage = useAppStore((s) => s.garage);
  const saveDeck = useAppStore((s) => s.saveDeck);
  const [found, setFound] = useState<Buildable[] | null>(null);

  const key = garage.map((g) => `${g.cardId}:${g.count}`).join(',');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: { card: CardRecord; count: number }[] = [];
      const rows: OwnedRow[] = [];
      for (const g of garage) {
        const record = await getCardById(g.cardId).catch(() => undefined);
        if (cancelled) return;
        rows.push({
          cardId: g.cardId,
          count: g.count,
          identity: record ? (record.colorIdentity ?? record.colors) : undefined,
        });
        if (record) entries.push({ card: record, count: g.count });
      }
      // No color restriction: the collection decides what it wants to be.
      const matches = await findCommandersFor(deckThemeProfile(entries), [], 30);
      if (!cancelled) setFound(rankBuildable(matches, rows, 10));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function start(pick: Buildable) {
    const deck = setCommander(createDeck(pick.card.name), pick.card);
    await saveDeck(deck);
    onStarted?.(deck.id);
    onClose();
  }

  const top = found?.[0]?.score ?? 1;

  return (
    <Sheet title="What can I build?" onClose={onClose} size="wide">
      {garage.length === 0 ? (
        <p className="hint">
          Nothing in the Curation yet — scan or paste some cards and the suggestions will follow.
        </p>
      ) : (
        <>
          <p className="hint">
            Commanders that lean into what your collection already does. Pick one to start a deck
            around it — theme matching from your offline database, not tournament wisdom.
          </p>
          {found === null ? (
            <p className="hint">Reading the collection, then 36,000 cards…</p>
          ) : found.length === 0 ? (
            <p className="hint">
              Not enough rules text to read themes from yet — add a few more cards and try again.
            </p>
          ) : (
            <ul className="align-list">
              {found.map((b) => (
                <li key={b.card.id}>
                  <button
                    className="align-row"
                    aria-label={`start a deck with ${b.card.name}`}
                    onClick={() => void start(b)}
                  >
                    {b.card.imageNormal ? (
                      <img className="align-thumb" src={b.card.imageNormal} alt="" loading="lazy" />
                    ) : (
                      <span className="align-thumb align-thumb--empty" />
                    )}
                    <span className="align-main">
                      <span className="align-name">
                        {b.card.name}
                        {b.owned && <span className="build-owned"> ★ in your collection</span>}
                      </span>
                      <span className="align-pips">
                        {(b.card.colorIdentity ?? b.card.colors).map((c) => (
                          <span key={c} className={`mana-pip mana-pip--mini mana-${c}`} />
                        ))}
                      </span>
                      <span className="align-bar" aria-hidden="true">
                        <span
                          className="align-bar-fill"
                          style={{ width: `${Math.max(6, Math.round((b.score / top) * 100))}%` }}
                        />
                      </span>
                      <span className="build-coverage">
                        You own {b.coverage} {b.coverage === 1 ? 'card' : 'cards'} in its colors
                      </span>
                      <span className="align-shared">
                        {b.shared.slice(0, 4).map((theme) => (
                          <span key={theme} className="align-theme">
                            {theme}
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Sheet>
  );
}
