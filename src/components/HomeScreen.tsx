import { useState } from 'react';
import type { PlayerProfile } from '../lib/types';
import { useAppStore } from '../state/store';
import NewGameScreen from './NewGameScreen';
import ProfileEditor from './ProfileEditor';

export default function HomeScreen() {
  const profiles = useAppStore((s) => s.profiles);
  const [view, setView] = useState<'home' | 'newgame'>('home');
  const [editing, setEditing] = useState<PlayerProfile | null>(null);
  const [creating, setCreating] = useState(false);

  if (view === 'newgame') return <NewGameScreen onBack={() => setView('home')} />;

  return (
    <div className="screen home">
      <h1>MTG Companion</h1>
      <div className="profile-grid">
        {profiles.map((p) => (
          <button key={p.id} className="profile-card" onClick={() => setEditing(p)}>
            {p.avatarUrl ? (
              <img className="avatar" src={p.avatarUrl} alt="" />
            ) : (
              <div className="avatar avatar--empty" />
            )}
            <span>{p.name}</span>
          </button>
        ))}
        <button className="profile-card add" onClick={() => setCreating(true)}>
          + New player
        </button>
      </div>
      <button className="big-button" disabled={profiles.length < 2} onClick={() => setView('newgame')}>
        New Game
      </button>
      {profiles.length < 2 && <p className="hint">Add at least two players to start a game.</p>}
      {(editing || creating) && (
        <ProfileEditor
          profile={editing}
          onDone={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
