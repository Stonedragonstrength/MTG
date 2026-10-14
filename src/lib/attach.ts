import { computedPT } from './board';
import { boostOf } from './boost';
import { hostIsThere, type Host } from './cards';
import { keywordList } from './keywords';
import type { CardInstance, CardRecord, GameState } from './types';

/** Auras and Equipment: what they can go on, what is on what. The screen's
 * half — the reducers are in lib/cards.ts (attachCard), and the game only
 * ever stores `CardInstance.on`. Everything here reads the table as it
 * stands: an attachment whose host has left is simply not attached. */

type Read = Pick<CardRecord, 'typeLine' | 'oracleText'> | null | undefined;
type Records = Record<string, CardRecord | null | undefined>;

const frontType = (record: Read) => (record?.typeLine ?? '').split(' // ')[0];
const frontText = (record: Read) => (record?.oracleText ?? '').split('\n//\n')[0];

export const isAura = (record: Read): boolean => /\bAura\b/.test(frontType(record));
export const isEquipment = (record: Read): boolean => /\bEquipment\b/.test(frontType(record));
/** A card that is meant to sit on another one. */
export const attaches = (record: Read): boolean => isAura(record) || isEquipment(record);

/** What an Aura may enchant, by the first words of its text; an Equipment
 * goes on creatures. 'player' has nothing on the board to sit on. */
export type HostKind = 'creature' | 'land' | 'artifact' | 'enchantment' | 'planeswalker' | 'permanent' | 'player';

export function hostKind(record: Read): HostKind {
  if (!isAura(record)) return 'creature';
  const m = frontText(record).match(/^Enchant ([a-z ]+)/im);
  const what = m?.[1].toLowerCase() ?? 'creature';
  if (/\bplayer\b|\bopponent\b/.test(what)) return 'player';
  for (const kind of ['creature', 'land', 'artifact', 'enchantment', 'planeswalker'] as const)
    if (what.includes(kind)) return kind;
  return 'permanent';
}

/** A change of size: so much power, so much toughness (either may be below zero). */
export interface Size {
  power: number;
  toughness: number;
}

const GETS = /\b(?:enchanted|equipped) (?:creature|permanent) gets ([+-]\d+)\/([+-]\d+)/i;
/** A size that depends on something: left to the players. */
const DEPENDS = /\bfor each\b|\bas long as\b|\buntil end of turn\b|\bwhere X is\b/i;

/** What an Aura or Equipment adds to the size of what it sits on, where its
 * text says so in plain numbers: "Equipped creature gets +2/+0", "Enchanted
 * creature gets -1/-1 and has…". Null when it changes no size, or by an
 * amount that has to be worked out ("+1/+1 for each…", "+X/+0", "as long
 * as…"): the players keep that. */
export function sizeGiven(record: Read): Size | null {
  for (const sentence of frontText(record).match(/[^.\n]+/g) ?? []) {
    const m = sentence.match(GETS);
    if (m && !DEPENDS.test(sentence)) return { power: Number(m[1]), toughness: Number(m[2]) };
  }
  return null;
}

// "Equipped creature has haste and shroud", "Enchanted creature gets +2/+0
// and has trample": one sentence, nothing in front of it.
const HAS = /^\s*(?:equipped|enchanted) (?:creature|permanent) (?:gets [+-]\d+\/[+-]\d+ and )?has ([^:"“”]+)$/i;
/** A grant that depends on something, or lasts a while: not standing. */
const ONLY_SOMETIMES = /\b(?:as long as|if|unless|during|while|until|except|for each)\b/i;

/** The keyword abilities an Aura or Equipment gives what it sits on, where
 * its text says so plainly: Lightning Greaves' haste, Basilisk Collar's
 * deathtouch and lifelink, Rancor's trample. Lower case, bare names, as
 * keywords.ts reads them. One behind a condition ("…has first strike as
 * long as…") is left to the players. */
export function keywordsGiven(record: Read): string[] {
  const out: string[] = [];
  for (const sentence of frontText(record).replace(/\([^)]*\)/g, '').match(/[^.\n]+/g) ?? []) {
    const m = sentence.match(HAS);
    if (!m || ONLY_SOMETIMES.test(m[1])) continue;
    for (const keyword of keywordList(m[1])) if (!out.includes(keyword)) out.push(keyword);
  }
  return out;
}

/** "+2/+0", "-1/-1": a change of size as the table writes it. */
export const sizeWords = (size: Size): string => {
  const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);
  return `${signed(size.power)}/${signed(size.toughness)}`;
};

/** The host this card sits on right now, or null: not attached, or its
 * host has left the table. */
export function hostOf(g: GameState, card: Pick<CardInstance, 'on'>): Host | null {
  const on = card.on;
  if (!on) return null;
  const host: Host = { seat: on.seat, kind: on.kind, id: on.id };
  return hostIsThere(g, host) ? host : null;
}

