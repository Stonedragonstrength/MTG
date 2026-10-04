import { useEffect, useRef, useState } from 'react';
import { getCardById } from '../data/scryfall';
import { searchNames } from '../lib/fuzzy';
import type { CardRecord } from '../lib/types';
import { getNameIndex } from './nameIndexCache';

interface Props {
  title: string;
  onPick: (card: CardRecord) => void;
  onClose: () => void;
}

/** Search any Magic card; used for avatars (art crop) and commander names. */
export default function AvatarPicker({ title, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const names = useRef<{ id: string; name: string }[]>([]);

  useEffect(() => {
    getNameIndex().then((idx) => {
      names.current = idx;
    });
  }, []);

  useEffect(() => {
    setResults(searchNames(query, names.current, 12));
  }, [query]);

  async function pick(id: string) {
    const card = await getCardById(id);
    if (card) onPick(card);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <input
          autoFocus
          type="search"
          placeholder="Search card names…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="search-results">
          {results.map((r) => (
            <li key={r.id}>
              <button onClick={() => pick(r.id)}>{r.name}</button>
            </li>
          ))}
        </ul>
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
