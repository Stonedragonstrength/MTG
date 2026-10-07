import { useState } from 'react';

const CONFIRM_MS = 600;

/** A button that confirms in place ("Delete deck" → "Really delete this deck?"),
 * which one stray double tap cannot answer: the first tap arms it, and a tap
 * confirms only once CONFIRM_MS have passed since. Sooner taps are dropped and
 * it stays armed. */
export function useConfirmTap() {
  const [armedAt, setArmedAt] = useState<number | null>(null);
  return {
    armed: armedAt !== null,
    /** Hand it every tap on the button: true means this one is the confirmation.
     * It goes by when the taps happened, not when they were handled, so a busy
     * main thread cannot stretch a double tap into two slow ones. */
    confirms: (tap: { timeStamp: number }): boolean => {
      if (armedAt === null) {
        setArmedAt(tap.timeStamp);
        return false;
      }
      return tap.timeStamp - armedAt >= CONFIRM_MS;
    },
  };
}
