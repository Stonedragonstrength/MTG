import { useEffect, useMemo, useState } from 'react';
import { getCardById } from '../data/scryfall';
import { manaValue } from '../lib/deck';
import { normalize } from '../lib/fuzzy';
import { COLOR_NAMES, MANA_COLORS, type ManaColor } from '../lib/mana';
import type { GarageCard } from '../lib/types';
import { useAppStore } from '../state/store';
import DeckCardSheet from './DeckCardSheet';

type GroupBy = 'type' | 'color' | 'cost' | 'az';

const GROUPS: { key: GroupBy; label: string }[] = [
  { key: 'type', label: 'Type' },
  { key: 'color', label: 'Color' },
  { key: 'cost', label: 'Cost' },
  { key: 'az', label: 'A–Z' },
];

const TYPE_ORDER = [
  'Creatures',
  'Instants',
  'Sorceries',
  'Enchantments',
  'Artifacts',
  'Planeswalkers',
  'Other',
  'Lands',
];

const COLOR_ORDER = ['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolor', 'Colorless', 'Lands'];
const COLOR_LABEL: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

interface Enrich {
  identity: string[];
  mv: number;
  priceUsd: number | null;
}

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function typeBucket(typeLine: string): string {
  if (/Creature/.test(typeLine)) return 'Creatures';
  if (/Land/.test(typeLine)) return 'Lands';
  if (/Instant/.test(typeLine)) return 'Instants';
  if (/Sorcery/.test(typeLine)) return 'Sorceries';
  if (/Enchantment/.test(typeLine)) return 'Enchantments';
  if (/Artifact/.test(typeLine)) return 'Artifacts';
  if (/Planeswalker/.test(typeLine)) return 'Planeswalkers';
  return 'Other';
}

/** The curation binder: the whole collection in full card art, sliceable
 * by type, color, cost, or alphabet — the battlefield's visual language
 * (thumbs, count controls, pips) applied to a collector's shelf. */
