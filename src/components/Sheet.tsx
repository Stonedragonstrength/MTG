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

/** The one modal shell every popup uses: title bar + ✕, body, optional footer.
 * Portaled to <body>: ancestors with CSS transforms (rotated zones, the centered
 * hub) would otherwise trap and clip position:fixed descendants. */
export default function Sheet({ title, onClose, size = 'regular', children, footer }: Props) {
  // The tablet's back button closes the top sheet instead of the app.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => registerBack(() => closeRef.current('back')), []);

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
