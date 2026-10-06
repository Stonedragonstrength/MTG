import type { CardZone } from '../lib/types';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';

interface Props {
  playerIdx: number;
  zone: Extract<CardZone, 'graveyard' | 'exile' | 'command'>;
  onClose: () => void;
}

const TITLES = { graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone' };

/** Public pile browser: graveyard (top first), exile, command. */
export default function PileSheet({ playerIdx, zone, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const castCommander = useAppStore((s) => s.castCommander);
  const cards = game?.players[playerIdx]?.cards?.[zone] ?? [];
  const shown = zone === 'graveyard' ? [...cards].reverse() : cards;
  const records = useCardRecords(shown);

  return (
    <Sheet title={TITLES[zone]} onClose={onClose} size="wide">
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
                    Cast
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
