import { useState } from 'react';
import { prepareArtwork } from '../data/images';
import { ensureRulesLoaded } from '../data/rules';
import { importBulkData } from '../data/scryfall';
import { useAppStore } from '../state/store';

type Phase = 'idle' | 'working' | 'error';

export default function SetupGate() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function run() {
    setPhase('working');
    setError('');
    try {
      await importBulkData((p, m) => {
        setPct(p);
        setMsg(m);
      });
      await ensureRulesLoaded();
      setMsg('Preparing artwork…');
      await prepareArtwork((done, total) => {
        setMsg(`Preparing artwork… ${done} / ${total}`);
      });
      useAppStore.getState().completeSetup();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }

  return (
    <div className="screen setup-gate">
      <h1 className="home-title">
        <span className="home-title-main">MTG Battlefield</span>
        <span className="home-title-sub">Hub &amp; Tracker</span>
      </h1>
      <p>
        First-time setup needs a one-time download of the full card database (~150MB) and the
        comprehensive rules. After this, everything works offline. Make sure you are on wifi.
      </p>
      {phase === 'idle' && <button onClick={run}>Download card database</button>}
      {phase === 'working' && (
        <div className="progress">
          <progress max={100} value={pct} />
          <p>{msg}</p>
        </div>
      )}
      {phase === 'error' && (
        <div className="error">
          <p>{error}</p>
          <button onClick={run}>Retry</button>
        </div>
      )}
    </div>
  );
}
