import { useEffect, type ReactNode } from 'react';
import { liveCombat, sameUnit } from '../lib/combat';
import type { Fighter } from '../lib/combatEngine';
import { hitsOf, reviewCombat, reviewId, setDeaths, type ReviewEdits, type ReviewUnit } from '../lib/combatReview';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { editsFor, unitArt, useCombatEdits, useTableRecords } from './useCombat';
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

/** The fight in detail, before its damage lands. The board already shows
 * the result and takes the common corrections (a tap on a creature, the
 * buttons beside a life total); this is the long way round, for what the
 * board has no place for: which commander the damage was, poison, life
 * gained, an attack that a card not on the tablet stopped — and the whole
 * fight laid out attack by attack, to see why a number is what it is.
 *
 * The app reads the printed card and its +1/+1 counters and nothing else —
 * no anthems, no tricks. What is changed here is the same set of changes
 * the board makes (useCombatEdits): it shows there too, and stays when the
 * sheet is closed. Apply carries exactly what is shown. */
export default function CombatReviewSheet({ onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const applyCombat = useAppStore((s) => s.applyCombat);
  const records = useTableRecords();
  const changed = useCombatEdits();
  // It opens under the finger that pressed Details: the rest of that tap
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

  // Only what the players changed is kept: the numbers themselves follow
  // the table, also when another device changes it under the open sheet.
  const edits = editsFor(changed, fight);
  const setEdits = (fn: (was: ReviewEdits) => ReviewEdits) => changed.change(fight.id, fn);
  const review = reviewCombat(game, fight, records, edits);
  const name = (seat: number) => game.config.profiles[seat]?.name ?? '?';
  const pod = game.players.length > 2;
  /** Adds to one of the typed-in numbers. */
  const add = (field: 'commander' | 'other' | 'poison' | 'gain', key: string | number, by: number) =>
    setEdits((e) => ({ ...e, [field]: { ...e[field], [key]: ((e[field] as Record<string, number>)[key] ?? 0) + by } }));
  const setDies = (u: ReviewUnit, n: number) => setEdits((e) => setDeaths(e, u, n));

  // A creature that fights in two places (a stack sent at two players, a
  // blocker in front of two attackers) dies as one: its tick is on the
  // first row it stands in, and the others only say what that came to.
  const ticked = new Set<string>();
  /** One side of one fight: the creature, and whether it dies. */
  function fighter(f: Fighter, blocking: boolean): ReactNode {
    const u = review.units.find((x) => x.id === reviewId(f.seat, f.unit));
    if (!u) return null;
    const first = !ticked.has(u.id);
    ticked.add(u.id);
    const whose = `${name(u.seat)}'s ${u.name}`;
    const art = unitArt(game!, f.seat, f.unit, records);
    return (
      <div className={`fight-unit${u.dies > 0 ? ' fight-unit--dying' : ''}`}>
        <span className="fight-art">{art ? <img src={art} alt="" loading="lazy" /> : null}</span>
        <span className="fight-text">
          <span className="fight-name">
            <span aria-hidden="true">{blocking ? '🛡 ' : '⚔ '}</span>
            {u.name} <strong>{u.size}</strong>
            {f.n > 1 ? ` ×${f.n}` : ''}
            {u.commander && <small className="hint-inline"> commander</small>}
          </span>
          {!first ? (
            <span className="fight-again">{u.dies > 0 ? (u.unit.kind === 'card' ? 'dies' : `${u.dies} of them die`) : 'lives'}</span>
          ) : u.unit.kind === 'card' ? (
            // One switch, two sides: the lit one is what happens to it.
            <label className={`review-tick dies-switch${u.dies > 0 ? ' dies-switch--on' : ''}`}>
              <input
                type="checkbox"
                checked={u.dies > 0}
                aria-label={`${whose} dies`}
                onChange={(e) => setDies(u, e.target.checked ? 1 : 0)}
              />
              <span className="dies-side dies-side--lives" aria-hidden="true">
                lives
              </span>
              <span className="dies-side dies-side--dies" aria-hidden="true">
                dies
              </span>
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
          {first && u.commander && u.dies > 0 && (
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
  }

  const rows = review.result.attacks.filter((row) => row.present && row.n > 0);

  return (
    <Sheet
      title="Review the damage"
      size="roomy"
      onClose={onClose}
      footer={
        <>
          <button className="primary" onClick={() => applyCombat(review.outcome, hitsOf(review))}>
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
        <span className="section-label">The fight, attack by attack</span>
        {rows.length === 0 && <p className="hint">Nobody is fighting.</p>}
        {rows.map((row) => {
          const attack = review.attacks.find((a) => a.index === row.index);
          const whose = `${name(row.seat)}'s ${row.name}`;
          // Named for its target wherever that is not plain: in a pod, and
          // for a stack that was sent at more than one player.
          const sent = review.attacks.filter((a) => sameUnit(a.unit, row.unit)).length;
          const at = pod || sent > 1 ? ` (${name(row.target)})` : '';
          return (
            <div className="fight" key={row.index}>
              {fighter(row, false)}
              <span className="fight-arrow" aria-hidden="true">
                →
              </span>
              <div className="fight-way">
                {row.blockers.filter((b) => b.present && b.n > 0).map((b, k) => (
                  <div key={k}>{fighter(b, true)}</div>
                ))}
                <div className="fight-end">
                  <span className={`fight-through${row.toPlayer > 0 ? '' : ' fight-through--none'}`}>
                    {row.toPlayer > 0 ? (
                      <>
                        <strong>−{row.toPlayer}</strong> to {name(row.target)}
                      </>
                    ) : (
                      `nothing to ${name(row.target)}`
                    )}
                  </span>
                  {/* Any attack can be ticked "blocked": a defender with nothing on the tablet never got to say so. */}
                  {attack && (
                    <label className="review-tick" title={attack.by ? `Blocked by ${attack.by}` : undefined}>
                      <input
                        type="checkbox"
                        checked={attack.blocked}
                        disabled={attack.fixed}
                        aria-label={`${whose} was blocked${at}`}
                        onChange={(e) =>
                          setEdits((was) => ({ ...was, blocked: { ...was.blocked, [attack.index]: e.target.checked } }))
                        }
                      />
                      blocked{at}
                    </label>
                  )}
                </div>
              </div>
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
