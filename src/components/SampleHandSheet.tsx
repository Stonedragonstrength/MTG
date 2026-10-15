import { useState } from 'react';
import { isLandLine, shuffledDeck } from '../lib/sample';
import type { Deck } from '../lib/types';
import Sheet from './Sheet';

const HAND = 7;

interface Props {
  deck: Deck;
  onClose: () => void;
}

/** A test hand from the deck: seven cards off a fresh shuffle, then draw
 * as many more as you like, mulligan, or start over. Nothing is saved. */
export default function SampleHandSheet({ deck, onClose }: Props) {
  const [library, setLibrary] = useState(() => shuffledDeck(deck));
  const [drawn, setDrawn] = useState(HAND);
  const [mulligans, setMulligans] = useState(0);
  const hand = library.slice(0, drawn);
  const lands = hand.filter((c) => isLandLine(c.typeLine)).length;
  const left = Math.max(0, library.length - drawn);

  const reshuffle = (mulligan: boolean) => {
    setLibrary(shuffledDeck(deck));
    setDrawn(HAND);
    setMulligans((m) => (mulligan ? m + 1 : 0));
  };

  return (
    <Sheet
      title="Sample hand"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button className="primary" disabled={left === 0} onClick={() => setDrawn((n) => n + 1)}>
            Draw a card
          </button>
          <button onClick={() => reshuffle(true)}>Mulligan</button>
          <button className="ghost" onClick={() => reshuffle(false)}>
            New hand
          </button>
        </>
      }
    >
      {library.length === 0 ? (
        <p className="hint">This deck has no cards to draw yet.</p>
      ) : (
        <>
          <p className="sample-line">
            <strong>{lands}</strong> {lands === 1 ? 'land' : 'lands'} · <strong>{hand.length - lands}</strong>{' '}
            {hand.length - lands === 1 ? 'spell' : 'spells'}
            {drawn > HAND && ` · ${drawn - HAND} drawn`}
            {mulligans > 0 && ` · mulligan ${mulligans}`}
            <span className="sample-left"> · {left} left in the library</span>
          </p>
          <div className="sample-hand">
            {hand.map((c, i) =>
              c.imageNormal ? (
                <img
                  key={`${i}-${c.cardId}`}
                  className={i >= HAND ? 'sample-card sample-card--drawn' : 'sample-card'}
                  src={c.imageNormal}
                  alt={c.name}
                />
              ) : (
                <div key={`${i}-${c.cardId}`} className="sample-card sample-card--text">
                  <span>{c.name}</span>
                  <small>{c.typeLine}</small>
                </div>
              ),
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
