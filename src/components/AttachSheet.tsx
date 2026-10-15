import { useEffect, useState } from 'react';
import { hostChoices, hostKind, hostOf, isEquipment, sizeGiven, sizeWords } from '../lib/attach';
import { seatIdentity } from '../lib/commanders';
import { comesAttached, equipHost, equipWay, equipWays } from '../lib/equip';
import { affordable, sourcesFrom } from '../lib/pay';
import { useAppStore } from '../state/store';
import { CostSymbols } from './ManaSymbol';
import Sheet from './Sheet';
import { useTableRecords } from './useCombat';
import { useSettleTaps } from './useSettleTaps';

interface Props {
  /** The seat that controls the Aura or Equipment. */
  playerIdx: number;
  /** The Aura or Equipment, on that seat's battlefield. */
  iid: string;
  onClose: () => void;
}

/** Where an Aura or an Equipment goes: one list of what it can sit on, a
 * tab per player — your own side first, then each opponent's, because some
 * of these are meant for somebody else's creature. A tap on a row attaches
 * it. No picking on the board: the list is the whole of it.
 *
 * An Equipment is paid for as it goes on ("Equip {2}": the lands tap in the
 * same move). While the seat cannot pay, the rows are dimmed and refuse,
 * the way a card in hand does — with "Equip anyway" beside the cost for
 * everything the table cannot see. An Aura was paid for when it was cast. */
