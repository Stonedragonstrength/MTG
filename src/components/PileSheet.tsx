import { isCommander } from '../lib/cards';
import type { CardZone } from '../lib/types';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';

interface Props {
  playerIdx: number;
  zone: Extract<CardZone, 'graveyard' | 'exile' | 'command'>;
  /** Command zone only: the commanders the mana gate refused — casting
   * one of these is an explicit override. */
  short?: string[];
  onClose: () => void;
}

const TITLES = { graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone' };
const NONE: string[] = [];

/** Public pile browser: graveyard (top first), exile, command. */
export default function PileSheet({ playerIdx, zone, short = NONE, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const castCommander = useAppStore((s) => s.castCommander);
  const commanderReturned = useAppStore((s) => s.commanderReturned);
  const seat = game?.players[playerIdx]?.cards;
  const cards = seat?.[zone] ?? [];
  const shown = zone === 'graveyard' ? [...cards].reverse() : cards;
  const records = useCardRecords(shown);
  // CR 903.9: a commander stranded here can go home — and only a
  // commander. Seats dealt before commanders were tracked keep the old
  // rule: an empty command zone takes whatever is sent.
  const goesHome = (iid: string) =>
    zone !== 'command' && !!seat && (isCommander(seat, iid) ?? seat.command.length === 0);

  return (
    <Sheet title={TITLES[zone]} onClose={onClose} size="wide">
      {zone === 'command' && shown.some((c) => short.includes(c.iid)) && (
        <p className="hint">Not enough mana ready (tax included) — cast it anyway?</p>
      )}
      {shown.length === 0 ? (
        <p className="hint">Empty.</p>
      ) : (
        <ul className="pile-list">
          {shown.map((c) => (
            <li key={c.iid} className="pile-row">
              {records[c.cardId]?.imageNormal ? (
                <img className="pile-art" src={records[c.cardId]!.imageNormal!} alt="" loading="lazy" />
              ) : (
                <span className="pile-art pile-art--empty" />
              )}
              <span className="pile-name">{c.name}</span>
              <span className="pile-actions">
                {zone === 'command' ? (
                  <button
                    onClick={() => {
                      castCommander(playerIdx, c.iid);
                      onClose();
                    }}
                  >
                    {short.includes(c.iid) ? 'Cast anyway' : 'Cast'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => moveVirtualCard(playerIdx, c.iid, zone, 'hand')}
                    >
                      Hand
                    </button>
                    <button
                      onClick={() =>
                        moveVirtualCard(playerIdx, c.iid, zone, 'battlefield', { row: 'front' })
                      }
                    >
                      Battlefield
                    </button>
                    <button
                      onClick={() =>
                        moveVirtualCard(playerIdx, c.iid, zone, zone === 'graveyard' ? 'exile' : 'graveyard')
                      }
                    >
                      {zone === 'graveyard' ? 'Exile' : 'Graveyard'}
                    </button>
                    <button
                      onClick={() =>
                        moveVirtualCard(playerIdx, c.iid, zone, 'library', { pos: 'bottom' })
                      }
                    >
                      Bottom
                    </button>
                    {goesHome(c.iid) && (
                      <button
                        onClick={() =>
                          commanderReturned(playerIdx, c.iid, zone as 'graveyard' | 'exile')
                        }
                      >
                        Command
                      </button>
                    )}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
