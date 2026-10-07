import type { CombatUnit, GameState, SeatCards } from './types';

/** One source of commander damage. The rules count 21 from the SAME
 * commander, so a partner pair is two attackers, each with its own total. */
export interface Attacker {
  /** Key into PlayerState.commanderDamage. A seat's first (or only)
   * commander keeps the plain profile id, so games in progress and
   * single-commander seats read exactly as before; a partner is `id#2`. */
  key: string;
  /** Full name for sheets, tooltips and the log. */
  label: string;
  /** Four letters for the slim header gauge. */
  short: string;
}

const short = (name: string) => name.slice(0, 4);

/** Who can deal commander damage for this seat: the player (one gauge,
 * under their own name — nothing changes), or each commander of a pair.
 * A pair is known either from the seat's dealt cards or from the profile
 * the game was started with. */
export function seatCommanders(game: GameState, seatIdx: number): Attacker[] {
  const profile = game.config.profiles[seatIdx];
  if (!profile) return [];
  const pair = pairNames(game, seatIdx);
  if (!pair) return [{ key: profile.id, label: profile.name, short: short(profile.name) }];
  return pair.map((name, i) => ({
    key: keyAt(profile.id, i),
    label: `${profile.name} — ${name}`,
    short: short(name),
  }));
}

/** The seat's tracked commanders in the ONE order their keys are handed
 * out in: by instance id. Not the order `cmd` lists them — the online
 * table keeps the game as jsonb, which hands object keys back in its own
 * order, so a pair read that way swapped gauges after a round trip. */
function commanderIids(cards: SeatCards | undefined): string[] {
  return Object.keys(cards?.cmd ?? {}).sort();
}

/** The key of the seat's n-th commander (see Attacker.key). */
const keyAt = (profileId: string, i: number) => (i === 0 ? profileId : `${profileId}#${i + 1}`);

const frontFace = (name: string) => name.split(' // ')[0].trim().toLowerCase();

/** The commander-damage key this card or stack deals its damage under, or
 * null when it is not a commander (plain damage, an ordinary death).
 * Combat credits its damage by this, and the gauges (seatCommanders) hand
 * their keys out by the same order and the same names, so the two cannot
 * disagree about which gauge is whose.
 * - A seat that tracks its commanders (`cards.cmd`): by instance id.
 * - A tracker seat, or a seat dealt before `cmd` existed: by front-face
 *   name against the profile's commanderName / partnerName — a tile added
 *   by hand is the commander when it carries the commander's name. */
export function commanderKey(game: GameState, seatIdx: number, unit: CombatUnit): string | null {
  const profile = game.config.profiles[seatIdx];
  const player = game.players[seatIdx];
  if (!profile || !player) return null;
  if (player.cards?.cmd) {
    const at = unit.kind === 'card' ? commanderIids(player.cards).indexOf(unit.id) : -1;
    return at === -1 ? null : keyAt(profile.id, at);
  }
  const name =
    unit.kind === 'card'
      ? player.cards?.battlefield.find((c) => c.iid === unit.id)?.name
      : player.board.find((it) => it.id === unit.id)?.name;
  if (!name || !profile.commanderName) return null;
  if (frontFace(name) === frontFace(profile.commanderName)) return profile.id;
  // Only a pair has a second key, and it is the partner's.
  if (profile.partnerName && frontFace(name) === frontFace(profile.partnerName)) {
    return keyAt(profile.id, 1);
  }
  return null;
}

function pairNames(game: GameState, seatIdx: number): string[] | null {
  const cards = game.players[seatIdx]?.cards;
  const iids = commanderIids(cards);
  if (cards && iids.length > 1) {
    // The commanders may be anywhere by now: at home, on the battlefield, dead.
    const everywhere = [
      ...cards.command,
      ...cards.battlefield,
      ...cards.graveyard,
      ...cards.exile,
      ...cards.hand,
      ...cards.library,
    ];
    return iids.map((iid) => everywhere.find((c) => c.iid === iid)?.name ?? 'Commander');
  }
  const profile = game.config.profiles[seatIdx];
  if (profile?.commanderName && profile.partnerName) {
    return [profile.commanderName, profile.partnerName];
  }
  return null;
}

/** The name behind a commander-damage key, for the log. */
export function attackerLabel(game: GameState, key: string): string {
  for (let i = 0; i < game.config.profiles.length; i++) {
    const hit = seatCommanders(game, i).find((a) => a.key === key);
    if (hit) return hit.label;
  }
  return '?';
}
