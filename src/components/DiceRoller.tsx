import { useState } from 'react';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';

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
    const profiles = game.config.profiles;
    const pick = profiles[Math.floor(Math.random() * profiles.length)];
    setResult(`${pick.name} goes first!`);
  }

  return (
    <Sheet title="Dice" onClose={onClose}>
      <div className="dice-result-slot">
        {result !== null ? (
          <div className="dice-result" data-testid="dice-result">
            {result}
          </div>
        ) : (
          <p className="hint">Roll something.</p>
        )}
      </div>
      <div className="dice-grid">
        <button onClick={() => roll(6)}>d6</button>
        <button onClick={() => roll(20)}>d20</button>
        <button onClick={coin}>Coin flip</button>
        <button onClick={whoGoesFirst}>Who goes first?</button>
      </div>
    </Sheet>
  );
}
