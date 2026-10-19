import { useEffect, useState } from 'react';
import { readUnits } from '../lib/combatEngine';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';
import { useTableRecords } from './useCombat';
import { useSettleTaps } from './useSettleTaps';

interface Props {
  playerIdx: number;
  /** The Vehicle. */
  iid: string;
  /** Its crew number: the power the creatures that crew it must add up to. */
  crew: number;
  onClose: () => void;
}

/** Crew a Vehicle: the seat's untapped creatures, each with its power — a
 * summoning-sick one too, crewing is no attack. Tap the ones that crew it
 * (of a token stack, so many copies); once their power adds up to the
 * Vehicle's number, Crew taps them and the Vehicle is a creature until the
 * turn ends. One move, one Undo. */
export default function CrewSheet({ playerIdx, iid, crew, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const crewVehicle = useAppStore((s) => s.crewVehicle);
  const records = useTableRecords();
  // Copies picked, by `card:<iid>` / `stack:<id>`.
  const [picked, setPicked] = useState<Record<string, number>>({});
  useSettleTaps();
  const vehicle = game?.players[playerIdx]?.cards?.battlefield.find((c) => c.iid === iid);
  const gone = !vehicle;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!game || !vehicle) return null;

  const player = game.players[playerIdx];
  // What can crew it: untapped creatures (copies of a stack), never itself.
  const units = readUnits(game, playerIdx, records).flatMap((u) => {
    if (!u.creature || (u.unit.kind === 'card' && u.unit.id === iid)) return [];
    const free =
      u.unit.kind === 'card'
        ? player.cards?.battlefield.find((c) => c.iid === u.unit.id)?.tapped
          ? 0
          : 1
        : Math.max(0, u.count - (player.board.find((it) => it.id === u.unit.id)?.tapped ?? 0));
    if (free === 0) return [];
    const art =
      u.unit.kind === 'card'
        ? (records[player.cards?.battlefield.find((c) => c.iid === u.unit.id)?.cardId ?? '']?.imageNormal ?? null)
        : (player.board.find((it) => it.id === u.unit.id)?.imageNormal ?? null);
    return [{ key: `${u.unit.kind}:${u.unit.id}`, unit: u.unit, name: u.name, power: u.power, unread: u.unread, free, art }];
  });
  const power = units.reduce((sum, u) => sum + (picked[u.key] ?? 0) * u.power, 0);
  const enough = power >= crew;
  const set = (key: string, n: number, free: number) => setPicked({ ...picked, [key]: Math.max(0, Math.min(free, n)) });

  function crewIt() {
    const chosen = units
      .filter((u) => (picked[u.key] ?? 0) > 0)
      .map((u) => ({ kind: u.unit.kind as 'card' | 'stack', id: u.unit.id, n: picked[u.key] }));
    crewVehicle(playerIdx, iid, chosen);
    onClose();
  }

  return (
    <Sheet
      title={`Crew ${vehicle.name}`}
      onClose={onClose}
      footer={
        <div className="pay-foot">
          <div className="pay-tally" aria-live="polite">
            <span className={enough ? 'pay-paid' : 'pay-paid pay-paid--short'}>{`Power ${power} of ${crew}`}</span>
          </div>
          <button className="ghost" onClick={onClose}>
            Back
          </button>
          <button className="primary" onClick={crewIt}>
            {enough ? 'Crew' : 'Crew anyway'}
          </button>
        </div>
      }
    >
      <p className="hint">
        Tap creatures with total power {crew} or more. It becomes an artifact creature until end of turn.
      </p>
      {units.length === 0 ? (
        <p className="hint">No untapped creature to crew it with.</p>
      ) : (
        <ul className="attach-list">
          {units.map((u) => {
            const n = picked[u.key] ?? 0;
            const top = (
              <>
                {u.art ? <img className="pile-art" src={u.art} alt="" loading="lazy" /> : <span className="pile-art pile-art--empty" />}
                <span className="pile-name">
                  {u.name}
                  {u.free > 1 && <small> ×{u.free}</small>}
                </span>
                <span className="attach-size">power {u.unread ? '?' : u.power}</span>
              </>
            );
            return (
              <li key={u.key}>
                {u.free > 1 ? (
                  <div className={n > 0 ? 'attach-row attach-row--on crew-row' : 'attach-row crew-row'}>
                    {top}
                    <span className="pay-step">
                      <button aria-label={`one fewer ${u.name}`} disabled={n === 0} onClick={() => set(u.key, n - 1, u.free)}>
                        −
                      </button>
                      <span className="pay-say">{n}</span>
                      <button aria-label={`one more ${u.name}`} disabled={n >= u.free} onClick={() => set(u.key, n + 1, u.free)}>
                        +
                      </button>
                    </span>
                  </div>
                ) : (
                  <button
                    className={n > 0 ? 'attach-row attach-row--on' : 'attach-row'}
                    aria-pressed={n > 0}
                    aria-label={`crew with ${u.name}`}
                    onClick={() => set(u.key, n > 0 ? 0 : 1, 1)}
                  >
                    {top}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
