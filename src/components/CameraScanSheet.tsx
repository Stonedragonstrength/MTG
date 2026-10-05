import { useEffect, useRef, useState } from 'react';
import { recognizeTitle } from '../data/ocr';
import { getCardById } from '../data/scryfall';
import { addCard } from '../lib/deck';
import { matchScannedTitle } from '../lib/decklist';
import { useAppStore } from '../state/store';
import { getNameIndex } from './nameIndexCache';
import Sheet from './Sheet';

interface Props {
  deckId: string;
  onClose: () => void;
}

/** Point the camera at a card's TITLE, hit read, confirm the match.
 * OCR via tesseract (fetched on first use), matching via the same
 * forgiving fuzzy index as search — misreads cost one tap. */
export default function CameraScanSheet({ deckId, onClose }: Props) {
  const saveDeck = useAppStore((s) => s.saveDeck);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<{ id: string; name: string }[]>([]);
  const [guesses, setGuesses] = useState<{ id: string; name: string }[]>([]);
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  useEffect(() => {
    getNameIndex().then(setNames);
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function read() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    setBusy(true);
    setGuesses([]);
    try {
      // The on-screen guide sits across the middle: crop that band only —
      // less text competing with the title, much better OCR.
      const canvas = document.createElement('canvas');
      const bandH = Math.round(video.videoHeight * 0.14);
      canvas.width = video.videoWidth;
      canvas.height = bandH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(
        video,
        0,
        Math.round(video.videoHeight * 0.43),
        video.videoWidth,
        bandH,
        0,
        0,
        canvas.width,
        bandH,
      );
      const text = await recognizeTitle(canvas);
      setLastRead(text || null);
      setGuesses(matchScannedTitle(text, names));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(id: string) {
    const card = await getCardById(id);
    const deck = useAppStore.getState().decks.find((d) => d.id === deckId);
    if (!card || card.isToken || !deck) return;
    await saveDeck(addCard(deck, card));
    setLastAdded(card.name);
    setGuesses([]);
  }

  return (
    <Sheet title="Scan cards" onClose={onClose} size="wide">
      {unavailable ? (
        <p className="hint">
          No camera here — on the tablet or phone this opens the rear camera. On desktop,
          "Paste a list" is the faster road anyway.
        </p>
      ) : (
        <>
          <div className="scan-stage">
            <video ref={videoRef} className="scan-video" playsInline muted />
            <div className="scan-guide" aria-hidden="true" />
          </div>
          <p className="hint">Line the card's title up inside the band, then read it.</p>
          <div className="modal-actions">
            <button className="primary" disabled={busy} onClick={() => void read()}>
              {busy ? 'Reading…' : 'Read card'}
            </button>
          </div>
          {lastAdded && <p className="entry-last">Added {lastAdded}</p>}
          {guesses.length > 0 ? (
            <div className="chip-row">
              {guesses.map((g) => (
                <button key={g.id} className="chip" onClick={() => void confirm(g.id)}>
                  {g.name}
                </button>
              ))}
            </div>
          ) : (
            lastRead !== null &&
            !busy && (
              <p className="hint">
                Read "{lastRead}" but nothing matched — better light or a steadier hold
                usually fixes it.
              </p>
            )
          )}
        </>
      )}
    </Sheet>
  );
}
