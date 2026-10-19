import { useEffect, useRef, useState } from 'react';
import { isAura } from '../lib/attach';
import { boardSeat } from '../lib/combat';
import { shareInSight } from '../lib/fit';
import { castPrice, castSources, costTable } from '../lib/costs';
import { affordable, asksAtCast } from '../lib/pay';
import { asksLife, entryLife } from '../lib/lands';
import { searchAsk, type SearchAsk } from '../lib/search';
import { seatSources } from '../lib/seatMana';
import { canPlayLand, isLandCard } from '../lib/turnRules';
import type { CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import AttachSheet from './AttachSheet';
import HandCardSheet from './HandCardSheet';
import LandLifeSheet from './LandLifeSheet';
import LibrarySearchSheet from './LibrarySearchSheet';
import { useCardRecords } from './useCardRecords';
import { useCastRecords } from './useCastRecords';
import { useLongPress } from './useLongPress';
import { useSeatTexts } from './useSeatTexts';
import XCostSheet from './XCostSheet';

/** How much of a hand card has to be in sight for a tap to play it: with
 * less showing, the first tap brings the card to the front instead. */
const IN_SIGHT = 0.85;

/** How much of the card in this slot is in sight, read off the layout (not
 * the screen: a seat may be turned). */
function inSight(slot: HTMLElement | null): number {
  const card = slot?.firstElementChild as HTMLElement | null | undefined;
  if (!slot || !card) return 1;
  const front = slot.parentElement?.querySelector<HTMLElement>('.hand-slot--front');
  return shareInSight(
    card.offsetWidth,
    slot.offsetLeft,
    slot.offsetWidth,
    front && front !== slot ? front.offsetLeft : null,
  );
}

function HandCard({
  iid,
  name,
  art,
  selected,
  front,
  why,
  onTap,
  onDetail,
}: {
  /** The card's instance: what flies in and out of the hand is found by it. */
  iid: string;
  name: string;
  art: string | null;
  selected: boolean;
  /** Brought to the front of the fan: in sight whole, over the others. */
  front: boolean;
  /** Why a tap will not play it right now (dimmed); null when it will. */
  why: string | null;
  /** A tap, with how much of the card was in sight (0–1) when it came. */
  onTap: (inSight: number) => void;
  onDetail: () => void;
}) {
  const slot = useRef<HTMLSpanElement>(null);
  const press = useLongPress(() => onTap(inSight(slot.current)), onDetail);
  return (
    // The slot is the card's place in the fan: where the cards overlap, the
    // slot is the part of this one that shows.
    <span ref={slot} className={`hand-slot${front ? ' hand-slot--front' : ''}`}>
      <button
        className={`hand-card${selected ? ' hand-card--selected' : ''}${why ? ' hand-card--poor' : ''}`}
        data-iid={iid}
        aria-label={`play ${name}`}
        title={why ? `${why.replace(/\.$/, '')} · hold for options` : 'Tap to play · hold for options'}
        {...press}
      >
        {art ? <img src={art} alt="" loading="lazy" /> : <span className="vcard-placeholder">{name}</span>}
      </button>
    </span>
  );
}

interface Props {
  playerIdx: number;
  /** HandScreen mode: always fanned, no pill, no collapse. */
  forceFanned?: boolean;
}

/** Your hand, docked at your own edge: a count pill that fans into the
 * cards, held like a hand — side by side while there is room, each one
 * under the next past that. Tap plays (undo covers misclicks); a card
 * lying under the others comes to the front on the first tap and plays on
 * the next. Hold for options. The button that folds the cards away again
 * sits on the corner of the card lying furthest back.
 * Turn one offers the London mulligan with select-to-bottom on keep. */
export default function HandTray({ playerIdx, forceFanned = false }: Props) {
  const game = useAppStore((s) => s.game);
  const online = useAppStore((s) => s.online);
  const playCard = useAppStore((s) => s.playCard);
  const mulliganSeat = useAppStore((s) => s.mulliganSeat);
  const keepHand = useAppStore((s) => s.keepHand);
  // What the player last did with the tray, until the big board changes
  // hands: null = as the table has it (open on the big board, a pill on a bar).
  const [folded, setFolded] = useState<boolean | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [bottoming, setBottoming] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [showHeld, setShowHeld] = useState(false); // dead-phone escape hatch
  const [xFor, setXFor] = useState<string | null>(null); // the card the X sheet is asking about
  const [shockFor, setShockFor] = useState<CardInstance | null>(null); // a shock land being played
  const [attachFor, setAttachFor] = useState<string | null>(null); // the Aura just played, asking where it goes
  // The permanent just played sends its player through their library as it enters.
  const [searchFor, setSearchFor] = useState<{ ask: SearchAsk; source: string } | null>(null);
  // The card a tap brought to the front of the fan (its iid): it is in sight
  // whole until another card is tapped, or a card is played.
  const [front, setFront] = useState<string | null>(null);

  const activeIdx = game?.activePlayerIndex;
  // The seat holding the big board: it also changes hands mid-turn, when a
  // defender takes it to choose blockers and when it goes back.
  const boardIdx = game ? boardSeat(game) : undefined;
  useEffect(() => {
    // Whenever the big board changes seat every tray goes back to where the
    // table has it: the player whose turn it is finds their hand open on
    // the big board (nobody should have to look for their cards), and a
    // hand somebody opened elsewhere folds again instead of lying open
    // beside the next player.
    setFolded(null);
    setBottoming(false);
    setSelected([]);
    setFront(null);
  }, [activeIdx, boardIdx, forceFanned]);
  // Open by default only for the active player on the big board. A defender
  // who holds the board to choose blockers needs the room for creatures:
  // their hand stays a pill, one tap away.
  const openByDefault = boardIdx === playerIdx && activeIdx === playerIdx;
  const fanned = forceFanned || (folded === null ? openByDefault : !folded);

  const seat = game?.players[playerIdx]?.cards;
  const records = useCardRecords(seat?.hand ?? []);
  const castRecords = useCastRecords(playerIdx);
  const texts = useSeatTexts(playerIdx);
  if (!game || !seat) return null;

  // The gates: a spell lights up only while the untapped table can pay it,
  // a land only while the seat has a land drop left on its own turn. An
  // unread record never blocks; "Play anyway" lives in the hold sheet for
  // treasure math and every rule the gates can't see. What a spell costs
  // is what it costs on this table (lib/costs.ts): Ruby Medallion, affinity,
  // free with a commander out, convoke's creatures.
  const table = costTable(game, playerIdx, castRecords);
  const mana = seatSources(game, playerIdx, castRecords);
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
    const sources = castSources(game, playerIdx, castRecords, r, c.iid, mana);
    return castPrice(r, { from: 'hand' }, table).faces.some((cost) => affordable(cost, sources))
      ? null
      : 'Not enough mana ready.';
  };
  /** A tap on a card the gates let through: one with {X}, or with a kicker
   * to pay or not, asks first. */
  const play = (c: CardInstance) => {
    if (asksAtCast(records[c.cardId], 'hand')) setXFor(c.iid);
    // A shock land: pay 2 life for it to come in untapped, or let it come in tapped.
    else if (isLandCard(records[c.cardId]?.typeLine ?? '') && asksLife(records[c.cardId])) setShockFor(c);
    // An Aura comes into play ON something: once it has landed, the list of
    // what it can go on comes up. (An Equipment arrives unattached; equipping
    // is on its own sheet.) If the play did not land, that sheet finds no
    // card and closes itself.
    else if (isAura(records[c.cardId])) void playCard(playerIdx, c.iid).then(() => setAttachFor(c.iid));
    else {
      // "When this enters, search your library for…": the list comes up by
      // itself once the card has landed (a play the table refused leaves it
      // in hand, and then nothing was searched for). An instant or a
      // sorcery offers its search under the cast banner instead.
      const ask = searchAsk(records[c.cardId]);
      void playCard(playerIdx, c.iid).then(() => {
        const hand = useAppStore.getState().game?.players[playerIdx]?.cards?.hand;
        if (ask?.when === 'enters' && hand && !hand.some((h) => h.iid === c.iid))
          setSearchFor({ ask, source: c.name });
      });
    }
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
          onClick={() => setFolded(false)}
        >
          ✋ {seat.hand.length}
        </button>
      ) : (
        <div className="hand-fan">
          <div className="hand-cards">
            {!forceFanned && (
              // The button that folds the hand rides the hand itself, on the
              // bottom corner of the card lying furthest back: it takes no
              // line of its own from the board. It wears the same "✋ 7" the
              // folded pill does, so the count stays in sight.
              <span className="hand-anchor">
                <button
                  className="hand-fold"
                  aria-label={`collapse hand, ${seat.hand.length} cards`}
                  onClick={() => setFolded(true)}
                >
                  ✋ {seat.hand.length} ▾
                </button>
              </span>
            )}
            {seat.hand.map((c) => (
              <HandCard
                key={c.iid}
                iid={c.iid}
                name={c.name}
                art={records[c.cardId]?.imageNormal ?? null}
                selected={selected.includes(c.iid)}
                front={!bottoming && c.iid === front}
                why={bottoming ? null : refusal(c)}
                onTap={(inSight) => {
                  if (bottoming) toggleSelect(c.iid);
                  // A card lying under the others is looked at before it is
                  // played: the first tap brings it to the front.
                  else if (c.iid !== front && inSight < IN_SIGHT) setFront(c.iid);
                  else if (!refusal(c)) {
                    setFront(null); // a card played, the fan closes up again
                    play(c);
                  }
                }}
                onDetail={() => !bottoming && setDetail(c.iid)}
              />
            ))}
          </div>
          {/* Only the opening hand has tools: with nothing to offer, the
              line they stand on is not there at all. */}
          {(canMulligan || keepWindow || bottoming) && (
            <div className="hand-tools">
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
          )}
        </div>
      )}
      {detail && (
        <HandCardSheet
          playerIdx={playerIdx}
          iid={detail}
          onSearch={(ask, source) => setSearchFor({ ask, source })}
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
      {shockFor && (
        <LandLifeSheet
          name={shockFor.name}
          life={entryLife(records[shockFor.cardId])}
          onAnswer={(pay) => {
            void playCard(playerIdx, shockFor.iid, { landEntry: pay ? 'life' : 'tapped' });
            setShockFor(null);
          }}
          onClose={() => setShockFor(null)}
        />
      )}
      {attachFor && (
        <AttachSheet playerIdx={playerIdx} iid={attachFor} onClose={() => setAttachFor(null)} />
      )}
      {searchFor && (
        <LibrarySearchSheet
          playerIdx={playerIdx}
          ask={searchFor.ask}
          source={searchFor.source}
          onClose={() => setSearchFor(null)}
        />
      )}
    </div>
  );
}
