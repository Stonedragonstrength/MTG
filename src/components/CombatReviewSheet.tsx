import { useEffect, useState, type ReactNode } from 'react';
import { liveCombat, sameUnit } from '../lib/combat';
import { NO_EDITS, reviewCombat, reviewId, type ReviewEdits, type ReviewUnit } from '../lib/combatReview';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useTableRecords } from './useCombat';
import { useSettleTaps } from './useSettleTaps';

interface Props {
  onClose: () => void;
}

/** One number the table may put right: − value +. It never goes below nothing. */
function Stepper({
  label,
  what,
  value,
  onChange,
}: {
  label: ReactNode;
  /** What the number is, for the buttons' names: "damage to Sam". */
  what: string;
  value: number;
  onChange: (by: number) => void;
}) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <div className="stepper">
        <button aria-label={`less ${what}`} disabled={value <= 0} onClick={() => onChange(-1)}>
          −
        </button>
        <span className="review-value" aria-label={what}>
          {value}
        </span>
        <button aria-label={`more ${what}`} onClick={() => onChange(1)}>
          +
        </button>
      </div>
    </div>
  );
}

/** The damage, before it lands. The app reads the printed card and its
 * +1/+1 counters and nothing else — no anthems, no equipment, no tricks —
 * so here the table puts the result right: more or less damage, a death
 * added or taken away, an attack that a card not on the tablet stopped.
 * Apply carries exactly what the sheet shows; the list of deaths IS the
 * confirmation. */
