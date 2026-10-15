import { useState, type CSSProperties } from 'react';
import { randomBasicArt } from '../data/images';
import { findBasicLand } from '../data/scryfall';
import { createBoardItem } from '../lib/board';
import { landsPlayed } from '../lib/cards';
import { attachedTo } from '../lib/attach';
import { draftSize, draftWords, tappedToAttack } from '../lib/attackDraft';
import { liveCombat } from '../lib/combat';
import { readUnits } from '../lib/combatEngine';
import { seatIdentity } from '../lib/commanders';
import { COLOR_NAMES, isOneShotSource, landSummary, MANA_COLORS, type ManaColor } from '../lib/mana';
import { availableMana, sourcesFrom } from '../lib/pay';
import { shelfOf } from '../lib/shelf';
import { isLandCard, landAllowance } from '../lib/turnRules';
import type { BoardItem, CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldCardSheet from './BattlefieldCardSheet';
import CardDetail from './CardDetail';
import CardSearch from './CardSearch';
import DiceRoller from './DiceRoller';
import FaceMark from './FaceMark';
import { useCardRecords } from './useCardRecords';
import { useLongPress } from './useLongPress';
import { useSeatTexts } from './useSeatTexts';

const BASICS: { name: string; color: ManaColor }[] = [
  { name: 'Plains', color: 'W' },
  { name: 'Island', color: 'U' },
  { name: 'Swamp', color: 'B' },
  { name: 'Mountain', color: 'R' },
  { name: 'Forest', color: 'G' },
];

/** The "2⤵" on a stack that has copies in use. It is also the way back: a
 * tap on it stands one of them up again. */
function TappedBadge({
  tapped,
  name,
  onUntap,
}: {
  tapped: number;
  name: string;
  onUntap: () => void;
}) {
  return (
    <button
      type="button"
      className="tapped-badge tapped-badge--undo"
      aria-label={`untap one ${name}`}
      title="Tap to untap one"
      onClick={(e) => {
        e.stopPropagation();
        onUntap();
      }}
    >
      {tapped}⤵
    </button>
  );
}

/** Tap = use one mana source (one-shots get spent); hold = card details.
 * A stack with nothing left to use takes a tap the other way: it stands
 * one copy back up. */
function LandStack({
  item,
  onTap,
  onUntap,
  onDetail,
}: {
  item: BoardItem;
  onTap: () => void;
  onUntap: () => void;
  onDetail: () => void;
}) {
  const tapped = item.tapped ?? 0;
  const oneShot = isOneShotSource(item);
  const full = !oneShot && tapped >= item.count;
  const press = useLongPress(full ? onUntap : onTap, onDetail);
  const label =
    `${item.name}` + (tapped > 0 ? `, ${tapped} of ${item.count} tapped` : '');
  return (
    <span
      className={[
        'land-stack',
        tapped >= item.count ? 'land-stack--tapped' : tapped > 0 ? 'land-stack--partial' : '',
        oneShot ? 'land-stack--oneshot' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        className="land-face"
        aria-label={label}
        title={
          oneShot
            ? 'Tap to spend one'
            : full
              ? 'Tap to untap one · hold for details'
              : 'Tap to use one · hold for details'
        }
        {...press}
      >
        {item.imageNormal ? (
          <img src={item.imageNormal} alt="" loading="lazy" />
        ) : (
          <span className="land-stack-name">{item.name}</span>
        )}
        <span className="count-badge">×{item.count}</span>
      </button>
      {tapped > 0 && <TappedBadge tapped={tapped} name={item.name} onUntap={onUntap} />}
    </span>
  );
}

interface VirtualStack {
  key: string;
  cards: CardInstance[];
}

/** Display grouping only — the data stays per-copy. Cards carrying
 * counters, or an Aura (`alone`), break out alone so the sheet edits
 * exactly that copy. */
function stackVirtualLands(cards: CardInstance[], alone: (c: CardInstance) => boolean): VirtualStack[] {
  const out: VirtualStack[] = [];
  const byId = new Map<string, VirtualStack>();
  for (const c of cards) {
    const hasCounters = Object.values(c.counters ?? {}).some((n) => n !== 0);
    if (hasCounters || alone(c)) {
      out.push({ key: c.iid, cards: [c] });
      continue;
    }
    const hit = byId.get(c.cardId);
    if (hit) hit.cards.push(c);
    else {
      const stack = { key: `s-${c.cardId}`, cards: [c] };
      byId.set(c.cardId, stack);
      out.push(stack);
    }
  }
  return out;
}

/** A stack of identical virtual lands (or one mana rock): tap = use one
 * (tap the first untapped copy), hold = full card sheet. A stack with
 * nothing left to use takes a tap the other way and stands one copy back
 * up; so does a tap on its "2⤵" count at any time. */
function VirtualLandStack({
  stack,
  art,
  attached,
  onTap,
  onUntap,
  onDetail,
}: {
  stack: VirtualStack;
  art: string | null;
  /** How many Auras sit on it (such a land stands alone). */
  attached: number;
  onTap: () => void;
  onUntap: () => void;
  onDetail: () => void;
}) {
  const n = stack.cards.length;
  const tapped = stack.cards.filter((c) => c.tapped).length;
  const full = tapped >= n;
  const press = useLongPress(full ? onUntap : onTap, onDetail);
  const name = stack.cards[0].name;
  const label = name + (tapped > 0 ? `, ${tapped} of ${n} tapped` : '');
  return (
    <span
      className={[
        'land-stack',
        full ? 'land-stack--tapped' : tapped > 0 ? 'land-stack--partial' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-iids={stack.cards.map((c) => c.iid).join(' ')}
    >
      <button
        className="land-face"
        aria-label={label}
        title={full ? 'Tap to untap one · hold for options' : 'Tap to use one · hold for options'}
        {...press}
      >
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="land-stack-name">{name}</span>
        )}
        {n > 1 && <span className="count-badge">×{n}</span>}
        {attached > 0 && (
          <span className="attached-badge" aria-label={`${attached} attached`}>
            🔗{attached}
          </span>
        )}
        {/* The land on the back of a spell: a stack holds one card id, so one face. */}
        <FaceMark cardId={stack.cards[0].cardId} />
      </button>
      {tapped > 0 && <TappedBadge tapped={tapped} name={name} onUntap={onUntap} />}
    </span>
  );
}

interface Props {
  playerIdx: number;
  /** false on the phone's hand view: a fight is declared on the table. */
  attackButton?: boolean;
  /** A deck seat draws the two halves apart, so its big board can lay each
   * out on its own: 'status' is the summary line alone, 'stacks' the lands
   * (and mana rocks) alone. Left out, the row is whole. */
  part?: 'status' | 'stacks';
}

export default function LandsRow({ playerIdx, attackButton = true, part }: Props) {
  const game = useAppStore((s) => s.game);
  const attackWithTapped = useAppStore((s) => s.attackWithTapped);
  const addItem = useAppStore((s) => s.addItem);
  const changeCount = useAppStore((s) => s.changeCount);
  const tapItem = useAppStore((s) => s.tapItem);
  const untapAll = useAppStore((s) => s.untapAll);
  const tapVirtualCard = useAppStore((s) => s.tapVirtualCard);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [vcardSheet, setVcardSheet] = useState<string | null>(null);
  const [diceOpen, setDiceOpen] = useState(false);

  // Every battlefield card is read, not just the shelf: a dork up front is
  // mana too, and the ready count has to see it.
  const seat = game?.players[playerIdx]?.cards;
  const records = useCardRecords(seat?.battlefield ?? []);
  // The lands shelf (cards mode): the seat's lands, and beside them
  // whatever else is on the table just to make mana — Sol Ring, a Signet.
  const isLand = (c: CardInstance) => {
    const record = records[c.cardId];
    return record ? isLandCard(record.typeLine) : c.row === 'lands';
  };
  const shelf = (seat?.battlefield ?? []).filter((c) => shelfOf(c, records[c.cardId]) === 'lands');
  const vLands = [...shelf.filter(isLand), ...shelf.filter((c) => !isLand(c))]; // rocks after the lands
  const texts = useSeatTexts(playerIdx);

  if (!game) return null;
  const lands = game.players[playerIdx].board.filter((it) => it.zone === 'lands');
  // The summary reads the whole board: dorks and Ashaya-fied creatures
  // count toward the color pips while the total stays lands-only. Virtual
  // lands count fully once their records resolve.
  const summary = landSummary(
    game.players[playerIdx].board,
    // A rock adds to the color pips, never to the land count.
    vLands.map((c) => ({ oracleText: records[c.cardId]?.oracleText ?? null, land: isLand(c) })),
    seatIdentity(game, playerIdx),
  );
  // Untap-all readies the whole board now, so any tapped permanent surfaces it.
  const anyTapped =
    game.players[playerIdx].board.some((it) => (it.tapped ?? 0) > 0) ||
    (seat?.battlefield.some((c) => c.tapped) ?? false);
  // What the cast gate sees: untapped sources plus mana still floating.
  const ready = seat
    ? availableMana(sourcesFrom(seat.battlefield, records, game.players[playerIdx].board, seatIdentity(game, playerIdx)))
    : null;
  // The land drop, for the deck seat whose turn it is: how many lands it
  // has played from hand against how many it may (the hand's gate reads
  // the same two numbers). Nobody else has a land drop to show.
  const landDrop =
    seat && game.activePlayerIndex === playerIdx
      ? { used: landsPlayed(game, playerIdx), allowed: landAllowance(texts.own, texts.others) }
      : null;
  const readyReadout = ready !== null && (
    <span className="mana-ready" aria-label={`${ready} mana ready`}>
      {ready} ready
    </span>
  );
  // Combat starts on the board, the way it does at a table: the active
  // player turns creatures sideways, and this line — the one every layout
  // draws at the player's own edge — offers to declare exactly those
  // ("⚔ Attack with 3 →"). Until something is tapped it only says how, and
  // only while there is something that could attack (a card not read yet
  // counts: what the app cannot read never blocks a play). While the fight
  // is on, the same place says so.
  const myTurn = game.activePlayerIndex === playerIdx && !game.players[playerIdx].eliminated;
  const inCombat = myTurn && liveCombat(game) !== null;
  const offer = attackButton && myTurn && !inCombat;
  const draft = offer ? tappedToAttack(game, records) : [];
  const attackers = draftSize(draft);
  const couldAttack = () => {
    try {
      return readUnits(game, playerIdx, records).some((unit) => unit.creature && unit.canAttack > 0);
    } catch {
      return false; // a board the engine cannot read offers no fight; nothing else changes
    }
  };
  const attackHint = offer && attackers === 0 && couldAttack();

  async function quickAdd(name: string) {
    const existing = lands.find((it) => it.name === name);
    if (existing) {
      changeCount(playerIdx, existing.id, 1);
      return;
    }
    const card = await findBasicLand(name);
    if (!card) return;
    // A fresh art roll per game and per player for each first-of-type land.
    const variant = await randomBasicArt(name).catch(() => undefined);
    addItem(
      playerIdx,
      createBoardItem(
        variant ? { ...card, imageNormal: variant.normal, imageArtCrop: variant.artCrop } : card,
        'lands',
      ),
    );
  }

  const carried = (c: CardInstance) =>
    attachedTo(game, { seat: playerIdx, kind: 'card', id: c.iid }).length;
  const virtualStacks = stackVirtualLands(vLands, (c) => carried(c) > 0);

  const summaryLine = (
      <div className="mana-summary">
        <span className="lands-total">{summary.total} lands</span>
        {MANA_COLORS.filter((c) => summary.colors[c] > 0).map((c) => (
          <span
            key={c}
            className={`mana-pip mana-${c}`}
            aria-label={`${summary.colors[c]} ${COLOR_NAMES[c]} sources`}
          >
            {summary.colors[c]}
          </span>
        ))}
        {summary.any > 0 && (
          <span className="mana-pip mana-any" aria-label={`${summary.any} any-color sources`}>
            {summary.any}
          </span>
        )}
        {!landDrop && readyReadout}
        {landDrop && (
          // One above the other: the line has no width to spare for a second
          // readout beside the first (it pushed a land stack out of sight).
          <span className="turn-readouts">
            {readyReadout}
            <span
              className="land-plays"
              aria-label={
                Number.isFinite(landDrop.allowed)
                  ? `${landDrop.used} of ${landDrop.allowed} land plays used`
                  : `${landDrop.used} land plays used, no limit`
              }
            >
              land {landDrop.used}/{Number.isFinite(landDrop.allowed) ? landDrop.allowed : '∞'}
            </span>
          </span>
        )}
        {/* In flow like the dice, never positioned: the board turns to face each
            seat. Ahead of the untap button, which comes and goes as things tap:
            this one must not be pushed along the line. It is never over the
            creatures themselves — a tap meant for the next attacker must not
            land on "Attack". */}
        {attackers > 0 && (
          <button
            className="attack-btn attack-btn--go"
            aria-label={`attack with ${draftWords(draft)}`}
            title="Declare the creatures you have tapped as attackers"
            onClick={() => void attackWithTapped()}
          >
            ⚔ Attack with {attackers} →
          </button>
        )}
        {attackHint && (
          <span className="attack-hint" aria-label="tap your creatures to attack">
            ⚔ tap creatures to attack
          </span>
        )}
        {attackButton && inCombat && (
          <button className="attack-btn" aria-label="in combat" disabled>
            ⚔ In combat
          </button>
        )}
        {anyTapped && (
          <button className="untap-btn" aria-label="untap all" onClick={() => untapAll(playerIdx)}>
            ⟳ untap
          </button>
        )}
        {/* In flow at the line's end so every seat rotation carries it. */}
        <button
          className="zone-dice"
          aria-label="dice roller"
          onClick={(e) => {
            e.stopPropagation();
            setDiceOpen(true);
          }}
        >
          🎲
        </button>
      </div>
  );

  const stacks = (
      <div
        className="lands-stacks"
        // How many stacks: the big board shares a crowded shelf line by it.
        style={{ '--n': virtualStacks.length + lands.length } as CSSProperties}
      >
        {virtualStacks.map((s) => {
          const untapped = s.cards.find((c) => !c.tapped);
          // The way back takes the copy that was tapped last (they tap in order).
          const tapped = [...s.cards].reverse().find((c) => c.tapped);
          return (
            <VirtualLandStack
              key={s.key}
              stack={s}
              art={records[s.cards[0].cardId]?.imageNormal ?? null}
              attached={carried(s.cards[0])}
              // Each way is said outright: a stale tile must never flip a card back.
              onTap={() => untapped && tapVirtualCard(playerIdx, untapped.iid, true)}
              onUntap={() => tapped && tapVirtualCard(playerIdx, tapped.iid, false)}
              onDetail={() => setVcardSheet(s.cards[0].iid)}
            />
          );
        })}
        {lands.map((item) => (
          <LandStack
            key={item.id}
            item={item}
            onTap={() =>
              isOneShotSource(item)
                ? changeCount(playerIdx, item.id, -1)
                : tapItem(playerIdx, item.id, 1)
            }
            onUntap={() => (item.tapped ?? 0) > 0 && tapItem(playerIdx, item.id, -1)}
            onDetail={() => setDetailId(item.id)}
          />
        ))}
        {/* Deck seats draw their lands — the quick-add chips are tracker-only. */}
        {!seat && (
          <span className="basic-adds">
            {BASICS.map((b) => (
              <button
                key={b.name}
                className={`basic-add swatch-${b.color}`}
                aria-label={`add ${b.name}`}
                onClick={() => void quickAdd(b.name)}
              >
                +
              </button>
            ))}
            <button
              className="basic-add land-search"
              aria-label="add a land"
              onClick={() => setSearchOpen(true)}
            >
              🔍
            </button>
          </span>
        )}
      </div>
  );

  // Every sheet is a portal: where it is listed changes nothing on screen.
  const sheets = (
    <>
      {searchOpen && (
        <CardSearch playerIdx={playerIdx} zone="lands" onClose={() => setSearchOpen(false)} />
      )}
      {detailId && (
        <CardDetail playerIdx={playerIdx} itemId={detailId} onClose={() => setDetailId(null)} />
      )}
      {vcardSheet && (
        <BattlefieldCardSheet
          playerIdx={playerIdx}
          iid={vcardSheet}
          onClose={() => setVcardSheet(null)}
        />
      )}
      {diceOpen && <DiceRoller onClose={() => setDiceOpen(false)} />}
    </>
  );

  if (part === 'stacks')
    return (
      <>
        {stacks}
        {sheets}
      </>
    );
  return (
    <div className="lands-row">
      {summaryLine}
      {part !== 'status' && stacks}
      {sheets}
    </div>
  );
}
