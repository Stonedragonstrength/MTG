import { useEffect, useRef, useState } from 'react';
import { commanderTax } from '../lib/cards';
import { isSummoningSick, permanentTexts } from '../lib/keywords';
import { affordable, castCosts, hasX, sourcesFrom } from '../lib/pay';
import type { CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldCardSheet from './BattlefieldCardSheet';
import CombatMarks, { combatClasses } from './CombatMarks';
import LibrarySheet from './LibrarySheet';
import PileSheet from './PileSheet';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import { useSeatCombat, type UnitLook } from './useCombat';
import { useFitCards } from './useFitCards';
import { useLongPress } from './useLongPress';
import XCostSheet from './XCostSheet';

/** One real card on the shared battlefield: tap = tap it, hold = sheet.
 * A summoning-sick creature only wears a badge: tapping it stays allowed
 * (crewing and convoke are legal).
 *
 * While its seat picks attackers or blockers a creature changes meaning:
 * a tap picks it (or is ignored, dimmed, when it cannot fight — the hold
 * still opens the sheet, where "Attack anyway" and a plain Tap live).
 * Anything that is no creature keeps its ordinary tap. */
function VCard({
  card,
  art,
  sick,
  look,
  names,
  onTap,
  onDetail,
}: {
  card: CardInstance;
  art: string | null;
  sick: boolean;
  /** How it stands in the fight on the table, if there is one. */
  look: UnitLook | null;
  /** The players' names by seat, for the marks. */
  names: string[];
  onTap: () => void;
  onDetail: () => void;
}) {
  const picks = look?.picks === true;
  const press = useLongPress(picks ? look.tap : onTap, onDetail);
  const p1p1 = card.counters?.p1p1 ?? 0;
  const job = look?.mode === 'attack' ? 'attack' : 'block';
  const label = !picks
    ? `tap ${card.name}${sick ? ', summoning sick' : ''}`
    : look.picked > 0
      ? `${card.name} ${job}s — tap to take it back`
      : look.dim
        ? `${card.name} cannot ${job}`
        : `${job} with ${card.name}`;
  return (
    <button
      className={`vcard${card.tapped ? ' vcard--tapped' : ''}${combatClasses('vcard', look)}`}
      aria-label={label}
      aria-pressed={picks ? look.picked > 0 : undefined}
      title={picks ? `Tap to ${job} · hold for options` : 'Tap to tap · hold for options'}
      {...press}
    >
      {art ? (
        <img src={art} alt="" loading="lazy" />
      ) : (
        <span className="vcard-placeholder">{card.name}</span>
      )}
      {sick && (
        <span className="sick-badge" aria-hidden="true">
          💤
        </span>
      )}
      {p1p1 !== 0 && (
        <span className="count-badge vcard-counter">
          {p1p1 > 0 ? `+${p1p1}/+${p1p1}` : `${p1p1}/${p1p1}`}
        </span>
      )}
      <CombatMarks look={look} names={names} />
    </button>
  );
}

interface Props {
  playerIdx: number;
  /** false on the phone's hand view: no picking there, a tap is always a tap. */
  picks?: boolean;
}

/** The card area from Nathan's sketch: real cards up front, and the
 * zone dock (library, graveyard, exile, command, hand pill) at its end.
 * Tokens keep their own strip (BoardStrip) — different physics. */
export default function BattlefieldRow({ playerIdx, picks = true }: Props) {
  const game = useAppStore((s) => s.game);
  const online = useAppStore((s) => s.online);
  const combat = useSeatCombat(playerIdx, picks);
  const tapVirtualCard = useAppStore((s) => s.tapVirtualCard);
  const drawCards = useAppStore((s) => s.drawCards);
  const castCommander = useAppStore((s) => s.castCommander);
  const peekNotice = useAppStore((s) => s.peekNotice);
  const [pile, setPile] = useState<'graveyard' | 'exile' | 'command' | null>(null);
  const [cardSheet, setCardSheet] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [armDraw, setArmDraw] = useState(false);
  const [peek, setPeek] = useState<'confirm' | 'shown' | null>(null);
  const [xFor, setXFor] = useState<string | null>(null); // the commander the X sheet is asking about

  const seat = game?.players[playerIdx]?.cards;
  const profiles = game?.config.profiles;
  const front = seat ? seat.battlefield.filter((c) => c.row !== 'lands') : [];
  // The whole battlefield, not just the front row: the lands shelf is
  // where the commander's mana comes from.
  const records = useCardRecords([
    ...(seat?.battlefield ?? []),
    ...(seat?.command ?? []),
    ...(seat ? seat.graveyard.slice(-1) : []),
  ]);
  // The front row fills whatever the zone leaves it, at any card count.
  const cardsRef = useRef<HTMLDivElement>(null);
  useFitCards(cardsRef, front.length, 300);
  const armTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(armTimer.current), []);
  const holdLibrary = useLongPress(
    () => {
      if (!seat || seat.library.length === 0) return; // empty: nothing to draw, never arm
      if (claimed) drawCards(playerIdx, 1);
      else if (armDraw) {
        window.clearTimeout(armTimer.current); // the window closed by use, not by timer
        drawCards(playerIdx, 1);
        setArmDraw(false);
      } else {
        window.clearTimeout(armTimer.current); // an old timer must not kill this window
        setArmDraw(true);
        armTimer.current = window.setTimeout(() => setArmDraw(false), 3000);
      }
    },
    () => setLibraryOpen(true),
  );
  const holdHand = useLongPress(
    () => {},
    () => setPeek('confirm'),
  );

  if (!game || !seat) return null;
  const name = profiles?.[playerIdx]?.name ?? '?';
  // Local table = shared tablet = every seat is yours; online = your seat.
  const claimed = !online || online.mySeat === playerIdx || online.mySeat === null;
  const size = front.length <= 3 ? 'lg' : front.length <= 8 ? 'md' : 'sm';
  const topGrave = seat.graveyard[seat.graveyard.length - 1];
  // One pedestal per commander still at home (a partner pair has two), each
  // behind the mana gate with its own tax. An unread record never blocks.
  // A commander with {X} lights up when X = 0 is payable, and a tap on it
  // asks how much instead of casting.
  const player = game.players[playerIdx];
  const sources = sourcesFrom(seat.battlefield, records, player.board);
  const pedestals = seat.command.map((card) => {
    const record = records[card.cardId];
    const tax = commanderTax(player, card.iid);
    const costs = record ? castCosts(record, 'command', tax) : null;
    return {
      card,
      art: record?.imageNormal ?? null,
      tax,
      poor: !!costs && !costs.some((cost) => affordable(cost, sources)),
      asksX: !!costs && hasX(costs),
    };
  });
  const shortIids = pedestals.filter((p) => p.poor).map((p) => p.card.iid);
  // What gives the seat's creatures haste, for the summoning-sick badge.
  const texts = permanentTexts(seat.battlefield, records, player.board);

  return (
    <div className={`bf-row bf-row--${size}`}>
      <div className="bf-cards" ref={cardsRef}>
        {front.map((c) => (
          <VCard
            key={c.iid}
            card={c}
            art={records[c.cardId]?.imageNormal ?? null}
            sick={isSummoningSick(c, records[c.cardId], texts)}
            look={combat?.look({ kind: 'card', id: c.iid }) ?? null}
            names={(profiles ?? []).map((p) => p.name)}
            onTap={() => tapVirtualCard(playerIdx, c.iid)}
            onDetail={() => setCardSheet(c.iid)}
          />
        ))}
      </div>
      <div className="zone-dock">
        <button
          className={`dock-pile dock-library${seat.library.length === 0 ? ' dock-library--empty' : ''}`}
          aria-label={
            armDraw
              ? `draw for ${name}?`
              : seat.library.length === 0
                ? 'library, empty'
                : `library, ${seat.library.length} card${seat.library.length === 1 ? '' : 's'}`
          }
          title={
            seat.library.length === 0
              ? 'Library is empty · hold for options'
              : 'Tap to draw · hold for library'
          }
          {...holdLibrary}
        >
          <span className="dock-count">{seat.library.length}</span>
          {armDraw && <span className="dock-arm">draw?</span>}
        </button>
        <button
          className="dock-pile dock-grave"
          aria-label={`graveyard, ${seat.graveyard.length} card${seat.graveyard.length === 1 ? '' : 's'}`}
          onClick={() => setPile('graveyard')}
        >
          {topGrave && records[topGrave.cardId]?.imageNormal ? (
            <img src={records[topGrave.cardId]!.imageNormal!} alt="" loading="lazy" />
          ) : (
            <span className="dock-empty">✝</span>
          )}
          <span className="dock-count">{seat.graveyard.length}</span>
        </button>
        {seat.exile.length > 0 && (
          <button
            className="dock-pile dock-exile"
            aria-label={`exile, ${seat.exile.length}`}
            onClick={() => setPile('exile')}
          >
            <span className="dock-empty">✦</span>
            <span className="dock-count">{seat.exile.length}</span>
          </button>
        )}
        {pedestals.length > 0 ? (
          pedestals.map(({ card, art, tax, poor, asksX }) => (
            <button
              key={card.iid}
              className={`dock-pile dock-command${poor ? ' dock-command--poor' : ''}`}
              aria-label={
                poor
                  ? `commander ${card.name} — not enough mana`
                  : `commander ${card.name} — tap to cast`
              }
              onClick={() => {
                if (poor) setPile('command');
                else if (asksX) setXFor(card.iid);
                else castCommander(playerIdx, card.iid);
              }}
            >
              {art ? <img src={art} alt="" loading="lazy" /> : <span className="dock-empty">★</span>}
              {tax > 0 && <span className="dock-count">+{tax}</span>}
            </button>
          ))
        ) : (
          <button
            className="dock-pile dock-command dock-command--out"
            aria-label="command zone, empty"
            onClick={() => setPile('command')}
          >
            <span className="dock-empty">★</span>
          </button>
        )}
        {!claimed && (
          <button
            className="dock-pile dock-hand"
            aria-label={`hand, ${seat.hand.length} cards`}
            title="Hold to peek (everyone will know)"
            {...holdHand}
          >
            ✋<span className="dock-count">{seat.hand.length}</span>
          </button>
        )}
      </div>

      {pile && (
        <PileSheet
          playerIdx={playerIdx}
          zone={pile}
          short={pile === 'command' ? shortIids : undefined}
          onClose={() => setPile(null)}
        />
      )}
      {cardSheet && (
        <BattlefieldCardSheet
          playerIdx={playerIdx}
          iid={cardSheet}
          picks={picks}
          onClose={() => setCardSheet(null)}
        />
      )}
      {xFor && (
        <XCostSheet playerIdx={playerIdx} iid={xFor} from="command" onClose={() => setXFor(null)} />
      )}
      {libraryOpen && (
        <LibrarySheet playerIdx={playerIdx} claimed={claimed} onClose={() => setLibraryOpen(false)} />
      )}
      {peek && (
        <Sheet
          title={peek === 'confirm' ? `Show ${name}'s hand?` : `${name}'s hand`}
          onClose={() => setPeek(null)}
        >
          {peek === 'confirm' ? (
            <>
              <p className="hint">
                {online?.status.kind === 'stale-build'
                  ? 'This build is behind the table — refresh this device first. The peek must announce itself, and a stale build cannot.'
                  : 'Everyone at the table will see that you looked.'}
              </p>
              <div className="modal-actions">
                <button
                  className="danger"
                  disabled={online?.status.kind === 'stale-build'}
                  onClick={() => {
                    peekNotice(playerIdx); // the feed announces the peek
                    setPeek('shown');
                  }}
                >
                  Show the hand
                </button>
              </div>
            </>
          ) : (
            <ul className="pile-list">
              {seat.hand.map((c) => (
                <li key={c.iid} className="pile-row">
                  <span className="pile-name">{c.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
    </div>
  );
}
