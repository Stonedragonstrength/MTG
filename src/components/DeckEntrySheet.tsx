import { useEffect, useMemo, useRef, useState } from 'react';
import { getCardById } from '../data/scryfall';
import { addCard, deckSize } from '../lib/deck';
import { searchNames } from '../lib/fuzzy';
import { useAppStore } from '../state/store';
import { getNameIndex } from './nameIndexCache';
import Sheet from './Sheet';

interface Props {
  deckId: string;
  onClose: () => void;
}

/** Rapid entry: built for working through a physical pile — the box keeps
 * focus, enter takes the top hit, and the counter ticks toward 100. */
export default function DeckEntrySheet({ deckId, onClose }: Props) {
  const deck = useAppStore((s) => s.decks.find((d) => d.id === deckId));
  const saveDeck = useAppStore((s) => s.saveDeck);
  const [query, setQuery] = useState('');
  const [names, setNames] = useState<{ id: string; name: string }[]>([]);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getNameIndex().then(setNames);
  }, []);

  const results = useMemo(() => searchNames(query, names, 8), [query, names]);

  if (!deck) return null;

  async function pick(id: string) {
    if (!deck) return;
    const card = await getCardById(id);
    if (!card) return;
    await saveDeck(addCard(deck, card));
    setLastAdded(card.name);
    setQuery('');
    inputRef.current?.focus();
  }

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
          if (e.key === 'Enter' && results[0]) void pick(results[0].id);
        }}
      />
      <ul className="search-results">
        {results.map((r) => (
          <li key={r.id} className="search-result-row">
            <button className="search-result-main" onClick={() => void pick(r.id)}>
              {r.name}
            </button>
          </li>
        ))}
      </ul>
      {query.trim() === '' && (
        <p className="hint">
          Work through the pile: type a few letters, tap the card (or hit enter for the top
          match), and the box clears for the next one.
        </p>
      )}
    </Sheet>
  );
}