export default function GarageScreen({ onBack }: { onBack: () => void }) {
  const garage = useAppStore((s) => s.garage);
  const setGarageCount = useAppStore((s) => s.setGarageCount);
  const [filter, setFilter] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('type');
  const [sortBy, setSortBy] = useState<'az' | 'cost'>('az');
  const [colorSel, setColorSel] = useState<ManaColor | null>(null);
  const [viewing, setViewing] = useState<GarageCard | null>(null);
  const [enriched, setEnriched] = useState<Record<string, Enrich>>({});

  // Color identity and mana value live in the card database, not the
  // garage rows — enrich once per collection change.
  const idsKey = garage.map((g) => g.cardId).join(',');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found: Record<string, Enrich> = {};
      for (const g of garage) {
        const record = await getCardById(g.cardId).catch(() => undefined);
        if (cancelled) return;
        if (record) {
          found[g.cardId] = {
            identity: record.colorIdentity ?? record.colors,
            mv: manaValue(record.manaCost),
            priceUsd: record.priceUsd ?? null,
          };
        }
      }
      if (!cancelled) setEnriched(found);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const total = garage.reduce((sum, g) => sum + g.count, 0);

  // Collection value over whatever the card database can price — the
  // bulk data carries one representative printing's USD price per card.
  const pricedValue = garage.reduce((sum, g) => {
    const p = enriched[g.cardId]?.priceUsd;
    return p != null ? sum + p * g.count : sum;
  }, 0);
  const pricedCopies = garage.reduce(
    (sum, g) => (enriched[g.cardId]?.priceUsd != null ? sum + g.count : sum),
    0,
  );

  const shown = useMemo(() => {
    let rows = garage;
    if (filter.trim()) rows = rows.filter((g) => normalize(g.name).includes(normalize(filter)));
    if (colorSel) {
      rows = rows.filter((g) => {
        const identity = enriched[g.cardId]?.identity;
        if (colorSel === 'C') return identity !== undefined && identity.length === 0;
        return identity?.includes(colorSel) ?? false;
      });
    }
    return rows;
  }, [garage, filter, colorSel, enriched]);

  const sections = useMemo(() => {
    const buckets = new Map<string, GarageCard[]>();
    const put = (label: string, g: GarageCard) =>
      buckets.set(label, [...(buckets.get(label) ?? []), g]);

    for (const g of shown) {
      if (groupBy === 'type') put(typeBucket(g.typeLine), g);
      else if (groupBy === 'az') put('All cards', g);
      else if (groupBy === 'color') {
        if (/Land/.test(g.typeLine)) put('Lands', g);
        else {
          const identity = enriched[g.cardId]?.identity ?? [];
          if (identity.length === 0) put('Colorless', g);
          else if (identity.length > 1) put('Multicolor', g);
          else put(COLOR_LABEL[identity[0]] ?? 'Colorless', g);
        }
      } else {
        if (/Land/.test(g.typeLine)) put('Lands', g);
        else {
          const mv = enriched[g.cardId]?.mv ?? 0;
          put(mv >= 7 ? '7+ mana' : `${mv} mana`, g);
        }
      }
    }

    const order =
      groupBy === 'type'
        ? TYPE_ORDER
        : groupBy === 'color'
          ? COLOR_ORDER
          : groupBy === 'cost'
            ? [...Array.from({ length: 7 }, (_, i) => `${i} mana`), '7+ mana', 'Lands']
            : ['All cards'];
    // Cost is a standing second axis: within every section, either
    // alphabet or mana value decides the shelf order.
    const byCost = (a: GarageCard, b: GarageCard) =>
      (enriched[a.cardId]?.mv ?? 99) - (enriched[b.cardId]?.mv ?? 99) ||
      a.name.localeCompare(b.name);
    const byName = (a: GarageCard, b: GarageCard) => a.name.localeCompare(b.name);
    return order
      .filter((label) => buckets.has(label))
      .map((label) => ({
        label,
        cards: [...buckets.get(label)!].sort(sortBy === 'cost' ? byCost : byName),
      }));
  }, [shown, groupBy, enriched, sortBy]);

  return (
    <div className="screen deck-editor curation">
      <header className="screen-header">
        <button className="ghost" onClick={onBack}>
          ‹ Home
        </button>
        <h1>Curation</h1>
        <span className="deck-size">
          {total} cards · {garage.length} unique
        </span>
      </header>

      {garage.length > 0 && (
        <p className="curation-value">
          {pricedCopies > 0 ? (
            <>
              Collection ≈ ${money(pricedValue)} · avg ${money(pricedValue / pricedCopies)}/card
              {pricedCopies < total && (
                <span className="curation-value-note">
                  {' '}
                  ({pricedCopies} of {total} copies priced)
                </span>
              )}
            </>
          ) : (
            'No prices yet — refresh the card data under Settings to price the collection.'
          )}
        </p>
      )}

      <input
        type="search"
        placeholder="Filter the collection…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      <div className="curation-controls">
        <div className="chip-row curation-groups" aria-label="group by">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              className={`chip${groupBy === g.key ? ' chip--recent' : ''}`}
              aria-label={`group by ${g.label}`}
              aria-pressed={groupBy === g.key}
              onClick={() => setGroupBy(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="chip-row curation-groups" aria-label="sort inside groups">
          <button
            className={`chip${sortBy === 'az' ? ' chip--recent' : ''}`}
            aria-label="sort alphabetically"
            aria-pressed={sortBy === 'az'}
            onClick={() => setSortBy('az')}
          >
            A–Z
          </button>
          <button
            className={`chip${sortBy === 'cost' ? ' chip--recent' : ''}`}
            aria-label="sort by cost"
            aria-pressed={sortBy === 'cost'}
            onClick={() => setSortBy('cost')}
          >
            By cost
          </button>
        </div>
        <div className="mana-pick" aria-label="filter by color">
          {MANA_COLORS.map((c) => (
            <button
              key={c}
              className={`mana-pip mana-${c} mana-pick-pip${colorSel === c ? ' mana-pick-pip--on' : ''}`}
              aria-label={`only ${c === 'C' ? 'colorless' : COLOR_NAMES[c]} cards`}
              aria-pressed={colorSel === c}
              onClick={() => setColorSel((prev) => (prev === c ? null : c))}
            />
          ))}
        </div>
      </div>

      {garage.length === 0 ? (
        <p className="hint">
          Empty so far — every card you swipe or paste into a deck joins the curation
          automatically.
        </p>
      ) : shown.length === 0 ? (
        <p className="hint">Nothing matches that slice of the collection.</p>
      ) : (
        sections.map((section) => (
          <section key={section.label} className="deck-group">
            <h2 className="deck-group-title">
              {section.label}
              <span className="deck-group-count">
                {section.cards.reduce((sum, c) => sum + c.count, 0)}
              </span>
            </h2>
            <div className="curation-grid">
              {section.cards.map((card) => (
                <div key={card.cardId} className="curation-item">
                  <button
                    className="curation-card"
                    aria-label={`${card.name} details`}
                    onClick={() => setViewing(card)}
                  >
                    {card.imageNormal ? (
                      <img src={card.imageNormal} alt={card.name} loading="lazy" />
                    ) : (
                      <span className="thumb-placeholder color-C curation-placeholder">
                        {card.name}
                      </span>
                    )}
                    {card.count > 1 && <span className="count-badge">×{card.count}</span>}
                  </button>
                  <div className="count-controls">
                    <button
                      aria-label={`one fewer ${card.name}`}
                      onClick={() => void setGarageCount(card.cardId, card.count - 1)}
                    >
                      −
                    </button>
                    <span className="count-badge">×{card.count}</span>
                    <button
                      aria-label={`one more ${card.name}`}
                      onClick={() => void setGarageCount(card.cardId, card.count + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {viewing && (
        <DeckCardSheet
          card={{
            cardId: viewing.cardId,
            name: viewing.name,
            typeLine: viewing.typeLine,
            manaCost: '',
            imageNormal: viewing.imageNormal,
            count: viewing.count,
          }}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
