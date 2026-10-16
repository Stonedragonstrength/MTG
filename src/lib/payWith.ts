import { COLOR_NAMES, type ManaColor } from './mana';
import { canPay, planPayment, sourcesFor, type ManaSource, type PayCost, type PaymentPlan } from './pay';
import { countersTaken, type Taken } from './storedMana';

// "Pay with…": the player says which lands pay, instead of the table.
// What the sheet shows and what the store taps are both worked out here,
// from the same sources the automatic payment reads (pay.sourcesFrom).

/** Mana sources the player sees as one thing — five Forests, a Sol Ring.
 * Its members are interchangeable: paying with two of them is paying with
 * any two. */
export interface PayGroup {
  id: string;
  kind: 'virtual' | 'board';
  /** In table order. A stack's copies all carry the stack's key. */
  members: ManaSource[];
  produces: (ManaColor | 'any')[];
  /** Mana one of them gives. */
  each: number;
  /** Already tapped by hand: this is mana in the pool, not a fresh tap. */
  floating: boolean;
  creature: boolean;
}

/** How many of each group pay: group id → count. */
export type Picked = Record<string, number>;

/** The sources sorted into what the player sees as one thing. `sameAs`
 * names the card behind a source (its card id, a stack's id): two sources
 * of one card that give the same mana in the same state stand together. */
export function groupSources(sources: ManaSource[], sameAs: (s: ManaSource) => string): PayGroup[] {
  const groups = new Map<string, PayGroup>();
  for (const s of sources) {
    const id = [s.kind, sameAs(s), s.amount, s.floating ? 'pool' : 'fresh', s.produces.join('')].join('|');
    const group = groups.get(id);
    if (group) group.members.push(s);
    else
      groups.set(id, {
        id,
        kind: s.kind,
        members: [s],
        produces: s.produces,
        each: s.amount,
        floating: s.floating === true,
        creature: s.creature === true,
      });
  }
  return [...groups.values()];
}

const within = (group: PayGroup, n: number | undefined) =>
  Math.max(0, Math.min(group.members.length, Math.floor(n ?? 0)));

/** The sources that are lit. */
export function chosenSources(groups: PayGroup[], picked: Picked): ManaSource[] {
  return groups.flatMap((group) => group.members.slice(0, within(group, picked[group.id])));
}

/** What the table itself would light for this plan. */
export function pickedFromPlan(groups: PayGroup[], plan: PaymentPlan | null): Picked {
  const picked: Picked = {};
  if (!plan) return picked;
  for (const group of groups) {
    const n =
      group.kind === 'virtual'
        ? group.members.filter((s) => (plan.spend[s.key] ?? 0) > 0).length
        : within(group, plan.boardTaps[group.members[0].key]);
    if (n > 0) picked[group.id] = n;
  }
  return picked;
}

/** The lit sources as the store is told them: source key → how many (a
 * card is one; a stack, the copies of it). */
export function usingOf(groups: PayGroup[], picked: Picked): Record<string, number> {
  const using: Record<string, number> = {};
  for (const s of chosenSources(groups, picked)) using[s.key] = (using[s.key] ?? 0) + 1;
  return using;
}

/** The sources a payment was told to use, as far as they are still there. */
export function sourcesUsing(sources: ManaSource[], using: Record<string, number>): ManaSource[] {
  const left = { ...using };
  return sources.filter((s) => {
    if (!((left[s.key] ?? 0) > 0)) return false;
    left[s.key] -= 1;
    return true;
  });
}

/** What the lit sources come to against a cost. */
export interface Tally {
  /** What the cost asks, in mana. */
  of: number;
  /** How much of it the lit sources cover. */
  paid: number;
  /** Colored pips nothing lit can pay. */
  missing: ManaColor[][];
  /** Lit sources the cost has no use for. */
  idle: number;
  /** Mana left over on the sources it does use. */
  spare: number;
  /** How the lit sources pay it; null while they cannot. */
  plan: PaymentPlan | null;
}

/** Which colored pips the sources can pay at the same time: as many as
 * possible (augmenting paths, one slot per unit of mana). */
function matchPips(cost: PayCost, sources: ManaSource[]): { matched: number; missing: ManaColor[][] } {
  const slots = sources.flatMap((s) => new Array<ManaSource>(s.amount).fill(s));
  const holder = slots.map(() => -1);
  const tryPip = (pip: number, seen: Set<number>): boolean => {
    for (let i = 0; i < slots.length; i++) {
      if (seen.has(i) || !canPay(slots[i], cost.pips[pip])) continue;
      seen.add(i);
      if (holder[i] === -1 || tryPip(holder[i], seen)) {
        holder[i] = pip;
        return true;
      }
    }
    return false;
  };
  const missing: ManaColor[][] = [];
  cost.pips.forEach((pip, i) => {
    if (!tryPip(i, new Set())) missing.push(pip);
  });
  return { matched: cost.pips.length - missing.length, missing };
}

