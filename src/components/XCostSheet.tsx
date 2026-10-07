import { useEffect, useState } from 'react';
import { commanderTax } from '../lib/cards';
import { affordable, availableMana, castCosts, maxX, priceX, sourcesFrom } from '../lib/pay';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import { useSettleTaps } from './useSettleTaps';

interface Props {
  playerIdx: number;
  iid: string;
  /** Where the card is cast from: the hand, or the command zone (its
   * front face, with the commander's tax on top). */
  from: 'hand' | 'command';
  onClose: () => void;
}

/** Nobody needs more; it keeps the number on the button. */
const X_CEILING = 99;

/** A card with {X} in its cost asks how much before it is cast. Every way
 * of playing such a card opens this instead of playing it; closing it
 * casts nothing. */
export default function XCostSheet({ playerIdx, iid, from, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const playCard = useAppStore((s) => s.playCard);
  const castCommander = useAppStore((s) => s.castCommander);
  const [x, setX] = useState(0);
  // It opens under the finger, on the tap that plays a hand card: the rest
  // of that tap must not land on Cast, on the stepper or on the backdrop.
  useSettleTaps();
  const player = game?.players[playerIdx];
  const seat = player?.cards;
  const card = seat?.[from].find((c) => c.iid === iid);
  const records = useCardRecords([...(card ? [card] : []), ...(seat?.battlefield ?? [])]);
  // Cast from another device, discarded, drawn away: really close — a
  // sheet left mounted would reopen by itself and squat on the back button.
  const gone = !card;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!player || !seat || !card) return null;

  const record = records[card.cardId];
  const tax = from === 'command' ? commanderTax(player, card.iid) : 0;
  // The same reading of the cost and of the mana as the store's payment.
  const faces = castCosts(record, from, tax);
  const sources = sourcesFrom(seat.battlefield, records, player.board);
  const ready = availableMana(sources);
  const priced = priceX(faces, x);
  // What will be paid: the first face the seat can afford, as in the store.
  const paying = priced.find((cost) => affordable(cost, sources));
  const shown = paying ?? priced[0];
  const total = shown ? shown.generic + shown.pips.length : 0;
  const max = Math.max(0, ...faces.map((cost) => maxX(cost, sources)));

  function cast() {
    if (from === 'command') castCommander(playerIdx, iid, { x });
    else void playCard(playerIdx, iid, { x });
    onClose();
  }

  return (
    <Sheet
      title={card.name}
      onClose={onClose}
      footer={
        <button className="primary" onClick={cast}>
          {paying ? `Cast for X = ${x}` : `Cast anyway (X = ${x})`}
        </button>
      }
    >
      <div className="card-hero x-hero">
        {record?.imageNormal && <img className="card-image" src={record.imageNormal} alt={card.name} />}
        {record?.typeLine && <p className="type-line">{record.typeLine}</p>}
      </div>
      <div className="x-row">
        <span className="x-label">X</span>
        <div className="stepper x-stepper">
          <button aria-label="lower X" disabled={x === 0} onClick={() => setX(x - 1)}>
            −
          </button>
          <span className="x-value">{x}</span>
          <button aria-label="raise X" disabled={x >= X_CEILING} onClick={() => setX(x + 1)}>
            +
          </button>
        </div>
        <button className="ghost x-max" disabled={x === max} onClick={() => setX(max)}>
          Max
        </button>
      </div>
      <p className={paying ? 'x-cost' : 'x-cost x-cost--short'}>
        {`Costs ${total} · ${ready} ready${tax > 0 ? ` · tax +${tax} included` : ''}`}
      </p>
    </Sheet>
  );
}
