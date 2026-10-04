import { useRef } from 'react';

const LONG_PRESS_MS = 500;

/** Pointer handlers: short tap fires onShort, holding ≥500ms fires onLong instead. */
export function useLongPress(onShort: () => void, onLong: () => void) {
  const timer = useRef<number | null>(null);
  const firedLong = useRef(false);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return {
    onPointerDown: () => {
      firedLong.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        firedLong.current = true;
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerUp: () => {
      clear();
      if (!firedLong.current) onShort();
      firedLong.current = false;
    },
    onPointerLeave: () => {
      clear();
      firedLong.current = false;
    },
    // Touch scrolls fire pointercancel (not up/leave); without this, the
    // long-press timer still fires and a scroll becomes a phantom ±5.
    onPointerCancel: () => {
      clear();
      firedLong.current = false;
    },
  };
}
