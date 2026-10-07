import { useEffect, useRef } from 'react';
import type { CardRecord } from '../lib/types';
import Sheet, { shieldBoard } from './Sheet';

interface Props {
  name: string;
  /** As useCardRecords hands it over: null when this device has no record
   * of the card, undefined while that is still being looked up. */
  record: CardRecord | null | undefined;
  onClose: () => void;
}

/** A tap this soon after it opened is the other half of the double tap that opened it. */
const SETTLE_MS = 350;

/** One card, large enough to read: the whole card image, its type line and
 * its rules text. It only shows — closing it changes nothing. */
export default function CardZoomSheet({ name, record, onClose }: Props) {
  // It closes back onto the sheet it was opened from, not onto the board: that
  // sheet's buttons — and its backdrop, which would close it — sit out the next
  // moment too, or the second half of a double tap lands on them.
  useEffect(() => () => shieldBoard(true), []);

  // The same double tap the other way round: its second half lands wherever
  // this sheet now is, often on the backdrop, and would tap it shut again
  // before anyone saw the card. The back button is never part of a double tap.
  const opened = useRef(performance.now());
  const close = (why?: 'back') => {
    if (why !== 'back' && performance.now() - opened.current < SETTLE_MS) return;
    onClose();
  };

  return (
    <Sheet title={name} onClose={close}>
      <div className="card-hero zoom-card">
        <div className="zoom-face" data-name={name}>
          {record?.imageNormal && <img src={record.imageNormal} alt={name} />}
        </div>
        {record && (
          <p className="type-line">
            {record.typeLine}
            {record.power !== null && record.toughness !== null && (
              <strong>
                {' '}
                {record.power}/{record.toughness}
              </strong>
            )}
            {record.manaCost && <span className="zoom-cost"> {record.manaCost}</span>}
          </p>
        )}
        {record?.oracleText && <p className="oracle-text">{record.oracleText}</p>}
        {record === null && <p className="hint">No card text for this one on this device.</p>}
      </div>
    </Sheet>
  );
}
