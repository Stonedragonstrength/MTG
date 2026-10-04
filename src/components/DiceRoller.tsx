import { useState } from 'react';
import { useAppStore } from '../state/store';

interface Props {
  onClose: () => void;
}

export default function DiceRoller({ onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const [result, setResult] = useState<string | null>(null);

  function roll(sides: number) {
    setResult(String(1 + Math.floor(Math.random() * sides)));
  }

  function coin() {
    setResult(Math.random() < 0.5 ? 'Heads' : 'Tails');
  }

  function whoGoesFirst() {
    if (!game) return;
    const alive = game.config.profiles;
    const pick = alive[Math.floor(Math.random() * alive.length)];
    setResult(`${pick.name} goes first!`);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal dice-roller" onClick={(e) => e.stopPropagation()}>
        <h2>Dice</h2>
        {result !== null && (
          <div className="dice-result" data-testid="dice-result">
            {result}
          </div>
        )}
        <div className="modal-actions">
          <button onClick={() => roll(6)}>d6</button>
          <button onClick={() => roll(20)}>d20</button>
          <button onClick={coin}>Coin</button>
        </div>
        <button onClick={whoGoesFirst}>Who goes first?</button>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
