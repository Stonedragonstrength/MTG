import { useEffect, useMemo, useState } from 'react';
import { kvGet, kvSet } from '../data/db';
import { getCardById } from '../data/scryfall';
import { createBoardItem } from '../lib/board';
import { normalize, searchNames } from '../lib/fuzzy';
import { useAppStore } from '../state/store';
import CustomTokenForm from './CustomTokenForm';
import { getNameIndex } from './nameIndexCache';

export const COMMON_TOKENS = [
  'Treasure',
  'Clue',
  'Food',
  'Soldier',
  'Zombie',
  'Goblin',
  'Spirit',
  'Thopter',
  'Elemental',
  'Angel',
  'Beast',
  'Saproling',
];

const RECENT_KEY = 'recentCards';
const RECENT_CAP = 12;

interface Props {
  playerIdx: number;
  onClose: () => void;
}

export default function CardSearch({ playerIdx, onClose }: Props) {
  const addItem = useAppStore((s) => s.addItem);
  const [query, setQuery] = useState('');
  const [names, setNames] = useState<{ id: string; name: string }[]>([]);
  const [recent, setRecent] = useState<{ id: string; name: string }[]>([]);
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    getNameIndex().then(setNames);
    kvGet<{ id: string; name: string }[]>(RECENT_KEY).then((r) => setRecent(r ?? []));
  }, []);

  const results = useMemo(() => searchNames(query, names, 15), [query, names]);

  async function pickId(id: string) {
    const card = await getCardById(id);
    if (!card) return;
    addItem(playerIdx, createBoardItem(card));
    const entry = { id: card.id, name: card.name };
    const nextRecent = [entry, ...recent.filter((r) => r.id !== entry.id)].slice(0, RECENT_CAP);
    kvSet(RECENT_KEY, nextRecent).catch(() => {});
    onClose();
  }

  function pickByName(name: string) {
    const exact = names.find((n) => normalize(n.name) === normalize(name));
    const target = exact ?? searchNames(name, names, 1)[0];
    if (target) void pickId(target.id);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card-search" onClick={(e) => e.stopPropagation()}>
        {customOpen ? (
          <CustomTokenForm playerIdx={playerIdx} onDone={onClose} />
        ) : (
          <>
            <div className="chip-row" aria-label="common tokens">
              {COMMON_TOKENS.map((name) => (
                <button
                  key={name}
                  className="chip"
                  aria-label={`${name} token`}
                  onClick={() => pickByName(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            {recent.length > 0 && (
              <div className="chip-row" aria-label="recently used">
                {recent.map((r) => (
                  <button key={r.id} className="chip chip--recent" onClick={() => pickId(r.id)}>
                    {r.name}
                  </button>
                ))}
              </div>
            )}
            <input
              autoFocus
              type="search"
              placeholder="Search any card…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="search-results">
              {results.map((r) => (
                <li key={r.id}>
                  <button onClick={() => pickId(r.id)}>{r.name}</button>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setCustomOpen(true)}>
                Custom token…
              </button>
              <button className="ghost" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
