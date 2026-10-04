import { useEffect, useMemo, useState } from 'react';
import { getGlossary } from '../data/rules';
import { computedPT } from '../lib/board';
import { findGlossaryTerms, type GlossaryEntry } from '../lib/rulesParser';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';

interface Props {
  playerIdx: number;
  itemId: string;
  onClose: () => void;
}

type Segment = { kind: 'text'; value: string } | { kind: 'term'; value: string };

function segment(text: string, terms: string[]): Segment[] {
  const hits = findGlossaryTerms(text, terms);
  const out: Segment[] = [];
  let pos = 0;
  for (const hit of hits) {
    if (hit.start > pos) out.push({ kind: 'text', value: text.slice(pos, hit.start) });
    out.push({ kind: 'term', value: text.slice(hit.start, hit.end) });
    pos = hit.end;
  }
  if (pos < text.length) out.push({ kind: 'text', value: text.slice(pos) });
  return out;
}

export default function CardDetail({ playerIdx, itemId, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const changeCount = useAppStore((s) => s.changeCount);
  const setCounter = useAppStore((s) => s.setCounter);
  const splitItemAction = useAppStore((s) => s.splitItem);
  const removeItemAction = useAppStore((s) => s.removeItem);

  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [activeTerm, setActiveTerm] = useState<GlossaryEntry | null>(null);
  const [splitCount, setSplitCount] = useState('1');
  const [newCounterName, setNewCounterName] = useState('');

  useEffect(() => {
    getGlossary().then(setGlossary);
  }, []);

  const item = game?.players[playerIdx]?.board.find((it) => it.id === itemId);

  const segments = useMemo(
    () => (item ? segment(item.oracleText, glossary.map((g) => g.term)) : []),
    [item, glossary],
  );

  if (!item) return null;

  const pt = computedPT(item);
  const p1p1 = item.counters['p1p1'] ?? 0;
  const namedCounters = Object.entries(item.counters).filter(([name]) => name !== 'p1p1');

  function showTerm(term: string) {
    const entry = glossary.find((g) => g.term.toLowerCase() === term.toLowerCase());
    if (entry) setActiveTerm(entry);
  }

  return (
    <Sheet
      title={item.name}
      onClose={onClose}
      footer={
        <button
          className="danger"
          onClick={() => {
            removeItemAction(playerIdx, itemId);
            onClose();
          }}
        >
          Remove from board
        </button>
      }
    >
      <div className="card-hero">
        {item.imageNormal && <img className="card-image" src={item.imageNormal} alt={item.name} />}
        <p className="type-line">
          {item.typeLine}
          {pt && (
            <strong>
              {' '}
              {pt.power}/{pt.toughness}
            </strong>
          )}
        </p>
        {item.oracleText && (
          <p className="oracle-text">
            {segments.map((seg, i) =>
              seg.kind === 'term' ? (
                <button key={i} className="term" onClick={() => showTerm(seg.value)}>
                  {seg.value}
                </button>
              ) : (
                <span key={i}>{seg.value}</span>
              ),
            )}
          </p>
        )}
        {activeTerm && (
          <div className="term-popover">
            <strong>{activeTerm.term}</strong>
            <p>{activeTerm.definition}</p>
            <button className="ghost" onClick={() => setActiveTerm(null)}>
              Close
            </button>
          </div>
        )}
      </div>

      <div className="detail-section">
        <span className="section-label">Stack</span>
        <div className="detail-row">
          <span>Copies</span>
          <div className="stepper">
            <button aria-label="one fewer copy" onClick={() => changeCount(playerIdx, itemId, -1)}>
              −
            </button>
            <span>×{item.count}</span>
            <button aria-label="one more copy" onClick={() => changeCount(playerIdx, itemId, 1)}>
              +
            </button>
          </div>
        </div>
        {item.count > 1 && (
          <div className="detail-row">
            <label className="split-label">
              Split off
              <input
                type="number"
                min={1}
                max={item.count - 1}
                value={splitCount}
                onChange={(e) => setSplitCount(e.target.value)}
              />
            </label>
            <button onClick={() => splitItemAction(playerIdx, itemId, Number(splitCount) || 0)}>
              Split
            </button>
          </div>
        )}
      </div>

      <div className="detail-section">
        <span className="section-label">Counters</span>
        <div className="detail-row">
          <span>+1/+1</span>
          <div className="stepper">
            <button
              aria-label="fewer +1/+1 counters"
              onClick={() => setCounter(playerIdx, itemId, 'p1p1', p1p1 - 1)}
            >
              −
            </button>
            <span>{p1p1}</span>
            <button
              aria-label="add +1/+1 counter"
              onClick={() => setCounter(playerIdx, itemId, 'p1p1', p1p1 + 1)}
            >
              +
            </button>
          </div>
        </div>
        {namedCounters.map(([name, value]) => (
          <div className="detail-row" key={name}>
            <span>{name}</span>
            <div className="stepper">
              <button
                aria-label={`fewer ${name} counters`}
                onClick={() => setCounter(playerIdx, itemId, name, value - 1)}
              >
                −
              </button>
              <span>{value}</span>
              <button
                aria-label={`more ${name} counters`}
                onClick={() => setCounter(playerIdx, itemId, name, value + 1)}
              >
                +
              </button>
            </div>
          </div>
        ))}
        <div className="detail-row">
          <input
            placeholder="counter name (oil, charge…)"
            value={newCounterName}
            onChange={(e) => setNewCounterName(e.target.value)}
          />
          <button
            disabled={!newCounterName.trim()}
            onClick={() => {
              setCounter(playerIdx, itemId, newCounterName.trim().toLowerCase(), 1);
              setNewCounterName('');
            }}
          >
            Add counter
          </button>
        </div>
      </div>
    </Sheet>
  );
}
