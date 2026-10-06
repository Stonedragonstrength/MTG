import {
  effectiveManaColors,
  isOneShotSource,
  isOneShotText,
  tapManaFromText,
  type ManaColor,
} from './mana';
import type { BoardItem, CardInstance, CardRecord } from './types';

/** A cost split for payment: generic count plus one entry per colored
 * pip, each listing the colors that satisfy it (hybrids list two). */
export interface PayCost {
  generic: number;
  pips: ManaColor[][];
}

/** One thing a seat can draw mana from right now: a virtual card (key =
 * iid) or one copy of a board stack (key = item id; copies repeat it). */
export interface ManaSource {
  key: string;
  kind: 'virtual' | 'board';
  produces: (ManaColor | 'any')[];
  /** Units on offer: a fresh Sol Ring has 2, a tapped one whatever is left. */
  amount: number;
  /** Already tapped by hand — its unspent mana is sitting in the pool. */
  floating?: boolean;
  /** Creatures pay last (they may be summoning sick, or needed to attack). */
  creature?: boolean;
}

/** What the payment does: units to draw from each virtual card (tapping it
 * if it is not already), and copies to tap per board stack. */
export interface PaymentPlan {
  spend: Record<string, number>;
  boardTaps: Record<string, number>;
}

const COLOR_SET = new Set(['W', 'U', 'B', 'R', 'G', 'C']);

/** {3}{G}{G} → 3 generic + two G pips. X pays zero; hybrid {G/W} accepts
 * either side; {2/W} and phyrexian {G/P} approximate to their color;
 * {C} stays strict (an any-color source cannot make colorless). */
export function parseCost(manaCost: string): PayCost {
  let generic = 0;
  const pips: ManaColor[][] = [];
  for (const [, symbol] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    if (/^\d+$/.test(symbol)) {
      generic += Number(symbol);
      continue;
    }
    if (symbol.includes('X')) continue; // X is chosen at cast: tap for it yourself
    const colors = symbol.split('/').filter((part) => COLOR_SET.has(part)) as ManaColor[];
    if (colors.length > 0) pips.push(colors);
    else generic += 1; // snow and friends: close enough to generic
  }
  return { generic, pips };
}

function canPay(s: ManaSource, pip: ManaColor[]): boolean {
  if (s.produces.includes('any') && pip.some((c) => c !== 'C')) return true; // any color ≠ colorless
  return s.produces.some((p) => p !== 'any' && pip.includes(p));
}

/** Lower pays first: mana already floating, then colorless-only sources
 * (they can never cover a colored pip), then the least flexible — so duals
 * and any-color lands stay open. Creatures go last. */
function rank(s: ManaSource): number {
  const flexibility = s.produces.includes('any') ? 9 : s.produces.length;
  const onlyColorless = s.produces.length === 1 && s.produces[0] === 'C';
  return (s.floating ? 0 : 1000) + (s.creature ? 100 : 0) + (onlyColorless ? 0 : 10) + flexibility;
}

/** Colored pips are matched with augmenting paths, so an assignment is
 * found whenever one exists; generic then fills from what is left,
 * preferring to drain a source whole over leaving it half-used. Null
 * when the seat cannot pay. */
