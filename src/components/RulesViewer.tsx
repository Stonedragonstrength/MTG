import { Fragment, useEffect, useMemo, useState } from 'react';
import { getGlossary, searchRules } from '../data/rules';
import type { GlossaryEntry, RuleEntry } from '../lib/rulesParser';
import Sheet from './Sheet';

interface Props {
  onClose: () => void;
}

const RULE_REF = /rule (\d+(?:\.\d+)?[a-z]?)/gi;

/** Renders definition text with tappable "rule 702.2" references. */
function DefinitionText({ text, onRule }: { text: string; onRule: (num: string) => void }) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(RULE_REF);
  while ((match = re.exec(text)) !== null) {
    if (match.index > pos) parts.push(text.slice(pos, match.index));
    const num = match[1];
    parts.push(
      <button key={match.index} className="rule-ref" onClick={() => onRule(num)}>
        rule {num}
      </button>,
    );
    pos = match.index + match[0].length;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return (
    <p className="definition-text">
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </p>
  );
}

export default function RulesViewer({ onClose }: Props) {
  const [tab, setTab] = useState<'glossary' | 'rules'>('glossary');
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [termQuery, setTermQuery] = useState('');
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
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
  const terms = useMemo(
    () =>
      glossary
        .filter((g) => !q || g.term.toLowerCase().includes(q))
        .sort((a, b) => {
          const ap = a.term.toLowerCase().startsWith(q) ? 0 : 1;
          const bp = b.term.toLowerCase().startsWith(q) ? 0 : 1;
          return ap - bp || a.term.localeCompare(b.term);
        }),
    [glossary, q],
  );

  const active =
    terms.find((g) => g.term === selectedTerm) ?? (terms.length > 0 ? terms[0] : null);

  function jumpToRule(num: string) {
    setTab('rules');
    setRuleQuery(num);
  }

  return (
    <Sheet title="Rules & Glossary" onClose={onClose} size="wide">
      <div role="tablist" className="segmented">
        <button
          role="tab"
          aria-selected={tab === 'glossary'}
          className={tab === 'glossary' ? 'segment active' : 'segment'}
          onClick={() => setTab('glossary')}
        >
          Glossary
        </button>
        <button
          role="tab"
          aria-selected={tab === 'rules'}
          className={tab === 'rules' ? 'segment active' : 'segment'}
          onClick={() => setTab('rules')}
        >
          Rules
        </button>
      </div>

      {tab === 'glossary' && (
        <div className="glossary-layout">
          <div className="glossary-list">
            <input
              type="search"
              placeholder="Search terms…"
              value={termQuery}
              onChange={(e) => setTermQuery(e.target.value)}
            />
            <ul className="term-list">
              {terms.map((g) => (
                <li key={g.term}>
                  <button
                    className={active?.term === g.term ? 'term-item active' : 'term-item'}
                    onClick={() => setSelectedTerm(g.term)}
                  >
                    {g.term}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="glossary-detail">
            {active ? (
              <>
                <h3>{active.term}</h3>
                <DefinitionText text={active.definition} onRule={jumpToRule} />
              </>
            ) : (
              <p className="hint">No matching terms.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'rules' && (
        <div className="rules-layout">
          <input
            autoFocus
            type="search"
            placeholder="Search rules by number or text…"
            value={ruleQuery}
            onChange={(e) => setRuleQuery(e.target.value)}
          />
          {ruleQuery.trim() === '' ? (
            <p className="hint">Type a rule number (702.2) or any text (combat damage, layers…).</p>
          ) : ruleResults.length === 0 ? (
            <p className="hint">No rules match.</p>
          ) : (
            <ul className="rule-results">
              {ruleResults.map((r) => (
                <li key={r.number}>
                  <strong>{r.number}</strong>
                  <p>{r.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}
