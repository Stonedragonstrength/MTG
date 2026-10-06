import { useEffect, useState } from 'react';
import { useAppStore } from '../state/store';
import HandCardSheet from './HandCardSheet';
import { useCardRecords } from './useCardRecords';
import { useLongPress } from './useLongPress';

function HandCard({
  name,
  art,
  selected,
  onPlay,
  onDetail,
}: {
  name: string;
  art: string | null;
  selected: boolean;
  onPlay: () => void;
  onDetail: () => void;
}) {
  const press = useLongPress(onPlay, onDetail);
  return (
    <button
      className={`hand-card${selected ? ' hand-card--selected' : ''}`}
      aria-label={`play ${name}`}
      title="Tap to play · hold for options"
      {...press}
    >
      {art ? <img src={art} alt="" loading="lazy" /> : <span className="vcard-placeholder">{name}</span>}
    </button>
  );
}

interface Props {
  playerIdx: number;
}

/** Your hand, docked at your own edge: a count pill that fans into
 * thumbnails. Tap plays (undo covers misclicks); hold for options.
 * Turn one offers the London mulligan with select-to-bottom on keep. */
export default function HandTray({ playerIdx }: Props) {
  const game = useAppStore((s) => s.game);
  const online = useAppStore((s) => s.online);
  const playCard = useAppStore((s) => s.playCard);
  const mulliganSeat = useAppStore((s) => s.mulliganSeat);
  const keepHand = useAppStore((s) => s.keepHand);
  const [fanned, setFanned] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [bottoming, setBottoming] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const activeIdx = game?.activePlayerIndex;
  useEffect(() => {
    setFanned(false); // trays fold when the turn moves (table manners)
    setBottoming(false);
    setSelected([]);
  }, [activeIdx]);

  const seat = game?.players[playerIdx]?.cards;
  const records = useCardRecords(seat?.hand ?? []);
  if (!game || !seat) return null;
  const claimed = !online || online.mySeat === playerIdx || online.mySeat === null;
  if (!claimed) return null; // unclaimed hands live behind the dock's peek gate

  const mulliganTime = game.turnNumber === 1 && seat.battlefield.length === 0;
  const needBottom = seat.mulligans;

  function toggleSelect(iid: string) {
    setSelected((prev) =>
      prev.includes(iid) ? prev.filter((x) => x !== iid) : prev.length < needBottom ? [...prev, iid] : prev,
    );
  }

  return (
    <div className="hand-tray">
      {!fanned ? (
        <button
          className="hand-pill"
          aria-label={`hand, ${seat.hand.length} cards`}
          onClick={() => setFanned(true)}
        >
          ✋ {seat.hand.length}
        </button>
      ) : (
        <div className="hand-fan">
          <div className="hand-cards">
            {seat.hand.map((c) => (
              <HandCard
                key={c.iid}
                name={c.name}
                art={records[c.cardId]?.imageNormal ?? null}
                selected={selected.includes(c.iid)}
                onPlay={() => (bottoming ? toggleSelect(c.iid) : void playCard(playerIdx, c.iid))}
                onDetail={() => !bottoming && setDetail(c.iid)}
              />
            ))}
          </div>
          <div className="hand-tools">
            <button className="ghost" aria-label="collapse hand" onClick={() => setFanned(false)}>
              ▾
            </button>
            {mulliganTime && !bottoming && (
              <>
                <button className="ghost" onClick={() => mulliganSeat(playerIdx)}>
                  Mulligan
                </button>
                {needBottom > 0 && (
                  <button className="ghost" onClick={() => setBottoming(true)}>
                    Keep (bottom {needBottom})
                  </button>
                )}
              </>
            )}
            {bottoming && (
              <>
                <span className="hint">
                  Pick {needBottom} to bottom · {selected.length}/{needBottom}
                </span>
                <button
                  className="primary"
                  disabled={selected.length !== needBottom}
                  onClick={() => {
                    keepHand(playerIdx, selected);
                    setBottoming(false);
                    setSelected([]);
                  }}
                >
                  Bottom them
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    keepHand(playerIdx, []); // house rule: keep all
                    setBottoming(false);
                    setSelected([]);
                  }}
                >
                  Keep all (house rule)
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {detail && <HandCardSheet playerIdx={playerIdx} iid={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
