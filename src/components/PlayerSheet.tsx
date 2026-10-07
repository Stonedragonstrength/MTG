import { seatCommanders } from '../lib/commanders';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';

const PLAYER_COUNTERS = [
  { key: 'poison', label: 'Poison', icon: '☠' },
  { key: 'energy', label: 'Energy', icon: '⚡' },
  { key: 'experience', label: 'Experience', icon: '✦' },
];

interface Props {
  playerIdx: number;
  onClose: () => void;
}

/** Per-player extras: poison/energy/experience, commander tax, badges. */
export default function PlayerSheet({ playerIdx, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const setPlayerCounter = useAppStore((s) => s.setPlayerCounter);
  const setCommanderDeaths = useAppStore((s) => s.setCommanderDeaths);
  const setCommanderReturns = useAppStore((s) => s.setCommanderReturns);
  const applyCommanderDamage = useAppStore((s) => s.applyCommanderDamage);
  const claimMonarch = useAppStore((s) => s.claimMonarch);
  const claimInitiative = useAppStore((s) => s.claimInitiative);
  const flipped = useAppStore((s) => s.seatFlips[playerIdx] === true);
  const setSeatFlip = useAppStore((s) => s.setSeatFlip);

  if (!game) return null;
  const player = game.players[playerIdx];
  const profile = game.config.profiles[playerIdx];
  // One row per enemy commander — a partner pair is two.
  const attackers = game.config.profiles.flatMap((_, j) =>
    j === playerIdx ? [] : seatCommanders(game, j),
  );
  // This seat's own commanders, when it tracks them per card: wherever each
  // one is by now, with how often it has gone home.
  const cards = player.cards;
  const everywhere = cards
    ? [cards.command, cards.battlefield, cards.graveyard, cards.exile, cards.hand, cards.library].flat()
    : [];
  const tracked = Object.keys(cards?.cmd ?? {})
    .sort() // the one order the gauges use too (lib/commanders.ts)
    .map((iid) => ({
      iid,
      name: everywhere.find((c) => c.iid === iid)?.name ?? 'Commander',
      returns: cards!.cmd![iid],
    }));

  return (
    <Sheet title={profile.name} onClose={onClose}>
      {PLAYER_COUNTERS.map(({ key, label, icon }) => {
        const value = player.counters[key] ?? 0;
        return (
          <div className="detail-row" key={key}>
            <span>
              {icon} {label}
              {key === 'poison' && <small className="hint-inline"> (10 is lethal)</small>}
            </span>
            <div className="stepper">
              <button
                aria-label={`less ${key}`}
                onClick={() => setPlayerCounter(playerIdx, key, value - 1)}
              >
                −
              </button>
              <span>{value}</span>
              <button
                aria-label={`more ${key}`}
                onClick={() => setPlayerCounter(playerIdx, key, value + 1)}
              >
                +
              </button>
            </div>
          </div>
        );
      })}

      {game.config.format === 'commander' &&
        attackers.map((attacker) => {
          const dmg = player.commanderDamage[attacker.key] ?? 0;
          return (
            <div className="detail-row" key={attacker.key}>
              <span>
                ⚔ Cmdr dmg from {attacker.label}
                <small className="hint-inline"> ({game.config.commanderDamageThreshold} is lethal)</small>
              </span>
              <div className="stepper">
                <button
                  aria-label={`less commander damage from ${attacker.label}`}
                  onClick={() => applyCommanderDamage(playerIdx, attacker.key, -1)}
                >
                  −
                </button>
                <span>{dmg}</span>
                <button
                  aria-label={`more commander damage from ${attacker.label}`}
                  onClick={() => applyCommanderDamage(playerIdx, attacker.key, 1)}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}

      {/* A seat that tracks its commanders per card: each has its own tax, and
          the seat-wide count below means nothing to it. A trip home that was
          counted wrongly (a death Review sent to the command zone by mistake)
          is put right here. */}
      {game.config.format === 'commander' &&
        tracked.map(({ iid, name, returns }) => (
          <div className="detail-row" key={iid}>
            <span>
              {name}: back to the command zone <small className="hint-inline">(tax +{returns * 2})</small>
            </span>
            <div className="stepper">
              <button
                aria-label={`fewer returns to the command zone for ${name}`}
                disabled={returns <= 0}
                onClick={() => setCommanderReturns(playerIdx, iid, returns - 1)}
              >
                −
              </button>
              <span>{returns}</span>
              <button
                aria-label={`more returns to the command zone for ${name}`}
                onClick={() => setCommanderReturns(playerIdx, iid, returns + 1)}
              >
                +
              </button>
            </div>
          </div>
        ))}

      {game.config.format === 'commander' && !player.cards?.cmd && (
        <div className="detail-row">
          <span>
            Commander deaths <small className="hint-inline">(tax +{player.commanderDeaths * 2})</small>
          </span>
          <div className="stepper">
            <button
              aria-label="fewer commander deaths"
              onClick={() => setCommanderDeaths(playerIdx, player.commanderDeaths - 1)}
            >
              −
            </button>
            <span>{player.commanderDeaths}</span>
            <button
              aria-label="more commander deaths"
              onClick={() => setCommanderDeaths(playerIdx, player.commanderDeaths + 1)}
            >
              +
            </button>
          </div>
        </div>
      )}

      <div className="detail-row">
        <span>Badges</span>
        <div className="stepper">
          <button
            className={game.monarchIdx === playerIdx ? 'badge-btn active' : 'badge-btn'}
            onClick={() => claimMonarch(playerIdx)}
          >
            👑 Monarch
          </button>
          <button
            className={game.initiativeIdx === playerIdx ? 'badge-btn active' : 'badge-btn'}
            onClick={() => claimInitiative(playerIdx)}
          >
            🗡 Initiative
          </button>
        </div>
      </div>

      {/* Where this player really sits at this screen: local, never part of the game. */}
      <div className="detail-row flip-row">
        <span className="settings-row-text">
          <span>Flip this side</span>
          <small>Turns this player's side of the table around on this device.</small>
        </span>
        <div className="stepper">
          <button
            className={flipped ? 'badge-btn active' : 'badge-btn'}
            aria-label="flip this side"
            aria-pressed={flipped}
            onClick={() => setSeatFlip(playerIdx, !flipped)}
          >
            {flipped ? '⇅ Flipped' : '⇅ Flip'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
