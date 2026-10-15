import { useEffect, useState } from 'react';
import { abilitiesOf, abilitiesWorn, type Ability } from '../lib/abilities';
import { attachedTo, attaches, hostName, hostOf, isAura, isEquipment } from '../lib/attach';
import { isCommander } from '../lib/cards';
import { faceNames, isBackId, turnsOver } from '../lib/faces';
import { godKey, godsOf, godWords } from '../lib/gods';
import { searchAsk, type SearchAsk } from '../lib/search';
import { seatSources } from '../lib/seatMana';
import { shelfOf, type Shelf } from '../lib/shelf';
import type { CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import AbilityRow, { type AbilityUse } from './AbilityRow';
import AttachSheet from './AttachSheet';
import DiscoverSheet from './DiscoverSheet';
import LibrarySearchSheet from './LibrarySearchSheet';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import { useSeatCombat, useTableRecords } from './useCombat';

interface Props {
  playerIdx: number;
  iid: string;
  onClose: () => void;
  /** false where there is no picking (the phone's hand view): no combat chips either. */
  picks?: boolean;
}

/** The three places a seat's board draws a card, and the `row` that pins it there. */
const SHELVES: { shelf: Shelf; row: NonNullable<CardInstance['row']>; label: string }[] = [
  { shelf: 'field', row: 'field', label: 'On the battlefield' },
  { shelf: 'lands', row: 'lands', label: 'With the lands' },
  { shelf: 'side', row: 'side', label: 'On the side shelf' },
];

/** A Discover being carried out from one of the card's abilities: the card
 * that discovers, and how its row was pressed. */
interface Discovering {
  ability: Ability;
  use: AbilityUse;
  source: string;
}

/** Everything you do to a card on the battlefield that isn't a tap. */
export default function BattlefieldCardSheet({ playerIdx, iid, onClose, picks = true }: Props) {
  const game = useAppStore((s) => s.game);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const setVirtualCounter = useAppStore((s) => s.setVirtualCounter);
  const commanderDiedAction = useAppStore((s) => s.commanderDiedAction);
  const tapVirtualCard = useAppStore((s) => s.tapVirtualCard);
  const sacrificeCard = useAppStore((s) => s.sacrificeCard);
  const transformCard = useAppStore((s) => s.transformCard);
  const startCombat = useAppStore((s) => s.startCombat);
  const attachVirtualCard = useAppStore((s) => s.attachVirtualCard);
  const activateAbility = useAppStore((s) => s.activateAbility);
  const takeControl = useAppStore((s) => s.takeControl);
  const giveBack = useAppStore((s) => s.giveBack);
  const mySeat = useAppStore((s) => s.online?.mySeat ?? null);
  const [counterName, setCounterName] = useState('');
  const [attaching, setAttaching] = useState(false);
  // The search this card sends its player on, once asked for: it outlives
  // the card, which may have been sacrificed to pay for it.
  const [searching, setSearching] = useState<{ ask: SearchAsk; source: string } | null>(null);
  // A Discover from one of its abilities, the same: the cards are turned over
  // before anything is paid, and the card may go with the answer.
  const [discovering, setDiscovering] = useState<Discovering | null>(null);
  const seat = game?.players[playerIdx]?.cards;
  const card = seat?.battlefield.find((c) => c.iid === iid);
  const records = useCardRecords(card ? [card] : []);
  const tableRecords = useTableRecords();
  const combat = useSeatCombat(playerIdx, picks);
  // A peer moved the card away: close for real, or the still-mounted sheet
  // ghost-reopens when the card returns and squats on the back stack.
  const gone = !card && !searching && !discovering;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  // The search takes this sheet's place; closing that closes the lot.
  if (searching)
    return (
      <LibrarySearchSheet
        playerIdx={playerIdx}
        ask={searching.ask}
        source={searching.source}
        onClose={() => onClose()}
      />
    );
  if (discovering) {
    const { ability, use, source } = discovering;
    const n = ability.effect.kind === 'discover' ? ability.effect.n : 0;
    return (
      <DiscoverSheet
        playerIdx={playerIdx}
        n={n === 'exiled' ? null : n}
        pick={ability.exiles}
        source={source}
        carryOut={(plan, take, value, pick) =>
          activateAbility(playerIdx, iid, ability.key, { ...use, discover: { plan, take, n: value, ...(pick ? { pick } : {}) } })
        }
        onClose={() => onClose()}
      />
    );
  }
  if (!game || !seat || !card) return null;
  // Choosing what it goes on takes this sheet's place; closing that closes the lot.
  if (attaching) return <AttachSheet playerIdx={playerIdx} iid={iid} onClose={onClose} />;

  const record = records[card.cardId];
  // Auras and Equipment: what it sits on (if anything), and — for any card —
  // what sits on it, whoever those belong to.
  const host = hostOf(game, card);
  const canAttach = attaches(record) || host !== null;
  const onThis = attachedTo(game, { seat: playerIdx, kind: 'card', id: iid });
  const whose = (s: number) => (s === playerIdx ? '' : `${game.config.profiles[s]?.name ?? '?'}’s `);
  const p1p1 = card.counters?.p1p1 ?? 0;
  const named = Object.entries(card.counters ?? {}).filter(([k]) => k !== 'p1p1');
  // Only a commander goes back to the command zone — its partner being
  // home does not block it. Seats dealt before commanders were tracked
  // keep the old rule: an empty command zone takes whatever is sent.
  const goesHome = isCommander(seat, card.iid) ?? seat.command.length === 0;

  const go = (fn: () => void) => () => {
    fn();
    onClose();
  };

  // While this seat picks attackers or blockers a tap on a creature is a
  // pick, and one that cannot fight ignores it. The way round both is
  // here, behind the hold: send it in anyway, and tap or untap it the
  // plain way (crewing and paying with a creature still work). Only the
  // front row fights — a card on the lands shelf moves there first.
  const look = card.row !== 'lands' && combat?.mode ? combat.look({ kind: 'card', id: iid }) : null;
  const job = look?.mode === 'attack' ? 'Attack' : 'Block';
  const myTurn = game.activePlayerIndex === playerIdx && !game.players[playerIdx].eliminated;
  const shelf = shelfOf(card, record);
  const onBack = isBackId(card.cardId);
  // Who would take control of it: this device's player online, else the
  // player whose turn it is (a seat that plays cards: a tracker seat has no
  // battlefield to put it on). Its own controller takes nothing.
  const takerSeat = mySeat ?? game.activePlayerIndex;
  const taker = game.players[takerSeat]?.cards ? takerSeat : playerIdx;
  const takerName = game.config.profiles[taker]?.name ?? 'You';
  // "Search your library for…": the list of what it may find, a tap away.
  // Where the card pays for it by being sacrificed, the same tap does that.
  const ask = searchAsk(record);
  const paysWithItself =
    !!ask &&
    /\bsacrifice (?:this \w+|it)\b[^.\n]*:[^\n]*\bsearch your library for\b/i.test(record?.oracleText ?? '');
  const faces = faceNames(record, card.name);
  // A Theros god: how near its devotion is to its number.
  const god = godsOf(game, playerIdx, tableRecords).get(godKey({ kind: 'card', id: iid })) ?? null;
  // Monstrosity, Adapt, Outlast, firebreathing, Discover…: paid from this
  // seat's lands — its own, and what its Equipment and Auras give it.
  const abilities = [
    ...abilitiesOf(record, card.counters?.level ?? 0).filter((a) => !a.graveyard),
    ...abilitiesWorn(game, { seat: playerIdx, kind: 'card', id: iid }, tableRecords),
  ];
  const sources =
    abilities.length > 0
      ? seatSources(game, playerIdx, tableRecords)
      : [];

  return (
    <Sheet title={card.name} onClose={onClose}>
      <div className="card-hero">
        {record?.imageNormal && <img className="card-image" src={record.imageNormal} alt={card.name} />}
        {record?.typeLine && <p className="type-line">{record.typeLine}</p>}
        {god && (
          <p className={god.creature ? 'god-line god-line--awake' : 'god-line'}>
            {god.creature ? 'A creature now' : 'Not a creature yet'} · {godWords(god)}
          </p>
        )}
      </div>

      {canAttach && (
        <div className="detail-section">
          <span className="section-label">{isEquipment(record) ? 'Equipped' : 'Attached'}</span>
          <p className="attach-where">
            {host ? `On ${whose(host.seat)}${hostName(game, host)}` : 'Not on anything'}
          </p>
          {!host && isAura(record) && (
            <p className="hint">An Aura with nothing to enchant goes to the graveyard.</p>
          )}
          <div className="chip-row">
            <button className="chip" onClick={() => setAttaching(true)}>
              {host ? 'Move it…' : isEquipment(record) ? 'Equip…' : 'Attach…'}
            </button>
            {host && (
              <button className="chip" onClick={go(() => attachVirtualCard(playerIdx, iid, null))}>
                Take it off
              </button>
            )}
          </div>
        </div>
      )}

      {onThis.length > 0 && (
        <div className="detail-section">
          <span className="section-label">On this card</span>
          {onThis.map(({ seat: owner, card: a }) => (
            <div className="detail-row" key={a.iid}>
              <span>
                {whose(owner)}
                {a.name}
              </span>
              <button
                className="chip"
                aria-label={`take ${a.name} off`}
                onClick={() => attachVirtualCard(owner, a.iid, null)}
              >
                Take it off
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="detail-section">
        <span className="section-label">{look ? 'Combat' : 'Tap'}</span>
        <div className="chip-row">
          {look?.stop && (
            <button className="chip" onClick={go(look.stop)}>
              Stop {look.mode === 'attack' ? 'attacking' : 'blocking'}
            </button>
          )}
          {look?.anyway && (
            <button className="chip" onClick={go(look.anyway)}>
              {/* "anyway" when a tap on the card would have refused */}
              {look.picks && look.free > 0 ? job : `${job} anyway`}
            </button>
          )}
          {/* No fight on and it is this seat's turn: the long way into one —
              pick the attackers one by one — for whatever the board cannot
              offer by itself (a card it cannot read, a Vehicle, a creature
              that should attack without being tapped first). */}
          {picks && !combat && myTurn && card.row !== 'lands' && (
            <button className="chip" onClick={go(startCombat)}>
              Pick attackers…
            </button>
          )}
          {/* Always here: the plain tap, and the way back from one made by
              mistake. The direction is said outright — a stale sheet must
              not flip it back. */}
          <button className="chip" onClick={go(() => tapVirtualCard(playerIdx, iid, !card.tapped))}>
            {card.tapped ? 'Untap' : 'Tap'}
          </button>
        </div>
      </div>

      {abilities.length > 0 && (
        <div className="detail-section">
          <span className="section-label">Abilities</span>
          {abilities.map((ability) => (
            <AbilityRow
              key={ability.key}
              playerIdx={playerIdx}
              card={card}
              ability={ability}
              sources={sources}
              onDiscover={(use) => setDiscovering({ ability, use, source: card.name })}
              onUsed={onClose}
            />
          ))}
        </div>
      )}

      {ask && (
        <div className="detail-section">
          <span className="section-label">Library</span>
          <p className="hint">Find {ask.what}.</p>
          <div className="chip-row">
            <button
              className="chip"
              onClick={() => {
                if (paysWithItself) sacrificeCard(playerIdx, iid);
                setSearching({ ask, source: card.name });
              }}
            >
              {paysWithItself ? 'Sacrifice it and search…' : 'Search library…'}
            </button>
          </div>
        </div>
      )}

      {/* A double-faced card: turn it over. The direction is read off the
          card as it lies, and everything on the table then reads that face. */}
      {turnsOver(record) && (
        <div className="detail-section">
          <span className="section-label">Faces</span>
          <p className="face-now">
            {onBack ? `On its back${faces.back ? `: ${faces.back}` : ''}` : `Front face up: ${faces.front}`}
          </p>
          <div className="chip-row">
            <button className="chip" onClick={go(() => void transformCard(playerIdx, iid))}>
              {onBack ? 'Transform back' : 'Transform'}
            </button>
          </div>
        </div>
      )}

      <div className="detail-section">
        <span className="section-label">Counters</span>
        <div className="detail-row">
          <span>+1/+1</span>
          <div className="stepper">
            <button aria-label="fewer +1/+1" onClick={() => setVirtualCounter(playerIdx, iid, 'p1p1', p1p1 - 1)}>−</button>
            <span>{p1p1}</span>
            <button aria-label="more +1/+1" onClick={() => setVirtualCounter(playerIdx, iid, 'p1p1', p1p1 + 1)}>+</button>
          </div>
        </div>
        {named.map(([name, value]) => (
          <div className="detail-row" key={name}>
            <span>{name === 'm1m1' ? '−1/−1' : name}</span>
            <div className="stepper">
              <button aria-label={`fewer ${name}`} onClick={() => setVirtualCounter(playerIdx, iid, name, value - 1)}>−</button>
              <span>{value}</span>
              <button aria-label={`more ${name}`} onClick={() => setVirtualCounter(playerIdx, iid, name, value + 1)}>+</button>
            </div>
          </div>
        ))}
        <div className="detail-row">
          <input placeholder="counter name" value={counterName} onChange={(e) => setCounterName(e.target.value)} />
          <button
            disabled={!counterName.trim()}
            onClick={() => {
              setVirtualCounter(playerIdx, iid, counterName.trim().toLowerCase(), 1);
              setCounterName('');
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div className="detail-section">
        <span className="section-label">Move</span>
        <div className="chip-row">
          {/* To the graveyard as well, but said as what it was: a card that
              asks for a sacrifice wants the table to see one. */}
          <button className="chip" onClick={go(() => sacrificeCard(playerIdx, iid))}>Sacrifice</button>
          <button className="chip" onClick={go(() => moveVirtualCard(playerIdx, iid, 'battlefield', 'graveyard'))}>Graveyard</button>
          <button className="chip" onClick={go(() => moveVirtualCard(playerIdx, iid, 'battlefield', 'exile'))}>Exile</button>
          <button className="chip" onClick={go(() => moveVirtualCard(playerIdx, iid, 'battlefield', 'hand'))}>Hand</button>
          <button className="chip" onClick={go(() => moveVirtualCard(playerIdx, iid, 'battlefield', 'library', { pos: 'top' }))}>Top</button>
          <button className="chip" onClick={go(() => moveVirtualCard(playerIdx, iid, 'battlefield', 'library', { pos: 'bottom' }))}>Bottom</button>
          {goesHome && (
            <button className="chip" onClick={go(() => commanderDiedAction(playerIdx, iid))}>
              To command (+2 tax)
            </button>
          )}
        </div>
      </div>

      {/* Who controls it: someone else's taken (Threaten, Control Magic —
          any card the reader does not carry out itself), or a taken one
          given back. Taken by the player whose device this is, else the one
          whose turn it is. */}
      {(card.stolen || taker !== playerIdx) && (
        <div className="detail-section">
          <span className="section-label">Control</span>
          <div className="chip-row">
            {card.stolen ? (
              <button className="chip" onClick={go(() => giveBack(playerIdx, iid))}>
                ⇄ Give back to {game.config.profiles[card.stolen.owner]?.name ?? 'its owner'}
              </button>
            ) : (
              <>
                <button className="chip" onClick={go(() => takeControl(taker, playerIdx, iid, { untilEndOfTurn: true }))}>
                  ⇄ {takerName} takes it for the turn
                </button>
                <button className="chip" onClick={go(() => takeControl(taker, playerIdx, iid))}>
                  ⇄ {takerName} takes it
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Where it is drawn. The board sorts cards by type; this is for the
          one that belongs somewhere else (an animated land, a Vehicle the
          player wants up with the creatures). 'lands' also keeps it out of
          combat until it is moved back. */}
      <div className="detail-section">
        <span className="section-label">Keep it</span>
        <div className="chip-row">
          {SHELVES.filter((s) => s.shelf !== shelf).map((s) => (
            <button
              key={s.shelf}
              className="chip"
              onClick={() =>
                moveVirtualCard(playerIdx, iid, 'battlefield', 'battlefield', { row: s.row })
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
