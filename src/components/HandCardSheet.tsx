import { useEffect, useState } from 'react';
import { castCosts, hasX } from '../lib/pay';
import { hasLandBack } from '../lib/turnRules';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import XCostSheet from './XCostSheet';

interface Props {
  playerIdx: number;
  iid: string;
  /** Why a tap would not play this card: the land rule, or the mana gate.
   * Said here, with the way around it — "Play anyway" — right below. */
  why?: string | null;
  onClose: () => void;
}

/** Hold on a hand card: everything that isn't playing it. */
export default function HandCardSheet({ playerIdx, iid, why = null, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const playCard = useAppStore((s) => s.playCard);
  const [askX, setAskX] = useState(false);
  const card = game?.players[playerIdx]?.cards?.hand.find((c) => c.iid === iid);
  const records = useCardRecords(card ? [card] : []);
  // The card left the hand (drawn away, discarded remotely): really close.
  const gone = !card;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!card) return null;
  const record = records[card.cardId];
  // Playing a card with {X} always asks how much first, override or not.
  if (askX) return <XCostSheet playerIdx={playerIdx} iid={iid} from="hand" onClose={onClose} />;

  const go = (to: 'graveyard' | 'exile', posTo?: never) => () => {
    void posTo;
    moveVirtualCard(playerIdx, iid, 'hand', to);
    onClose();
  };

  return (
    <Sheet title={card.name} onClose={onClose}>
      <div className="card-hero">
        {record?.imageNormal && <img className="card-image" src={record.imageNormal} alt={card.name} />}
        {record?.typeLine && <p className="type-line">{record.typeLine}</p>}
      </div>
      {why && <p className="hint refusal-hint">{why}</p>}
      <div className="chip-row">
        {why && (
          <button
            className="chip"
            onClick={() => {
              if (hasX(castCosts(record, 'hand'))) {
                setAskX(true);
                return;
              }
              void playCard(playerIdx, iid); // free spells, reducers, treasure math, a land the rules do allow
              onClose();
            }}
          >
            Play anyway
          </button>
        )}
        {hasLandBack(record?.typeLine ?? '') && (
          // A tap casts the front face; the land on the back is played from
          // here, and is counted as the turn's land like any other.
          <button
            className="chip"
            onClick={() => {
              void playCard(playerIdx, iid, { asLand: true });
              onClose();
            }}
          >
            Play as land
          </button>
        )}
        <button className="chip" onClick={go('graveyard')}>Discard</button>
        <button className="chip" onClick={go('exile')}>Exile</button>
        <button
          className="chip"
          onClick={() => {
            moveVirtualCard(playerIdx, iid, 'hand', 'library', { pos: 'top' });
            onClose();
          }}
        >
          Top of library
        </button>
        <button
          className="chip"
          onClick={() => {
            moveVirtualCard(playerIdx, iid, 'hand', 'library', { pos: 'bottom' });
            onClose();
          }}
        >
          Bottom
        </button>
      </div>
    </Sheet>
  );
}
