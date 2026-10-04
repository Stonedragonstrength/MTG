import { useState } from 'react';
import { createCustomToken } from '../lib/board';
import { useAppStore } from '../state/store';

const COLORS = [
  { code: 'W', label: 'White' },
  { code: 'U', label: 'Blue' },
  { code: 'B', label: 'Black' },
  { code: 'R', label: 'Red' },
  { code: 'G', label: 'Green' },
  { code: 'C', label: 'Colorless' },
];

interface Props {
  playerIdx: number;
  onDone: () => void;
}

export default function CustomTokenForm({ playerIdx, onDone }: Props) {
  const addItem = useAppStore((s) => s.addItem);
  const [name, setName] = useState('');
  const [power, setPower] = useState('');
  const [toughness, setToughness] = useState('');
  const [color, setColor] = useState('C');

  function create() {
    addItem(
      playerIdx,
      createCustomToken(
        name.trim(),
        power.trim() === '' ? null : Number(power),
        toughness.trim() === '' ? null : Number(toughness),
        color,
      ),
    );
    onDone();
  }

  return (
    <div className="custom-token-form">
      <h3>Custom token</h3>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name" />
      </label>
      <div className="pt-inputs">
        <label>
          Power
          <input
            type="number"
            value={power}
            onChange={(e) => setPower(e.target.value)}
            placeholder="—"
          />
        </label>
        <label>
          Toughness
          <input
            type="number"
            value={toughness}
            onChange={(e) => setToughness(e.target.value)}
            placeholder="—"
          />
        </label>
      </div>
      <div className="color-swatches" role="radiogroup" aria-label="color">
        {COLORS.map((c) => (
          <button
            key={c.code}
            type="button"
            role="radio"
            aria-checked={color === c.code}
            aria-label={c.label}
            className={`swatch swatch-${c.code}${color === c.code ? ' selected' : ''}`}
            onClick={() => setColor(c.code)}
          />
        ))}
      </div>
      <div className="modal-actions">
        <button disabled={!name.trim()} onClick={create}>
          Create
        </button>
        <button className="ghost" onClick={onDone}>
          Back
        </button>
      </div>
    </div>
  );
}
