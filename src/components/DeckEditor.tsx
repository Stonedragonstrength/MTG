import { useEffect, useMemo, useState } from 'react';
import { getCardById } from '../data/scryfall';
import {
  changeCardCount,
  colorBreakdown,
  compositionExtras,
  deckSize,
  deckStats,
  groupCards,
  manaCurve,
  offColorCards,
  starRatings,
  type DeckStats,
} from '../lib/deck';
import { COLOR_NAMES, MANA_COLORS } from '../lib/mana';
import type { CardRecord, DeckCard } from '../lib/types';
import { useAppStore } from '../state/store';
import CommanderAlignSheet from './CommanderAlignSheet';
import DeckCardSheet from './DeckCardSheet';
import DeckEntrySheet from './DeckEntrySheet';
import SynergySheet from './SynergySheet';

/** Commander rules of thumb — a nudge, not a judge. */
const HEALTH_TARGETS: { key: keyof DeckStats; label: string; target: number }[] = [
  { key: 'lands', label: 'Lands', target: 36 },
  { key: 'ramp', label: 'Ramp', target: 10 },
  { key: 'draw', label: 'Draw', target: 10 },
  { key: 'removal', label: 'Removal', target: 8 },
];

/** The bars read relative to the deck's own tallest bucket. */
function CurveBar({ curve }: { curve: number[] }) {
  const max = Math.max(1, ...curve);
  return (
    <div className="deck-curve" aria-label="mana curve">
      {curve.map((n, mv) => (
        <div key={mv} className="deck-curve-col" title={`${mv === 7 ? '7+' : mv} mana: ${n}`}>
          <div
            className="deck-curve-bar"
            style={{ height: `${Math.round((n / max) * 100)}%` }}
          />
          <span className="deck-curve-label">{mv === 7 ? '7+' : mv}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  deckId: string;
  onBack: () => void;
}

export default function DeckEditor({ deckId, onBack }: Props) {
  const deck = useAppStore((s) => s.decks.find((d) => d.id === deckId));
  const saveDeck = useAppStore((s) => s.saveDeck);
  const deleteDeck = useAppStore((s) => s.deleteDeck);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<DeckCard | null>(null);
  const addToGarage = useAppStore((s) => s.addToGarage);
  const [synergyOpen, setSynergyOpen] = useState(false);
  const [aligning, setAligning] = useState(false);
  const [stats, setStats] = useState<DeckStats | null>(null);
  const [curationMsg, setCurationMsg] = useState('');

  const [records, setRecords] = useState<Record<string, CardRecord>>({});
  const [cmdRecord, setCmdRecord] = useState<CardRecord | null>(null);

  // Rules text and identities live in the card database, not the deck —
  // fetch once per deck change, derive everything else from the map.
  const cardsKey = `${deck?.commander?.cardId ?? ''}|${deck?.cards
    .map((c) => `${c.cardId}:${c.count}`)
    .join(',')}`;
  useEffect(() => {
    if (!deck) return;
    let cancelled = false;
    (async () => {
      const found: Record<string, CardRecord> = {};
      const statEntries = [];
      for (const c of deck.cards) {
        const record = await getCardById(c.cardId).catch(() => undefined);
        if (cancelled) return;
        if (record) found[c.cardId] = record;
        statEntries.push({
          typeLine: c.typeLine,
          oracleText: record?.oracleText ?? '',
          count: c.count,
        });
      }
      const cmd = deck.commander
        ? ((await getCardById(deck.commander.cardId).catch(() => undefined)) ?? null)
        : null;
      if (cancelled) return;
      setRecords(found);
      setCmdRecord(cmd);
      setStats(deckStats(statEntries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsKey]);

  const stars = useMemo(
    () =>
      starRatings(
        cmdRecord,
        (deck?.cards ?? [])
          .filter((c) => records[c.cardId])
          .map((c) => ({ cardId: c.cardId, record: records[c.cardId] })),
      ),
    [cmdRecord, records, deck?.cards],
  );

  const colors = useMemo(
    () =>
      colorBreakdown(
        (deck?.cards ?? []).map((c) => ({
          count: c.count,
          identity: c.colorIdentity ?? records[c.cardId]?.colorIdentity,
        })),
      ),
    [deck?.cards, records],
  );

  if (!deck) return null;
  const groups = groupCards(deck.cards);
  const size = deckSize(deck);
  const offColor = new Set(offColorCards(deck).map((c) => c.cardId));
  const extras = compositionExtras(deck.cards);

  return (
    <div className="screen deck-editor">
      <header className="screen-header">
        <button className="ghost" onClick={onBack}>
          ‹ Decks
        </button>
        <input
          className="deck-name-input"
          aria-label="deck name"
          value={deck.name}
          onChange={(e) => void saveDeck({ ...deck, name: e.target.value })}
        />
        <span className={`deck-size${size === 100 ? ' deck-size--full' : ''}`}>
          {size} / 100
        </span>
      </header>

      <div className="deck-hero">
        {deck.commander?.imageNormal && (
          <img className="deck-commander-img" src={deck.commander.imageNormal} alt="" />
        )}
        <div className="deck-hero-info">
          {deck.commander ? (
            <span className="deck-commander-name">{deck.commander.name}</span>
          ) : (
            <span className="deck-commander-name deck-commander-name--none">
              No commander yet
            </span>
          )}
          <span className="profile-pips">
            {deck.colors.map((c) => (
              <span key={c} className={`mana-pip mana-pip--mini mana-${c}`} />
            ))}
          </span>
          <span className="deck-hero-actions">
            {deck.commander && (
              <button className="ghost deck-synergy-btn" onClick={() => setSynergyOpen(true)}>
                Goes well with…
              </button>
            )}
            <button className="ghost deck-synergy-btn" onClick={() => setAligning(true)}>
              Align commander
            </button>
          </span>
          <CurveBar curve={manaCurve(deck.cards)} />
        </div>
      </div>

      <div className="deck-made-of">
        <span className="made-of-label">Made of</span>
        {groups.map((g) => (
          <span key={g.label} className="deck-health-chip">
            {g.label} {g.cards.reduce((s, c) => s + c.count, 0)}
          </span>
        ))}
        {extras.equipment > 0 && (
          <span className="deck-health-chip">Equipment {extras.equipment}</span>
        )}
        {extras.auras > 0 && <span className="deck-health-chip">Auras {extras.auras}</span>}
        <span className="made-of-colors">
          {MANA_COLORS.filter((c) => c !== 'C' && colors[c as 'W'] > 0).map((c) => (
            <span
              key={c}
              className={`mana-pip mana-${c}`}
              aria-label={`${colors[c as 'W']} ${COLOR_NAMES[c]} cards`}
            >
              {colors[c as 'W']}
            </span>
          ))}
          {colors.colorless > 0 && (
            <span className="mana-pip mana-C" aria-label={`${colors.colorless} colorless cards`}>
              {colors.colorless}
            </span>
          )}
        </span>
      </div>

      {stats && (
        <div className="deck-health" aria-label="deck health">
          {HEALTH_TARGETS.map(({ key, label, target }) => (
            <span
              key={key}
              className={`deck-health-chip${stats[key] < target ? ' deck-health-chip--short' : ''}`}
            >
              {label} {stats[key]}/{target}
            </span>
          ))}
        </div>
      )}

      <button className="primary deck-add-btn" onClick={() => setAdding(true)}>
        + Add cards
      </button>

      {groups.map((group) => (
        <section key={group.label} className="deck-group">
          <h2 className="deck-group-title">
            {group.label}
            <span className="deck-group-count">
              {group.cards.reduce((sum, c) => sum + c.count, 0)}
            </span>
          </h2>
          {group.cards.map((card) => (
            <div key={card.cardId} className="deck-row">
              <button className="deck-row-name" onClick={() => setViewing(card)}>
                {card.name}
              </button>
              {(stars[card.cardId] ?? 0) > 0 && (
                <span
                  className="deck-row-stars"
                  aria-label={`${stars[card.cardId]} stars for ${card.name}`}
                  title={`Synergy with your commander: ${stars[card.cardId]}/5`}
                >
                  {'★'.repeat(stars[card.cardId])}
                </span>
              )}
              {offColor.has(card.cardId) && (
                <span
                  className="deck-row-warn"
                  aria-label={`${card.name} is outside commander colors`}
                  title="Outside commander color identity"
                >
                  ⚠
                </span>
              )}
              <span className="deck-row-cost">{card.manaCost}</span>
              <div className="stepper stepper--tight">
                <button
                  aria-label={`one fewer ${card.name}`}
                  onClick={() => void saveDeck(changeCardCount(deck, card.cardId, -1))}
                >
                  −
                </button>
                <span>×{card.count}</span>
                <button
                  aria-label={`one more ${card.name}`}
                  onClick={() => void saveDeck(changeCardCount(deck, card.cardId, 1))}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </section>
      ))}

      <footer className="deck-footer">
        <button
          className="ghost"
          onClick={async () => {
            // Top-up semantics: the curation ends up with AT LEAST the deck's
            // copies of each card, and never double-counts what's already
            // logged (safe to tap twice, safe after live entry-feeding).
            const have = (cardId: string) =>
              useAppStore.getState().garage.find((g) => g.cardId === cardId)?.count ?? 0;
            let added = 0;
            let already = 0;
            const entries = [
              ...(deck.commander ? [{ ...deck.commander, count: 1 }] : []),
              ...deck.cards,
            ];
            for (const c of entries) {
              const existing = have(c.cardId);
              const gap = Math.max(0, c.count - existing);
              already += Math.min(existing, c.count);
              if (gap > 0) {
                await addToGarage({ id: c.cardId, ...c }, gap);
                added += gap;
              }
            }
            setCurationMsg(
              added === 0
                ? 'Everything here is already in the Curation.'
                : `Added ${added} to the Curation${already > 0 ? ` (${already} copies already there)` : ''}.`,
            );
          }}
        >
          Send to Curation
        </button>
        <button
          className="danger"
          onClick={() => {
            void deleteDeck(deck.id);
            onBack();
          }}
        >
          Delete deck
        </button>
      </footer>
      {curationMsg && <p className="entry-last deck-curation-msg">{curationMsg}</p>}

      {adding && <DeckEntrySheet deckId={deck.id} onClose={() => setAdding(false)} />}
      {viewing && <DeckCardSheet card={viewing} onClose={() => setViewing(null)} />}
      {synergyOpen && deck.commander && (
        <SynergySheet
          cardId={deck.commander.cardId}
          cardName={deck.commander.name}
          isCommander
          onClose={() => setSynergyOpen(false)}
        />
      )}
      {aligning && <CommanderAlignSheet deckId={deck.id} onClose={() => setAligning(false)} />}
    </div>
  );
}
