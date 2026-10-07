import type { GameState } from './types';

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
    key: i === 0 ? profile.id : `${profile.id}#${i + 1}`,
    label: `${profile.name} — ${name}`,
    short: short(name),
  }));
}

function pairNames(game: GameState, seatIdx: number): string[] | null {
  const cards = game.players[seatIdx]?.cards;
  const iids = Object.keys(cards?.cmd ?? {});
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
