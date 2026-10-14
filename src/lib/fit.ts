interface FitOpts {
  gap?: number;
  /** width / height of a card */
  aspect?: number;
  max?: number;
  min?: number;
}

/** The tallest card (px) at which `n` cards fit a W×H box in wrapped rows:
 * every row count is tried, each limited by both the box's height and the
 * width its row needs. Capped so a lone card doesn't balloon, floored so
 * a crowded board scrolls instead of shrinking past readable. */
export function fitCardHeight(
  width: number,
  height: number,
  n: number,
  { gap = 8, aspect = 63 / 88, max = 240, min = 72 }: FitOpts = {},
): number {
  if (n <= 0) return max;
  let best = 0;
  for (let rows = 1; rows <= n; rows++) {
    const perRow = Math.ceil(n / rows);
    const byHeight = (height - gap * (rows - 1)) / rows;
    const byWidth = (width - gap * (perRow - 1)) / perRow / aspect;
    best = Math.max(best, Math.min(max, byHeight, byWidth));
  }
  return Math.max(min, Math.floor(best));
}

/** The same fit in a box with something standing in one corner (the tokens,
 * at the foot of the field): `cornerW`×`cornerH` is the room the cards must
 * keep clear of. They either stand above it, giving up a strip along that
 * edge, or beside it, giving up a column — whichever leaves the taller
 * card. `clear` is null when nothing stands there. */
export function fitAroundCorner(
  width: number,
  height: number,
  n: number,
  cornerW: number,
  cornerH: number,
  opts: FitOpts = {},
): { cardHeight: number; clear: 'above' | 'beside' | null } {
  if (cornerW <= 0 || cornerH <= 0)
    return { cardHeight: fitCardHeight(width, height, n, opts), clear: null };
  const above = fitCardHeight(width, height - cornerH, n, opts);
  const beside = fitCardHeight(width - cornerW, height, n, opts);
  // A tie goes to the strip: the cards keep the whole width of the box.
  return above >= beside
    ? { cardHeight: above, clear: 'above' }
    : { cardHeight: beside, clear: 'beside' };
}

/** The share (0–1) of a hand card's width that is in sight in the fan.
 * A card `card` wide stands in a slot `slotWidth` wide at `slotLeft`: the
 * slot is what the next card leaves uncovered. The card brought to the
 * front (at `frontLeft`, null when none is) lies over what it reaches. */
export function shareInSight(
  card: number,
  slotLeft: number,
  slotWidth: number,
  frontLeft: number | null,
): number {
  // A slot with no box of its own (the phone's hand view) covers nothing.
  if (card <= 0 || slotWidth <= 0) return 1;
  const to = slotLeft + Math.min(card, slotWidth);
  let seen = to - slotLeft;
  if (frontLeft !== null) {
    const under = Math.min(to, frontLeft + card) - Math.max(slotLeft, frontLeft);
    if (under > 0) seen -= under;
  }
  return seen / card;
}
