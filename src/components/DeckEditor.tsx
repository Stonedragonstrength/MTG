import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCardById } from '../data/scryfall';
import { findPartnersFor } from '../data/synergy';
import {
  changeCardCount,
  colorBreakdown,
  compositionExtras,
  deckSize,
  deckStats,
  groupCards,
  manaCurve,
  offColorCards,
  setPartner,
  shortType,
  starRatings,
  type DeckStats,
} from '../lib/deck';
import { COLOR_NAMES, MANA_COLORS } from '../lib/mana';
import { canPartner, partnerKind, partnerOffer } from '../lib/partner';
import type { CardRecord, DeckCard } from '../lib/types';
import { useAppStore } from '../state/store';
import AvatarPicker from './AvatarPicker';
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

/** The bars read relative to the deck's own tallest bucket; each wears
 * its card count so the curve is numbers, not just a shape. */
function CurveBar({ curve }: { curve: number[] }) {
  const max = Math.max(1, ...curve);
  return (
    <div className="deck-curve" aria-label="mana curve">
      {curve.map((n, mv) => (
        <div key={mv} className="deck-curve-col" title={`${mv === 7 ? '7+' : mv} mana: ${n}`}>
          {n > 0 && <span className="deck-curve-count">{n}</span>}
          <div className="deck-curve-track">
            <div
              className="deck-curve-bar"
              style={{ height: `${Math.round((n / max) * 100)}%` }}
            />
          </div>
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
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [finding, setFinding] = useState('');
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<DeckCard | null>(null);
  const addToGarage = useAppStore((s) => s.addToGarage);
  const [synergyOpen, setSynergyOpen] = useState(false);
  const [aligning, setAligning] = useState(false);
  const [stats, setStats] = useState<DeckStats | null>(null);
  const [curationMsg, setCurationMsg] = useState('');

  const [records, setRecords] = useState<Record<string, CardRecord>>({});
  const [cmdRecord, setCmdRecord] = useState<CardRecord | null>(null);
  const [partnerRecord, setPartnerRecord] = useState<CardRecord | null>(null);
  const [partnerOptions, setPartnerOptions] = useState<CardRecord[] | null>(null); // null = picker shut

  // Rules text and identities live in the card database, not the deck —
  // fetch once per deck change, derive everything else from the map.
  const cardsKey = `${deck?.commander?.cardId ?? ''}+${deck?.partner?.cardId ?? ''}|${deck?.cards
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
      const partner = deck.partner
        ? ((await getCardById(deck.partner.cardId).catch(() => undefined)) ?? null)
        : null;
      if (cancelled) return;
      setRecords(found);
      setCmdRecord(cmd);
      setPartnerRecord(partner);
      setStats(deckStats(statEntries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsKey]);

  // A pair leads together: a card that serves either commander earns stars.
  const leader = useMemo(
    () =>
      cmdRecord && partnerRecord
        ? {
            ...cmdRecord,
            typeLine: `${cmdRecord.typeLine} // ${partnerRecord.typeLine}`,
            oracleText: `${cmdRecord.oracleText}\n${partnerRecord.oracleText}`,
          }
        : cmdRecord,
    [cmdRecord, partnerRecord],
  );

  const stars = useMemo(
    () =>
      starRatings(
        leader,
        (deck?.cards ?? [])
          .filter((c) => records[c.cardId])
          .map((c) => ({ cardId: c.cardId, record: records[c.cardId] })),
      ),
    [leader, records, deck?.cards],
  );

  const partnerFilter = useCallback(
    (card: CardRecord) => !!cmdRecord && canPartner(cmdRecord, card),
    [cmdRecord],
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
  // The second command-zone slot only exists when the commander's own
  // text allows one (Partner, a Background, the Doctor's companion…).
  const partnerSlot = cmdRecord ? partnerOffer(partnerKind(cmdRecord)) : null;

  async function openPartnerPicker() {
    if (!deck || !cmdRecord) return;
    const options = await findPartnersFor(cmdRecord);
    // "Partner with X" names its one legal partner — no need to ask.
    if (partnerKind(cmdRecord)?.type === 'with' && options.length === 1) {
      void saveDeck(setPartner(deck, options[0]));
      return;
    }
    setPartnerOptions(options);
  }

  const groups = groupCards(deck.cards);
  const size = deckSize(deck);
  const offColor = new Set(offColorCards(deck).map((c) => c.cardId));
  const extras = compositionExtras(deck.cards);

  // "Do I already have this?" — count copies before typing another one in.
  const q = finding.trim().toLowerCase();
  const found = q ? deck.cards.filter((c) => c.name.toLowerCase().includes(q)) : [];
  const foundCopies = found.reduce((sum, c) => sum + c.count, 0);
  const commanderMatch = q !== '' && (deck.commander?.name.toLowerCase().includes(q) ?? false);
  const visibleGroups = q
    ? groups
        .map((g) => ({ ...g, cards: g.cards.filter((c) => c.name.toLowerCase().includes(q)) }))
        .filter((g) => g.cards.length > 0)
    : groups;

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
        {deck.partner?.imageNormal && (
          <img
            className="deck-commander-img deck-commander-img--partner"
            src={deck.partner.imageNormal}
            alt=""
          />
        )}
        <div className="deck-hero-info">
          {deck.commander ? (
            <span className="deck-commander-name">{deck.commander.name}</span>
          ) : (
            <span className="deck-commander-name deck-commander-name--none">
              No commander yet
            </span>
          )}
          {deck.partner && (
            <span className="deck-partner-line">
              <span className="deck-commander-name">{deck.partner.name}</span>
              <button
                className="ghost deck-partner-remove"
                aria-label="remove partner"
                title="Remove the second commander"
                onClick={() => void saveDeck(setPartner(deck, null))}
              >
                ✕
              </button>
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
            {partnerSlot && !deck.partner && (
              <button className="ghost deck-synergy-btn" onClick={() => void openPartnerPicker()}>
                {partnerSlot}
              </button>
            )}
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

      <div className="deck-tools">
        <input
          type="search"
          aria-label="find in deck"
          placeholder="Already in the deck?"
          value={finding}
          onChange={(e) => setFinding(e.target.value)}
        />
        <button
          className="ghost deck-art-toggle"
          aria-label="toggle card art"
          aria-pressed={settings.deckArtOn}
          onClick={() => updateSettings({ ...settings, deckArtOn: !settings.deckArtOn })}
        >
          🖼 {settings.deckArtOn ? 'Art on' : 'Art off'}
        </button>
      </div>
      {q !== '' && (
        <p className="hint deck-find-line">
          {found.length > 0
            ? `In the deck: ${foundCopies} ${foundCopies === 1 ? 'copy' : 'copies'} (${found.length} ${found.length === 1 ? 'card' : 'cards'})`
            : commanderMatch
              ? `That's your commander — ${deck.commander!.name} leads this deck.`
              : 'Not in this deck yet.'}
        </p>
      )}

      {visibleGroups.map((group) => (
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
                {settings.deckArtOn &&
                  ((card.imageNormal ?? records[card.cardId]?.imageNormal) ? (
                    <img
                      className="deck-row-art"
                      src={(card.imageNormal ?? records[card.cardId]?.imageNormal)!}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className="deck-row-art deck-row-art--empty" />
                  ))}
                <span className="deck-row-title">
                  <span className="deck-row-cardname">{card.name}</span>
                  {shortType(card.typeLine) !== '' && (
                    <span className="deck-row-type">{shortType(card.typeLine)}</span>
                  )}
                </span>
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
              ...(deck.partner ? [{ ...deck.partner, count: 1 }] : []),
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
      {partnerOptions && (
        <AvatarPicker
          title={partnerSlot ?? 'Add partner'}
          filter={partnerFilter}
          suggestions={partnerOptions}
          onPick={(card) => {
            void saveDeck(setPartner(deck, card));
            setPartnerOptions(null);
          }}
          onClose={() => setPartnerOptions(null)}
        />
      )}
    </div>
  );
}
