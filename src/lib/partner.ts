/** The ways the rules let a deck run two commanders. */
export type PartnerKind =
  | { type: 'partner' } // "Partner": any other card with plain Partner
  | { type: 'with'; name: string } // "Partner with X": exactly that card
  | { type: 'group'; group: string } // "Partner—Survivors": the same group
  | { type: 'friends' } // "Friends forever"
  | { type: 'background' } // "Choose a Background": a Background enchantment
  | { type: 'companion' } // "Doctor's companion": a Time Lord Doctor
  | { type: 'doctor' }; // a Time Lord Doctor: one companion

interface Pairable {
  name: string;
  typeLine: string;
  oracleText: string;
}

/** Everything this card's own text says about a second commander. Keyword
 * lines are read at line starts, so reminder text and flavor never match.
 * A card can carry more than one (Amy Pond: "Partner with Rory Williams"
 * and "Doctor's companion") and its owner picks which to use — CR 702.124g. */
export function partnerKinds(card: Pick<Pairable, 'typeLine' | 'oracleText'>): PartnerKind[] {
  const text = card.oracleText;
  const kinds: PartnerKind[] = [];
  const named = text.match(/^Partner with ([^\n(]+?)\s*(?:\(|$)/im);
  if (named) kinds.push({ type: 'with', name: named[1].trim() });
  const group = text.match(/^Partner\s*[—–-]\s*([^\n(]+?)\s*(?:\(|$)/im);
  if (group) kinds.push({ type: 'group', group: group[1].trim() });
  if (/^Partner\s*(?:\(|$)/im.test(text)) kinds.push({ type: 'partner' });
  if (/^Friends forever\b/im.test(text)) kinds.push({ type: 'friends' });
  if (/^Choose a Background\b/im.test(text)) kinds.push({ type: 'background' });
  if (/^Doctor[’']s companion\b/im.test(text)) kinds.push({ type: 'companion' });
  if (/Time Lord Doctor/.test(card.typeLine)) kinds.push({ type: 'doctor' });
  return kinds;
}

const sameName = (a: string, b: string) =>
  a.split(' // ')[0].trim().toLowerCase() === b.split(' // ')[0].trim().toLowerCase();

/** May `second` sit in the command zone beside `first`? Any one of
 * `first`'s pairing abilities is enough. */
export function canPartner(first: Pairable, second: Pairable): boolean {
  if (sameName(first.name, second.name)) return false;
  const theirs = partnerKinds(second);
  return partnerKinds(first).some((a) => {
    switch (a.type) {
      case 'partner':
        return theirs.some((b) => b.type === 'partner');
      case 'with':
        return sameName(second.name, a.name);
      case 'group':
        return theirs.some((b) => b.type === 'group' && b.group.toLowerCase() === a.group.toLowerCase());
      case 'friends':
        return theirs.some((b) => b.type === 'friends');
      case 'background':
        return /Background/.test(second.typeLine);
      case 'companion':
        return theirs.some((b) => b.type === 'doctor');
      case 'doctor':
        return theirs.some((b) => b.type === 'companion');
    }
  });
}

/** Button copy for the second slot — null when the commander stands
 * alone. With a choice of abilities it names none of them. */
export function partnerOffer(kinds: PartnerKind[]): string | null {
  if (kinds.length === 0) return null;
  if (kinds.length > 1) return 'Add partner';
  const kind = kinds[0];
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
