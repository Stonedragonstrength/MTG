import { useEffect, useState, type CSSProperties } from 'react';
import { findCardByName } from '../data/scryfall';
import { registerBack } from '../lib/backstack';
import { playerStandings, winsOf } from '../lib/history';
import { COLOR_HEX } from '../lib/mana';
import { decided } from '../lib/story';
import type { PlayerProfile } from '../lib/types';
import { useAppStore } from '../state/store';
import DecksScreen from './DecksScreen';
import GarageScreen from './GarageScreen';
import HistoryScreen from './HistoryScreen';
import JoinTableSheet from './JoinTableSheet';
import LandBackground from './LandBackground';
import NewGameScreen from './NewGameScreen';
import ProfileEditor from './ProfileEditor';
import SettingsSheet from './SettingsSheet';

function profileAccent(profile: PlayerProfile): string {
  const colors = profile.commanderColors ?? [];
  return colors.length === 1 ? COLOR_HEX[colors[0]] : 'var(--accent)';
}

export default function HomeScreen() {
  const profiles = useAppStore((s) => s.profiles);
  const game = useAppStore((s) => s.game);
  const enterGame = useAppStore((s) => s.enterGame);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const [view, setView] = useState<'home' | 'newgame' | 'decks' | 'garage' | 'history'>('home');
  const [openDeck, setOpenDeck] = useState<string | null>(null);
  const decks = useAppStore((s) => s.decks);
  const garage = useAppStore((s) => s.garage);
  const games = useAppStore((s) => s.games);
  const [editing, setEditing] = useState<PlayerProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const { getCloudConfig } = await import('../data/cloud');
      setCloudReady(!!(await getCloudConfig())?.url);
    })();
  }, []);

  // However a sub-screen is left, the deck it was asked to open is spent.
  const goHome = () => {
    setOpenDeck(null);
    setView('home');
  };

  // Sub-screens answer the tablet's back button by returning home.
  useEffect(() => {
    if (view === 'home') return;
    return registerBack(goHome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // A sync can take the player being edited away: deleted on another device,
  // or found to be the same person as one the cloud already had (who then
  // keeps the cloud's id). Left open, the sheet's Save would bring them back
  // under an id no other device knows — so it closes.
  useEffect(() => {
    if (editing && !profiles.some((p) => p.id === editing.id)) setEditing(null);
  }, [editing, profiles]);

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

  if (view === 'newgame') return <NewGameScreen onBack={goHome} />;
  if (view === 'history') return <HistoryScreen onBack={goHome} />;
  if (view === 'decks') return <DecksScreen initialOpenId={openDeck ?? undefined} onBack={goHome} />;
  if (view === 'garage')
    return (
      <GarageScreen
        onBack={goHome}
        // A deck started from a Curation suggestion opens in its editor.
        onOpenDeck={(deckId) => {
          setOpenDeck(deckId);
          setView('decks');
        }}
      />
    );

  const savedNames = game?.config.profiles.map((p) => p.name).join(' · ');
  const leader = playerStandings(games)[0];
  const over = game ? decided(game) : null;

  return (
    <div className="screen home">
      {/* The table's own art behind everything, slowly changing. */}
      <div className="home-backdrop" aria-hidden="true">
        <LandBackground cycle={24} />
        <div className="home-vignette" />
      </div>
      <button
        className="ghost home-settings"
        aria-label="settings"
        onClick={() => setSettingsOpen(true)}
      >
        ⚙ Settings
      </button>
      <img className="home-crest" src="/icons/icon-192.png" alt="" draggable={false} />
      <h1 className="home-title">
        <span className="home-title-main">MTG Battlefield</span>
        <span className="home-title-sub">Hub &amp; Tracker</span>
      </h1>

      <div className="home-actions">
        {game && (
          <button className="action-card action-card--hero action-card--resume" onClick={enterGame}>
            <span className="action-card-title">Pick up game</span>
            <span className="action-card-sub">
              {over !== null
                ? `${typeof over === 'number' ? `${game.config.profiles[over]?.name} won` : 'A draw'} · see the results`
                : `Turn ${game.turnNumber} · ${savedNames}`}
            </span>
            {over === null && (
              <span className="action-card-lives" aria-hidden="true">
                {game.players.map((pl, i) => (
                  <span key={pl.profileId} className={pl.eliminated ? 'resume-life resume-life--out' : 'resume-life'}>
                    {game.config.profiles[i]?.name} <strong>{pl.life}</strong>
                  </span>
                ))}
              </span>
            )}
          </button>
        )}
        <button
          className="action-card action-card--hero action-card--new"
          disabled={profiles.length < 2}
          onClick={() => setView('newgame')}
        >
          <span className="action-card-title">New Game</span>
          <span className="action-card-sub">
            {profiles.length < 2 ? 'Add two players first' : 'Shuffle up'}
          </span>
        </button>
      </div>

      <div className="home-actions home-actions--tiles">
        {cloudReady && (
          <button className="action-card action-card--tile" onClick={() => setJoinOpen(true)}>
            <span className="action-icon" aria-hidden="true">🌐</span>
            <span className="action-card-title">Join table</span>
            <span className="action-card-sub">Enter a friend's code</span>
          </button>
        )}
        <button className="action-card action-card--tile" onClick={() => setView('decks')}>
          <span className="action-icon" aria-hidden="true">🂠</span>
          <span className="action-card-title">Decks</span>
          <span className="action-card-sub">
            {decks.length > 0
              ? `${decks.length} ${decks.length === 1 ? 'deck' : 'decks'} saved`
              : 'Build & keep lists'}
          </span>
        </button>
        <button className="action-card action-card--tile" onClick={() => setView('garage')}>
          <span className="action-icon" aria-hidden="true">📚</span>
          <span className="action-card-title">Curation</span>
          <span className="action-card-sub">
            {garage.length > 0
              ? `${garage.reduce((s, g) => s + g.count, 0)} cards swiped`
              : 'Your collection'}
          </span>
        </button>
        <button className="action-card action-card--tile" onClick={() => setView('history')}>
          <span className="action-icon" aria-hidden="true">🏆</span>
          <span className="action-card-title">History</span>
          <span className="action-card-sub">
            {games.length === 0
              ? 'Winners & recaps'
              : `${games.length} ${games.length === 1 ? 'game' : 'games'}${leader && leader.wins > 0 ? ` · ${leader.name} leads` : ''}`}
          </span>
        </button>
      </div>

      <h2 className="home-section">Players</h2>
      <div className="profile-grid">
        {profiles.map((p) => (
          <button
            key={p.id}
            className={p.avatarUrl || p.commanderImage ? 'profile-card profile-card--art' : 'profile-card'}
            style={
              {
                borderColor: profileAccent(p),
                '--art': p.avatarUrl || p.commanderImage ? `url("${p.avatarUrl ?? p.commanderImage}")` : undefined,
              } as CSSProperties
            }
            onClick={() => setEditing(p)}
          >
            {p.avatarUrl ? (
              <img className="avatar avatar--big" src={p.avatarUrl} alt="" />
            ) : (
              <div className="avatar avatar--big avatar--empty" />
            )}
            <span className="profile-name">{p.name}</span>
            {winsOf(games, p.id) > 0 && (
              <span className="profile-wins">
                🏆 {winsOf(games, p.id)} {winsOf(games, p.id) === 1 ? 'win' : 'wins'}
              </span>
            )}
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
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {joinOpen && <JoinTableSheet onClose={() => setJoinOpen(false)} />}
    </div>
  );
}
