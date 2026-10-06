import { useEffect } from 'react';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';

interface Props {
  playerIdx: number;
  iid: string;
  onClose: () => void;
}

/** Hold on a hand card: everything that isn't playing it. */
export default function HandCardSheet({ playerIdx, iid, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const card = game?.players[playerIdx]?.cards?.hand.find((c) => c.iid === iid);
  const records = useCardRecords(card ? [card] : []);
  // The card left the hand (drawn away, discarded remotely): really close.
  const gone = !card;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!card) return null;
  const record = records[card.cardId];

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
      <div className="chip-row">
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
