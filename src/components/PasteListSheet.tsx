import { useState } from 'react';
import { resolveDeckList } from '../data/import';
import { importLines } from '../lib/deck';
import { useAppStore } from '../state/store';
import OwnedSwitch from './OwnedSwitch';
import Sheet from './Sheet';

interface Props {
  deckId: string;
  onClose: () => void;
}

/** Paste any decklist (Delver Lens export, Moxfield, Arena, plain lines)
 * and it resolves against the offline database in one shot. */
export default function PasteListSheet({ deckId, onClose }: Props) {
  const saveDeck = useAppStore((s) => s.saveDeck);
  const addToGarage = useAppStore((s) => s.addToGarage);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ added: number; misses: string[]; owned: boolean } | null>(
    null,
  );

  async function doImport() {
    setBusy(true);
    const { hits, misses } = await resolveDeckList(text);
    const deck = useAppStore.getState().decks.find((d) => d.id === deckId);
    if (!deck) return;
    const { deck: next, added } = importLines(deck, hits);
    await saveDeck(next);
    // A list brought in from elsewhere is a plan, not a collection: it only
    // joins the Curation when the deck is marked as cards you own.
    const owned = !!next.owned;
    if (owned) for (const hit of hits) await addToGarage(hit.card, hit.count);
    setBusy(false);
    setReport({ added, misses, owned });
  }

  return (
    <Sheet title="Paste a list" onClose={onClose} size="wide">
      {report === null ? (
        <>
          <p className="hint">
            One card per line — "24 Forest", "2x Sol Ring", set codes and *CMDR* flags all
            fine. Scanned a pile in another app? Export as text and paste it here.
          </p>
          <textarea
            className="paste-box"
            rows={10}
            placeholder={'1 Lathril, Blade of the Elves *CMDR*\n24 Forest\n1 Sol Ring'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <OwnedSwitch deckId={deckId} />
          <div className="modal-actions">
            <button className="primary" disabled={!text.trim() || busy} onClick={doImport}>
              {busy ? 'Matching…' : 'Import'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="import-done">
            Added {report.added} card{report.added === 1 ? '' : 's'}.
          </p>
          <p className="hint">
            {report.owned
              ? 'Logged in your Curation too.'
              : 'Your Curation is untouched. Once you own this deck, “Send to Curation” on the deck logs it all.'}
          </p>
          {report.misses.length > 0 && (
            <>
              <p className="hint">These lines didn't match any real card:</p>
              <ul className="import-misses">
                {report.misses.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          )}
          <div className="modal-actions">
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
