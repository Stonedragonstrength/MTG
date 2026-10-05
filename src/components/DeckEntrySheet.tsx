import { useEffect, useMemo, useRef, useState } from 'react';
import { findCardByName, getCardById } from '../data/scryfall';
import { addCard, deckSize } from '../lib/deck';
import { searchNames } from '../lib/fuzzy';
import { STAPLE_CATEGORIES } from '../lib/staples';
import type { CardRecord } from '../lib/types';
import { useAppStore } from '../state/store';
import { getNameIndex } from './nameIndexCache';
import Sheet from './Sheet';

interface Props {
  deckId: string;
  onClose: () => void;
}

/** Rapid entry: built for working through a physical pile — the box keeps
 * focus, enter takes the top hit, and the counter ticks toward 100.
 * Tokens never appear here: decks are made of real cards. */
export default function DeckEntrySheet({ deckId, onClose }: Props) {
  const deck = useAppStore((s) => s.decks.find((d) => d.id === deckId));
  const saveDeck = useAppStore((s) => s.saveDeck);
  const [query, setQuery] = useState('');
  const [names, setNames] = useState<{ id: string; name: string }[]>([]);
  const [suggestions, setSuggestions] = useState<CardRecord[]>([]);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [staplesOpen, setStaplesOpen] = useState<string | null>(null);
  const [staples, setStaples] = useState<CardRecord[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getNameIndex().then(setNames);
  }, []);

  // Tokens share names with real cards ("Elemental") and exact matches rank
  // first, so suggestions go through the full records: over-fetch, drop
  // tokens, keep 8, and show type lines so same-name cards stay tellable.
  const candidates = useMemo(() => searchNames(query, names, 24), [query, names]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kept: CardRecord[] = [];
      for (const c of candidates) {
        if (cancelled) return;
        const card = await getCardById(c.id).catch(() => undefined);
        if (card && !card.isToken) kept.push(card);
        if (kept.length >= 8) break;
      }
      if (!cancelled) setSuggestions(kept);
    })();
    return () => {
      cancelled = true;
    };
  }, [candidates]);

  // A staple category resolves its names once per open, keeping only cards
  // inside the deck's color identity (everything, if no commander yet).
  const deckColors = deck?.colors ?? [];
  useEffect(() => {
    if (!staplesOpen) {
      setStaples([]);
      return;
    }
    const category = STAPLE_CATEGORIES.find((c) => c.label === staplesOpen);
    if (!category) return;
    let cancelled = false;
    (async () => {
      const kept: CardRecord[] = [];
      for (const name of category.names) {
        if (cancelled) return;
        const card = await findCardByName(name).catch(() => undefined);
        if (!card || card.isToken) continue;
        const identity = card.colorIdentity ?? card.colors;
        if (deckColors.length > 0 && identity.some((c) => !deckColors.includes(c))) continue;
        kept.push(card);
      }
      if (!cancelled) setStaples(kept);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staplesOpen, deckColors.join('')]);

  if (!deck) return null;

  async function add(card: CardRecord) {
    if (!deck) return;
    await saveDeck(addCard(deck, card));
    setLastAdded(card.name);
    setQuery('');
    inputRef.current?.focus();
  }

  const owned = new Set(deck.cards.map((c) => c.cardId));

  return (
    <Sheet title="Add cards" onClose={onClose} size="wide">
      <div className="entry-status">
        <span className="deck-size">{deckSize(deck)} / 100</span>
        {lastAdded && <span className="entry-last">Added {lastAdded}</span>}
      </div>
      <input
        ref={inputRef}
        autoFocus
        type="search"
        placeholder="Type a card name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && suggestions[0]) void add(suggestions[0]);
        }}
      />
      {query.trim() !== '' ? (
        <ul className="search-results">
          {suggestions.map((card) => (
            <li key={card.id} className="search-result-row">
              <button className="search-result-main entry-result" onClick={() => void add(card)}>
                <span className="entry-result-name">{card.name}</span>
                <span className="entry-result-type">{card.typeLine}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="chip-row entry-staple-cats" aria-label="staple categories">
            {STAPLE_CATEGORIES.map((c) => (
              <button
                key={c.label}
                className={`chip${staplesOpen === c.label ? ' chip--recent' : ''}`}
                aria-pressed={staplesOpen === c.label}
                onClick={() => setStaplesOpen((prev) => (prev === c.label ? null : c.label))}
              >
                {c.label}
              </button>
            ))}
          </div>
          {staplesOpen && (
            <div className="chip-row entry-staples">
              {staples.map((card) => {
                const have = owned.has(card.id);
                return (
                  <button
                    key={card.id}
                    className={`chip${have ? ' chip--owned' : ''}`}
                    disabled={have}
                    onClick={() => void add(card)}
                  >
                    {card.name}
                    {have ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
          )}
          {!staplesOpen && (
            <p className="hint">
              Work through the pile: type a few letters, tap the card (or hit enter for the top
              match), and the box clears for the next one. Or tap a category for the usual
              staples in your colors.
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
