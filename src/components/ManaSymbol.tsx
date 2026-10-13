import { useState } from 'react';

/** Scryfall's drawings of the mana symbols, one small file each (kept by
 * the service worker once seen: vite.config.ts). */
const SYMBOLS = 'https://svgs.scryfall.io/card-symbols';

interface Props {
  /** A color letter ("G"), a hybrid ("GU"), a generic amount ("2"), or 'any'. */
  symbol: string;
  /** What it stands for, in words: the picture's name. */
  label: string;
}

/** One mana symbol as the cards print it. Where the picture cannot be had
 * (offline, never seen before) the table's own colored dot stands in, with
 * the letter or the number on it. */
export default function ManaSymbol({ symbol, label }: Props) {
  const [failed, setFailed] = useState(false);
  // No card prints "any color": the five-color wheel is the table's own.
  if (symbol === 'any')
    return <span className="mana-sym mana-pip mana-any" role="img" aria-label={label} />;
  if (failed) {
    const color = /^[WUBRG]/.test(symbol) ? symbol[0] : 'C';
    return (
      <span className={`mana-sym mana-pip mana-${color}`} role="img" aria-label={label}>
        {symbol}
      </span>
    );
  }
  return (
    <img
      className="mana-sym"
      src={`${SYMBOLS}/${symbol}.svg`}
      alt={label}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
