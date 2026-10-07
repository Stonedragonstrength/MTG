import { useState } from 'react';
import { randomBasicArt } from '../data/images';
import { findBasicLand } from '../data/scryfall';
import { createBoardItem } from '../lib/board';
import { landsPlayed } from '../lib/cards';
import { liveCombat } from '../lib/combat';
import { readUnits } from '../lib/combatEngine';
import { COLOR_NAMES, isOneShotSource, landSummary, MANA_COLORS, type ManaColor } from '../lib/mana';
import { availableMana, sourcesFrom } from '../lib/pay';
import { landAllowance } from '../lib/turnRules';
import type { BoardItem, CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import BattlefieldCardSheet from './BattlefieldCardSheet';
import CardDetail from './CardDetail';
import CardSearch from './CardSearch';
import DiceRoller from './DiceRoller';
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

/** Tap = use one mana source (one-shots get spent); hold = card details. */
function LandStack({
  item,
  onTap,
  onDetail,
}: {
  item: BoardItem;
  onTap: () => void;
  onDetail: () => void;
}) {
  const press = useLongPress(onTap, onDetail);
  const tapped = item.tapped ?? 0;
  const oneShot = isOneShotSource(item);
  const label =
    `${item.name}` + (tapped > 0 ? `, ${tapped} of ${item.count} tapped` : '');
  return (
    <button
      className={[
        'land-stack',
        tapped >= item.count ? 'land-stack--tapped' : tapped > 0 ? 'land-stack--partial' : '',
        oneShot ? 'land-stack--oneshot' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={oneShot ? 'Tap to spend one' : 'Tap to use one · hold for details'}
      {...press}
    >
      {item.imageNormal ? (
        <img src={item.imageNormal} alt="" loading="lazy" />
      ) : (
        <span className="land-stack-name">{item.name}</span>
      )}
      <span className="count-badge">×{item.count}</span>
      {tapped > 0 && <span className="tapped-badge">{tapped}⤵</span>}
    </button>
  );
}

interface VirtualStack {
  key: string;
  cards: CardInstance[];
}

/** Display grouping only — the data stays per-copy. Cards carrying
 * counters break out alone so the sheet edits exactly that copy. */
function stackVirtualLands(cards: CardInstance[]): VirtualStack[] {
  const out: VirtualStack[] = [];
  const byId = new Map<string, VirtualStack>();
  for (const c of cards) {
    const hasCounters = Object.values(c.counters ?? {}).some((n) => n !== 0);
    if (hasCounters) {
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

/** A stack of identical virtual lands: tap = use one (tap the first
 * untapped copy), hold = full card sheet. Fully tapped stacks wait for
 * untap-all, same as tracker stacks. */
function VirtualLandStack({
  stack,
  art,
  onTap,
  onDetail,
}: {
  stack: VirtualStack;
  art: string | null;
  onTap: () => void;
  onDetail: () => void;
}) {
  const press = useLongPress(onTap, onDetail);
  const n = stack.cards.length;
  const tapped = stack.cards.filter((c) => c.tapped).length;
  const name = stack.cards[0].name;
  const label = name + (tapped > 0 ? `, ${tapped} of ${n} tapped` : '');
  return (
    <button
      className={[
        'land-stack',
        tapped >= n ? 'land-stack--tapped' : tapped > 0 ? 'land-stack--partial' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title="Tap to use one · hold for options"
      {...press}
    >
      {art ? (
        <img src={art} alt="" loading="lazy" />
      ) : (
        <span className="land-stack-name">{name}</span>
      )}
      {n > 1 && <span className="count-badge">×{n}</span>}
      {tapped > 0 && <span className="tapped-badge">{tapped}⤵</span>}
    </button>
  );
}

interface Props {
  playerIdx: number;
  /** false on the phone's hand view: a fight is declared on the table. */
  attackButton?: boolean;
}

export default function LandsRow({ playerIdx, attackButton = true }: Props) {
  const game = useAppStore((s) => s.game);
  const startCombat = useAppStore((s) => s.startCombat);
  const addItem = useAppStore((s) => s.addItem);
  const changeCount = useAppStore((s) => s.changeCount);
  const tapItem = useAppStore((s) => s.tapItem);
  const untapAll = useAppStore((s) => s.untapAll);
  const tapVirtualCard = useAppStore((s) => s.tapVirtualCard);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [vcardSheet, setVcardSheet] = useState<string | null>(null);
  const [diceOpen, setDiceOpen] = useState(false);

  // Virtual deck lands live on the battlefield's lands shelf (cards mode).
  const seat = game?.players[playerIdx]?.cards;
  const vLands = seat ? seat.battlefield.filter((c) => c.row === 'lands') : [];
  // Every battlefield card, not just the shelf: rocks and dorks up front
  // are mana too, and the ready count has to see them.
  const records = useCardRecords(seat?.battlefield ?? []);
  const texts = useSeatTexts(playerIdx);

  if (!game) return null;
  const lands = game.players[playerIdx].board.filter((it) => it.zone === 'lands');
  // The summary reads the whole board: dorks and Ashaya-fied creatures
  // count toward the color pips while the total stays lands-only. Virtual
  // lands count fully once their records resolve.
  const summary = landSummary(
    game.players[playerIdx].board,
    vLands.map((c) => ({ oracleText: records[c.cardId]?.oracleText ?? null })),
  );
  // Untap-all readies the whole board now, so any tapped permanent surfaces it.
  const anyTapped =
    game.players[playerIdx].board.some((it) => (it.tapped ?? 0) > 0) ||
    (seat?.battlefield.some((c) => c.tapped) ?? false);
  // What the cast gate sees: untapped sources plus mana still floating.
  const ready = seat
    ? availableMana(sourcesFrom(seat.battlefield, records, game.players[playerIdx].board))
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
  // Combat starts here, on the line every layout draws at the player's own
  // edge: the active seat may attack once it has a creature on the tablet
  // (one whose card is not read yet counts: what the app cannot read never
  // blocks a play). While its fight is on, the button keeps its place and
  // only says so — nothing moves under the finger that pressed it.
  const myTurn = game.activePlayerIndex === playerIdx && !game.players[playerIdx].eliminated;
  const inCombat = myTurn && liveCombat(game) !== null;
  const hasCreature = () => {
    try {
      return readUnits(game, playerIdx, records).some((unit) => unit.creature);
    } catch {
      return false; // a board the engine cannot read offers no fight; nothing else changes
    }
  };
  const attack = attackButton && myTurn && (inCombat || hasCreature());

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

  return (
    <div className="lands-row">
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
            seat. Ahead of the untap button, which comes and goes as things tap
            (the declaration taps the attackers): this one must not be pushed
            along the line while its fight is on. */}
        {attack && (
          <button
            className="attack-btn"
            aria-label={inCombat ? 'in combat' : 'attack'}
            disabled={inCombat}
            onClick={() => startCombat()}
          >
            ⚔ {inCombat ? 'In combat' : 'Attack'}
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

      <div className="lands-stacks">
        {stackVirtualLands(vLands).map((s) => {
          const untapped = s.cards.find((c) => !c.tapped);
          return (
            <VirtualLandStack
              key={s.key}
              stack={s}
              art={records[s.cards[0].cardId]?.imageNormal ?? null}
              onTap={() => untapped && tapVirtualCard(playerIdx, untapped.iid, true)}
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
    </div>
  );
}
