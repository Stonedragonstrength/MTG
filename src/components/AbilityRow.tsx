import { useState } from 'react';
import { abilityBlocked, costWords, loyaltyWords, type Ability } from '../lib/abilities';
import { affordable, maxX, withX, type ManaSource } from '../lib/pay';
import type { CardInstance } from '../lib/types';
import { useAppStore } from '../state/store';
import ManaSymbol, { CostSymbols } from './ManaSymbol';

/** How the ability is to be paid, as its row was pressed. */
export interface AbilityUse {
  x?: number;
  free?: boolean;
}

/** One of a card's abilities: what it costs, what it does, and Use — paid
 * from the lands as it is done ("Use without paying" while the mana is short,
 * as equipping does), with the rest of its cost (a sacrifice, counters,
 * loyalty) said beside the mana. X is asked on the row. A Discover hands the
 * press to `onDiscover`: the cards are turned over first, and the cost is
 * paid with the answer. */
export default function AbilityRow({
  playerIdx,
  card,
  ability,
  sources,
  onDiscover,
}: {
  playerIdx: number;
  card: CardInstance;
  ability: Ability;
  sources: ManaSource[];
  onDiscover?: (use: AbilityUse) => void;
}) {
  const activateAbility = useAppStore((s) => s.activateAbility);
  // A card tapped or sacrificed for its own ability pays nothing towards it.
  const own = ability.tap || ability.sacrifice ? sources.filter((s) => s.key !== card.iid) : sources;
  const [x, setX] = useState(() => (ability.cost.x ? maxX(ability.cost, own) : 0));
  const blocked = abilityBlocked(ability, card);
  const short = !affordable(withX(ability.cost, x), own);
  const xs = ability.cost.x ?? 0;
  const words = costWords(ability);
  const mana = ability.cost.generic > 0 || ability.cost.pips.length > 0;
  const bare = xs === 0 && !ability.tap && ability.loyalty === undefined && words.length === 0;
  const use: AbilityUse = { ...(xs > 0 ? { x } : {}), ...(short ? { free: true } : {}) };
  return (
    <div className="ability-row">
      <span className="ability-cost" aria-label="cost">
        {ability.loyalty !== undefined && (
          <span className="ability-loyalty" aria-label={`loyalty ${loyaltyWords(ability.loyalty)}`}>
            {loyaltyWords(ability.loyalty)}
          </span>
        )}
        {Array.from({ length: xs }, (_, i) => (
          <ManaSymbol key={i} symbol="X" label="X" />
        ))}
        {(mana || bare) && <CostSymbols cost={ability.cost} />}
        {ability.tap && <ManaSymbol symbol="T" label="tap it" />}
        {words.length > 0 && <span className="ability-also">{words.join(', ')}</span>}
      </span>
      <span className="ability-label">
        {ability.effect.kind === 'level' ? `Level up · now level ${card.counters?.level ?? 0}` : ability.label}
      </span>
      {xs > 0 && (
        <span className="stepper">
          <button aria-label="less X" onClick={() => setX((n) => Math.max(0, n - 1))}>
            −
          </button>
          <span>X={x}</span>
          <button aria-label="more X" onClick={() => setX((n) => n + 1)}>
            +
          </button>
        </span>
      )}
      <button
        className={short && !blocked ? 'chip ability-use ability-use--free' : 'chip ability-use'}
        disabled={!!blocked}
        title={blocked ?? (short ? 'Not enough mana ready' : undefined)}
        onClick={() =>
          ability.effect.kind === 'discover' && onDiscover
            ? onDiscover(use)
            : void activateAbility(playerIdx, card.iid, ability.key, use)
        }
      >
        {blocked ?? (short ? 'Use without paying' : 'Use')}
      </button>
    </div>
  );
}
