import { useEffect, useMemo, useState } from 'react';
import { kvGet, kvSet } from '../data/db';
import { getCardById } from '../data/scryfall';
import { searchNames } from '../lib/fuzzy';
import type { DeckCard } from '../lib/types';
import DeckCardSheet from './DeckCardSheet';
import { getNameIndex } from './nameIndexCache';
import Sheet from './Sheet';

interface StackItem {
  id: string;
  label: string;
  cardId?: string;
}

const CATEGORIES = ['Instant', 'Sorcery', 'Creature', 'Artifact', 'Enchantment'] as const;
type Category = (typeof CATEGORIES)[number];

const RECENT_KEY = 'recentStackSpells';
const RECENT_CAP = 10;

interface Props {
  onClose: () => void;
}

/** The stack, visualized: add spells/abilities as they're cast; the last
 * one in resolves first. Settles "which resolves first?" at the table. */
export default function StackSheet({ onClose }: Props) {
  const [items, setItems] = useState<StackItem[]>([]);
  const [draft, setDraft] = useState('');
  const [names, setNames] = useState<{ id: string; name: string }[]>([]);
  const [category, setCategory] = useState<Category | null>(null);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [recents, setRecents] = useState<{ id: string; name: string }[]>([]);
  const [detail, setDetail] = useState<StackItem | null>(null);

  useEffect(() => {
    getNameIndex().then(setNames);
    kvGet<{ id: string; name: string }[]>(RECENT_KEY).then((r) => setRecents(r ?? []));
  }, []);

  // A category needs each candidate's type line, so cast a wider net and
  // keep the first 8 that match (same over-fetch trick as AvatarPicker).
  const candidates = useMemo(
    () => searchNames(draft, names, category ? 48 : 8),
    [draft, names, category],
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!category) {
        setSuggestions(candidates);
        return;
      }
      const kept: { id: string; name: string }[] = [];
      for (const c of candidates) {
        if (cancelled) return;
        const card = await getCardById(c.id).catch(() => undefined);
        if (card?.typeLine.includes(category)) kept.push(c);
        if (kept.length >= 8) break;
      }
      if (!cancelled) setSuggestions(kept);
    })();
    return () => {
      cancelled = true;
    };
  }, [candidates, category]);

  function push(item: Omit<StackItem, 'id'>) {
    setItems((prev) => [...prev, { ...item, id: crypto.randomUUID() }]);
    setDraft('');
  }

  function addSuggestion(entry: { id: string; name: string }) {
    push({ label: entry.name, cardId: entry.id });
    const next = [entry, ...recents.filter((r) => r.id !== entry.id)].slice(0, RECENT_CAP);
    setRecents(next);
    kvSet(RECENT_KEY, next).catch(() => {});
  }

  function addFreetext() {
    const label = draft.trim();
    if (!label) return;
    push({ label });
  }

  function resolveTop() {
    setItems((prev) => prev.slice(0, -1));
  }

  const topFirst = [...items].reverse();
  const detailCard: DeckCard | null =
    detail?.cardId != null
      ? {
          cardId: detail.cardId,
          name: detail.label,
          typeLine: '',
          manaCost: '',
          imageNormal: null,
          count: 1,
        }
      : null;

  return (
    <Sheet title="The Stack" onClose={onClose}>
      <form
        className="stack-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (suggestions[0]) addSuggestion(suggestions[0]);
          else addFreetext();
        }}
      >
        <input
          autoFocus
          placeholder="Spell or ability…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={addFreetext}
          title="Add exactly as typed (abilities, triggers…)"
        >
          Add to stack
        </button>
      </form>

      <div className="chip-row stack-categories" aria-label="narrow by type">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`chip${category === c ? ' chip--recent' : ''}`}
            aria-pressed={category === c}
            onClick={() => setCategory((prev) => (prev === c ? null : c))}
          >
            {c}
          </button>
        ))}
      </div>

      {draft.trim() !== '' && suggestions.length > 0 && (
        <ul className="search-results stack-suggestions">
          {suggestions.map((s) => (
            <li key={s.id} className="search-result-row">
              <button className="search-result-main" onClick={() => addSuggestion(s)}>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {draft.trim() === '' && recents.length > 0 && (
        <div className="chip-group">
          <span className="chip-group-label">Recent</span>
          <div className="chip-row">
            {recents.map((r) => (
              <button
                key={r.id}
                className="chip"
                aria-label={`${r.name} (recent)`}
                onClick={() => addSuggestion(r)}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="hint">
          The stack is empty. Add spells in the order they're cast — the newest sits on top and
          resolves first.
        </p>
      ) : (
        <ul className="stack-list">
          {topFirst.map((item, i) => (
            <li key={item.id} data-testid="stack-item" className={i === 0 ? 'stack-top' : ''}>
              {item.cardId ? (
                <button
                  className="stack-label stack-label--card"
                  aria-label={`${item.label} — details`}
                  onClick={() => setDetail(item)}
                >
                  {item.label}
                  {i === 0 && <em className="stack-note"> — resolves first</em>}
                </button>
              ) : (
                <span className="stack-label">
                  {item.label}
                  {i === 0 && <em className="stack-note"> — resolves first</em>}
                </span>
              )}
              <button
                aria-label={`remove ${item.label}`}
                onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="modal-actions">
        <button className="primary" disabled={items.length === 0} onClick={resolveTop}>
          Resolve top
        </button>
        <button className="ghost" disabled={items.length === 0} onClick={() => setItems([])}>
          Clear
        </button>
      </div>

      {detailCard && <DeckCardSheet card={detailCard} onClose={() => setDetail(null)} />}
    </Sheet>
  );
}
