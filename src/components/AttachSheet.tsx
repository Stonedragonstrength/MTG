import { useEffect, useState } from 'react';
import { boostOf, hostChoices, hostKind, hostOf, isEquipment } from '../lib/attach';
import { useAppStore } from '../state/store';
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
 * it. No picking on the board: the list is the whole of it. */
export default function AttachSheet({ playerIdx, iid, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const attachVirtualCard = useAppStore((s) => s.attachVirtualCard);
  const [tab, setTab] = useState(playerIdx);
  const [counters, setCounters] = useState(true);
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
  const current = hostOf(game, card);
  const boost = boostOf(record);
  // Your own side first, then the others in turn order.
  const seats = game.players.map((_, i) => (playerIdx + i) % game.players.length);
  const shown = seats.includes(tab) ? tab : playerIdx;
  const choices = hostChoices(game, shown, record, records, { seat: playerIdx, iid });
  const nowhere = hostKind(record) === 'player';

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
      {boost > 0 && (
        // The table can show a plain +N/+N: as counters on the creature,
        // where the fight reads its size. They come off with the card.
        <label className="attach-boost">
          <input type="checkbox" checked={counters} onChange={(e) => setCounters(e.target.checked)} />
          Show its +{boost}/+{boost} as counters on the creature
        </label>
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
            return (
              <li key={`${host.kind}:${host.id}`}>
                <button
                  className={here ? 'attach-row attach-row--on' : 'attach-row'}
                  aria-label={here ? `${host.name} — it is on this now` : `put it on ${host.name}`}
                  aria-pressed={here}
                  onClick={() => {
                    attachVirtualCard(
                      playerIdx,
                      iid,
                      { seat: host.seat, kind: host.kind, id: host.id },
                      counters ? boost : 0,
                    );
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
