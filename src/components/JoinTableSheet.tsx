import { useState } from 'react';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';

interface Props {
  onClose: () => void;
}

// Stable empty fallback: a fresh [] per selector call would re-render forever.
const NO_PROFILES: never[] = [];

/** Type the 6-char code from the host, land at the living table, then
 * point at which seat is you so the board faces the right way. */
export default function JoinTableSheet({ onClose }: Props) {
  const joinOnlineGame = useAppStore((s) => s.joinOnlineGame);
  const setMySeat = useAppStore((s) => s.setMySeat);
  const seedSeatFromDeck = useAppStore((s) => s.seedSeatFromDeck);
  const decks = useAppStore((s) => s.decks);
  const hadLocalGame = useAppStore((s) => s.game !== null && s.online === null);
  const cardsTable = useAppStore((s) => s.game?.config.mode === 'cards');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'code' | 'seat' | 'deck'>('code');
  const [seat, setSeat] = useState<number | null>(null);
  const profiles = useAppStore((s) => s.game?.config.profiles ?? NO_PROFILES);

  async function join() {
    setBusy(true);
    setError('');
    const err = await joinOnlineGame(code.toUpperCase().trim());
    setBusy(false);
    if (err) setError(err);
    else setStep('seat');
  }

  function seatPicked(i: number) {
    setMySeat(i);
    setSeat(i);
    // A cards table without cards in your seat: bring one of your decks.
    const seatHasCards = useAppStore.getState().game?.players[i]?.cards !== undefined;
    if (cardsTable && !seatHasCards && decks.length > 0) setStep('deck');
    else onClose();
  }

  return (
    <Sheet
      title={
        step === 'code' ? 'Join table' : step === 'seat' ? 'Which seat is you?' : 'Bring a deck?'
      }
      onClose={onClose}
    >
      {step === 'code' ? (
        <>
          <p className="hint">
            Ask the host for their table code — you'll see the same living table they do.
          </p>
          {hadLocalGame && (
            <p className="hint join-warn">Joining replaces the game saved on this device.</p>
          )}
          <input
            className="join-code-input"
            value={code}
            maxLength={6}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="KQ7M2X"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          {error && <p className="hint join-error">{error}</p>}
          <div className="modal-actions">
            <button className="primary" disabled={code.trim().length < 6 || busy} onClick={join}>
              {busy ? 'Joining…' : 'Join'}
            </button>
          </div>
        </>
      ) : step === 'seat' ? (
        <>
          <p className="hint">The table will turn so your zone sits at your bottom edge.</p>
          <div className="chip-row">
            {profiles.map((p, i) => (
              <button key={p.id} className="chip" onClick={() => seatPicked(i)}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="modal-actions">
            <button className="ghost" onClick={onClose}>
              Skip
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            This table plays with virtual cards — pick one of your decks to shuffle up.
            Friendly game: hands are hidden by politeness, not cryptography.
          </p>
          <div className="chip-row">
            {decks.map((d) => (
              <button
                key={d.id}
                className="chip"
                onClick={() => {
                  if (seat !== null) seedSeatFromDeck(seat, d);
                  onClose();
                }}
              >
                {d.name}
              </button>
            ))}
          </div>
          <div className="modal-actions">
            <button className="ghost" onClick={onClose}>
              Spectate / tracker only
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
