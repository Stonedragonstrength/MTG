import { useEffect, useState } from 'react';
import { commanderTax } from '../lib/cards';
import { affordable, castCosts, hasX } from '../lib/pay';
import { seatSources } from '../lib/seatMana';
import { useAppStore } from '../state/store';
import { PrintedCost } from './ManaSymbol';
import PayWithSheet from './PayWithSheet';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import { useSettleTaps } from './useSettleTaps';
import XCostSheet from './XCostSheet';

interface Props {
  playerIdx: number;
  /** The commander in the command zone this is about. */
  iid: string;
  onClose: () => void;
}

/** A tap on a commander's pedestal: the card, large enough to read, and
 * the one thing to do with it from there — cast it. Nothing is cast until
 * the button is pressed, so a stray tap on the pedestal costs nothing. */
export default function CommanderSheet({ playerIdx, iid, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const castCommander = useAppStore((s) => s.castCommander);
  const [askX, setAskX] = useState(false);
  const [paying, setPaying] = useState(false);
  // It opens under the finger, on the tap that asked for it: the rest of
  // that tap must not land on Cast.
  useSettleTaps();
  const player = game?.players[playerIdx];
  const seat = player?.cards;
  const card = seat?.command.find((c) => c.iid === iid);
  const records = useCardRecords([...(card ? [card] : []), ...(seat?.battlefield ?? [])]);
  // Cast from another device meanwhile: really close, or the sheet would
  // come back by itself the next time the commander goes home.
  const gone = !card;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!player || !seat || !card) return null;
  // A commander with {X} in its cost asks how much, in this sheet's place.
  if (askX) return <XCostSheet playerIdx={playerIdx} iid={iid} from="command" onClose={onClose} />;
  // Choosing the lands that pay takes this sheet's place; Back returns here.
  if (paying)
    return (
      <PayWithSheet
        playerIdx={playerIdx}
        iid={iid}
        from="command"
        onBack={() => setPaying(false)}
        onClose={onClose}
      />
    );

  const record = records[card.cardId];
  const tax = commanderTax(player, card.iid);
  // The same reading of the cost and of the mana as the store's payment.
  // An unread record never blocks.
  const costs = record ? castCosts(record, 'command', tax) : null;
  const sources = seatSources(game, playerIdx, records);
  const poor = !!costs && !costs.some((cost) => affordable(cost, sources));

  function cast() {
    if (costs && hasX(costs)) {
      setAskX(true);
      return;
    }
    castCommander(playerIdx, iid);
    onClose();
  }

  return (
    <Sheet
      title={card.name}
      onClose={onClose}
      footer={
        <>
          {/* A commander with {X} is asked how much first: its cast sheet
              has the same way on to the lands. */}
          <button
            className="ghost"
            onClick={() => (costs && hasX(costs) ? setAskX(true) : setPaying(true))}
          >
            Pay with…
          </button>
          <button className="primary" onClick={cast}>
            {poor ? 'Cast anyway' : 'Cast'}
          </button>
        </>
      }
    >
      <div className="card-hero zoom-card">
        <div className="zoom-face" data-name={card.name}>
          {record?.imageNormal && <img src={record.imageNormal} alt={card.name} />}
        </div>
        {record && (
          <p className="type-line">
            {record.typeLine}
            {record.power !== null && record.toughness !== null && (
              <strong>
                {' '}
                {record.power}/{record.toughness}
              </strong>
            )}
            {record.manaCost && (
              <span className="zoom-cost">
                {' '}
                <PrintedCost cost={record.manaCost} />
              </span>
            )}
          </p>
        )}
        {record?.oracleText && <p className="oracle-text">{record.oracleText}</p>}
      </div>
      {(tax > 0 || poor) && (
        <p className={poor ? 'x-cost x-cost--short' : 'x-cost'}>
          {[tax > 0 ? `Commander tax +${tax}` : '', poor ? 'not enough mana ready' : '']
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </Sheet>
  );
}
