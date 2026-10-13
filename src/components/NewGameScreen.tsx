import { useEffect, useRef, useState } from 'react';
import type { Deck, Format, PlayerProfile } from '../lib/types';
import { useAppStore } from '../state/store';

interface Props {
  onBack: () => void;
}

/** How the table plays: real cards with the tablet keeping score, or saved
 * decks dealt and played on screen. */
type Play = 'assistant' | 'tablet';

export default function NewGameScreen({ onBack }: Props) {
  const profiles = useAppStore((s) => s.profiles);
  const decks = useAppStore((s) => s.decks);
  const startGame = useAppStore((s) => s.startGame);
  const hostOnlineGame = useAppStore((s) => s.hostOnlineGame);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const seedSeatFromDeck = useAppStore((s) => s.seedSeatFromDeck);
  const [play, setPlay] = useState<Play>('assistant');
  const [pickedFormat, setPickedFormat] = useState<Format>('commander');
  const [where, setWhere] = useState<'local' | 'online'>('local');
  const [cloudReady, setCloudReady] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);
  const [hostError, setHostError] = useState('');
  const [threshold, setThreshold] = useState('21');
  const [selected, setSelected] = useState<string[]>([]);
  // Only what was chosen on this screen ('' = "no deck", chosen on purpose).
  // A player nobody chose for sits down with the deck attached to them.
  const [deckChoice, setDeckChoice] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      const { getCloudConfig, signedInEmail } = await import('../data/cloud');
      const cfg = await getCloudConfig();
      setCloudReady(!!cfg?.url && !!(await signedInEmail()));
    })();
  }, []);

  // Leaving this screen while a table is still being created calls it off.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  // Playing on the tablet needs a deck to play. A sync can delete the last
  // one while this screen is open: then it is the Assistant again.
  const onTablet = play === 'tablet' && decks.length > 0;
  // Decks on screen are Commander decks, whatever format was picked before.
  const format: Format = onTablet ? 'commander' : pickedFormat;
  const pickingDecks = format === 'commander' && decks.length > 0;

  // A sync can take a player away while this screen is open (deleted on
  // another device, or found to be one the cloud already had): only players
  // still in the list are seated.
  const here = (id: string) => profiles.some((p) => p.id === id);
  const seated = selected.filter(here);

  function toggle(id: string) {
    setSelected((prev) => {
      const live = prev.filter(here);
      if (live.includes(id)) return live.filter((x) => x !== id);
      return live.length < 4 ? [...live, id] : live;
    });
  }

  /** The deck this player sits down with: the one chosen here, else the one
   * attached to them. Only decks still saved count (a sync can delete one). */
  function deckFor(profile: PlayerProfile): Deck | undefined {
    if (!pickingDecks) return undefined;
    const id = profile.id in deckChoice ? deckChoice[profile.id] : profile.deckId;
    return id ? decks.find((d) => d.id === id) : undefined;
  }

  const seatedProfiles = seated.map((id) => profiles.find((p) => p.id === id)!);
  const needsADeck = onTablet && !seatedProfiles.some((p) => deckFor(p));

  /** A chosen deck stays attached to the player for next time, and brings
   * its commander along for this game. One save, and only when something
   * about the player actually changed. */
  function withDeck(profile: PlayerProfile): PlayerProfile {
    if (!pickingDecks) return profile;
    const deck = deckFor(profile);
    let patched = profile;
    if (deck) {
      patched = { ...profile, deckId: deck.id };
      if (deck.commander) {
        patched = {
          ...patched,
          commanderName: deck.commander.name,
          // A pair's second commander rides along (commander damage is counted
          // per commander); a solo deck clears whatever the last deck left.
          partnerName: deck.partner?.name ?? null,
          commanderColors: deck.colors,
          commanderImage: deck.commander.imageNormal,
        };
      }
    } else if (deckChoice[profile.id] === '' && profile.deckId) {
      // "No deck" chosen on purpose over the attached one: it comes off.
      patched = { ...profile, deckId: null };
    }
    const same =
      (patched.deckId ?? null) === (profile.deckId ?? null) &&
      patched.commanderName === profile.commanderName &&
      (patched.partnerName ?? null) === (profile.partnerName ?? null) &&
      (patched.commanderColors ?? []).join() === (profile.commanderColors ?? []).join() &&
      (patched.commanderImage ?? null) === (profile.commanderImage ?? null);
    if (same) return profile;
    void saveProfile(patched);
    return patched;
  }

  async function start() {
    const n = Number(threshold);
    // Shared tablet (or host): every seat whose player has a deck gets
    // seated with it. Guests on their own devices bring their own.
    const toDeal = onTablet
      ? seatedProfiles.flatMap((p, seatIdx) => {
          const deck = deckFor(p);
          return deck ? [{ seatIdx, deck }] : [];
        })
      : [];
    const seedChosenDecks = () => toDeal.forEach(({ seatIdx, deck }) => seedSeatFromDeck(seatIdx, deck));
    const config = {
      format,
      startingLife: format === 'commander' ? (40 as const) : (20 as const),
      commanderDamageThreshold: Number.isFinite(n) && n >= 1 ? Math.floor(n) : 21,
      profiles: seatedProfiles.map(withDeck),
      ...(onTablet ? { mode: 'cards' as const } : {}),
    };
    if (where === 'online') {
      setHostBusy(true);
      setHostError('');
      // The store asks once, when the table answers. A hosted table swaps
      // this screen for the game, so "is it still mounted" afterwards cannot
      // tell success from walking away — what was answered can.
      let calledOff = false;
      const err = await hostOnlineGame(config, () => {
        calledOff = !open.current;
        return open.current;
      });
      if (calledOff) return;
      setHostBusy(false);
      if (err) setHostError(err);
      else seedChosenDecks();
      return;
    }
    startGame(config);
    seedChosenDecks();
  }

  return (
    <div className="screen new-game">
      <h2>New game</h2>
      <div className="play-choice" role="radiogroup" aria-label="How are you playing?">
        <button
          type="button"
          role="radio"
          aria-checked={!onTablet}
          className={onTablet ? 'play-card' : 'play-card selected'}
          onClick={() => setPlay('assistant')}
        >
          <span className="play-card-title">Assistant</span>
          <span className="play-card-line">
            Real cards on the table. The tablet keeps life, tokens, lands and commander damage.
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={onTablet}
          disabled={decks.length === 0}
          className={onTablet ? 'play-card selected' : 'play-card'}
          onClick={() => setPlay('tablet')}
        >
          <span className="play-card-title">Play on the tablet</span>
          <span className="play-card-line">
            Your saved decks are shuffled, dealt and played on screen.
          </span>
          {decks.length === 0 && (
            <span className="play-card-hint">Build a deck first (Home → Decks).</span>
          )}
        </button>
      </div>
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
          {!cloudReady && <small> (sign in under Settings → Cloud sync first)</small>}
        </label>
      </fieldset>
      {!onTablet && (
        <fieldset className="format-toggle">
          <legend>Format</legend>
          <label>
            <input
              type="radio"
              name="format"
              checked={format === 'commander'}
              onChange={() => setPickedFormat('commander')}
            />
            Commander (40 life)
          </label>
          <label>
            <input
              type="radio"
              name="format"
              checked={format === 'standard'}
              onChange={() => setPickedFormat('standard')}
            />
            Standard (20 life)
          </label>
        </fieldset>
      )}
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
            className={seated.includes(p.id) ? 'profile-chip selected' : 'profile-chip'}
            onClick={() => toggle(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      {pickingDecks && seatedProfiles.length > 0 && (
        <div className="deck-picks">
          {seatedProfiles.map((p) => (
            <label key={p.id} className="deck-pick">
              <span>{onTablet ? `Deck for ${p.name}` : `Commander deck for ${p.name}`}</span>
              <select
                value={deckFor(p)?.id ?? ''}
                onChange={(e) => setDeckChoice((prev) => ({ ...prev, [p.id]: e.target.value }))}
              >
                {!onTablet && <option value="">No deck</option>}
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
                {onTablet && <option value="">No deck — real cards (assistant seat)</option>}
              </select>
            </label>
          ))}
        </div>
      )}
      {needsADeck && seatedProfiles.length > 0 && (
        <p className="hint">Pick a deck for at least one player.</p>
      )}
      {hostError && <p className="hint join-error">{hostError}</p>}
      <div className="modal-actions">
        <button
          disabled={seated.length < 2 || hostBusy || needsADeck}
          onClick={() => void start()}
        >
          {hostBusy ? 'Opening table…' : 'Start game'}
        </button>
        <button className="ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
