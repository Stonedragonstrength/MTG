import type { CardZone } from '../lib/types';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';

interface Props {
  playerIdx: number;
  zone: Extract<CardZone, 'graveyard' | 'exile' | 'command'>;
  /** Command zone only: the mana gate said no, so casting is an override. */
  short?: boolean;
  onClose: () => void;
}

const TITLES = { graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone' };

/** Public pile browser: graveyard (top first), exile, command. */
export default function PileSheet({ playerIdx, zone, short = false, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const castCommander = useAppStore((s) => s.castCommander);
  const commanderReturned = useAppStore((s) => s.commanderReturned);
  const cards = game?.players[playerIdx]?.cards?.[zone] ?? [];
  const shown = zone === 'graveyard' ? [...cards].reverse() : cards;
  const records = useCardRecords(shown);
  // CR 903.9: a commander stranded here can go home. Offered only while
  // the command zone is empty — the feed discloses whatever moves.
  const commandOpen =
    zone !== 'command' && (game?.players[playerIdx]?.cards?.command.length ?? 1) === 0;

  return (
    <Sheet title={TITLES[zone]} onClose={onClose} size="wide">
      {short && shown.length > 0 && (
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
                      castCommander(playerIdx);
                      onClose();
                    }}
                  >
                    {short ? 'Cast anyway' : 'Cast'}
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
                    {commandOpen && (
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
