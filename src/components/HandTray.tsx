import { useEffect, useState } from 'react';
import { affordable, parseCost, sourcesFrom } from '../lib/pay';
import type { CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import HandCardSheet from './HandCardSheet';
import { useCardRecords } from './useCardRecords';
import { useLongPress } from './useLongPress';

function HandCard({
  name,
  art,
  selected,
  poor,
  onPlay,
  onDetail,
}: {
  name: string;
  art: string | null;
  selected: boolean;
  poor: boolean;
  onPlay: () => void;
  onDetail: () => void;
}) {
  const press = useLongPress(onPlay, onDetail);
  return (
    <button
      className={`hand-card${selected ? ' hand-card--selected' : ''}${poor ? ' hand-card--poor' : ''}`}
      aria-label={`play ${name}`}
      title={poor ? 'Not enough untapped mana · hold for options' : 'Tap to play · hold for options'}
      {...press}
    >
      {art ? <img src={art} alt="" loading="lazy" /> : <span className="vcard-placeholder">{name}</span>}
    </button>
  );
}

interface Props {
  playerIdx: number;
  /** HandScreen mode: always fanned, no pill, no collapse. */
  forceFanned?: boolean;
}

/** Your hand, docked at your own edge: a count pill that fans into
 * thumbnails. Tap plays (undo covers misclicks); hold for options.
 * Turn one offers the London mulligan with select-to-bottom on keep. */
export default function HandTray({ playerIdx, forceFanned = false }: Props) {
  const game = useAppStore((s) => s.game);
  const online = useAppStore((s) => s.online);
  const playCard = useAppStore((s) => s.playCard);
  const mulliganSeat = useAppStore((s) => s.mulliganSeat);
  const keepHand = useAppStore((s) => s.keepHand);
  const [fanned, setFanned] = useState(forceFanned);
  const [detail, setDetail] = useState<string | null>(null);
  const [bottoming, setBottoming] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [showHeld, setShowHeld] = useState(false); // dead-phone escape hatch

  const activeIdx = game?.activePlayerIndex;
  useEffect(() => {
    if (!forceFanned) setFanned(false); // trays fold when the turn moves (table manners)
    setBottoming(false);
    setSelected([]);
  }, [activeIdx, forceFanned]);

  const seat = game?.players[playerIdx]?.cards;
  const records = useCardRecords(seat?.hand ?? []);
  const bfRecords = useCardRecords(seat?.battlefield ?? []);
  if (!game || !seat) return null;

  // The mana gate: a card lights up only while the untapped table can pay
  // it. Lands and unread records never block; "Play anyway" lives in the
  // hold sheet for cost-reducers and treasure math the gate can't see.
  const sources = sourcesFrom(seat.battlefield, bfRecords, game.players[playerIdx]?.board ?? []);
  const payable = (c: CardInstance): boolean => {
    const r = records[c.cardId];
    if (!r) return true;
    if (/Land/.test(r.typeLine)) return true;
    return affordable(parseCost(r.manaCost), sources);
  };
  const claimed = !online || online.mySeat === playerIdx || online.mySeat === null;
  if (!claimed) return null; // unclaimed hands live behind the dock's peek gate
  // A phone holds this hand: every other device shows a hint, not cards.
  // The hint stays tappable so a dead phone can never wedge the table.
  if (seat.handHeld && online && online.mySeat !== playerIdx && !showHeld) {
    return (
      <div className="hand-tray">
        <button
          className="hand-pill hand-pill--held"
          title="This hand lives on its player's phone"
          aria-label="show the hand here anyway"
          onClick={() => setShowHeld(true)}
        >
          ✋ {seat.hand.length} 📱
        </button>
      </div>
    );
  }

  const kept = seat.kept === true;
  // CR 103.5d: in a pod (3+ players) the first mulligan is free.
  const freeMulls = game.players.length > 2 ? 1 : 0;
  const needBottom = Math.min(seat.hand.length, Math.max(0, seat.mulligans - freeMulls));
  // Mulligan needs an untouched board; the owed keep/bottom step does not —
  // playing a land first must never cancel the debt.
  const canMulligan = game.turnNumber === 1 && !kept && seat.battlefield.length === 0;
  const keepWindow = game.turnNumber === 1 && !kept && seat.mulligans > 0;

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
                poor={!bottoming && !payable(c)}
                onPlay={() => {
                  if (bottoming) toggleSelect(c.iid);
                  else if (payable(c)) void playCard(playerIdx, c.iid);
                }}
                onDetail={() => !bottoming && setDetail(c.iid)}
              />
            ))}
          </div>
          <div className="hand-tools">
            {!forceFanned && (
              <button className="ghost" aria-label="collapse hand" onClick={() => setFanned(false)}>
                ▾
              </button>
            )}
            {(canMulligan || keepWindow) && !bottoming && (
              <>
                {canMulligan && (
                  <button className="ghost" onClick={() => mulliganSeat(playerIdx)}>
                    Mulligan
                  </button>
                )}
                {keepWindow &&
                  (needBottom > 0 ? (
                    <button className="ghost" onClick={() => setBottoming(true)}>
                      Keep (bottom {needBottom})
                    </button>
                  ) : (
                    <button className="ghost" onClick={() => keepHand(playerIdx, [])}>
                      Keep hand
                    </button>
                  ))}
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
      {detail && (
        <HandCardSheet
          playerIdx={playerIdx}
          iid={detail}
          poor={(() => {
            const c = seat.hand.find((x) => x.iid === detail);
            return c ? !payable(c) : false;
          })()}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
