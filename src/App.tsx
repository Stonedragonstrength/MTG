import { useEffect, useState } from 'react';
import GameScreen from './components/GameScreen';
import HomeScreen from './components/HomeScreen';
import SetupGate from './components/SetupGate';
import { useAppStore } from './state/store';
import './styles/screens.css';

export default function App() {
  const setupDone = useAppStore((s) => s.setupDone);
  const game = useAppStore((s) => s.game);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    useAppStore
      .getState()
      .init()
      .then(() => setReady(true));
  }, []);

  if (!ready) return <div className="screen boot">Loading…</div>;
  if (!setupDone) return <SetupGate />;
  if (!game) return <HomeScreen />;
  return <GameScreen />;
}
