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

const EVERGREEN_KEYWORDS = [
  'Flying',
  'Trample',
  'Reach',
  'Lifelink',
  'Deathtouch',
  'First Strike',
  'Double Strike',
  'Haste',
  'Vigilance',
  'Menace',
  'Hexproof',
  'Indestructible',
  'Ward',
];

interface Props {
  playerIdx: number;
  onDone: () => void;
}

/** Body of the custom-token sheet; the host Sheet provides title and close. */
export default function CustomTokenForm({ playerIdx, onDone }: Props) {
  const addItem = useAppStore((s) => s.addItem);
  const [name, setName] = useState('');
  const [power, setPower] = useState('');
  const [toughness, setToughness] = useState('');
  const [color, setColor] = useState('C');
  const [keywords, setKeywords] = useState<string[]>([]);

  function toggleKeyword(kw: string) {
    setKeywords((prev) =>
      prev.includes(kw) ? prev.filter((k) => k !== kw) : [...prev, kw],
    );
  }

  function create() {
    addItem(
      playerIdx,
      createCustomToken(
        name.trim(),
        power.trim() === '' ? null : Number(power),
        toughness.trim() === '' ? null : Number(toughness),
        color,
        EVERGREEN_KEYWORDS.filter((kw) => keywords.includes(kw)),
      ),
    );
    onDone();
  }

  return (
    <div className="custom-token-form">
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
      <div className="chip-group">
        <span className="chip-group-label">Abilities</span>
        <div className="chip-row">
          {EVERGREEN_KEYWORDS.map((kw) => (
            <button
              key={kw}
              type="button"
              className={keywords.includes(kw) ? 'chip chip--selected' : 'chip'}
              aria-pressed={keywords.includes(kw)}
              onClick={() => toggleKeyword(kw)}
            >
              {kw}
            </button>
          ))}
        </div>
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
      <button className="primary" disabled={!name.trim()} onClick={create}>
        Create
      </button>
    </div>
  );
}