export function planPayment(cost: PayCost, sources: ManaSource[]): PaymentPlan | null {
  const pool = [...sources].sort((a, b) => rank(a) - rank(b));
  const left = pool.map((s) => s.amount);
  const used = pool.map(() => 0);

  // pip index held by each unit of each source
  const holder: number[][] = pool.map((s) => new Array<number>(s.amount).fill(-1));
  const tryPip = (pip: number, seen: Set<string>): boolean => {
    for (let s = 0; s < pool.length; s++) {
      if (!canPay(pool[s], cost.pips[pip])) continue;
      for (let u = 0; u < holder[s].length; u++) {
        const id = `${s}:${u}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (holder[s][u] === -1 || tryPip(holder[s][u], seen)) {
          holder[s][u] = pip;
          return true;
        }
      }
    }
    return false;
  };
  for (let pip = 0; pip < cost.pips.length; pip++) {
    if (!tryPip(pip, new Set())) return null;
  }
  holder.forEach((units, s) => {
    used[s] = units.filter((p) => p !== -1).length;
    left[s] -= used[s];
  });

  let generic = cost.generic;
  const take = (s: number, n: number) => {
    used[s] += n;
    left[s] -= n;
    generic -= n;
  };
  // 1) mana that is spent or lost anyway: floating, or left on a source a pip opened
  for (let s = 0; s < pool.length && generic > 0; s++) {
    if (left[s] > 0 && (pool[s].floating || used[s] > 0)) take(s, Math.min(left[s], generic));
  }
  // 2) fresh sources that the remaining cost drains completely
  for (let s = 0; s < pool.length && generic > 0; s++) {
    if (left[s] > 0 && left[s] <= generic) take(s, left[s]);
  }
  // 3) whatever is left breaks open one more source
  for (let s = 0; s < pool.length && generic > 0; s++) {
    if (left[s] > 0) take(s, Math.min(left[s], generic));
  }
  if (generic > 0) return null;

  const plan: PaymentPlan = { spend: {}, boardTaps: {} };
  pool.forEach((s, i) => {
    if (used[i] === 0) return;
    if (s.kind === 'virtual') plan.spend[s.key] = (plan.spend[s.key] ?? 0) + used[i];
    else plan.boardTaps[s.key] = (plan.boardTaps[s.key] ?? 0) + 1;
  });
  return plan;
}

export function affordable(cost: PayCost, sources: ManaSource[]): boolean {
  return planPayment(cost, sources) !== null;
}

/** Every unit the seat could spend right now — the number the table reads. */
export function availableMana(sources: ManaSource[]): number {
  return sources.reduce((sum, s) => sum + s.amount, 0);
}

const BASIC_COLOR: Record<string, ManaColor> = {
  plains: 'W',
  island: 'U',
  swamp: 'B',
  mountain: 'R',
  forest: 'G',
};

/** Mana abilities other permanents hand to your creatures: Cryptolith
 * Rite's quoted `{T}: Add …`, and Ashaya making them basic lands. */
function grantsFrom(texts: string[]): { all: (ManaColor | 'any')[]; nontoken: (ManaColor | 'any')[] } {
  const all: (ManaColor | 'any')[] = [];
  const nontoken: (ManaColor | 'any')[] = [];
  const add = (into: (ManaColor | 'any')[], colors: (ManaColor | 'any')[]) => {
    for (const c of colors) if (!into.includes(c)) into.push(c);
  };
  for (const text of texts) {
    const quoted = text.match(/creatures you control have "([^"]*)"/i);
    if (quoted) add(all, tapManaFromText(quoted[1]).produces);
    const landed = text.match(
      /(nontoken )?creatures you control are (plains|island|swamp|mountain|forest) lands/i,
    );
    if (landed) add(landed[1] ? nontoken : all, [BASIC_COLOR[landed[2].toLowerCase()]]);
  }
  return { all, nontoken: [...nontoken, ...all.filter((c) => !nontoken.includes(c))] };
}

/** Everything a seat can draw mana from right now. Untapped mana cards
 * are fresh sources; a card you tapped by hand floats whatever nothing has
 * spent yet. Board stacks offer their untapped copies. Sacrifice-for-mana
 * permanents stay manual — a payment never eats a permanent. */
export function sourcesFrom(
  battlefield: CardInstance[],
  records: Record<string, CardRecord | null | undefined>,
  board: BoardItem[],
): ManaSource[] {
  const granted = grantsFrom(
    battlefield.map((c) => records[c.cardId]?.oracleText ?? '').filter((t) => t !== ''),
  );
  const out: ManaSource[] = [];

  for (const c of battlefield) {
    const record = records[c.cardId];
    if (!record) continue; // unresolved: its text is not readable yet
    if (isOneShotText(record.oracleText)) continue;
    const creature = /Creature/.test(record.typeLine);
    const own = tapManaFromText(record.oracleText);
    const produces = [...own.produces];
    if (creature) for (const g of granted.nontoken) if (!produces.includes(g)) produces.push(g);
    if (produces.length === 0) continue;
    const total = Math.max(own.amount, 1);
    const amount = c.tapped ? total - (c.spent ?? 0) : total;
    if (amount <= 0) continue;
    out.push({
      key: c.iid,
      kind: 'virtual',
      produces,
      amount,
      ...(c.tapped ? { floating: true } : {}),
      ...(creature ? { creature: true } : {}),
    });
  }

  for (const item of board) {
    if (isOneShotSource(item)) continue;
    const creature = /Creature/.test(item.typeLine);
    const produces = [...effectiveManaColors(item)];
    if (creature && item.manaMode !== 'none')
      for (const g of granted.all) if (!produces.includes(g)) produces.push(g);
    if (produces.length === 0) continue;
    const ready = item.count - (item.tapped ?? 0);
    for (let i = 0; i < ready; i++) {
      out.push({
        key: item.id,
        kind: 'board',
        produces,
        amount: 1,
        ...(creature ? { creature: true } : {}),
      });
    }
  }
  return out;
}