export default function AttachSheet({ playerIdx, iid, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const attachVirtualCard = useAppStore((s) => s.attachVirtualCard);
  const takeControl = useAppStore((s) => s.takeControl);
  const equipCard = useAppStore((s) => s.equipCard);
  const [tab, setTab] = useState(playerIdx);
  // Whether this equip is paid for, once the player has said so: null = as
  // the table reads it (paid — but for an Equipment that attaches itself as
  // it comes in).
  const [unpaid, setUnpaid] = useState<boolean | null>(null);
  // After playing an Aura it opens under the finger that played it: the
  // rest of that tap must not pick a row.
  useSettleTaps();
  const records = useTableRecords();
  const card = game?.players[playerIdx]?.cards?.battlefield.find((c) => c.iid === iid);
  // Gone meanwhile (destroyed, bounced by another device): really close.
  const gone = !card;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!game || !card) return null;

  const record = records[card.cardId];
  const equipment = isEquipment(record);
  const controlsHost = /\byou control enchanted (?:creature|permanent|artifact)\b/i.test(record?.oracleText.split('\n//\n')[0] ?? '');
  const current = hostOf(game, card);
  const given = sizeGiven(record);
  // Your own side first, then the others in turn order.
  const seats = game.players.map((_, i) => (playerIdx + i) % game.players.length);
  const shown = seats.includes(tab) ? tab : playerIdx;
  const choices = hostChoices(game, shown, record, records, { seat: playerIdx, iid });
  const nowhere = hostKind(record) === 'player';

  // What equipping costs, as the card prints it, and what the seat has to
  // pay it with — the same reading the store pays by (lib/equip.ts).
  const ways = equipWays(record);
  const owes = ways.some((way) => way.cost.generic + way.cost.pips.length > 0);
  const me = game.players[playerIdx];
  const sources = sourcesFrom(me.cards?.battlefield ?? [], records, me.board, seatIdentity(game, playerIdx));
  // "When this Equipment enters, attach it to…": the first time it goes on
  // something, the turn it arrived, nothing is owed.
  const arriving = comesAttached(record) && card.sick === true && !current;
  const free = unpaid ?? arriving;
  const canPayAny = ways.some((way) => affordable(way.cost, sources));

  return (
    <Sheet
      title={`${equipment ? 'Equip' : 'Attach'} ${card.name}`}
      onClose={onClose}
      footer={
        current ? (
          <button
            className="ghost"
            onClick={() => {
              attachVirtualCard(playerIdx, iid, null);
              onClose();
            }}
          >
            Take it off
          </button>
        ) : (
          <button className="ghost" onClick={() => onClose()}>
            Leave it unattached
          </button>
        )
      }
    >
      {seats.length > 1 && (
        <div role="tablist" className="segmented attach-tabs">
          {seats.map((seat) => (
            <button
              key={seat}
              role="tab"
              aria-selected={seat === shown}
              className={seat === shown ? 'segment active' : 'segment'}
              onClick={() => setTab(seat)}
            >
              {seat === playerIdx ? 'Mine' : (game.config.profiles[seat]?.name ?? '?')}
            </button>
          ))}
        </div>
      )}
      {given && (
        // Nothing to switch on: the creature is that much bigger for as long
        // as this is on it, on the board and in a fight (lib/attach.ts).
        <p className="hint attach-boost">
          It gives {sizeWords(given)} to what it is on, for as long as it is on it.
        </p>
      )}
      {ways.length > 0 && (
        <div className="equip-cost" role="group" aria-label="equip cost">
          <span className="equip-ways">
            {ways.map((way, i) => (
              <span className="equip-way" key={i}>
                Equip{way.only ? ` ${way.only}` : ''} <CostSymbols cost={way.cost} />
              </span>
            ))}
          </span>
          {owes && (
            <>
              <span className={free || canPayAny ? 'equip-state' : 'equip-state equip-state--short'}>
                {free
                  ? arriving && unpaid === null
                    ? 'It attaches itself as it comes in: nothing to pay.'
                    : 'Not paying for it.'
                  : canPayAny
                    ? 'Your lands pay for it.'
                    : 'Not enough mana ready.'}
              </span>
              <button className="ghost equip-switch" onClick={() => setUnpaid(!free)}>
                {free ? 'Pay for it' : canPayAny ? 'Don’t pay' : 'Equip anyway'}
              </button>
            </>
          )}
        </div>
      )}
      {nowhere ? (
        <p className="hint">It enchants a player: there is nothing on the board to put it on.</p>
      ) : choices.length === 0 ? (
        <p className="hint">Nothing here it can go on.</p>
      ) : (
        <ul className="attach-list">
          {choices.map((host) => {
            const here =
              current !== null && current.seat === host.seat && current.kind === host.kind && current.id === host.id;
            // What this creature pays (a card may have a cheaper way for
            // some), and whether the seat can: one it cannot pay for is
            // dimmed and refuses, like a card in hand.
            const way = equipment && !free && !here ? equipWay(record, equipHost(game, host, records)) : null;
            const short = way !== null && !affordable(way.cost, sources);
            return (
              <li key={`${host.kind}:${host.id}`}>
                <button
                  className={`attach-row${here ? ' attach-row--on' : ''}${short ? ' attach-row--short' : ''}`}
                  aria-label={here ? `${host.name} — it is on this now` : `put it on ${host.name}`}
                  aria-pressed={here}
                  aria-disabled={short || undefined}
                  title={short ? 'Not enough mana ready' : undefined}
                  onClick={() => {
                    if (short) return;
                    const on = { seat: host.seat, kind: host.kind, id: host.id };
                    if (!equipment) {
                      attachVirtualCard(playerIdx, iid, on);
                      // "You control enchanted creature" (Control Magic): the
                      // creature comes over, held by the Aura while it stays.
                      if (controlsHost && on.kind === 'card' && on.seat !== playerIdx)
                        takeControl(playerIdx, on.seat, on.id, { by: iid });
                    }
                    // On it already: nothing moves, nothing is owed.
                    else if (!here) void (free ? equipCard(playerIdx, iid, on, { free: true }) : equipCard(playerIdx, iid, on));
                    onClose();
                  }}
                >
                  {host.art ? (
                    <img className="pile-art" src={host.art} alt="" loading="lazy" />
                  ) : (
                    <span className="pile-art pile-art--empty" />
                  )}
                  <span className="pile-name">{host.name}</span>
                  {host.size && <span className="attach-size">{host.size}</span>}
                  {/* Two equip abilities on one card: each row says which it pays. */}
                  {way && ways.length > 1 && (
                    <span className="attach-cost">
                      <CostSymbols cost={way.cost} />
                    </span>
                  )}
                  {here && <span className="attach-here">on it</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
