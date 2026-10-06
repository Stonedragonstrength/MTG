import { useState } from 'react';
import type { CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldCardSheet from './BattlefieldCardSheet';
import LibrarySheet from './LibrarySheet';
import PileSheet from './PileSheet';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import { useLongPress } from './useLongPress';

/** One real card on the shared battlefield: tap = tap it, hold = sheet. */
function VCard({
  card,
  art,
  onTap,
  onDetail,
}: {
  card: CardInstance;
  art: string | null;
  onTap: () => void;
  onDetail: () => void;
}) {
  const press = useLongPress(onTap, onDetail);
  const p1p1 = card.counters?.p1p1 ?? 0;
  return (
    <button
      className={`vcard${card.tapped ? ' vcard--tapped' : ''}`}
      aria-label={`tap ${card.name}`}
      title="Tap to tap · hold for options"
      {...press}
    >
      {art ? (
        <img src={art} alt="" loading="lazy" />
      ) : (
        <span className="vcard-placeholder">{card.name}</span>
      )}
      {p1p1 !== 0 && (
        <span className="count-badge vcard-counter">
          {p1p1 > 0 ? `+${p1p1}/+${p1p1}` : `${p1p1}/${p1p1}`}
        </span>
      )}
    </button>
  );
}

interface Props {
  playerIdx: number;
}

/** The card area from Nathan's sketch: real cards up front, and the
 * zone dock (library, graveyard, exile, command, hand pill) at its end.
 * Tokens keep their own strip (BoardStrip) — different physics. */
export default function BattlefieldRow({ playerIdx }: Props) {
  const game = useAppStore((s) => s.game);
  const online = useAppStore((s) => s.online);
  const tapVirtualCard = useAppStore((s) => s.tapVirtualCard);
  const drawCards = useAppStore((s) => s.drawCards);
  const castCommander = useAppStore((s) => s.castCommander);
  const peekNotice = useAppStore((s) => s.peekNotice);
  const [pile, setPile] = useState<'graveyard' | 'exile' | 'command' | null>(null);
  const [cardSheet, setCardSheet] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [armDraw, setArmDraw] = useState(false);
  const [peek, setPeek] = useState<'confirm' | 'shown' | null>(null);

  const seat = game?.players[playerIdx]?.cards;
  const profiles = game?.config.profiles;
  const front = seat ? seat.battlefield.filter((c) => c.row !== 'lands') : [];
  const records = useCardRecords([
    ...front,
    ...(seat?.command ?? []),
    ...(seat ? seat.graveyard.slice(-1) : []),
  ]);
  const holdLibrary = useLongPress(
    () => {
      if (claimed) drawCards(playerIdx, 1);
      else if (armDraw) {
        drawCards(playerIdx, 1);
        setArmDraw(false);
      } else {
        setArmDraw(true);
        window.setTimeout(() => setArmDraw(false), 3000);
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
  const commander = seat.command[0];
  const topGrave = seat.graveyard[seat.graveyard.length - 1];

  return (
    <div className={`bf-row bf-row--${size}`}>
      <div className="bf-cards">
        {front.map((c) => (
          <VCard
            key={c.iid}
            card={c}
            art={records[c.cardId]?.imageNormal ?? null}
            onTap={() => tapVirtualCard(playerIdx, c.iid)}
            onDetail={() => setCardSheet(c.iid)}
          />
        ))}
      </div>
      <div className="zone-dock">
        <button
          className="dock-pile dock-library"
          aria-label={
            armDraw
              ? `draw for ${name}?`
              : `library, ${seat.library.length} card${seat.library.length === 1 ? '' : 's'}`
          }
          title="Tap to draw · hold for library"
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
        {commander ? (
          <button
            className="dock-pile dock-command"
            aria-label={`commander ${commander.name} — tap to cast`}
            onClick={() => castCommander(playerIdx)}
          >
            {records[commander.cardId]?.imageNormal ? (
              <img src={records[commander.cardId]!.imageNormal!} alt="" loading="lazy" />
            ) : (
              <span className="dock-empty">★</span>
            )}
          </button>
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

      {pile && <PileSheet playerIdx={playerIdx} zone={pile} onClose={() => setPile(null)} />}
      {cardSheet && (
        <BattlefieldCardSheet playerIdx={playerIdx} iid={cardSheet} onClose={() => setCardSheet(null)} />
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
              <p className="hint">Everyone at the table will see that you looked.</p>
              <div className="modal-actions">
                <button
                  className="danger"
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
