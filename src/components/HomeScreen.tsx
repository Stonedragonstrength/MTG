import { useEffect, useState } from 'react';
import { findCardByName } from '../data/scryfall';
import { COLOR_HEX } from '../lib/mana';
import type { PlayerProfile } from '../lib/types';
import { useAppStore } from '../state/store';
import DecksScreen from './DecksScreen';
import NewGameScreen from './NewGameScreen';
import ProfileEditor from './ProfileEditor';

function profileAccent(profile: PlayerProfile): string {
  const colors = profile.commanderColors ?? [];
  return colors.length === 1 ? COLOR_HEX[colors[0]] : 'var(--accent)';
}

export default function HomeScreen() {
  const profiles = useAppStore((s) => s.profiles);
  const game = useAppStore((s) => s.game);
  const enterGame = useAppStore((s) => s.enterGame);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const [view, setView] = useState<'home' | 'newgame' | 'decks'>('home');
  const decks = useAppStore((s) => s.decks);
  const [editing, setEditing] = useState<PlayerProfile | null>(null);
  const [creating, setCreating] = useState(false);

  // Older profiles picked a commander before we stored its card image.
  useEffect(() => {
    for (const p of profiles) {
      if (p.commanderName && !p.commanderImage) {
        findCardByName(p.commanderName)
          .then((card) => {
            if (card?.imageNormal) {
              void saveProfile({
                ...p,
                commanderImage: card.imageNormal,
                commanderColors: p.commanderColors ?? card.colorIdentity ?? card.colors,
              });
            }
          })
          .catch(() => {});
      }
    }
  }, [profiles, saveProfile]);

  if (view === 'newgame') return <NewGameScreen onBack={() => setView('home')} />;
  if (view === 'decks') return <DecksScreen onBack={() => setView('home')} />;

  const savedNames = game?.config.profiles.map((p) => p.name).join(' · ');

  return (
    <div className="screen home">
      <h1 className="home-title">
        <span className="home-title-main">MTG Battlefield</span>
        <span className="home-title-sub">Hub &amp; Tracker</span>
      </h1>

      <div className="home-actions">
        {game && (
          <button className="action-card action-card--resume" onClick={enterGame}>
            <span className="action-card-title">Pick up game</span>
            <span className="action-card-sub">
              Turn {game.turnNumber} · {savedNames}
            </span>
          </button>
        )}
        <button
          className="action-card action-card--new"
          disabled={profiles.length < 2}
          onClick={() => setView('newgame')}
        >
          <span className="action-card-title">New Game</span>
          <span className="action-card-sub">
            {profiles.length < 2 ? 'Add two players first' : 'Shuffle up'}
          </span>
        </button>
        <button className="action-card" onClick={() => setView('decks')}>
          <span className="action-card-title">Decks</span>
          <span className="action-card-sub">
            {decks.length > 0
              ? `${decks.length} ${decks.length === 1 ? 'deck' : 'decks'} saved`
              : 'Build & keep lists'}
          </span>
        </button>
      </div>

      <div className="profile-grid">
        {profiles.map((p) => (
          <button
            key={p.id}
            className="profile-card"
            style={{ borderColor: profileAccent(p) }}
            onClick={() => setEditing(p)}
          >
            {p.avatarUrl ? (
              <img className="avatar avatar--big" src={p.avatarUrl} alt="" />
            ) : (
              <div className="avatar avatar--big avatar--empty" />
            )}
            <span className="profile-name">{p.name}</span>
            {p.commanderImage && (
              <img
                className="profile-commander-card"
                src={p.commanderImage}
                alt={p.commanderName ?? 'commander'}
                loading="lazy"
              />
            )}
            {p.commanderName && <span className="profile-commander">{p.commanderName}</span>}
            {(p.commanderColors ?? []).length > 0 && (
              <span className="profile-pips">
                {(p.commanderColors ?? []).map((c) => (
                  <span key={c} className={`mana-pip mana-pip--mini mana-${c}`} />
                ))}
              </span>
            )}
          </button>
        ))}
        <button className="profile-card profile-card--add" onClick={() => setCreating(true)}>
          <span className="profile-add-plus">+</span>
          <span className="profile-name">New player</span>
        </button>
      </div>

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
