import { useEffect, useState } from 'react';
import { boardSeat } from '../lib/combat';
import { affordable, castCosts, hasX, parseCosts, sourcesFrom } from '../lib/pay';
import { canPlayLand, isLandCard } from '../lib/turnRules';
import type { CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import HandCardSheet from './HandCardSheet';
import { useCardRecords } from './useCardRecords';
import { useLongPress } from './useLongPress';
import { useSeatTexts } from './useSeatTexts';
import XCostSheet from './XCostSheet';

function HandCard({
  name,
  art,
  selected,
  why,
  onPlay,
  onDetail,
}: {
  name: string;
  art: string | null;
  selected: boolean;
  /** Why a tap will not play it right now (dimmed); null when it will. */
  why: string | null;
  onPlay: () => void;
  onDetail: () => void;
}) {
  const press = useLongPress(onPlay, onDetail);
  return (
    <button
      className={`hand-card${selected ? ' hand-card--selected' : ''}${why ? ' hand-card--poor' : ''}`}
      aria-label={`play ${name}`}
      title={why ? `${why.replace(/\.$/, '')} · hold for options` : 'Tap to play · hold for options'}
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
  const [xFor, setXFor] = useState<string | null>(null); // the card the X sheet is asking about

  const activeIdx = game?.activePlayerIndex;
  // The seat holding the big board: it also changes hands mid-turn, when a
  // defender takes it to choose blockers and when it goes back.
  const boardIdx = game ? boardSeat(game) : undefined;
  useEffect(() => {
    // Trays fold whenever the big board changes seat (table manners): a hand
    // left fanned would lie open in front of whoever the table turns to next.
    if (!forceFanned) setFanned(false);
    setBottoming(false);
    setSelected([]);
  }, [activeIdx, boardIdx, forceFanned]);

  const seat = game?.players[playerIdx]?.cards;
  const records = useCardRecords(seat?.hand ?? []);
  const bfRecords = useCardRecords(seat?.battlefield ?? []);
  const texts = useSeatTexts(playerIdx);
  if (!game || !seat) return null;

  // The gates: a spell lights up only while the untapped table can pay it,
  // a land only while the seat has a land drop left on its own turn. An
  // unread record never blocks; "Play anyway" lives in the hold sheet for
  // cost-reducers, treasure math and every rule the gates can't see.
  const sources = sourcesFrom(seat.battlefield, bfRecords, game.players[playerIdx]?.board ?? []);
  /** Why a tap will not play this card right now — null when it will. */
  const refusal = (c: CardInstance): string | null => {
    const r = records[c.cardId];
    if (!r) return null;
    // A land by its front face only: a spell with a land on the back is a
    // spell, and answers to the mana gate like any other.
    if (isLandCard(r.typeLine))
      return canPlayLand(game, playerIdx, texts.own, texts.others).why ?? null;
    // Either face will do: a split card needs one half, an adventure
    // creature its own cost — never the two added together. A card with
    // {X} lights up as soon as X = 0 is payable.
    return parseCosts(r.manaCost).some((cost) => affordable(cost, sources))
      ? null
      : 'Not enough mana ready.';
  };
  /** A tap on a card the gates let through: one with {X} asks how much first. */
  const play = (c: CardInstance) => {
    if (hasX(castCosts(records[c.cardId], 'hand'))) setXFor(c.iid);
    else void playCard(playerIdx, c.iid);
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
                why={bottoming ? null : refusal(c)}
                onPlay={() => {
                  if (bottoming) toggleSelect(c.iid);
                  else if (!refusal(c)) play(c);
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
          why={(() => {
            const c = seat.hand.find((x) => x.iid === detail);
            return c ? refusal(c) : null;
          })()}
          onClose={() => setDetail(null)}
        />
      )}
      {xFor && (
        <XCostSheet playerIdx={playerIdx} iid={xFor} from="hand" onClose={() => setXFor(null)} />
      )}
    </div>
  );
}
