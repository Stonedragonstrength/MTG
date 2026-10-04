import { useEffect, useState } from 'react';
import GameScreen from './components/GameScreen';
import HomeScreen from './components/HomeScreen';
import SetupGate from './components/SetupGate';
import { kvDelete } from './data/db';
import { useAppStore } from './state/store';
import './styles/screens.css';
import './styles/sheets.css';

export default function App() {
  const setupDone = useAppStore((s) => s.setupDone);
  const game = useAppStore((s) => s.game);
  const inGame = useAppStore((s) => s.inGame);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    useAppStore
      .getState()
      .init()
      .then(() => setReady(true))
      .catch((err) => setBootError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function startFresh() {
    try {
      await kvDelete('activeGame');
    } catch {
      // DB may be unusable; reload regardless.
    }
    location.reload();
  }

  if (bootError) {
    return (
      <div className="screen">
        <h1>MTG Companion</h1>
        <p>Couldn't start up.</p>
        <p className="error">{bootError}</p>
        <button onClick={() => void startFresh()}>Start fresh</button>
      </div>
    );
  }

  if (!ready) return <div className="screen boot">Loading…</div>;
  if (!setupDone) return <SetupGate />;
  if (!game || !inGame) return <HomeScreen />;
  return <GameScreen />;
}
