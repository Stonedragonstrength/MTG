import { useState } from 'react';
import Sheet from './Sheet';

interface StackItem {
  id: string;
  label: string;
}

interface Props {
  onClose: () => void;
}

/** The stack, visualized: add spells/abilities as they're cast; the last
 * one in resolves first. Settles "which resolves first?" at the table. */
export default function StackSheet({ onClose }: Props) {
  const [items, setItems] = useState<StackItem[]>([]);
  const [draft, setDraft] = useState('');

  function add() {
    const label = draft.trim();
    if (!label) return;
    setItems((prev) => [...prev, { id: crypto.randomUUID(), label }]);
    setDraft('');
  }

  function resolveTop() {
    setItems((prev) => prev.slice(0, -1));
  }

  const topFirst = [...items].reverse();

  return (
    <Sheet title="The Stack" onClose={onClose}>
      <form
        className="stack-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          autoFocus
          placeholder="Spell or ability…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          Add to stack
        </button>
      </form>

      {items.length === 0 ? (
        <p className="hint">
          The stack is empty. Add spells in the order they're cast — the newest sits on top and
          resolves first.
        </p>
      ) : (
        <ul className="stack-list">
          {topFirst.map((item, i) => (
            <li key={item.id} data-testid="stack-item" className={i === 0 ? 'stack-top' : ''}>
              <span className="stack-label">
                {item.label}
                {i === 0 && <em className="stack-note"> — resolves first</em>}
              </span>
              <button aria-label={`remove ${item.label}`} onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}>
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
    </Sheet>
  );
}