/** A host's name, for a line of text. */
export function hostName(g: GameState, host: Host): string {
  const player = g.players[host.seat];
  if (host.kind === 'card') return player?.cards?.battlefield.find((c) => c.iid === host.id)?.name ?? '?';
  return player?.board.find((it) => it.id === host.id)?.name ?? '?';
}

/** One card attached to something, and whose it is. */
export interface Attached {
  seat: number; // the seat that controls the attachment
  card: CardInstance;
}

/** Everything attached to that host, from every seat, in seat order. */
export function attachedTo(g: GameState, host: Host): Attached[] {
  const out: Attached[] = [];
  g.players.forEach((p, seat) => {
    for (const card of p.cards?.battlefield ?? []) {
      const on = card.on;
      if (on && on.seat === host.seat && on.kind === host.kind && on.id === host.id) out.push({ seat, card });
    }
  });
  return out;
}

/** What everything attached to that host adds to its size, whoever each
 * belongs to: 0/0 when nothing does (or nothing this device has read).
 * It is never stored: take the Equipment off, or let its creature leave,
 * and the size is gone with it. An attachment from a game begun before
 * this — one that put its bonus on the host as +1/+1 counters (`on.plus`)
 * — is left out: those counters already say it. */
export function sizeWorn(g: GameState, host: Host, records: Records): Size {
  const total: Size = { power: 0, toughness: 0 };
  for (const { card } of attachedTo(g, host)) {
    if (card.on?.plus) continue;
    const given = sizeGiven(records[card.cardId]);
    if (!given) continue;
    total.power += given.power;
    total.toughness += given.toughness;
  }
  return total;
}

/** The keywords everything attached to that host gives it, whoever each
 * belongs to — never stored, like its size: off comes the Equipment, off
 * go the keywords. */
export function keywordsWorn(g: GameState, host: Host, records: Records): Set<string> {
  const out = new Set<string>();
  for (const { card } of attachedTo(g, host)) for (const keyword of keywordsGiven(records[card.cardId])) out.add(keyword);
  return out;
}

/** The keywords it has right now from outside its own text: what it wears,
 * and what "…gains flying until end of turn" gave it this turn. */
export function keywordsNow(g: GameState, host: Host, records: Records): Set<string> {
  const out = keywordsWorn(g, host, records);
  const player = g.players[host.seat];
  const it =
    host.kind === 'card'
      ? player?.cards?.battlefield.find((c) => c.iid === host.id)
      : player?.board.find((item) => item.id === host.id);
  for (const keyword of boostOf(g, it)?.keywords ?? []) out.add(keyword);
  return out;
}

/** Is this card drawn tucked under a host (and so not on its own shelf)? */
export const isAttached = (g: GameState, card: Pick<CardInstance, 'on'>): boolean => hostOf(g, card) !== null;

/** One thing an Aura or Equipment could go on. */
export interface HostChoice extends Host {
  name: string;
  art: string | null;
  /** "2/2" when it has a size. */
  size: string | null;
}

const typeHas = (typeLine: string, kind: HostKind) =>
  kind === 'permanent' || new RegExp(`\\b${kind}\\b`, 'i').test(typeLine.split(' // ')[0]);

/** What `record` (an Aura or an Equipment, the card `self` of `selfSeat`)
 * could be attached to on one seat's side: that seat's cards of the right
 * kind, then its stacks. A card that is not read yet is offered too —
 * what the app cannot read never blocks a play. Never the card itself,
 * and never another attachment that is sitting on something. */
export function hostChoices(
  g: GameState,
  seat: number,
  record: Read,
  records: Records,
  self?: { seat: number; iid: string },
): HostChoice[] {
  const kind = hostKind(record);
  const player = g.players[seat];
  if (!player || kind === 'player') return [];
  const out: HostChoice[] = [];
  for (const c of player.cards?.battlefield ?? []) {
    if (self && self.seat === seat && self.iid === c.iid) continue;
    if (isAttached(g, c)) continue;
    const r = records[c.cardId];
    if (r && !typeHas(r.typeLine, kind)) continue;
    out.push({
      seat,
      kind: 'card',
      id: c.iid,
      name: c.name,
      art: r?.imageNormal ?? null,
      size: r && r.power !== null && r.toughness !== null ? `${r.power}/${r.toughness}` : null,
    });
  }
  for (const it of player.board) {
    const pt = computedPT({ ...it, counters: it.counters ?? {} });
    const isLand = it.zone === 'lands';
    const fits =
      kind === 'permanent' ||
      (kind === 'creature' && pt !== null && !isLand) ||
      (kind === 'land' && isLand) ||
      (kind !== 'creature' && kind !== 'land' && typeHas(it.typeLine, kind));
    if (!fits) continue;
    out.push({
      seat,
      kind: 'stack',
      id: it.id,
      name: it.count > 1 ? `${it.name} ×${it.count}` : it.name,
      art: it.imageNormal,
      size: pt ? `${pt.power}/${pt.toughness}` : null,
    });
  }
  return out;
}
