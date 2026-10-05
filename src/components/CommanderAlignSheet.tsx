import { useEffect, useState } from 'react';
import { getCardById } from '../data/scryfall';
import { findCommandersFor, type CommanderMatch } from '../data/synergy';
import { setCommander } from '../lib/deck';
import { deckThemeProfile } from '../lib/themes';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';

interface Props {
  deckId: string;
  onClose: () => void;
}

/** Reverse commander search: reads the deck's themes and ranks legal
 * commanders that lean into them, alignment bar and reasons included. */
export default function CommanderAlignSheet({ deckId, onClose }: Props) {
  const deck = useAppStore((s) => s.decks.find((d) => d.id === deckId));
  const saveDeck = useAppStore((s) => s.saveDeck);
  const [matches, setMatches] = useState<CommanderMatch[] | null>(null);

  const cardsKey = deck?.cards.map((c) => `${c.cardId}:${c.count}`).join(',');
  useEffect(() => {
    if (!deck) return;
    let cancelled = false;
    (async () => {
      const entries = [];
      const colorSet = new Set<string>();
      for (const c of deck.cards) {
        const record = await getCardById(c.cardId).catch(() => undefined);
        if (cancelled) return;
        if (!record) continue;
        entries.push({ card: record, count: c.count });
        for (const color of record.colorIdentity ?? record.colors) colorSet.add(color);
      }
      const profile = deckThemeProfile(entries);
      const found = await findCommandersFor(profile, [...colorSet], 10);
      if (!cancelled) setMatches(found);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsKey]);

  if (!deck) return null;

  function crown(match: CommanderMatch) {
    if (!deck) return;
    void saveDeck(setCommander(deck, match.card));
    onClose();
  }

  const top = matches?.[0]?.score ?? 1;

  return (
    <Sheet title="Align commander" onClose={onClose} size="wide">
      <p className="hint">
        Who wants to lead this pile? Ranked by how hard each commander leans into what your
        cards already do — theme matching from your offline database, not tournament wisdom.
      </p>
      {matches === null ? (
        <p className="hint">Reading the deck, then 36,000 cards…</p>
      ) : matches.length === 0 ? (
        <p className="hint">
          Not enough rules text to read themes from yet — add a few more cards and try again.
        </p>
      ) : (
        <ul className="align-list">
          {matches.map((m) => (
            <li key={m.card.id}>
              <button className="align-row" onClick={() => crown(m)}>
                {m.card.imageNormal ? (
                  <img className="align-thumb" src={m.card.imageNormal} alt="" loading="lazy" />
                ) : (
                  <span className="align-thumb align-thumb--empty" />
                )}
                <span className="align-main">
                  <span className="align-name">{m.card.name}</span>
                  <span className="align-pips">
                    {(m.card.colorIdentity ?? m.card.colors).map((c) => (
                      <span key={c} className={`mana-pip mana-pip--mini mana-${c}`} />
                    ))}
                  </span>
                  <span className="align-bar" aria-label={`alignment ${m.score}`}>
                    <span
                      className="align-bar-fill"
                      style={{ width: `${Math.max(6, Math.round((m.score / top) * 100))}%` }}
                    />
                  </span>
                  <span className="align-shared">
                    {m.shared.slice(0, 4).map((theme) => (
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
    </Sheet>
  );
}