export default function CombatReviewSheet({ onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const applyCombat = useAppStore((s) => s.applyCombat);
  const records = useTableRecords();
  // Only what the players changed is kept: the numbers themselves follow
  // the table, also when another device changes it under the open sheet.
  const [edits, setEdits] = useState<ReviewEdits>(NO_EDITS);
  // It opens under the finger that pressed Review: the rest of that tap
  // must not land on a stepper, on Apply or on the backdrop.
  useSettleTaps();
  const fight = game ? liveCombat(game) : null;
  // Applied or called off (here or on another device), or taken back to an
  // earlier step by an Undo: really close — a sheet left mounted would
  // reopen by itself on the next fight.
  const gone = !fight || fight.step !== 'damage';
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!game || !fight || gone) return null;

  const review = reviewCombat(game, fight, records, edits);
  const name = (seat: number) => game.config.profiles[seat]?.name ?? '?';
  const pod = game.players.length > 2;
  /** Adds to one of the typed-in numbers. */
  const add = (field: 'commander' | 'other' | 'poison' | 'gain', key: string | number, by: number) =>
    setEdits((e) => ({ ...e, [field]: { ...e[field], [key]: ((e[field] as Record<string, number>)[key] ?? 0) + by } }));
  const setDies = (u: ReviewUnit, n: number) => setEdits((e) => ({ ...e, dies: { ...e.dies, [u.id]: n } }));

  return (
    <Sheet
      title="Review the damage"
      onClose={onClose}
      footer={
        <>
          <button className="primary" onClick={() => applyCombat(review.outcome)}>
            Apply
          </button>
          <button className="ghost" onClick={() => onClose()}>
            Back
          </button>
        </>
      }
    >
      <p className="hint review-hint">
        Worked out from the printed cards and their +1/+1 counters only. Put right whatever else was going on, then
        apply.
      </p>

      {review.defenders.map((d) => (
        <div className="detail-section review-steppers" key={d.seat}>
          <span className="section-label">
            {name(d.seat)} loses {d.lost}
          </span>
          {d.commanders.map((cmd) => (
            <Stepper
              key={cmd.key}
              label={
                <>
                  From {cmd.name}
                  <small className="hint-inline">{cmd.infect ? ' (commander · infect: no life lost)' : ' (commander)'}</small>
                </>
              }
              what={`damage to ${name(d.seat)} from ${cmd.name}`}
              value={cmd.damage}
              onChange={(by) => add('commander', reviewId(d.seat, cmd.key), by)}
            />
          ))}
          <Stepper
            label={d.commanders.length > 0 ? 'From all the other attackers' : 'Damage'}
            what={`damage to ${name(d.seat)}`}
            value={d.other}
            onChange={(by) => add('other', d.seat, by)}
          />
          {d.poison !== null && (
            <Stepper
              label="☠ Poison"
              what={`poison for ${name(d.seat)}`}
              value={d.poison}
              onChange={(by) => add('poison', d.seat, by)}
            />
          )}
        </div>
      ))}

      {review.gains.length > 0 && (
        <div className="detail-section review-steppers">
          <span className="section-label">Life gained</span>
          {review.gains.map((x) => (
            <Stepper
              key={x.seat}
              label={name(x.seat)}
              what={`life gained by ${name(x.seat)}`}
              value={x.life}
              onChange={(by) => add('gain', x.seat, by)}
            />
          ))}
        </div>
      )}

      <div className="detail-section review-steppers">
        <span className="section-label">Who dies</span>
        {review.units.length === 0 && <p className="hint">Nobody is fighting.</p>}
        {review.units.map((u) => {
          const whose = `${name(u.seat)}'s ${u.name}`;
          const attacks = u.attacking ? review.attacks.filter((a) => sameUnit(a.unit, u.unit)) : [];
          return (
            <div className={`review-unit${u.attacking ? '' : ' review-unit--blocker'}`} key={u.id}>
              <span className="review-unit-name">
                <span aria-hidden="true">{u.attacking ? '⚔ ' : '🛡 '}</span>
                {u.name} <strong>{u.size}</strong>
                {u.n > 1 ? ` ×${u.n}` : ''}
                {u.commander && <small className="hint-inline"> commander</small>}
              </span>
              <span className="review-ticks">
                {/* Any attack can be ticked "blocked": a defender with nothing on the tablet never got to say so. */}
                {attacks.map((a) => {
                  const at = pod || attacks.length > 1 ? ` (${name(a.target)})` : '';
                  return (
                    <label className="review-tick" key={a.index} title={a.by ? `Blocked by ${a.by}` : undefined}>
                      <input
                        type="checkbox"
                        checked={a.blocked}
                        disabled={a.fixed}
                        aria-label={`${whose} was blocked${at}`}
                        onChange={(e) =>
                          setEdits((was) => ({ ...was, blocked: { ...was.blocked, [a.index]: e.target.checked } }))
                        }
                      />
                      blocked{at}
                    </label>
                  );
                })}
                {u.unit.kind === 'card' ? (
                  <label className="review-tick review-tick--dies">
                    <input
                      type="checkbox"
                      checked={u.dies > 0}
                      aria-label={`${whose} dies`}
                      onChange={(e) => setDies(u, e.target.checked ? 1 : 0)}
                    />
                    dies
                  </label>
                ) : (
                  <span className="stepper review-dies">
                    <button aria-label={`one fewer of ${whose} dies`} disabled={u.dies <= 0} onClick={() => setDies(u, u.dies - 1)}>
                      −
                    </button>
                    <span className="review-value" aria-label={`${whose} dying`}>
                      {u.dies} {u.dies === 1 ? 'dies' : 'die'}
                    </span>
                    <button aria-label={`one more of ${whose} dies`} disabled={u.dies >= u.n} onClick={() => setDies(u, u.dies + 1)}>
                      +
                    </button>
                  </span>
                )}
                {u.commander && u.dies > 0 && (
                  <label className="review-tick">
                    <input
                      type="checkbox"
                      checked={u.home}
                      aria-label={`${whose} goes to the command zone`}
                      onChange={(e) => setEdits((was) => ({ ...was, home: { ...was.home, [u.id]: e.target.checked } }))}
                    />
                    to the command zone (+2)
                  </label>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {review.defeats.length > 0 && (
        <p className="review-warning" role="alert">
          This defeats {review.defeats.map(name).join(' and ')}.
        </p>
      )}
    </Sheet>
  );
}
