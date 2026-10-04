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
}

/** Card search with art previews; used for avatars and commander picks. */
export default function AvatarPicker({ title, onPick, onClose }: Props) {
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
    setResults(searchNames(query, names.current, 12));
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded: Record<string, CardRecord> = {};
      for (const r of results) {
        const card = await getCardById(r.id);
        if (card) loaded[r.id] = card;
        if (cancelled) return;
      }
      if (!cancelled) setPreviews(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [results]);

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
