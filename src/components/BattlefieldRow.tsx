import { useEffect, useRef, useState } from 'react';
import { attachedTo, isAttached, keywordsNow, sizeWorn } from '../lib/attach';
import { levelChange } from '../lib/abilities';
import { sizeAround } from '../lib/anthems';
import { boostOf, plusSize, withBoost } from '../lib/boost';
import { commanderTax, owesDraw } from '../lib/cards';
import { godKey, godsOf } from '../lib/gods';
import { isSummoningSick, permanentTexts } from '../lib/keywords';
import { affordable, castCosts } from '../lib/pay';
import { seatSources } from '../lib/seatMana';
import { shelfOf } from '../lib/shelf';
import type { CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldCardSheet from './BattlefieldCardSheet';
import CommanderSheet from './CommanderSheet';
import LibrarySheet from './LibrarySheet';
import PileSheet from './PileSheet';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import { useSeatCombat, useTableRecords } from './useCombat';
import { useFitCards } from './useFitCards';
import { useLongPress } from './useLongPress';
import VCard from './VCard';

/** A commander at home in the command zone: a tap brings the card up to
 * read, with Cast on it; a hold opens the command zone. Nothing is cast
 * by the tap itself. */
function Pedestal({
  card,
  art,
  tax,
  poor,
  onLook,
  onZone,
}: {
  card: CardInstance;
  art: string | null;
  tax: number;
  /** The mana ready does not cover its cost (tax included). */
  poor: boolean;
  onLook: () => void;
  onZone: () => void;
}) {
  const press = useLongPress(onLook, onZone);
  return (
    <button
      className={`dock-pile dock-command${poor ? ' dock-command--poor' : ''}`}
      aria-label={poor ? `commander ${card.name} — not enough mana` : `commander ${card.name}`}
      title="Tap to look and cast · hold for the command zone"
      {...press}
    >
      {art ? <img src={art} alt="" loading="lazy" /> : <span className="dock-empty">★</span>}
      {tax > 0 && <span className="dock-count">+{tax}</span>}
    </button>
  );
}

interface Props {
  playerIdx: number;
  /** false on the phone's hand view: no picking there, a tap is always a tap. */
  picks?: boolean;
  /** What stands in the field's bottom left corner on the big board (the
   * seat's tokens): the creatures keep clear of it. */
  corner?: HTMLElement | null;
}

/** A seat's creatures and its piles. The field is for creatures only:
 * lib/shelf.ts sorts every battlefield card, and the others are drawn by
 * the lands row (lands, mana rocks) and the side shelf (the rest). The
 * dock holds the piles: graveyard, exile, the commanders at home — and
 * the library, which is also where a turn's draw is made.
 * Tokens keep their own strip (BoardStrip) — different physics. */
export default function BattlefieldRow({ playerIdx, picks = true, corner = null }: Props) {
  const game = useAppStore((s) => s.game);
  const online = useAppStore((s) => s.online);
  const combat = useSeatCombat(playerIdx, picks);
  const tapVirtualCard = useAppStore((s) => s.tapVirtualCard);
  const drawCards = useAppStore((s) => s.drawCards);
  const peekNotice = useAppStore((s) => s.peekNotice);
  const [pile, setPile] = useState<'graveyard' | 'exile' | 'command' | null>(null);
  // The card whose sheet is open: usually one of this seat's, but an Aura
  // sitting on one of its creatures may be somebody else's.
  const [cardSheet, setCardSheet] = useState<{ seat: number; iid: string } | null>(null);
  const [commander, setCommander] = useState<string | null>(null); // the pedestal being looked at
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [armDraw, setArmDraw] = useState(false);
  const [peek, setPeek] = useState<'confirm' | 'shown' | null>(null);

  const seat = game?.players[playerIdx]?.cards;
  const profiles = game?.config.profiles;
  // The whole battlefield, not just what is drawn here: the lands shelf is
  // where the commander's mana comes from.
  const records = useCardRecords([
    ...(seat?.battlefield ?? []),
    ...(seat?.command ?? []),
    ...(seat ? seat.graveyard.slice(-1) : []),
  ]);
  // What sits on something (a bestowed creature, say) is drawn with its host.
  const field = (seat?.battlefield ?? []).filter(
    (c) => shelfOf(c, records[c.cardId]) === 'field' && !(game && isAttached(game, c)),
  );
  // Attachments can come from any seat: their pictures too.
  const tableRecords = useTableRecords();
  // The field fills whatever the zone leaves it, at any card count.
  const cardsRef = useRef<HTMLDivElement>(null);
  useFitCards(cardsRef, field.length, 300, corner);
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
  const size = field.length <= 3 ? 'lg' : field.length <= 8 ? 'md' : 'sm';
  const topGrave = seat.graveyard[seat.graveyard.length - 1];
  // One pedestal per commander still at home (a partner pair has two), each
  // behind the mana gate with its own tax. An unread record never blocks.
  const player = game.players[playerIdx];
  const sources = seatSources(game, playerIdx, records);
  const pedestals = seat.command.map((card) => {
    const record = records[card.cardId];
    const tax = commanderTax(player, card.iid);
    const costs = record ? castCosts(record, 'command', tax) : null;
    return {
      card,
      art: record?.imageNormal ?? null,
      tax,
      poor: !!costs && !costs.some((cost) => affordable(cost, sources)),
    };
  });
  const shortIids = pedestals.filter((p) => p.poor).map((p) => p.card.iid);
  // What gives the seat's creatures haste, for the summoning-sick badge.
  const texts = permanentTexts(seat.battlefield, records, player.board);
  // Its gods, and how near each is to being a creature.
  const gods = godsOf(game, playerIdx, tableRecords);
  const names = (profiles ?? []).map((p) => p.name);
  // The turn's draw is still to be made: the library says so until it is.
  const owes = claimed && owesDraw(game, playerIdx);
  const libraryCount = `${seat.library.length} card${seat.library.length === 1 ? '' : 's'}`;

  return (
    <div className={`bf-row bf-row--${size}`}>
      <div className="bf-cards" ref={cardsRef}>
        {field.map((c) => {
          const god = gods.get(godKey({ kind: 'card', id: c.iid })) ?? null;
          const vcard = (
            <VCard
              key={c.iid}
              card={c}
              art={records[c.cardId]?.imageNormal ?? null}
              sick={
                god?.creature !== false &&
                isSummoningSick(c, records[c.cardId], texts, keywordsNow(game, { seat: playerIdx, kind: 'card', id: c.iid }, tableRecords))
              }
              god={god}
              look={combat?.look({ kind: 'card', id: c.iid }) ?? null}
              names={names}
              worn={plusSize(
                plusSize(
                  withBoost(sizeWorn(game, { seat: playerIdx, kind: 'card', id: c.iid }, tableRecords), boostOf(game, c)),
                  // A leveler is bigger than printed once it reaches a level.
                  levelChange(records[c.cardId], c.counters?.level ?? 0),
                ),
                // The anthems and lords on the table.
                sizeAround(game, { seat: playerIdx, kind: 'card', id: c.iid }, tableRecords),
              )}
              onTap={() => tapVirtualCard(playerIdx, c.iid)}
              onDetail={() => setCardSheet({ seat: playerIdx, iid: c.iid })}
            />
          );
          const on = attachedTo(game, { seat: playerIdx, kind: 'card', id: c.iid });
          if (on.length === 0) return vcard;
          // Its Auras and Equipment: small cards tucked along its lower edge,
          // each one a tap away from being looked at (and moved, or taken off).
          return (
            <span className="vcard-host" key={c.iid}>
              {vcard}
              <span className="vcard-attached">
                {on.map(({ seat: owner, card: a }) => {
                  const art = tableRecords[a.cardId]?.imageNormal ?? null;
                  return (
                    <button
                      key={a.iid}
                      className="attached-mini"
                      aria-label={`${a.name}, on ${c.name}`}
                      title="Tap to look"
                      onClick={() => setCardSheet({ seat: owner, iid: a.iid })}
                    >
                      {art ? <img src={art} alt="" loading="lazy" /> : <span className="attached-name">{a.name}</span>}
                    </button>
                  );
                })}
              </span>
            </span>
          );
        })}
      </div>
      <div className="zone-dock">
        <div className="dock-minis">
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
            pedestals.map(({ card, art, tax, poor }) => (
              <Pedestal
                key={card.iid}
                card={card}
                art={art}
                tax={tax}
                poor={poor}
                onLook={() => setCommander(card.iid)}
                onZone={() => setPile('command')}
              />
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
        <button
          className={`dock-pile dock-library${seat.library.length === 0 ? ' dock-library--empty' : ''}${owes ? ' dock-library--draw' : ''}`}
          aria-label={
            armDraw
              ? `draw for ${name}?`
              : seat.library.length === 0
                ? 'library, empty'
                : owes
                  ? `library, ${libraryCount} — draw for the turn`
                  : `library, ${libraryCount}`
          }
          title={
            seat.library.length === 0
              ? 'Library is empty · hold for options'
              : 'Tap to draw · hold for library'
          }
          {...holdLibrary}
        >
          <span className="dock-count">{seat.library.length}</span>
          {owes && !armDraw && (
            <span className="dock-draw" aria-hidden="true">
              Draw
            </span>
          )}
          {armDraw && <span className="dock-arm">draw?</span>}
        </button>
      </div>

      {pile && (
        <PileSheet
          playerIdx={playerIdx}
          zone={pile}
          short={pile === 'command' ? shortIids : undefined}
          onClose={() => setPile(null)}
        />
      )}
      {commander && (
        <CommanderSheet playerIdx={playerIdx} iid={commander} onClose={() => setCommander(null)} />
      )}
      {cardSheet && (
        <BattlefieldCardSheet
          playerIdx={cardSheet.seat}
          iid={cardSheet.iid}
          picks={picks}
          onClose={() => setCardSheet(null)}
        />
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
