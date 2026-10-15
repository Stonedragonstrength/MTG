import { useEffect, useState } from 'react';
import { commanderTax } from '../lib/cards';
import {
  affordable,
  availableMana,
  castCosts,
  extraCosts,
  extraTimes,
  hasX,
  maxX,
  priceExtras,
  priceX,
} from '../lib/pay';
import { seatSources } from '../lib/seatMana';
import { useAppStore } from '../state/store';
import PayWithSheet from './PayWithSheet';
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
/** As often as anyone pays a multikicker. */
const TIMES_CEILING = 20;

/** The cast sheet: what a spell has to be told before it is cast. A card
 * with {X} in its cost asks how much; a card with a kicker (or a
 * multikicker, a buyback, …) asks whether it is paid. Every way of playing
 * such a card opens this instead of playing it; closing it casts nothing.
 * Extra costs are asked from the hand only. */
export default function XCostSheet({ playerIdx, iid, from, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const playCard = useAppStore((s) => s.playCard);
  const castCommander = useAppStore((s) => s.castCommander);
  const [x, setX] = useState(0);
  const [asked, setAsked] = useState<number[]>([]);
  const [choosing, setChoosing] = useState(false); // "Pay with…" has this sheet's place
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
  const asksX = hasX(faces);
  const extras = from === 'hand' ? extraCosts(record) : [];
  const times = extraTimes(extras, asked);
  const sources = seatSources(game, playerIdx, records);
  const ready = availableMana(sources);
  const priced = priceExtras(priceX(faces, x), extras, times);
  // What will be paid: the first face the seat can afford, as in the store.
  const paying = priced.find((cost) => affordable(cost, sources));
  const shown = paying ?? priced[0];
  const total = shown ? shown.generic + shown.pips.length : 0;
  // The largest X that still pays with the extras chosen.
  const max = Math.max(0, ...priceExtras(faces, extras, times).map((cost) => maxX(cost, sources)));
  const setTimes = (i: number, n: number) =>
    setAsked(extras.map((_, k) => (k === i ? Math.max(0, n) : times[k])));

  function cast() {
    if (from === 'command') castCommander(playerIdx, iid, { x });
    else void playCard(playerIdx, iid, { ...(asksX ? { x } : {}), ...(extras.length > 0 ? { extras: times } : {}) });
    onClose();
  }

  const label = asksX
    ? paying
      ? `Cast for X = ${x}`
      : `Cast anyway (X = ${x})`
    : paying
      ? 'Cast'
      : 'Cast anyway';

  // Which lands pay, with what was answered here: that sheet takes this
  // one's place, and its Back returns with the answers as they were.
  if (choosing)
    return (
      <PayWithSheet
        playerIdx={playerIdx}
        iid={iid}
        from={from}
        {...(asksX ? { x } : {})}
        extras={times}
        onBack={() => setChoosing(false)}
        onClose={onClose}
      />
    );

  return (
    <Sheet
      title={card.name}
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={() => setChoosing(true)}>
            Pay with…
          </button>
          <button className="primary" onClick={cast}>
            {label}
          </button>
        </>
      }
    >
      <div className="card-hero x-hero">
        {record?.imageNormal && <img className="card-image" src={record.imageNormal} alt={card.name} />}
        {record?.typeLine && <p className="type-line">{record.typeLine}</p>}
      </div>
      {asksX && (
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
      )}
      {extras.map((extra, i) =>
        extra.many ? (
          // Paid any number of times: how many.
          <div className="x-row extra-row" key={i}>
            <span className="extra-label">{extra.label}</span>
            <div className="stepper x-stepper">
              <button
                aria-label={`one fewer ${extra.label}`}
                disabled={times[i] === 0}
                onClick={() => setTimes(i, times[i] - 1)}
              >
                −
              </button>
              <span className="x-value">{times[i]}</span>
              <button
                aria-label={`one more ${extra.label}`}
                disabled={times[i] >= TIMES_CEILING}
                onClick={() => setTimes(i, times[i] + 1)}
              >
                +
              </button>
            </div>
          </div>
        ) : (
          // Paid or not: one switch, off until the player says so.
          <div className="x-row extra-row" key={i}>
            <span className="extra-label">{extra.label}</span>
            <button
              role="switch"
              aria-checked={times[i] > 0}
              aria-label={extra.label}
              className={times[i] > 0 ? 'extra-switch extra-switch--on' : 'extra-switch'}
              onClick={() => setTimes(i, times[i] > 0 ? 0 : 1)}
            >
              {times[i] > 0 ? 'Paid' : 'Not paid'}
            </button>
          </div>
        ),
      )}
      <p className={paying ? 'x-cost' : 'x-cost x-cost--short'}>
        {`Costs ${total} · ${ready} ready${tax > 0 ? ` · tax +${tax} included` : ''}`}
      </p>
    </Sheet>
  );
}
