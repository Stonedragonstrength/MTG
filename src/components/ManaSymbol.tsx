import { useState } from 'react';
import { COLOR_NAMES } from '../lib/mana';
import type { PayCost } from '../lib/pay';

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

/** A printed mana cost ("{5}{G}{G}", "{2}{R} // {1}{R}", "{X}{G/W}") drawn
 * with the cards' own symbols, each face's cost apart. */
export function PrintedCost({ cost }: { cost: string }) {
  return (
    <span className="printed-cost" aria-label={`mana cost ${cost}`}>
      {cost.split(' // ').map((face, f) => (
        <span key={f} className="printed-cost-face">
          {f > 0 && (
            <span className="printed-cost-sep" aria-hidden="true">
              //
            </span>
          )}
          {[...face.matchAll(/\{([^}]+)\}/g)].map((m, i) => (
            <ManaSymbol key={i} symbol={m[1].replace(/\//g, '')} label={m[1]} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** A cost as the card prints it: the generic amount, then one symbol a pip. */
export function CostSymbols({ cost }: { cost: PayCost }) {
  return (
    <>
      {(cost.generic > 0 || cost.pips.length === 0) && (
        <ManaSymbol symbol={String(cost.generic)} label={`${cost.generic} of any color`} />
      )}
      {cost.pips.map((pip, i) => (
        <ManaSymbol key={i} symbol={pip.join('')} label={pip.map((c) => COLOR_NAMES[c]).join(' or ')} />
      ))}
    </>
  );
}
