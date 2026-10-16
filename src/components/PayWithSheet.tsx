import { useEffect, useState } from 'react';
import { commanderTax } from '../lib/cards';
import { countersWords } from '../lib/entering';
import { COLOR_NAMES, type ManaColor } from '../lib/mana';
import {
  affordable,
  castCosts,
  extraCosts,
  extraTimes,
  hasX,
  planPayment,
  priceExtras,
  priceX,
  sourcesFor,
  type ManaSource,
  type PayCost,
} from '../lib/pay';
import {
  chosenSources,
  groupSources,
  pickedFromPlan,
  tally,
  tallyWords,
  usingOf,
  type PayGroup,
  type Picked,
} from '../lib/payWith';
import { seatSources } from '../lib/seatMana';
import { spendWords } from '../lib/spendOnly';
import type { BoardItem, CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import ManaSymbol, { CostSymbols } from './ManaSymbol';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';

interface Props {
  playerIdx: number;
  iid: string;
  /** Where the card is cast from: the hand, or the command zone. */
  from: 'hand' | 'command';
  /** What the cast sheet was already told: X, and the extra costs paid. */
  x?: number;
  extras?: number[];
  /** Back to the sheet this one took the place of; left out, Back closes. */
  onBack?: () => void;
  onClose: () => void;
}

const NUMBER_WORDS: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' };

/** What one of them taps for: "G", "G or U", two colorless for a Sol Ring. */
function Makes({ group }: { group: Pick<PayGroup, 'produces' | 'each'> }) {
  if (group.produces.includes('any'))
    return (
      <span className="pay-makes">
        <ManaSymbol symbol="any" label="makes any color" />
      </span>
    );
  const colors = group.produces as ManaColor[];
  const shown = colors.length === 1 ? new Array<ManaColor>(group.each).fill(colors[0]) : colors;
  // Three or more (Dreadship Reef's {C}, {U}, {B}): side by side, so the name keeps its room.
  const or = colors.length === 2;
  return (
    <span className="pay-makes">
      {shown.map((c, i) => (
        <span className="pay-makes" key={i}>
          {or && i > 0 && <span className="pay-or">or</span>}
          <ManaSymbol symbol={c} label={`makes ${COLOR_NAMES[c]}`} />
        </span>
      ))}
    </span>
  );
}

/** "Pay with…": the player says which lands pay for a spell, instead of
 * the table. Every mana source of the seat is a tile; the ones the table
 * would tap are lit to begin with, and what is lit when Cast is pressed is
 * what taps — no more and no less, also where that is not what the card
 * says it costs (a cost reducer on the board, mana left floating on
 * purpose). */
export default function PayWithSheet({ playerIdx, iid, from, x, extras, onBack, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const playCard = useAppStore((s) => s.playCard);
  const castCommander = useAppStore((s) => s.castCommander);
  // null: as the table would pay. The first change makes it the player's own.
  const [mine, setMine] = useState<Picked | null>(null);
  const player = game?.players[playerIdx];
  const seat = player?.cards;
  const card = seat?.[from].find((c) => c.iid === iid);
  const records = useCardRecords([...(card ? [card] : []), ...(seat?.battlefield ?? [])]);
  // Cast from another device, discarded, drawn away: really close.
  const gone = !card;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!player || !seat || !card) return null;

  const record = records[card.cardId];
  const tax = from === 'command' ? commanderTax(player, card.iid) : 0;
  // The same reading of the cost and of the mana as the store's payment.
  const faces = castCosts(record, from, tax);
  const asksX = hasX(faces);
  const kinds = from === 'hand' ? extraCosts(record) : [];
  const times = extraTimes(kinds, extras);
  const priced = priceExtras(priceX(faces, asksX ? (x ?? 0) : 0), kinds, times);
  const sources = seatSources(game, playerIdx, records);
  // The face the table would pay: the first it can afford, like the store.
  const cost: PayCost = priced.find((face) => affordable(face, sources)) ?? priced[0] ?? { generic: 0, pips: [] };

  // Mana a card's counters make apart from its tap has a key of its own: `stored.iid` is the card.
  const cardOf = (s: ManaSource): CardInstance | undefined =>
    s.kind === 'virtual' ? seat.battlefield.find((c) => c.iid === (s.stored?.iid ?? s.key)) : undefined;
  const stackOf = (s: ManaSource): BoardItem | undefined =>
    s.kind === 'board' ? player.board.find((it) => it.id === s.key) : undefined;
  const sameAs = (s: ManaSource) => {
    const one = cardOf(s);
    return one ? (one.iid === s.key ? one.cardId : `${one.cardId}#counters`) : s.key;
  };
  // Lands first, then rocks, creatures last — the order a player reaches for them.
  const shelf = (group: PayGroup) => {
    if (group.creature) return 2;
    const first = group.members[0];
    const typeLine = stackOf(first)?.typeLine ?? records[cardOf(first)?.cardId ?? '']?.typeLine ?? '';
    return /\bLand\b/.test(typeLine) ? 0 : 1;
  };
  const inOrder = (all: PayGroup[]) =>
    all.map((group, i) => ({ group, i })).sort((a, b) => shelf(a.group) - shelf(b.group) || a.i - b.i).map((x) => x.group);
  const groups = inOrder(groupSources(sources, sameAs));
  const picked = mine ?? pickedFromPlan(groups, planPayment(cost, sources));
  const chosen = chosenSources(groups, picked);
  const count = tally(cost, chosen);
  const paid = count.plan !== null;

  // What has no mana left to give, shown so nobody looks for it: every
  // source the seat would have with all of it untapped, less the live ones.
  const untapped = seatSources(game, playerIdx, records, {
    battlefield: seat.battlefield.map(({ tapped: _t, spent: _s, ...c }) => c),
    board: player.board.map((it) => (it.tapped ? { ...it, tapped: 0 } : it)),
  });
  const live: Record<string, number> = {};
  for (const s of sources) live[s.key] = (live[s.key] ?? 0) + 1;
  const spent = inOrder(
    groupSources(
      untapped.filter((s) => {
        if ((live[s.key] ?? 0) === 0) return true;
        live[s.key] -= 1;
        return false;
      }),
      sameAs,
    ),
  );

  const face = (group: PayGroup) => {
    const first = group.members[0];
    const one = cardOf(first);
    const stack = stackOf(first);
    const read = one ? records[one.cardId] : null;
    return {
      name: one?.name ?? stack?.name ?? 'Mana',
      art: one ? (read?.imageArtCrop ?? read?.imageNormal ?? null) : (stack?.imageArtCrop ?? stack?.imageNormal ?? null),
    };
  };
  const set = (group: PayGroup, n: number) =>
    setMine({ ...picked, [group.id]: Math.max(0, Math.min(group.members.length, n)) });

  function cast() {
    const using = usingOf(groups, picked);
    if (from === 'command') castCommander(playerIdx, iid, { ...(asksX ? { x: x ?? 0 } : {}), using });
    else
      void playCard(playerIdx, iid, {
        ...(asksX ? { x: x ?? 0 } : {}),
        ...(kinds.length > 0 ? { extras: times } : {}),
        using,
      });
    onClose();
  }

  const short = card.name.split(' // ')[0].split(',')[0];
  const words = tallyWords(cost, count);

  return (
    <Sheet
      title={`Pay for ${card.name}`}
      size="roomy"
      onClose={onClose}
      footer={
        <div className="pay-foot">
          <div className="pay-tally" aria-live="polite">
            <span className={paid && count.idle === 0 ? 'pay-paid' : 'pay-paid pay-paid--short'}>
              {count.of > 0 ? `${count.paid} of ${count.of} paid` : 'Nothing to pay'}
            </span>
            {words && <span className="pay-sub">{words}</span>}
          </div>
          <button className="ghost" onClick={() => (onBack ? onBack() : onClose())}>
            Back
          </button>
          <button className="primary" onClick={cast}>
            {paid ? `Cast ${short}` : 'Cast anyway'}
          </button>
        </div>
      }
    >
      <div className="pay-head">
        <span className="pay-cost">
          costs <CostSymbols cost={cost} />
          {tax > 0 && <span className="pay-or">tax +{tax} included</span>}
        </span>
        {mine !== null && (
          <button className="chip" onClick={() => setMine(null)}>
            Back to the app’s pick
          </button>
        )}
      </div>
      <p className="pay-hint">
        {!record
          ? 'The app cannot read what this card costs. Light what pays for it.'
          : groups.length === 0
            ? 'Nothing here has mana to give right now.'
            : 'The gold ones are what taps when you cast. They start as the app’s pick; change them to pay your way.'}
      </p>
      <div className="pay-tiles">
        {groups.map((group) => {
          const { name, art } = face(group);
          const n = Math.min(group.members.length, picked[group.id] ?? 0);
          const many = group.members.length > 1;
          // Mana kept for some spells ("Spend this mana only…"): what it makes for this one.
          const only = group.members[0].only;
          const here = only ? sourcesFor(group.members.slice(0, 1), cost.on)[0] : group.members[0];
          // Cavern of Souls makes {C} for anything: "any color only to cast a creature spell…".
          const free = group.members[0].free;
          const more = !free
            ? ''
            : group.produces.includes('any') && !free.produces.includes('any')
              ? 'any color '
              : group.each > free.amount
                ? `${NUMBER_WORDS[group.each] ?? group.each} `
                : '';
          // Mana saved up as counters: how many it has (Dreadship Reef, a Mana Battery).
          const stored = group.members[0].stored;
          const saved = stored ? countersWords({ [stored.kind]: cardOf(group.members[0])?.counters?.[stored.kind] ?? 0 }) : '';
          const note = only
            ? [`${more}only ${spendWords(only)}`, saved].filter(Boolean).join(' · ')
            : saved
              ? saved
              : group.floating
                ? 'tapped · mana in your pool'
                : group.creature
                  ? 'creature'
                  : null;
          const tile = ['pay-tile', n > 0 && 'pay-tile--lit', !here && 'pay-tile--kept'].filter(Boolean).join(' ');
          const top = (
            <span className="pay-top">
              {art ? <img className="pay-art" src={art} alt="" loading="lazy" /> : <span className="pay-art" />}
              <span className="pay-name">
                {name}
                {many && <small> ×{group.members.length}</small>}
                {note && <small className="pay-note">{note}</small>}
              </span>
              <Makes group={here ? { produces: here.produces, each: here.amount } : group} />
            </span>
          );
          return many ? (
            <div key={group.id} className={tile}>
              {top}
              <span className="pay-step">
                <button aria-label={`one fewer ${name}`} disabled={n === 0} onClick={() => set(group, n - 1)}>
                  −
                </button>
                <span className="pay-say">{n > 0 ? `paying with ${n}` : 'not used'}</span>
                <button
                  aria-label={`one more ${name}`}
                  disabled={n >= group.members.length}
                  onClick={() => set(group, n + 1)}
                >
                  +
                </button>
              </span>
            </div>
          ) : (
            <button
              key={group.id}
              className={tile}
              aria-pressed={n > 0}
              aria-label={`pay with ${name}`}
              onClick={() => set(group, n > 0 ? 0 : 1)}
            >
              {top}
              <span className="pay-say">{n > 0 ? 'paying with it · tap to leave it' : 'not used · tap to pay with it'}</span>
            </button>
          );
        })}
        {spent.map((group) => {
          const { name, art } = face(group);
          return (
            <div key={`spent ${group.id}`} className="pay-tile pay-tile--spent">
              <span className="pay-top">
                {art ? <img className="pay-art" src={art} alt="" loading="lazy" /> : <span className="pay-art" />}
                <span className="pay-name">
                  {name}
                  {group.members.length > 1 && <small> ×{group.members.length}</small>}
                </span>
              </span>
              <span className="pay-say">already tapped</span>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