export function tally(cost: PayCost, chosen: ManaSource[]): Tally {
  const of = cost.generic + cost.pips.length;
  // Mana kept for other spells ("Spend this mana only…") does not count toward this one.
  const usable = sourcesFor(chosen, cost.on);
  const units = usable.reduce((sum, s) => sum + s.amount, 0);
  const plan = planPayment(cost, chosen);
  if (!plan) {
    const { matched, missing } = matchPips(cost, usable);
    const paid = matched + Math.min(cost.generic, units - matched);
    return { of, paid, missing, idle: 0, spare: 0, plan: null };
  }
  let idle = 0;
  let spare = 0;
  const copies: Record<string, number> = {};
  const makes = new Map(usable.map((s) => [s.key, s.amount]));
  for (const s of chosen) {
    if (s.kind === 'board') {
      copies[s.key] = (copies[s.key] ?? 0) + 1;
      continue;
    }
    const spent = plan.spend[s.key] ?? 0;
    if (spent === 0) idle += 1;
    // Counters it did not need stay on the card, not in the pool.
    else if (!s.stored) spare += (makes.get(s.key) ?? s.amount) - spent;
  }
  for (const [key, n] of Object.entries(copies)) idle += n - (plan.boardTaps[key] ?? 0);
  return { of, paid: of, missing: [], idle, spare, plan };
}

const listed = (words: string[]) =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

const pipWords = (pips: ManaColor[][]) => [
  ...new Set(pips.map((pip) => pip.map((c) => COLOR_NAMES[c]).join(' or '))),
];

/** The line under "3 of 3 paid": what is still missing, what is too much,
 * or that the colors are covered. */
export function tallyWords(cost: PayCost, t: Tally): string {
  if (!t.plan) {
    const short = `${t.of - t.paid} more to go`;
    return t.missing.length > 0 ? `${short} · still needs ${listed(pipWords(t.missing))}` : short;
  }
  if (t.idle > 0) return `${t.idle} more than it needs`;
  if (t.spare > 0) return `${t.spare} left over stays in your pool`;
  const colors = pipWords(cost.pips);
  if (colors.length === 0) return '';
  return `${listed(colors)} ${colors.length > 1 ? 'are' : 'is'} covered`;
}

/** What a payment with chosen sources does to each of them. Where they
 * pay the cost, each is drawn on as that plan says and a lit source the
 * cost had no use for is only tapped (its mana floats). Where they cannot
 * pay it — a cost the table reads too high, a reducer on the board — they
 * are spent whole: the player said these pay for it. Counters a card keeps
 * mana in come off as far as they are drawn on (`taken`); one the cost had
 * no use for keeps them. */
export function payWith(
  costs: PayCost[],
  chosen: ManaSource[],
): { spend: Record<string, number>; tap: string[]; boardTaps: Record<string, number>; taken?: Taken[] } {
  let plan: PaymentPlan | null = null;
  for (const cost of costs) {
    const t = tally(cost, chosen);
    // The face these sources pay exactly; failing that, the first they pay at all.
    if (t.plan && t.idle === 0) {
      plan = t.plan;
      break;
    }
    plan ??= t.plan;
  }
  const taken: Taken[] = [...(plan?.taken ?? [])];
  const out: { spend: Record<string, number>; tap: string[]; boardTaps: Record<string, number>; taken?: Taken[] } = {
    spend: {},
    tap: [],
    boardTaps: {},
  };
  for (const s of chosen) {
    if (s.kind === 'board') {
      out.boardTaps[s.key] = (out.boardTaps[s.key] ?? 0) + 1;
      continue;
    }
    const spent = plan ? (plan.spend[s.key] ?? 0) : s.amount;
    // Mana its counters make without a tap: nothing to tap, only counters to take.
    const apart = !!s.stored && s.key !== s.stored.iid;
    if (spent > 0) out.spend[s.key] = spent;
    else if (!s.floating && !apart) out.tap.push(s.key);
    if (!plan && s.stored) {
      const n = countersTaken(s.stored, s.amount, []);
      if (n > 0) taken.push({ iid: s.stored.iid, kind: s.stored.kind, n, ...(s.stored.goes ? { goes: true as const } : {}) });
    }
  }
  if (taken.length > 0) out.taken = taken;
  return out;
}
