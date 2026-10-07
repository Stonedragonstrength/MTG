import type { CSSProperties } from 'react';
import { seatTint, type UnitLook } from './useCombat';

/** The modifier classes a card (`vcard`) or a stack tile (`thumb`) wears
 * while it is in a fight. Outlines and dimming only: never a transform —
 * a tapped card is already turned with one. */
export function combatClasses(base: 'vcard' | 'thumb', look: UnitLook | null): string {
  if (!look) return '';
  return [
    look.attacking.length > 0 ? ` ${base}--attacking` : '',
    look.blocking.length > 0 ? ` ${base}--blocking` : '',
    look.dim ? ` ${base}--cant` : '',
    look.dying > 0 ? ` ${base}--dying` : '',
  ].join('');
}

interface Props {
  look: UnitLook | null;
  /** The players' names by seat: an attacker wears its target's initial. */
  names: string[];
  /** A stack: every mark says how many copies it stands for. */
  counts?: boolean;
}

/** What a creature wears in a fight: the opponent it is pointed at (their
 * initial, in their colour — with two players just the swords), the number
 * of the attacker it stands in front of, and at the end whether it dies. */
export default function CombatMarks({ look, names, counts = false }: Props) {
  if (!look || (look.attacking.length === 0 && look.blocking.length === 0 && look.dying === 0)) return null;
  const pod = names.length > 2;
  const times = (n: number) => (counts || n > 1 ? `×${n}` : '');
  return (
    <span className="combat-marks" aria-hidden="true">
      {look.attacking.map(([seat, n]) => (
        <span
          key={`at-${seat}`}
          className="combat-mark combat-mark--attack"
          style={{ '--tint': seatTint(seat) } as CSSProperties}
        >
          ⚔{pod ? (names[seat] ?? '?').slice(0, 1).toUpperCase() : ''}
          {times(n)}
        </span>
      ))}
      {look.blocking.map(([no, n]) => (
        <span key={`in-${no}`} className="combat-mark combat-mark--block">
          🛡{no}
          {times(n)}
        </span>
      ))}
      {look.dying > 0 && (
        <span className="combat-mark combat-mark--dies">
          ☠{times(look.dying)}
        </span>
      )}
    </span>
  );
}
