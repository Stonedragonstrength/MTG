import { Component, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { actingSeat, attackersStopped, copiesOf, liveCombat } from '../lib/combat';
import {
  COMBAT_KEYWORDS,
  cardsRead,
  hasKeyword,
  readSeat,
  readUnit,
  readUnits,
  type CardRecords,
  type CombatKeyword,
  type UnitRead,
} from '../lib/combatEngine';
import { NO_EDITS, reviewCombat } from '../lib/combatReview';
import {
  allAttack,
  attackTargets,
  attackersAt,
  attacksAt,
  barSentence,
  litAttack,
  litTarget,
  resultFlags,
  resultLines,
  type Incoming,
} from '../lib/combatView';
import type { CardRecord, CombatState, CombatUnit, GameState } from '../lib/types';
import { useAppStore } from '../state/store';
import CardZoomSheet from './CardZoomSheet';
import CombatReviewSheet from './CombatReviewSheet';
import { seatTint, useCombatAim, useTableRecords } from './useCombat';
import { useConfirmTap } from './useConfirmTap';
import { useLongPress } from './useLongPress';

/** An armed "Really call it off?" that nobody answers stands down again. */
const DISARM_MS = 5000;
/** How often a fight that cannot be applied yet asks for its missing cards again. */
const REREAD_MS = 1500;

/** [Cancel]. While attackers are still being picked nobody else has done
 * anything and Undo brings the picks back: one tap. Past that it throws
 * away other players' work, so it asks in place — and one stray double
 * tap cannot answer (useConfirmTap). */
function CancelButton({ asks }: { asks: boolean }) {
  const cancelCombat = useAppStore((s) => s.cancelCombat);
  const sure = useConfirmTap();
  const { armed, disarm } = sure;
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(disarm, DISARM_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);
  return (
    <button
      className={`combat-cancel${armed ? ' danger' : ' ghost'}`}
      onClick={(tap) => {
        if (!asks || sure.confirms(tap)) cancelCombat();
      }}
    >
      {armed ? 'Really call it off?' : 'Cancel'}
    </button>
  );
}

// ---- attackers ----

function AttackersBar({ game, fight }: { game: GameState; fight: CombatState }) {
  const confirmAttackers = useAppStore((s) => s.confirmAttackers);
  const setAttackers = useAppStore((s) => s.setAttackers);
  const aim = useCombatAim();
  const records = useTableRecords();
  const targets = attackTargets(game, fight);
  const lit = litTarget(game, fight, aim.combatId === fight.id ? aim.target : null);
  const n = (fight.attacks ?? []).reduce((total, a) => total + copiesOf(a), 0);
  // A card whose record has not arrived is taken on trust as a creature, so
  // that a single tap is never refused. Sending EVERYTHING on trust is
  // another matter — a Sol Ring would be declared and tapped with the rest:
  // "All attack" waits until this seat's cards have been read.
  const read = (game.players[fight.active]?.cards?.battlefield ?? []).every((c) => c.cardId in records);
  const everyone = lit === null || !read ? [] : allAttack(fight, readUnits(game, fight.active, records), lit);
  return (
    <div className="combat-bar combat-bar--attackers" role="group" aria-label="combat">
      <div className="combat-line">
        <span className="combat-say">{barSentence(game, fight)}</span>
        <span className="combat-actions">
          <CancelButton asks={false} />
          <button className="combat-all" disabled={everyone.length === 0} onClick={() => setAttackers(everyone)}>
            All attack
          </button>
          {/* With nobody picked this just ends the fight: "Attack (0)" is a cancel. */}
          <button className="primary combat-go" onClick={() => void confirmAttackers()}>
            Attack ({n})
          </button>
        </span>
      </div>
      {/* A pod: one chip per living opponent, and a tap on a creature points it at the lit one. */}
      {targets.length > 1 && (
        <div className="combat-chips" role="group" aria-label="attack whom">
          {targets.map((seat) => {
            const coming = attackersAt(fight, seat);
            const name = game.config.profiles[seat]?.name ?? '?';
            return (
              <button
                key={seat}
                className={`combat-chip${seat === lit ? ' combat-chip--lit' : ''}`}
                style={{ '--tint': seatTint(seat) } as CSSProperties}
                aria-pressed={seat === lit}
                aria-label={`attack ${name}${coming > 0 ? `, ${coming} attacking` : ''}`}
                onClick={() => aim.aimAt(fight.id, seat)}
              >
                <span className="combat-chip-name">{name}</span>
                <span className="combat-chip-n">⚔ {coming}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- blockers ----

/** The keyword marks a tile wears, short enough for a row of them. */
const MARKS: Record<CombatKeyword, string> = {
  flying: 'fly',
  reach: 'reach',
  menace: 'menace',
  'first strike': '1st',
  'double strike': '2×',
  deathtouch: 'death',
  lifelink: 'life',
  trample: 'tramp',
  vigilance: 'vig',
  indestructible: 'indes',
  infect: 'infect',
  toxic: 'toxic',
  defender: 'def',
};

/** Printed and handed out alike: a creature that has it, has it. */
function keywordMarks(read: UnitRead | null): { key: string; text: string; full: string }[] {
  if (!read) return [];
  const out = COMBAT_KEYWORDS.filter((k) => k !== 'toxic' && hasKeyword(read, k)).map((k) => ({
    key: k as string,
    text: MARKS[k],
    full: k as string,
  }));
  if (read.toxic > 0) out.push({ key: 'toxic', text: `toxic ${read.toxic}`, full: `toxic ${read.toxic}` });
  return out;
}

/** The art of a card or a stack as this device has it. */
function unitArt(game: GameState, seat: number, unit: CombatUnit, records: CardRecords): string | null {
  const player = game.players[seat];
  if (unit.kind === 'stack') return player?.board.find((it) => it.id === unit.id)?.imageNormal ?? null;
  const card = player?.cards?.battlefield.find((c) => c.iid === unit.id);
  return (card && records[card.cardId]?.imageNormal) || null;
}

/** What the large view shows for a card or a stack: the card's record, or
 * one made up from what a stack carries (tokens are not in the database). */
function zoomOf(
  game: GameState,
  seat: number,
  unit: CombatUnit,
  records: CardRecords,
): { name: string; record: CardRecord | null | undefined } | null {
  const player = game.players[seat];
  if (unit.kind === 'card') {
    const card = player?.cards?.battlefield.find((c) => c.iid === unit.id);
    return card ? { name: card.name, record: records[card.cardId] } : null;
  }
  const item = player?.board.find((it) => it.id === unit.id);
  if (!item) return null;
  return {
    name: item.name,
    record: {
      id: item.cardId ?? item.id,
      name: item.name,
      nameLower: item.name.toLowerCase(),
      typeLine: item.typeLine,
      oracleText: item.oracleText,
      manaCost: '',
      power: item.basePower === null ? null : String(item.basePower),
      toughness: item.baseToughness === null ? null : String(item.baseToughness),
      colors: [],
      imageNormal: item.imageNormal,
      imageArtCrop: item.imageArtCrop,
      isToken: true,
      isBasicLand: false,
    },
  };
}

/** Who is in an attack's way, for its tile. A stack attack is one tile:
 * "×n · k blocked". */
function inTheWay(game: GameState, tile: Incoming): string {
  const { attack } = tile;
  const blockers = attack.blockers ?? [];
  const copies = blockers.reduce((total, b) => total + copiesOf(b), 0);
  if (attack.unit.kind === 'stack') {
    const n = copiesOf(attack);
    return `×${n} · ${attack.blocked ? n : Math.min(n, copies)} blocked`;
  }
  const defender = game.players[attack.target];
  const names = blockers.map((b) => {
    const name =
      b.kind === 'card'
        ? defender?.cards?.battlefield.find((c) => c.iid === b.id)?.name
        : defender?.board.find((it) => it.id === b.id)?.name;
    return `${name ?? 'a creature'}${copiesOf(b) > 1 ? ` ×${copiesOf(b)}` : ''}`;
  });
  if (attack.blocked) names.push('✋ paper');
  return names.length > 0 ? `← ${names.join(', ')}` : 'not blocked';
}

function StripTile({
  tile,
  name,
  read,
  art,
  way,
  lit,
  onLight,
  onZoom,
}: {
  tile: Incoming;
  name: string;
  read: UnitRead | null;
  art: string | null;
  way: string;
  lit: boolean;
  onLight: () => void;
  onZoom: () => void;
}) {
  const press = useLongPress(onLight, onZoom);
  const size = !read || read.unread ? '?' : `${read.power}/${read.toughness}`;
  const marks = keywordMarks(read);
  return (
    <button
      className={`strip-tile${lit ? ' strip-tile--lit' : ''}`}
      aria-pressed={lit}
      aria-label={`attacker ${tile.no}: ${name}, ${size}${marks.length > 0 ? `, ${marks.map((m) => m.full).join(', ')}` : ''}, ${way.replace('← ', 'blocked by ')}`}
      title="Tap to block this one · hold to read it"
      {...press}
    >
      <span className="strip-no">{tile.no}</span>
      <span className="strip-art">{art ? <img src={art} alt="" loading="lazy" /> : null}</span>
      <span className="strip-text">
        <span className="strip-name">{name}</span>
        <span className="strip-size">
          <strong>{size}</strong>
          {marks.map((m) => (
            <i key={m.key} className="strip-mark">
              {m.text}
            </i>
          ))}
        </span>
        <span className="strip-way">{way}</span>
      </span>
    </button>
  );
}

function BlockersBar({ game, fight, defender }: { game: GameState; fight: CombatState; defender: number }) {
  const finishBlocks = useAppStore((s) => s.finishBlocks);
  const setAttackBlocked = useAppStore((s) => s.setAttackBlocked);
  const aim = useCombatAim();
  const records = useTableRecords();
  const [zoom, setZoom] = useState<CombatUnit | null>(null);
  const tiles = attacksAt(fight, defender);
  const lit = litAttack(fight, defender, aim.combatId === fight.id ? aim.attack : null);
  const stopped = attackersStopped(fight, defender);
  const attacker = readSeat(game, fight.active, records);
  const paper = lit?.attack.blocked === true;
  const shown = zoom ? zoomOf(game, fight.active, zoom, records) : null;
  return (
    <div className="combat-bar combat-bar--blockers" role="group" aria-label="combat">
      <div className="combat-line">
        <span className="combat-say">{barSentence(game, fight)}</span>
        <span className="combat-actions">
          <CancelButton asks />
          {/* For a blocker that is not on the tablet: the lit attacker is stopped by a paper card. */}
          <button
            className={`combat-paper${paper ? ' combat-paper--on' : ''}`}
            aria-pressed={paper}
            aria-label="the lit attacker is blocked by a card that is not on the tablet"
            disabled={!lit}
            onClick={() => lit && setAttackBlocked(defender, lit.attack.unit, !paper)}
          >
            Blocked ✋
          </button>
          <button className="primary combat-go" onClick={() => finishBlocks(defender)}>
            {stopped === 0 ? 'No blocks' : `Done (${stopped})`}
          </button>
        </span>
      </div>
      {/* ONE line of fixed height that scrolls sideways: it must never grow
          and re-size the cards under a finger. */}
      <div className="combat-strip" role="group" aria-label="attackers coming at you">
        {tiles.map((tile) => {
          const read = readUnit(game, fight.active, tile.attack.unit, records, attacker);
          const name = read?.name || zoomOf(game, fight.active, tile.attack.unit, records)?.name || 'Attacker';
          return (
            <StripTile
              key={tile.index}
              tile={tile}
              name={name}
              read={read}
              art={unitArt(game, fight.active, tile.attack.unit, records)}
              way={inTheWay(game, tile)}
              lit={tile.index === lit?.index}
              onLight={() => aim.light(fight.id, tile.index)}
              onZoom={() => setZoom(tile.attack.unit)}
            />
          );
        })}
      </div>
      {shown && <CardZoomSheet name={shown.name} record={shown.record} onClose={() => setZoom(null)} />}
    </div>
  );
}

// ---- damage ----

function DamageBar({ game, fight }: { game: GameState; fight: CombatState }) {
  const applyCombat = useAppStore((s) => s.applyCombat);
  const [reviewing, setReviewing] = useState(false);
  const [retry, setRetry] = useState(0);
  const records = useTableRecords(retry);
  // A late record changes sizes, and a late Whip of Erebos changes who
  // gains: until every card in the fight has answered, nothing is shown as
  // a result and nothing can be applied. A read that failed is asked again.
  const read = cardsRead(game, fight, records);
  useEffect(() => {
    if (read) return;
    const t = window.setInterval(() => setRetry((k) => k + 1), REREAD_MS);
    return () => window.clearInterval(t);
  }, [read]);
  const review = read ? reviewCombat(game, fight, records, NO_EDITS) : null;
  const name = (seat: number) => game.config.profiles[seat]?.name ?? '?';
  // A wrong death strips counters or sends a commander home, and a defeat
  // ends someone's game: those are confirmed in Review, where the list of
  // deaths is the confirmation. Plain damage keeps a one-tap Apply.
  const serious =
    !!review && (review.outcome.deaths.length > 0 || review.defeats.length > 0 || !!review.result.failed);
  const attacked = [...new Set((fight.attacks ?? []).map((a) => a.target))].length;
  return (
    <div className="combat-bar combat-bar--damage" role="group" aria-label="combat">
      <div className="combat-line">
        <span className="combat-say">{barSentence(game, fight)}</span>
        <span className="combat-actions">
          <CancelButton asks />
          {review && (
            <>
              <button className={`combat-review${serious ? ' primary combat-go' : ''}`} onClick={() => setReviewing(true)}>
                Review…
              </button>
              {!serious && (
                <button className="primary combat-go" onClick={() => applyCombat(review.outcome)}>
                  Apply
                </button>
              )}
            </>
          )}
        </span>
      </div>
      {/* Room for a line per defender from the start, so the result arriving does not move the cards. */}
      <ul className="combat-result" style={{ minHeight: `${Math.max(1, attacked) * 1.4}em` }}>
        {!review && <li className="combat-reading">Reading the cards…</li>}
        {review && resultLines(game, review.result).map((line, i) => <li key={`line-${i}`}>{line}</li>)}
        {review?.defeats.map((seat) => (
          <li key={`out-${seat}`} className="combat-flag combat-flag--defeat">
            this defeats {name(seat)}
          </li>
        ))}
        {review &&
          resultFlags(review.result).map((flag, i) => (
            <li key={`flag-${i}`} className="combat-flag">
              {flag}
            </li>
          ))}
      </ul>
      {reviewing && <CombatReviewSheet onClose={() => setReviewing(false)} />}
    </div>
  );
}

// ---- the bar ----

function Bar({ playerIdx }: { playerIdx: number }) {
  const game = useAppStore((s) => s.game);
  const fight = game ? liveCombat(game) : null;
  if (!game || !fight || actingSeat(fight) !== playerIdx) return null;
  if (fight.step === 'attackers') return <AttackersBar game={game} fight={fight} />;
  if (fight.step === 'blockers' && fight.defender !== undefined) {
    return <BlockersBar game={game} fight={fight} defender={fight.defender} />;
  }
  return <DamageBar game={game} fight={fight} />;
}

/** A fight that makes the bar throw must never become a crash loop that
 * only "Start fresh" — which deletes the save — can leave: the bar has a
 * boundary of its own, and what it falls back to is the way out. */
export class CombatBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('The combat bar failed', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="combat-bar combat-bar--broken" role="group" aria-label="combat">
        <div className="combat-line">
          <span className="combat-say">This fight cannot be shown.</span>
          <span className="combat-actions">
            <button className="danger" onClick={() => useAppStore.getState().cancelCombat()}>
              Cancel combat
            </button>
          </span>
        </div>
      </div>
    );
  }
}

interface Props {
  playerIdx: number;
}

/** The combat bar, in the zone of the seat whose move it is: who is
 * picking what, the buttons that move the fight on, the attackers coming
 * at a defender, and at the end the damage. It is shared table state, not
 * a layer: nothing here touches the back button. */
export default function CombatBar({ playerIdx }: Props) {
  return (
    <CombatBoundary>
      <Bar playerIdx={playerIdx} />
    </CombatBoundary>
  );
}
