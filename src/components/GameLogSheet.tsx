import { useAppStore } from '../state/store';
import Sheet from './Sheet';

interface Props {
  onClose: () => void;
}

function clock(t: number): string {
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function GameLogSheet({ onClose }: Props) {
  const log = useAppStore((s) => s.log);
  const game = useAppStore((s) => s.game);

  const startedAt = log[0]?.t;
  const minutes = startedAt ? Math.round((Date.now() - startedAt) / 60000) : 0;

  return (
    <Sheet title="Game log" onClose={onClose} size="wide">
      {game && (
        <p className="hint">
          Turn {game.turnNumber} · {minutes} min played · {log.length} events
        </p>
      )}
      <ul className="log-list">
        {log.map((entry, i) => (
          <li key={i}>
            <span className="log-time">{clock(entry.t)}</span>
            <span>{entry.text}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
