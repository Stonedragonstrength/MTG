import { useEffect, useMemo, useState } from 'react';
import { kvGet, kvSet } from '../data/db';
import { findCardByName, getCardById } from '../data/scryfall';
import { createBoardItem } from '../lib/board';
import { normalize, searchNames } from '../lib/fuzzy';
import { useAppStore } from '../state/store';
import CustomTokenForm from './CustomTokenForm';
import { getNameIndex } from './nameIndexCache';
import Sheet from './Sheet';
import { useLongPress } from './useLongPress';

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
const PINNED_KEY = 'customQuickTokens';
const PINNED_CAP = 16;

function ChipArt({ src }: { src?: string }) {
  return src ? <img className="chip-art" src={src} alt="" loading="lazy" /> : null;
}

/** A user-pinned quick token: tap adds it, hold unpins it. */
function PinnedChip({
  name,
  artSrc,
  onPick,
  onUnpin,
}: {
  name: string;
  artSrc?: string;
  onPick: () => void;
  onUnpin: () => void;
}) {
  const press = useLongPress(onPick, onUnpin);
  return (
    <button
      className="chip chip--art chip--pinned"
      aria-label={`${name} (pinned)`}
      title="Tap to add · hold to unpin"
      {...press}
    >
      <ChipArt src={artSrc} />
      <span className="chip-name">{name}</span>
    </button>
  );
}

interface Props {
  playerIdx: number;
  onClose: () => void;
  zone?: 'board' | 'lands';
}

export default function CardSearch({ playerIdx, onClose, zone = 'board' }: Props) {
  const addItem = useAppStore((s) => s.addItem);
  const [query, setQuery] = useState('');
  const [names, setNames] = useState<{ id: string; name: string }[]>([]);
  const [recent, setRecent] = useState<{ id: string; name: string }[]>([]);
  const [pinned, setPinned] = useState<{ id: string; name: string }[]>([]);
  const [customOpen, setCustomOpen] = useState(false);

  const [art, setArt] = useState<Record<string, string>>({});

  useEffect(() => {
    getNameIndex().then(setNames);
    kvGet<{ id: string; name: string }[]>(RECENT_KEY).then((r) => setRecent(r ?? []));
    kvGet<{ id: string; name: string }[]>(PINNED_KEY).then((p) => setPinned(p ?? []));
  }, []);

  // Little art strips for the chip rows: defaults resolve by name, the
  // pinned/recent entries by id.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded: Record<string, string> = {};
      for (const name of COMMON_TOKENS) {
        const card = await findCardByName(name).catch(() => undefined);
        if (card?.imageNormal) loaded[`name:${name}`] = card.imageArtCrop ?? card.imageNormal;
        if (cancelled) return;
      }
      for (const entry of [...pinned, ...recent]) {
        if (loaded[`id:${entry.id}`]) continue;
        const card = await getCardById(entry.id).catch(() => undefined);
        if (card?.imageNormal) loaded[`id:${entry.id}`] = card.imageArtCrop ?? card.imageNormal;
        if (cancelled) return;
      }
      if (!cancelled) setArt(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [pinned, recent]);

  function pin(entry: { id: string; name: string }) {
    const next = [...pinned.filter((p) => p.id !== entry.id), entry].slice(-PINNED_CAP);
    setPinned(next);
    kvSet(PINNED_KEY, next).catch(() => {});
  }

  function unpin(id: string) {
    const next = pinned.filter((p) => p.id !== id);
    setPinned(next);
    kvSet(PINNED_KEY, next).catch(() => {});
  }

  const results = useMemo(() => searchNames(query, names, 15), [query, names]);

  async function pickId(id: string) {
    const card = await getCardById(id);
    if (!card) return;
    addItem(playerIdx, createBoardItem(card, zone));
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

  if (customOpen) {
    return (
      <Sheet title="Custom token" onClose={onClose}>
        <CustomTokenForm playerIdx={playerIdx} onDone={onClose} />
      </Sheet>
    );
  }

  return (
    <Sheet
      title={zone === 'lands' ? 'Add a land' : 'Add a card'}
      onClose={onClose}
      size="wide"
      footer={
        zone === 'lands' ? undefined : (
          <button className="ghost" onClick={() => setCustomOpen(true)}>
            Custom token…
          </button>
        )
      }
    >
      <input
        autoFocus
        type="search"
        placeholder="Search any card…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {query.trim() === '' && zone === 'lands' ? (
        <p className="hint">Search for any land — basics have one-tap buttons back on the board.</p>
      ) : query.trim() === '' ? (
        <>
          <div className="chip-group">
            <span className="chip-group-label">Quick tokens</span>
            <div className="chip-row" aria-label="common tokens">
              {COMMON_TOKENS.map((name) => (
                <button
                  key={name}
                  className="chip chip--art"
                  aria-label={`${name} token`}
                  onClick={() => pickByName(name)}
                >
                  <ChipArt src={art[`name:${name}`]} />
                  <span className="chip-name">{name}</span>
                </button>
              ))}
              {pinned.map((p) => (
                <PinnedChip
                  key={p.id}
                  name={p.name}
                  artSrc={art[`id:${p.id}`]}
                  onPick={() => void pickId(p.id)}
                  onUnpin={() => unpin(p.id)}
                />
              ))}
            </div>
          </div>
          {recent.length > 0 && (
            <div className="chip-group">
              <span className="chip-group-label">Recent</span>
              <div className="chip-row" aria-label="recently used">
                {recent.map((r) => (
                  <button
                    key={r.id}
                    className="chip chip--art chip--recent"
                    onClick={() => pickId(r.id)}
                  >
                    <ChipArt src={art[`id:${r.id}`]} />
                    <span className="chip-name">{r.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <ul className="search-results">
          {results.map((r) => (
            <li key={r.id} className="search-result-row">
              <button className="search-result-main" onClick={() => pickId(r.id)}>
                {r.name}
              </button>
              <button
                className="pin-btn"
                aria-label={`pin ${r.name} to quick tokens`}
                title="Pin to quick tokens"
                onClick={() => pin(r)}
              >
                {pinned.some((p) => p.id === r.id) ? '★' : '☆'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
