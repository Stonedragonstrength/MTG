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

/** width / height of a card */
export const CARD_ASPECT = 63 / 88;

/** Where a hand lies open: on the big board, or on a player's bar. Sizes
 * are card heights in px; `room` is the height a hand on a bar may take
 * (the big board's depends on the seat: see handRoom). */
export const HAND_FIT = {
  board: { gap: 6, max: 218, min: 84 },
  bar: { gap: 4, max: 140, min: 56, room: 140 },
} as const;

export type HandPlace = keyof typeof HAND_FIT;

/** The height (px) a hand may take on a big board `zoneHeight` tall: one
 * row of full-size cards at least, and about a third of the seat where it
 * has the height to spare — a tablet held upright, where a second row is
 * what keeps a full hand large. */
export function handRoom(zoneHeight: number): number {
  return Math.round(Math.min(440, Math.max(HAND_FIT.board.max, zoneHeight * 0.34)));
}

export interface HandFit {
  /** how tall each card is drawn */
  height: number;
  /** how many stand in a row */
  perRow: number;
}

/** A hand in which every card is in sight, whole: `n` cards in a box
 * `width` wide that may grow `room` tall. Side by side while that leaves
 * them a fair size, in more rows when it does not — a row more has to
 * earn its height with cards a tenth taller at least. Only a hand too
 * large for its room at the smallest size overflows it (and scrolls). */
export function fitHand(width: number, room: number, n: number, place: HandPlace): HandFit {
  const { gap, max, min } = HAND_FIT[place];
  if (n <= 0) return { height: max, perRow: 1 };
  let best: HandFit = { height: 0, perRow: n };
  for (let rows = 1; rows <= n; rows++) {
    const perRow = Math.ceil(n / rows);
    const byHeight = (room - gap * (rows - 1)) / rows;
    const byWidth = (width - gap * (perRow - 1)) / perRow / CARD_ASPECT;
    const height = Math.min(max, byHeight, byWidth);
    if (height > best.height * 1.1) best = { height, perRow };
  }
  if (best.height >= min) return { height: Math.floor(best.height), perRow: best.perRow };
  const across = Math.floor((width + gap) / (min * CARD_ASPECT + gap));
  return { height: min, perRow: Math.max(1, Math.min(n, across)) };
}
