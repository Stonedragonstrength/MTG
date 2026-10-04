import { useState } from 'react';
import type { Format } from '../lib/types';
import { useAppStore } from '../state/store';

interface Props {
  onBack: () => void;
}

export default function NewGameScreen({ onBack }: Props) {
  const profiles = useAppStore((s) => s.profiles);
  const startGame = useAppStore((s) => s.startGame);
  const [format, setFormat] = useState<Format>('commander');
  const [threshold, setThreshold] = useState('21');
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev,
    );
  }

  function start() {
    const n = Number(threshold);
    startGame({
      format,
      startingLife: format === 'commander' ? 40 : 20,
      commanderDamageThreshold: Number.isFinite(n) && n >= 1 ? Math.floor(n) : 21,
      profiles: selected.map((id) => profiles.find((p) => p.id === id)!),
    });
  }

  return (
    <div className="screen new-game">
      <h2>New game</h2>
      <fieldset className="format-toggle">
        <legend>Format</legend>
        <label>
          <input
            type="radio"
            name="format"
            checked={format === 'commander'}
            onChange={() => setFormat('commander')}
          />
          Commander (40 life)
        </label>
        <label>
          <input
            type="radio"
            name="format"
            checked={format === 'standard'}
            onChange={() => setFormat('standard')}
          />
          Standard (20 life)
        </label>
      </fieldset>
      {format === 'commander' && (
        <label className="threshold">
          Commander damage to eliminate
          <input
            type="number"
            min={1}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
      )}
      <p>Who's playing? (2–4, in seat order)</p>
      <p className="hint">
        Tap in seating order: the first player gets the tablet's bottom edge, then clockwise
        around the table.
      </p>
      <div className="profile-grid">
        {profiles.map((p) => (
          <button
            key={p.id}
            className={selected.includes(p.id) ? 'profile-chip selected' : 'profile-chip'}
            onClick={() => toggle(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button disabled={selected.length < 2} onClick={start}>
          Start game
        </button>
        <button className="ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
