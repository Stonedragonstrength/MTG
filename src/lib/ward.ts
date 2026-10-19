import { attachedTo } from './attach';
import { isCommander, type Host } from './cards';
import type { CardRecords } from './combatEngine';
import { asItIs } from './vehicles';
import type { GameState } from './types';

// ---- ward ----
// "Ward {2} (Whenever this creature becomes the target of a spell or
// ability an opponent controls, counter it unless that player pays {2}.)"
// The app knows when a spell or a card's ability is pointed at something:
// its target list (components/SpellTargetSheet.tsx). There, a permanent
// with ward that the caster does not control asks its price first.

/** What it costs to point something at a permanent with ward, all its
 * wards together: generic mana, life, and what the app cannot pay itself
 * ("Discard a card", "Sacrifice a creature"). */
export interface Ward {
  /** Generic mana, added up. */
  mana: number;
  life: number;
  other: string[];
}

const EMPTY: Ward = { mana: 0, life: 0, other: [] };

/** One ward's cost, as printed after "ward": "{2}", "—Pay 3 life.", "—{2}, Pay 2 life.", "—Discard a card." */
function costOf(said: string): Ward {
  const out: Ward = { mana: 0, life: 0, other: [] };
  const words = said.replace(/^\s*[—–-]\s*/, '').replace(/\.\s*$/, '').trim();
  for (const part of words.split(/,\s*/)) {
    const p = part.trim();
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^((?:\{\d+\})+)$/))) {
      for (const [, n] of m[1].matchAll(/\{(\d+)\}/g)) out.mana += Number(n);
    } else if ((m = p.match(/^pay (\d+) life$/i))) out.life += Number(m[1]);
    else if (p) out.other.push(p[0].toUpperCase() + p.slice(1));
  }
  return out;
}

const add = (a: Ward, b: Ward): Ward => ({ mana: a.mana + b.mana, life: a.life + b.life, other: [...a.other, ...b.other] });

/** The wards printed on a card's own text (its keyword lines). */
export function wardsPrinted(text: string): Ward {
  let total = EMPTY;
  for (const raw of text.split('\n//\n')[0].split('\n')) {
    const line = raw.replace(/\s*\([^)]*\)/g, '').trim();
    // "Ward {2}", "Flying, ward {2}", "Ward—Pay 3 life.", "Ward—{2}, Pay 2 life."
    const m = line.match(/^(?:[A-Za-z ]+,\s*)*ward\s*((?:\{\d+\})+|[—–].+)$/i);
    if (m) total = add(total, costOf(m[1]));
  }
  return total;
}

/** "has ward {2}" / "have ward {1}" / 'have "Ward—Pay 2 life."' in a sentence. */
function grantedIn(sentence: string): Ward | null {
  const m = sentence.match(/\bha(?:s|ve) (?:[^.]*? and )?(?:"ward|ward)\s*((?:\{\d+\})+|[—–][^"]+)/i);
  return m ? costOf(m[1]) : null;
}

/** Every ward a permanent has now: its own, what it wears ("Equipped
 * creature has ward {2}"), and what its controller's permanents hand out
 * ("Other creatures you control have ward {1}", "Commanders you control
 * have ward {2}"). Null when it has none. */
export function wardOf(g: GameState, host: Host, records: CardRecords): Ward | null {
  const player = g.players[host.seat];
  if (!player) return null;
  const card = host.kind === 'card' ? player.cards?.battlefield.find((c) => c.iid === host.id) : undefined;
  const item = host.kind === 'stack' ? player.board.find((it) => it.id === host.id) : undefined;
  if (!card && !item) return null;
  const record = card ? asItIs(g, card, records[card.cardId]) : null;
  const typeLine = (card ? (record?.typeLine ?? '') : (item?.typeLine ?? '')).split(' // ')[0];
  const creature = /\bCreature\b/.test(typeLine) || (!!item && item.basePower !== null);
  const counters = Object.values((card ? card.counters : item?.counters) ?? {}).some((n) => n > 0);
  const commander = !!card && !!player.cards && isCommander(player.cards, card.iid) === true;
  let total = wardsPrinted(card ? (record?.oracleText ?? '') : (item?.oracleText ?? ''));

  // What it wears.
  for (const { card: a } of attachedTo(g, host)) {
    const text = records[a.cardId]?.oracleText.split('\n//\n')[0] ?? '';
    for (const s of text.split(/\n|(?<=\.)\s+/)) {
      if (!/^(?:Equipped|Enchanted) (?:creature|permanent)\b/i.test(s)) continue;
      const w = grantedIn(s);
      if (w) total = add(total, w);
    }
  }

  // What its controller's other permanents hand out.
  const handers = [
    ...(player.cards?.battlefield ?? []).map((c) => ({ id: c.iid, text: records[c.cardId]?.oracleText.split('\n//\n')[0] ?? '' })),
    ...player.board.map((it) => ({ id: it.id, text: it.oracleText ?? '' })),
  ];
  for (const h of handers) {
    for (const s of h.text.split(/\n|(?<=\.)\s+/)) {
      const m = s.match(/^(Each|Other)?\s*(legendary )?(creatures?|permanents?|commanders?) you control( with (?:a counter|counters) on (?:it|them))?\b[^.]*?\bha(?:s|ve)\b/i);
      if (!m) continue;
      const w = grantedIn(s);
      if (!w) continue;
      if (m[1]?.toLowerCase() === 'other' && h.id === host.id) continue;
      if (m[2] && !/\bLegendary\b/.test(typeLine)) continue;
      const kind = m[3].toLowerCase();
      if (kind.startsWith('creature') && !creature) continue;
      if (kind.startsWith('commander') && !commander) continue;
      if (m[4] && !counters) continue;
      total = add(total, w);
    }
  }
  return total.mana > 0 || total.life > 0 || total.other.length > 0 ? total : null;
}

/** "{2}", "{2} and 3 life", "3 life", "discard a card": what a ward asks, for the screen. */
export function wardWords(w: Ward): string {
  const parts = [
    w.mana > 0 ? `{${w.mana}}` : '',
    w.life > 0 ? `${w.life} life` : '',
    ...w.other.map((o) => o[0].toLowerCase() + o.slice(1)),
  ].filter(Boolean);
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
