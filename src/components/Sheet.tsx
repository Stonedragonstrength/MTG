import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { registerBack } from '../lib/backstack';

interface Props {
  title: string;
  /** `why` is 'back' when the tablet's back button closed it — a caller
   * that would open something next must not do so on a Back press. */
  onClose: (why?: 'back') => void;
  /** 'regular' fits content; 'wide' is a near-fullscreen workspace (rules, search). */
  size?: 'regular' | 'wide';
  children: ReactNode;
  /** Optional footer action row, pinned under the body. */
  footer?: ReactNode;
}

const QUIET_MS = 350;

/** The tap that closes a sheet is often the first half of a double tap, and the
 * second half used to land on the board underneath: it tapped a land, played a
 * hand card, passed the turn. So a closing sheet leaves a see-through shield
 * over the board until the screen has been left alone for QUIET_MS.
 * (`.tap-shield` sits under every backdrop: a sheet that opens next still works,
 * and a sheet that was lying beneath the closed one is not covered.)
 *
 * A finger that lands on the shield holds it up for as long as it stays down:
 * useLongPress acts on a bare pointerup, so a shield that lifted mid-press
 * would hand that release to whatever lies beneath. */
function shieldBoard(): void {
  const shield = document.createElement('div');
  shield.className = 'tap-shield';
  const down = new Set<number>();
  let lift: number | undefined;
  const rest = () => {
    window.clearTimeout(lift);
    lift = window.setTimeout(() => shield.remove(), QUIET_MS);
  };
  shield.addEventListener('pointerdown', (e) => {
    window.clearTimeout(lift);
    // A first finger means every earlier one is off the glass, reported or not:
    // a release the browser never delivers must not hold the shield up for good.
    if (e.isPrimary) down.clear();
    down.add(e.pointerId);
    shield.setPointerCapture(e.pointerId); // its release comes here, wherever it happens
  });
  const lifted = (e: PointerEvent) => {
    down.delete(e.pointerId);
    if (down.size === 0) rest();
  };
  shield.addEventListener('pointerup', lifted);
  shield.addEventListener('pointercancel', lifted);
  document.body.appendChild(shield);
  rest();
}

/** The one modal shell every popup uses: title bar + ✕, body, optional footer.
 * Portaled to <body>: ancestors with CSS transforms (rotated zones, the centered
 * hub) would otherwise trap and clip position:fixed descendants. */
export default function Sheet({ title, onClose, size = 'regular', children, footer }: Props) {
  // The tablet's back button closes the top sheet instead of the app.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => registerBack(() => closeRef.current('back')), []);
  // However it closes — a button, ✕, the back button — the board sits out the next
  // moment. (StrictMode's rehearsal unmount raises a shield too; it lifts like any other.)
  useEffect(() => shieldBoard, []);

  return createPortal(
    <div className="modal-backdrop" onClick={() => onClose()}>
      <div className={`sheet sheet--${size}`} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="sheet-close" aria-label="close" onClick={() => onClose()}>
            ✕
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
