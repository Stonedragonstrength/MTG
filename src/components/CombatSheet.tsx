import { useMemo, useState } from 'react';
import { computedPT } from '../lib/board';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';

interface Props {
  onClose: () => void;
}

/** Combat math: pick attackers from tracked creatures, see total damage,
 * optionally apply it to the defender's life. */
export default function CombatSheet({ onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const adjustLife = useAppStore((s) => s.adjustLife);

  const [attackerIdx, setAttackerIdx] = useState(game?.activePlayerIndex ?? 0);
  const [defenderIdx, setDefenderIdx] = useState(() => {
    if (!game) return 0;
    const other = game.players.findIndex((p, i) => i !== game.activePlayerIndex && !p.eliminated);
    return other === -1 ? 0 : other;
  });
  const [attacking, setAttacking] = useState<Record<string, number>>({});
  const [blocked, setBlocked] = useState<Record<string, boolean>>({});

  const creatures = useMemo(
    () =>
      (game?.players[attackerIdx]?.board ?? [])
        .filter((it) => it.zone !== 'lands')
        .map((it) => ({ item: it, pt: computedPT(it) }))
        .filter((e): e is { item: (typeof e)['item']; pt: NonNullable<(typeof e)['pt']> } =>
          e.pt !== null,
        ),
    [game, attackerIdx],
  );

  if (!game) return null;
  const profiles = game.config.profiles;

  const total = creatures.reduce((sum, { item, pt }) => {
    if (blocked[item.id]) return sum;
    return sum + (attacking[item.id] ?? 0) * pt.power;
  }, 0);

  function sendEverything() {
    const all: Record<string, number> = {};
    for (const { item } of creatures) all[item.id] = item.count;
    setAttacking(all);
  }

  return (
    <Sheet title="Combat math" onClose={onClose} size="wide">
      <div className="combat-parties">
        <label>
          Attacker
          <select value={attackerIdx} onChange={(e) => setAttackerIdx(Number(e.target.value))}>
            {profiles.map((p, i) => (
              <option key={p.id} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <span className="combat-arrow">→</span>
        <label>
          Defender
          <select value={defenderIdx} onChange={(e) => setDefenderIdx(Number(e.target.value))}>
            {profiles.map((p, i) => (
              <option key={p.id} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {creatures.length === 0 ? (
        <p className="hint">No tracked creatures on {profiles[attackerIdx].name}'s board.</p>
      ) : (
        <>
          <button onClick={sendEverything}>Everything attacks</button>
          <div className="combat-list">
            {creatures.map(({ item, pt }) => (
              <div className="detail-row" key={item.id}>
                <span>
                  {item.name} <strong>{pt.power}/{pt.toughness}</strong> ×{item.count}
                </span>
                <div className="stepper">
                  <button
                    aria-label={`fewer ${item.name} attacking`}
                    onClick={() =>
                      setAttacking((a) => ({
                        ...a,
                        [item.id]: Math.max(0, (a[item.id] ?? 0) - 1),
                      }))
                    }
                  >
                    −
                  </button>
                  <span>{attacking[item.id] ?? 0}</span>
                  <button
                    aria-label={`more ${item.name} attacking`}
                    onClick={() =>
                      setAttacking((a) => ({
                        ...a,
                        [item.id]: Math.min(item.count, (a[item.id] ?? 0) + 1),
                      }))
                    }
                  >
                    +
                  </button>
                  <label className="blocked-toggle">
                    <input
                      type="checkbox"
                      aria-label={`${item.name} blocked`}
                      checked={blocked[item.id] ?? false}
                      onChange={(e) =>
                        setBlocked((b) => ({ ...b, [item.id]: e.target.checked }))
                      }
                    />
                    blocked
                  </label>
                </div>
              </div>
            ))}
          </div>
          <p className="combat-total" data-testid="combat-total">
            Total unblocked damage: <strong>{total}</strong>
          </p>
          <button
            className="primary"
            disabled={total === 0 || defenderIdx === attackerIdx}
            onClick={() => {
              adjustLife(defenderIdx, -total);
              onClose();
            }}
          >
            Deal {total} to {profiles[defenderIdx].name}
          </button>
        </>
      )}
    </Sheet>
  );
}
