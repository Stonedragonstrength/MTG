import { useState } from 'react';
import type { Found, FoundTo } from '../lib/cards';
import { normalize } from '../lib/fuzzy';
import { FOUND_TO, fitsSearch, type SearchAsk } from '../lib/search';
import { isCreatureCard } from '../lib/shelf';
import { isLandCard } from '../lib/turnRules';
import type { CardInstance, CardRecord } from '../lib/types';
import { useAppStore } from '../state/store';
import CardZoomSheet from './CardZoomSheet';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import { useLongPress } from './useLongPress';
import { useSettleTaps } from './useSettleTaps';

interface Props {
  playerIdx: number;
  /** What a card sent its player to find, and that card's name; without
   * them it is a plain search of the library. */
  ask?: SearchAsk | null;
  source?: string;
  /** Closed: `searched` when the search was carried out (and shuffled). */
  onClose: (searched: boolean) => void;
}

type Show = 'asked' | 'all' | 'lands' | 'creatures' | 'other';

/** One card of the library, with every copy of it still there. */
interface Pile {
  cardId: string;
  name: string;
  iids: string[];
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function PileTile({
  pile,
  art,
  left,
  onTake,
  onLook,
}: {
  pile: Pile;
  art: string | null;
  /** Copies not taken yet. */
  left: number;
  onTake: () => void;
  onLook: () => void;
}) {
  const press = useLongPress(onTake, onLook);
  return (
    <button
      className={left === 0 ? 'find-card find-card--gone' : 'find-card'}
      aria-label={`take ${pile.name}`}
      title="Tap to take · hold to read"
      disabled={left === 0}
      {...press}
    >
      {art ? <img src={art} alt="" loading="lazy" /> : null}
      <span className="find-name">{pile.name}</span>
      {pile.iids.length > 1 && <span className="find-count">×{left}</span>}
    </button>
  );
}

/** A search of one's own library, the way a card asks for it: the cards are
 * shown with their pictures in alphabetical order (the order they lie in
 * stays secret), the ones the card asks for first; a tap takes a card, each
 * taken card says where it is going, and Done sends them there and shuffles
 * what is left — one move at the table, one Undo. Nothing the app reads off
 * the card is a limit: every card can be shown, any number taken, and each
 * sent anywhere. */
export default function LibrarySearchSheet({ playerIdx, ask = null, source, onClose }: Props) {
  // It may come up by itself, under the finger that played the card.
  useSettleTaps();
  const library = useAppStore((s) => s.game?.players[playerIdx]?.cards?.library);
  const searchLibrary = useAppStore((s) => s.searchLibrary);
  const [show, setShow] = useState<Show>(ask?.fits ? 'asked' : 'all');
  const [filter, setFilter] = useState('');
  const [taken, setTaken] = useState<string[]>([]);
  // Only the cards sent somewhere BY HAND are in here: the rest go where the card says.
  const [sent, setSent] = useState<Record<string, FoundTo>>({});
  const [zoom, setZoom] = useState<string | null>(null);

  const cards: CardInstance[] = library ?? [];
  const records = useCardRecords(cards);

  const piles: Pile[] = [];
  for (const c of [...cards].sort((a, b) => a.name.localeCompare(b.name))) {
    const pile = piles.find((p) => p.cardId === c.cardId);
    if (pile) pile.iids.push(c.iid);
    else piles.push({ cardId: c.cardId, name: c.name, iids: [c.iid] });
  }
  const shows = (record: CardRecord | null | undefined): boolean => {
    if (show === 'all') return true;
    if (show === 'asked') return fitsSearch(ask?.fits ?? null, record);
    if (!record) return true; // a card this device cannot read is never hidden
    const land = isLandCard(record.typeLine);
    const creature = isCreatureCard(record);
    return show === 'lands' ? land : show === 'creatures' ? creature : !land && !creature;
  };
  const shown = piles.filter(
    (p) => shows(records[p.cardId]) && (!filter.trim() || normalize(p.name).includes(normalize(filter))),
  );

  // A card taken that has left the library meanwhile is simply not taken.
  const picks = taken.flatMap((iid) => cards.find((c) => c.iid === iid) ?? []);
  const wanted: FoundTo[] = ask?.to ?? ['hand'];
  const toOf = (iid: string, at: number): FoundTo => sent[iid] ?? wanted[Math.min(at, wanted.length - 1)];
  const take = (pile: Pile) => {
    const next = pile.iids.find((iid) => !taken.includes(iid));
    if (next) setTaken([...taken, next]);
  };

  function done() {
    const found: Found[] = picks.map((c, at) => {
      const to = toOf(c.iid, at);
      const record = records[c.cardId];
      const row = record && isLandCard(record.typeLine) ? 'lands' : 'front';
      return to === 'tapped' || to === 'battlefield' ? { iid: c.iid, to, row } : { iid: c.iid, to };
    });
    searchLibrary(playerIdx, found, source);
    onClose(true);
  }

  const chips: { key: Show; label: string }[] = [
    ...(ask?.fits ? [{ key: 'asked' as const, label: capital(ask.what.replace(/^up to /i, '').replace(/^(?:an?|one|two|three|four|five|six|seven|x) /i, '')) }] : []),
    { key: 'all', label: 'All cards' },
    { key: 'lands', label: 'Lands' },
    { key: 'creatures', label: 'Creatures' },
    { key: 'other', label: 'Other' },
  ];
  const zoomed = zoom === null ? undefined : piles.find((p) => p.cardId === zoom);
  const over = ask?.upTo != null && picks.length > ask.upTo;

  return (
    <Sheet
      title={source ? `Search your library · ${source}` : 'Search your library'}
      onClose={() => onClose(false)}
      size="wide"
      footer={
        <button className="primary find-done" onClick={done}>
          {picks.length === 0 ? 'Nothing found · shuffle' : `Done · shuffle the rest`}
        </button>
      }
    >
      <p className="hint find-hint">
        {ask ? <>Find {ask.what}. </> : null}
        Tap a card to take it; hold to read it. The rest is shuffled when you are done.
      </p>

      {picks.length > 0 && (
        <ol className={over ? 'find-taken find-taken--over' : 'find-taken'} aria-label="taking">
          {picks.map((c, at) => {
            const to = toOf(c.iid, at);
            const art = records[c.cardId]?.imageNormal;
            return (
              <li key={c.iid} className="find-pick">
                <span className="find-pick-face">{art ? <img src={art} alt="" /> : null}</span>
                <span className="find-pick-name">{c.name}</span>
                <div className="find-dests" role="group" aria-label={`where ${c.name} goes`}>
                  {FOUND_TO.map((d) => (
                    <button
                      key={d.to}
                      className={to === d.to ? 'look-dest look-dest--on' : 'look-dest'}
                      aria-pressed={to === d.to}
                      onClick={() => setSent((prev) => ({ ...prev, [c.iid]: d.to }))}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <button
                  className="ghost find-back"
                  aria-label={`put ${c.name} back`}
                  onClick={() => setTaken(taken.filter((iid) => iid !== c.iid))}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {over && <p className="hint find-over">The card says up to {ask!.upTo}.</p>}

      <div className="find-filters">
        <div className="chip-row find-chips" role="group" aria-label="which cards to show">
          {chips.map((chip) => (
            <button
              key={chip.key}
              className={show === chip.key ? 'chip chip--selected' : 'chip'}
              aria-pressed={show === chip.key}
              onClick={() => setShow(chip.key)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Name…"
          aria-label="filter by name"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <p className="hint">
          {cards.length === 0 ? 'The library is empty.' : 'No such card in the library.'}
        </p>
      ) : (
        <div className="find-grid">
          {shown.map((p) => (
            <PileTile
              key={p.cardId}
              pile={p}
              art={records[p.cardId]?.imageNormal ?? null}
              left={p.iids.filter((iid) => !taken.includes(iid)).length}
              onTake={() => take(p)}
              onLook={() => setZoom(p.cardId)}
            />
          ))}
        </div>
      )}
      {zoomed && (
        <CardZoomSheet name={zoomed.name} record={records[zoomed.cardId]} onClose={() => setZoom(null)} />
      )}
    </Sheet>
  );
}
