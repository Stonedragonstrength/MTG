/** The ways the rules let a deck run two commanders. */
export type PartnerKind =
  | { type: 'partner' } // "Partner": any other card with plain Partner
  | { type: 'with'; name: string } // "Partner with X": exactly that card
  | { type: 'group'; group: string } // "Partner—Survivors": the same group
  | { type: 'friends' } // "Friends forever"
  | { type: 'background' } // "Choose a Background": a Background enchantment
  | { type: 'companion' } // "Doctor's companion": a Time Lord Doctor
  | { type: 'doctor' } // a Time Lord Doctor: one companion
  | null;

interface Pairable {
  name: string;
  typeLine: string;
  oracleText: string;
}

/** What this card's own text says about a second commander. Keyword lines
 * are read at line starts, so reminder text and flavor never match. */
export function partnerKind(card: Pick<Pairable, 'typeLine' | 'oracleText'>): PartnerKind {
  const text = card.oracleText;
  const named = text.match(/^Partner with ([^\n(]+?)\s*(?:\(|$)/im);
  if (named) return { type: 'with', name: named[1].trim() };
  const group = text.match(/^Partner\s*[—–-]\s*([^\n(]+?)\s*(?:\(|$)/im);
  if (group) return { type: 'group', group: group[1].trim() };
  if (/^Partner\s*(?:\(|$)/im.test(text)) return { type: 'partner' };
  if (/^Friends forever\b/im.test(text)) return { type: 'friends' };
  if (/^Choose a Background\b/im.test(text)) return { type: 'background' };
  if (/^Doctor[’']s companion\b/im.test(text)) return { type: 'companion' };
  if (/Time Lord Doctor/.test(card.typeLine)) return { type: 'doctor' };
  return null;
}

const sameName = (a: string, b: string) =>
  a.split(' // ')[0].trim().toLowerCase() === b.split(' // ')[0].trim().toLowerCase();

/** May `second` sit in the command zone beside `first`? */
export function canPartner(first: Pairable, second: Pairable): boolean {
  if (sameName(first.name, second.name)) return false;
  const a = partnerKind(first);
  const b = partnerKind(second);
  if (!a) return false;
  switch (a.type) {
    case 'partner':
      return b?.type === 'partner';
    case 'with':
      return sameName(second.name, a.name);
    case 'group':
      return b?.type === 'group' && b.group.toLowerCase() === a.group.toLowerCase();
    case 'friends':
      return b?.type === 'friends';
    case 'background':
      return /Background/.test(second.typeLine);
    case 'companion':
      return b?.type === 'doctor';
    case 'doctor':
      return b?.type === 'companion';
  }
}

/** Button copy for the second slot — null when the commander stands alone. */
export function partnerOffer(kind: PartnerKind): string | null {
  if (!kind) return null;
  switch (kind.type) {
    case 'with':
      return `Add ${kind.name}`;
    case 'background':
      return 'Add Background';
    case 'companion':
      return 'Add the Doctor';
    case 'doctor':
      return 'Add companion';
    default:
      return 'Add partner';
  }
}
