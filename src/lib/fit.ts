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
