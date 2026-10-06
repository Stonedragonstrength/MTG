import { useState } from 'react';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';

interface Props {
  playerIdx: number;
  iid: string;
  onClose: () => void;
}

/** Everything you do to a card on the battlefield that isn't a tap. */
export default function BattlefieldCardSheet({ playerIdx, iid, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const setVirtualCounter = useAppStore((s) => s.setVirtualCounter);
  const commanderDiedAction = useAppStore((s) => s.commanderDiedAction);
  const [counterName, setCounterName] = useState('');
  const seat = game?.players[playerIdx]?.cards;
  const card = seat?.battlefield.find((c) => c.iid === iid);
  const records = useCardRecords(card ? [card] : []);
  if (!game || !seat || !card) return null;

  const record = records[card.cardId];
  const p1p1 = card.counters?.p1p1 ?? 0;
  const named = Object.entries(card.counters ?? {}).filter(([k]) => k !== 'p1p1');
  const commandEmpty = seat.command.length === 0;

  const go = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <Sheet title={card.name} onClose={onClose}>
      <div className="card-hero">
        {record?.imageNormal && <img className="card-image" src={record.imageNormal} alt={card.name} />}
        {record?.typeLine && <p className="type-line">{record.typeLine}</p>}
      </div>

      <div className="detail-section">
        <span className="section-label">Counters</span>
        <div className="detail-row">
          <span>+1/+1</span>
          <div className="stepper">
            <button aria-label="fewer +1/+1" onClick={() => setVirtualCounter(playerIdx, iid, 'p1p1', p1p1 - 1)}>−</button>
            <span>{p1p1}</span>
            <button aria-label="more +1/+1" onClick={() => setVirtualCounter(playerIdx, iid, 'p1p1', p1p1 + 1)}>+</button>
          </div>
        </div>
        {named.map(([name, value]) => (
          <div className="detail-row" key={name}>
            <span>{name}</span>
            <div className="stepper">
              <button aria-label={`fewer ${name}`} onClick={() => setVirtualCounter(playerIdx, iid, name, value - 1)}>−</button>
              <span>{value}</span>
              <button aria-label={`more ${name}`} onClick={() => setVirtualCounter(playerIdx, iid, name, value + 1)}>+</button>
            </div>
          </div>
        ))}
        <div className="detail-row">
          <input placeholder="counter name" value={counterName} onChange={(e) => setCounterName(e.target.value)} />
          <button
            disabled={!counterName.trim()}
            onClick={() => {
              setVirtualCounter(playerIdx, iid, counterName.trim().toLowerCase(), 1);
              setCounterName('');
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div className="detail-section">
        <span className="section-label">Move</span>
        <div className="chip-row">
          <button className="chip" onClick={go(() => moveVirtualCard(playerIdx, iid, 'battlefield', 'graveyard'))}>Graveyard</button>
          <button className="chip" onClick={go(() => moveVirtualCard(playerIdx, iid, 'battlefield', 'exile'))}>Exile</button>
          <button className="chip" onClick={go(() => moveVirtualCard(playerIdx, iid, 'battlefield', 'hand'))}>Hand</button>
          <button className="chip" onClick={go(() => moveVirtualCard(playerIdx, iid, 'battlefield', 'library', { pos: 'top' }))}>Top</button>
          <button className="chip" onClick={go(() => moveVirtualCard(playerIdx, iid, 'battlefield', 'library', { pos: 'bottom' }))}>Bottom</button>
          {commandEmpty && (
            <button className="chip" onClick={go(() => commanderDiedAction(playerIdx, iid))}>
              To command (+2 tax)
            </button>
          )}
          <button
            className="chip"
            onClick={() =>
              moveVirtualCard(playerIdx, iid, 'battlefield', 'battlefield', {
                row: card.row === 'lands' ? 'front' : 'lands',
              })
            }
          >
            {card.row === 'lands' ? 'To front row' : 'To lands shelf'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
