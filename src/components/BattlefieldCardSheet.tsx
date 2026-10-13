import { useEffect, useState } from 'react';
import { isCommander } from '../lib/cards';
import { shelfOf, type Shelf } from '../lib/shelf';
import type { CardInstance } from '../lib/types';
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

/** The three places a seat's board draws a card, and the `row` that pins it there. */
const SHELVES: { shelf: Shelf; row: NonNullable<CardInstance['row']>; label: string }[] = [
  { shelf: 'field', row: 'field', label: 'On the battlefield' },
  { shelf: 'lands', row: 'lands', label: 'With the lands' },
  { shelf: 'side', row: 'side', label: 'On the side shelf' },
];

/** Everything you do to a card on the battlefield that isn't a tap. */
export default function BattlefieldCardSheet({ playerIdx, iid, onClose, picks = true }: Props) {
  const game = useAppStore((s) => s.game);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const setVirtualCounter = useAppStore((s) => s.setVirtualCounter);
  const commanderDiedAction = useAppStore((s) => s.commanderDiedAction);
  const tapVirtualCard = useAppStore((s) => s.tapVirtualCard);
  const sacrificeCard = useAppStore((s) => s.sacrificeCard);
  const startCombat = useAppStore((s) => s.startCombat);
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
  const myTurn = game.activePlayerIndex === playerIdx && !game.players[playerIdx].eliminated;
  const shelf = shelfOf(card, record);

  return (
    <Sheet title={card.name} onClose={onClose}>
      <div className="card-hero">
        {record?.imageNormal && <img className="card-image" src={record.imageNormal} alt={card.name} />}
        {record?.typeLine && <p className="type-line">{record.typeLine}</p>}
      </div>

      <div className="detail-section">
        <span className="section-label">{look ? 'Combat' : 'Tap'}</span>
        <div className="chip-row">
          {look?.stop && (
            <button className="chip" onClick={go(look.stop)}>
              Stop {look.mode === 'attack' ? 'attacking' : 'blocking'}
            </button>
          )}
          {look?.anyway && (
            <button className="chip" onClick={go(look.anyway)}>
              {/* "anyway" when a tap on the card would have refused */}
              {look.picks && look.free > 0 ? job : `${job} anyway`}
            </button>
          )}
          {/* No fight on and it is this seat's turn: the long way into one —
              pick the attackers one by one — for whatever the board cannot
              offer by itself (a card it cannot read, a Vehicle, a creature
              that should attack without being tapped first). */}
          {picks && !combat && myTurn && card.row !== 'lands' && (
            <button className="chip" onClick={go(startCombat)}>
              Pick attackers…
            </button>
          )}
          {/* Always here: the plain tap, and the way back from one made by
              mistake. The direction is said outright — a stale sheet must
              not flip it back. */}
          <button className="chip" onClick={go(() => tapVirtualCard(playerIdx, iid, !card.tapped))}>
            {card.tapped ? 'Untap' : 'Tap'}
          </button>
        </div>
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
          {/* To the graveyard as well, but said as what it was: a card that
              asks for a sacrifice wants the table to see one. */}
          <button className="chip" onClick={go(() => sacrificeCard(playerIdx, iid))}>Sacrifice</button>
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
        </div>
      </div>

      {/* Where it is drawn. The board sorts cards by type; this is for the
          one that belongs somewhere else (an animated land, a Vehicle the
          player wants up with the creatures). 'lands' also keeps it out of
          combat until it is moved back. */}
      <div className="detail-section">
        <span className="section-label">Keep it</span>
        <div className="chip-row">
          {SHELVES.filter((s) => s.shelf !== shelf).map((s) => (
            <button
              key={s.shelf}
              className="chip"
              onClick={() =>
                moveVirtualCard(playerIdx, iid, 'battlefield', 'battlefield', { row: s.row })
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
