import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  onClose: () => void;
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
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`sheet sheet--${size}`} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="sheet-close" aria-label="close" onClick={onClose}>
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
