import { isEquipment } from './attach';
import { isCommander, type Host } from './cards';
import { parseCost, type PayCost } from './pay';
import { spendOnCard } from './spendOnly';
import type { CardRecord, GameState } from './types';

/** What it costs to put an Equipment on a creature, as the card prints it:
 * "Equip {2}". The paying is the table's (store `equipCard`, with the same
 * machinery that pays for a spell); taking an Equipment off costs nothing,
 * and an Aura is paid for when it is cast, not when it is attached. */

type Read = (Pick<CardRecord, 'typeLine' | 'oracleText'> & Partial<Pick<CardRecord, 'manaCost' | 'colors'>>) | null | undefined;

/** One equip ability of a card. */
export interface EquipWay {
  /** The cost as printed: "{2}", "{1}{W}". */
  printed: string;
  cost: PayCost;
  /** Whom it is for, when it is not for every creature: "legendary
   * creature", "commander", "Shaman, Warlock, or Wizard". */
  only: string | null;
}

// "Equip {2}", "Equip legendary creature {3}", "Reconfigure {2}" — a line
// of its own that ends with the cost (reminder text may follow). "Equip
// abilities you activate cost {1} less" goes on after its cost: not this.
const EQUIP_LINE = /^(?:Equip|Reconfigure)(?: ([A-Za-z][A-Za-z ,'-]*?))? ?((?:\{[^}]+\})+)\s*(?:\(|$)/i;

/** The equip abilities on the card's FRONT face, in the order printed. Only
 * an Equipment has any. One the table cannot price is left out — a cost
 * that is not mana ("Equip—Pay 3 life"), or one with {X} in it: the card
 * then goes on for nothing, as it always did. */
export function equipWays(record: Read): EquipWay[] {
  if (!record || !isEquipment(record)) return [];
  const out: EquipWay[] = [];
  for (const line of record.oracleText.split('\n//\n')[0].split('\n')) {
    const m = line.trim().match(EQUIP_LINE);
    if (!m) continue;
    const cost = parseCost(m[2]);
    if (cost.x) continue; // nobody has said what X is
    // Its mana may be kept for it: "Spend this mana only to … activate an equip ability".
    const on = spendOnCard({ ...record, manaCost: record.manaCost ?? '' }, 'ability', 0, { equip: true });
    out.push({ printed: m[2], cost: { ...cost, on }, only: m[1]?.trim() || null });
  }
  return out;
}

/** What the table knows of a creature an Equipment may go on. */
export interface EquipHost {
  typeLine?: string | null;
  commander?: boolean;
}

/** May that host use a way that is only for some creatures? Each of the
 * kinds it names ("Shaman, Warlock, or Wizard") is read off the host's type
 * line, word for word; "commander" off the seat. */
function fits(only: string, host: EquipHost): boolean {
  const type = (host.typeLine ?? '').split(' // ')[0].toLowerCase();
  return only
    .toLowerCase()
    .split(/,\s*(?:or\s+)?|\s+or\s+/)
    .filter((kind) => kind !== '')
    .some((kind) =>
      kind.split(/\s+/).every((word) => (word === 'commander' ? host.commander === true : new RegExp(`\\b${word}\\b`).test(type))),
    );
}

/** A host on the table, as far as an equip ability asks about it. */
export function equipHost(
  g: GameState,
  host: Host,
  records: Record<string, Pick<CardRecord, 'typeLine'> | null | undefined>,
): EquipHost {
  const there = g.players[host.seat];
  if (host.kind === 'stack') return { typeLine: there?.board.find((it) => it.id === host.id)?.typeLine };
  const card = there?.cards?.battlefield.find((c) => c.iid === host.id);
  return {
    typeLine: card ? records[card.cardId]?.typeLine : undefined,
    commander: !!card && !!there?.cards && isCommander(there.cards, card.iid) === true,
  };
}

const total = (cost: PayCost) => cost.generic + cost.pips.length;

/** The equip ability that host pays: the cheapest one it may use. A host
 * the table cannot read (null) may use them all — too little is asked
 * rather than too much. Null when the card has no way for it that the
 * table can price: then nothing is asked at all. */
export function equipWay(record: Read, host: EquipHost | null): EquipWay | null {
  const open = equipWays(record).filter((way) => way.only === null || !host?.typeLine || fits(way.only, host));
  return open.reduce<EquipWay | null>((best, way) => (best && total(best.cost) <= total(way.cost) ? best : way), null);
}

/** An Equipment that attaches itself as it arrives — "When this Equipment
 * enters, attach it to target creature you control", living weapon, For
 * Mirrodin! — and so costs nothing the first time it is put on something. */
export function comesAttached(record: Read): boolean {
  if (!record || !isEquipment(record)) return false;
  const front = record.oracleText.split('\n//\n')[0];
  return /\benters\b[^\n]*\battach (?:it|this equipment) to\b|\bliving weapon\b|\bfor mirrodin!|\bjob select\b/i.test(front);
}
