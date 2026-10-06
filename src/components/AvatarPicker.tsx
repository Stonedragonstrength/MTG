import { useEffect, useRef, useState } from 'react';
import { getCardById } from '../data/scryfall';
import { searchNames } from '../lib/fuzzy';
import type { CardRecord } from '../lib/types';
import { getNameIndex } from './nameIndexCache';
import Sheet from './Sheet';

interface Props {
  title: string;
  onPick: (card: CardRecord) => void;
  onClose: () => void;
  /** Keeps only qualifying cards (e.g. commander-legal); candidates whose
   * record can't be loaded are dropped rather than shown unverified. */
  filter?: (card: CardRecord) => boolean;
  /** A shortlist shown before anything is typed (e.g. every legal partner). */
  suggestions?: CardRecord[];
}

/** Card search with art previews; used for avatars and commander picks. */
export default function AvatarPicker({ title, onPick, onClose, filter, suggestions }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [previews, setPreviews] = useState<Record<string, CardRecord>>({});
  const names = useRef<{ id: string; name: string }[]>([]);

  useEffect(() => {
    getNameIndex().then((idx) => {
      names.current = idx;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (query.trim() === '' && suggestions && suggestions.length > 0) {
        setResults(suggestions.map((c) => ({ id: c.id, name: c.name })));
        setPreviews(Object.fromEntries(suggestions.map((c) => [c.id, c])));
        return;
      }
      // Filtering needs the full card, so cast a wider net and keep 12 hits.
      const candidates = searchNames(query, names.current, filter ? 48 : 12);
      const kept: { id: string; name: string }[] = [];
      const loaded: Record<string, CardRecord> = {};
      for (const r of candidates) {
        if (cancelled) return;
        const card = await getCardById(r.id);
        if (!card) {
          if (!filter) kept.push(r);
          continue;
        }
        if (filter && !filter(card)) continue;
        loaded[r.id] = card;
        kept.push(r);
        if (kept.length >= 12) break;
      }
      if (!cancelled) {
        setResults(kept);
        setPreviews(loaded);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, filter, suggestions]);

  function pick(id: string) {
    const card = previews[id];
    if (card) onPick(card);
    else void getCardById(id).then((c) => c && onPick(c));
  }

  return (
    <Sheet title={title} onClose={onClose} size="wide">
      <input
        autoFocus
        type="search"
        placeholder="Search card names…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="preview-grid">
        {results.map((r) => {
          const card = previews[r.id];
          const art = card?.imageArtCrop ?? card?.imageNormal ?? null;
          return (
            <button key={r.id} className="preview-card" onClick={() => pick(r.id)}>
              {art ? (
                <img src={art} alt={r.name} loading="lazy" />
              ) : (
                <span className="preview-placeholder" />
              )}
              <span className="preview-name">{r.name}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
