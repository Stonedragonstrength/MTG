import { useEffect, useState } from 'react';
import { isCommander } from '../lib/cards';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import { useSeatCombat } from './useCombat';

interface Props {
  playerIdx: number;
  iid: string;
  onClose: () => void;
  /** false where there is no picking (the phone's hand view): no combat chips either. */
  picks?: boolean;
}

/** Everything you do to a card on the battlefield that isn't a tap. */
export default function BattlefieldCardSheet({ playerIdx, iid, onClose, picks = true }: Props) {
  const game = useAppStore((s) => s.game);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const setVirtualCounter = useAppStore((s) => s.setVirtualCounter);
  const commanderDiedAction = useAppStore((s) => s.commanderDiedAction);
  const tapVirtualCard = useAppStore((s) => s.tapVirtualCard);
  const [counterName, setCounterName] = useState('');
  const seat = game?.players[playerIdx]?.cards;
  const card = seat?.battlefield.find((c) => c.iid === iid);
  const records = useCardRecords(card ? [card] : []);
  const combat = useSeatCombat(playerIdx, picks);
  // A peer moved the card away: close for real, or the still-mounted sheet
  // ghost-reopens when the card returns and squats on the back stack.
  const gone = !card;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!game || !seat || !card) return null;

  const record = records[card.cardId];
  const p1p1 = card.counters?.p1p1 ?? 0;
  const named = Object.entries(card.counters ?? {}).filter(([k]) => k !== 'p1p1');
  // Only a commander goes back to the command zone — its partner being
  // home does not block it. Seats dealt before commanders were tracked
  // keep the old rule: an empty command zone takes whatever is sent.
  const goesHome = isCommander(seat, card.iid) ?? seat.command.length === 0;

  const go = (fn: () => void) => () => {
    fn();
    onClose();
  };

  // While this seat picks attackers or blockers a tap on a creature is a
  // pick, and one that cannot fight ignores it. The way round both is
  // here, behind the hold: send it in anyway, and tap or untap it the
  // plain way (crewing and paying with a creature still work). Only the
  // front row fights — a card on the lands shelf moves there first.
  const look = card.row !== 'lands' && combat?.mode ? combat.look({ kind: 'card', id: iid }) : null;
  const job = look?.mode === 'attack' ? 'Attack' : 'Block';

  return (
    <Sheet title={card.name} onClose={onClose}>
      <div className="card-hero">
        {record?.imageNormal && <img className="card-image" src={record.imageNormal} alt={card.name} />}
        {record?.typeLine && <p className="type-line">{record.typeLine}</p>}
      </div>

      {look && (
        <div className="detail-section">
          <span className="section-label">Combat</span>
          <div className="chip-row">
            {look.stop && (
              <button className="chip" onClick={go(look.stop)}>
                Stop {look.mode === 'attack' ? 'attacking' : 'blocking'}
              </button>
            )}
            {look.anyway && (
              <button className="chip" onClick={go(look.anyway)}>
                {/* "anyway" when a tap on the card would have refused */}
                {look.picks && look.free > 0 ? job : `${job} anyway`}
              </button>
            )}
            {/* The direction is said outright: a stale sheet must not flip it back. */}
            <button className="chip" onClick={go(() => tapVirtualCard(playerIdx, iid, !card.tapped))}>
              {card.tapped ? 'Untap' : 'Tap'}
            </button>
          </div>
        </div>
      )}

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
          {goesHome && (
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
