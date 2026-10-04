import { useEffect, useState } from 'react';
import { getGlossary, searchRules } from '../data/rules';
import type { GlossaryEntry, RuleEntry } from '../lib/rulesParser';

interface Props {
  onClose: () => void;
}

export default function RulesViewer({ onClose }: Props) {
  const [tab, setTab] = useState<'glossary' | 'rules'>('glossary');
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [termQuery, setTermQuery] = useState('');
  const [activeTerm, setActiveTerm] = useState<GlossaryEntry | null>(null);
  const [ruleQuery, setRuleQuery] = useState('');
  const [ruleResults, setRuleResults] = useState<RuleEntry[]>([]);

  useEffect(() => {
    getGlossary().then(setGlossary);
  }, []);

  useEffect(() => {
    if (tab !== 'rules') return;
    const q = ruleQuery.trim();
    if (!q) {
      setRuleResults([]);
      return;
    }
    let cancelled = false;
    searchRules(q).then((results) => {
      if (!cancelled) setRuleResults(results);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, ruleQuery]);

  const q = termQuery.trim().toLowerCase();
  const filteredTerms = q
    ? glossary
        .filter((g) => g.term.toLowerCase().includes(q))
        .sort((a, b) => {
          const ap = a.term.toLowerCase().startsWith(q) ? 0 : 1;
          const bp = b.term.toLowerCase().startsWith(q) ? 0 : 1;
          return ap - bp || a.term.localeCompare(b.term);
        })
        .slice(0, 30)
    : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal rules-viewer" onClick={(e) => e.stopPropagation()}>
        <div role="tablist" className="tabs">
          <button
            role="tab"
            aria-selected={tab === 'glossary'}
            className={tab === 'glossary' ? 'tab active' : 'tab'}
            onClick={() => setTab('glossary')}
          >
            Glossary
          </button>
          <button
            role="tab"
            aria-selected={tab === 'rules'}
            className={tab === 'rules' ? 'tab active' : 'tab'}
            onClick={() => setTab('rules')}
          >
            Rules
          </button>
        </div>

        {tab === 'glossary' && (
          <>
            <input
              autoFocus
              type="search"
              placeholder="Search terms (deathtouch, ward…)"
              value={termQuery}
              onChange={(e) => {
                setTermQuery(e.target.value);
                setActiveTerm(null);
              }}
            />
            {activeTerm ? (
              <div className="term-popover">
                <strong>{activeTerm.term}</strong>
                <p>{activeTerm.definition}</p>
                <button className="ghost" onClick={() => setActiveTerm(null)}>
                  Back
                </button>
              </div>
            ) : (
              <ul className="search-results">
                {filteredTerms.map((g) => (
                  <li key={g.term}>
                    <button onClick={() => setActiveTerm(g)}>{g.term}</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'rules' && (
          <>
            <input
              autoFocus
              type="search"
              placeholder="Search rules (number or text)…"
              value={ruleQuery}
              onChange={(e) => setRuleQuery(e.target.value)}
            />
            <ul className="rule-results">
              {ruleResults.map((r) => (
                <li key={r.number}>
                  <strong>{r.number}</strong>
                  <p>{r.text}</p>
                </li>
              ))}
            </ul>
          </>
        )}

        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
