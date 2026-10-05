import { useEffect, useRef, useState } from 'react';
import { recognizeLines } from '../data/ocr';
import { getCardById } from '../data/scryfall';
import { addCard } from '../lib/deck';
import { bestScannedMatch } from '../lib/decklist';
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

  // Hands-free loop: keep reading while nothing is pending, pause while
  // confirm chips are up so they can't flicker away mid-tap.
  const loopState = useRef({ busy: false, pending: false });
  loopState.current = { busy, pending: guesses.length > 0 };
  useEffect(() => {
    if (unavailable) return;
    const t = window.setInterval(() => {
      const { busy: b, pending } = loopState.current;
      if (!b && !pending) void read(true);
    }, 2200);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unavailable, names]);

  // The just-confirmed card keeps sitting under the lens; auto reads skip
  // it so a stray tap can't double-add. A different card clears the hold.
  const lastConfirmed = useRef<string | null>(null);

  async function read(auto = false) {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    setBusy(true);
    setGuesses([]);
    try {
      // Crop the on-screen band (generous on purpose — line matching sorts
      // the title from type/rules text) and upscale ×2: small letters from
      // arm's length resolve far better for the OCR.
      const canvas = document.createElement('canvas');
      const bandY = Math.round(video.videoHeight * 0.3);
      const bandH = Math.round(video.videoHeight * 0.36);
      canvas.width = video.videoWidth * 2;
      canvas.height = bandH * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(video, 0, bandY, video.videoWidth, bandH, 0, 0, canvas.width, canvas.height);
      const lines = await recognizeLines(canvas);
      setLastRead(lines.join(' · ') || null);
      const hits = bestScannedMatch(lines, names);
      if (auto && hits[0] && hits[0].id === lastConfirmed.current) {
        setGuesses([]);
      } else {
        if (hits[0] && hits[0].id !== lastConfirmed.current) lastConfirmed.current = null;
        setGuesses(hits);
      }
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
    lastConfirmed.current = id;
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
          <p className="hint">
            Line the title up inside the band — it reads on its own. Tap the match, slide the
            next card in, repeat.
          </p>
          <div className="modal-actions">
            <button className="primary" disabled={busy} onClick={() => void read()}>
              {busy ? 'Reading…' : 'Read now'}
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
              <button className="chip chip--skip" onClick={() => setGuesses([])}>
                ✕ none of these
              </button>
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
