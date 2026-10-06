import { useEffect, useState } from 'react';
import type { Format, PlayerProfile } from '../lib/types';
import { useAppStore } from '../state/store';

interface Props {
  onBack: () => void;
}

export default function NewGameScreen({ onBack }: Props) {
  const profiles = useAppStore((s) => s.profiles);
  const decks = useAppStore((s) => s.decks);
  const startGame = useAppStore((s) => s.startGame);
  const hostOnlineGame = useAppStore((s) => s.hostOnlineGame);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const seedSeatFromDeck = useAppStore((s) => s.seedSeatFromDeck);
  const [format, setFormat] = useState<Format>('commander');
  const [cardsMode, setCardsMode] = useState(false);
  const [where, setWhere] = useState<'local' | 'online'>('local');
  const [cloudReady, setCloudReady] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);
  const [hostError, setHostError] = useState('');
  const [threshold, setThreshold] = useState('21');
  const [selected, setSelected] = useState<string[]>([]);
  const [deckChoice, setDeckChoice] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      const { getCloudConfig, signedInEmail } = await import('../data/cloud');
      const cfg = await getCloudConfig();
      setCloudReady(!!cfg?.url && !!(await signedInEmail()));
    })();
  }, []);

  // The Virtual-cards box lives under Commander only; leaving the format
  // disarms it so no hidden cards-mode Standard game can start.
  useEffect(() => {
    if (format !== 'commander') setCardsMode(false);
  }, [format]);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev,
    );
  }

  /** A chosen deck brings its commander along for this game (and sticks
   * to the profile for next time). */
  function withDeck(profile: PlayerProfile): PlayerProfile {
    const deck = decks.find((d) => d.id === deckChoice[profile.id]);
    if (!deck?.commander) return profile;
    const patched = {
      ...profile,
      commanderName: deck.commander.name,
      commanderColors: deck.colors,
      commanderImage: deck.commander.imageNormal,
    };
    void saveProfile(patched);
    return patched;
  }

  function seedChosenDecks() {
    // Shared tablet (or host): every seat whose player picked a deck
    // gets seated with it. Guests on their own devices bring their own.
    selected.forEach((id, seatIdx) => {
      const deck = decks.find((d) => d.id === deckChoice[id]);
      if (deck) seedSeatFromDeck(seatIdx, deck);
    });
  }

  async function start() {
    const n = Number(threshold);
    const config = {
      format,
      startingLife: format === 'commander' ? (40 as const) : (20 as const),
      commanderDamageThreshold: Number.isFinite(n) && n >= 1 ? Math.floor(n) : 21,
      profiles: selected.map((id) => withDeck(profiles.find((p) => p.id === id)!)),
      ...(format === 'commander' && cardsMode ? { mode: 'cards' as const } : {}),
    };
    const seeding = format === 'commander' && cardsMode;
    if (where === 'online') {
      setHostBusy(true);
      setHostError('');
      const err = await hostOnlineGame(config);
      setHostBusy(false);
      if (err) setHostError(err);
      else if (seeding) seedChosenDecks();
      return;
    }
    startGame(config);
    if (seeding) seedChosenDecks();
  }

  return (
    <div className="screen new-game">
      <h2>New game</h2>
      <fieldset className="format-toggle">
        <legend>Where</legend>
        <label>
          <input
            type="radio"
            name="where"
            checked={where === 'local'}
            onChange={() => setWhere('local')}
          />
          This tablet (pass around)
        </label>
        <label>
          <input
            type="radio"
            name="where"
            disabled={!cloudReady}
            checked={where === 'online'}
            onChange={() => setWhere('online')}
          />
          Online — everyone's own device
          {!cloudReady && <small> (sign in under Settings → Curation cloud sync first)</small>}
        </label>
      </fieldset>
      <fieldset className="format-toggle">
        <legend>Format</legend>
        <label>
          <input
            type="radio"
            name="format"
            checked={format === 'commander'}
            onChange={() => setFormat('commander')}
          />
          Commander (40 life)
        </label>
        <label>
          <input
            type="radio"
            name="format"
            checked={format === 'standard'}
            onChange={() => setFormat('standard')}
          />
          Standard (20 life)
        </label>
      </fieldset>
      {format === 'commander' && (
        <label className="threshold">
          Commander damage to eliminate
          <input
            type="number"
            min={1}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
      )}
      <p>Who's playing? (2–4, in seat order)</p>
      <p className="hint">
        Tap in seating order: the first player gets the tablet's bottom edge, then clockwise
        around the table.
      </p>
      <div className="profile-grid">
        {profiles.map((p) => (
          <button
            key={p.id}
            className={selected.includes(p.id) ? 'profile-chip selected' : 'profile-chip'}
            onClick={() => toggle(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      {format === 'commander' && decks.length > 0 && (
        <label className="cards-mode-toggle">
          <input
            type="checkbox"
            aria-label="virtual cards"
            checked={cardsMode}
            onChange={(e) => setCardsMode(e.target.checked)}
          />
          Virtual cards — play your saved decks digitally (pick decks below)
        </label>
      )}
      {format === 'commander' && decks.length > 0 && selected.length > 0 && (
        <div className="deck-picks">
          {selected.map((id) => {
            const p = profiles.find((x) => x.id === id)!;
            return (
              <label key={id} className="deck-pick">
                Deck for {p.name}
                <select
                  value={deckChoice[id] ?? ''}
                  onChange={(e) =>
                    setDeckChoice((prev) => ({ ...prev, [id]: e.target.value }))
                  }
                >
                  <option value="">{p.commanderName ?? 'No deck'}</option>
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
      {hostError && <p className="hint join-error">{hostError}</p>}
      <div className="modal-actions">
        <button disabled={selected.length < 2 || hostBusy} onClick={() => void start()}>
          {hostBusy ? 'Opening table…' : 'Start game'}
        </button>
        <button className="ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
