import { useEffect, useState } from 'react';
import { importBulkData } from '../data/scryfall';
import {
  getSettings,
  saveSettings,
  type BackgroundMode,
  type Settings,
} from '../data/settings';
import { useAppStore } from '../state/store';
import Sheet from './Sheet';

const MODES: { value: BackgroundMode; label: string }[] = [
  { value: 'all', label: 'All five lands' },
  { value: 'plains', label: 'Plains only' },
  { value: 'island', label: 'Island only' },
  { value: 'swamp', label: 'Swamp only' },
  { value: 'mountain', label: 'Mountain only' },
  { value: 'forest', label: 'Forest only' },
  { value: 'off', label: 'Off' },
];

interface Props {
  onClose: () => void;
}

export default function SettingsSheet({ onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  function update(mode: BackgroundMode) {
    const next = { ...(settings ?? { backgroundMode: 'all' as const }), backgroundMode: mode };
    setSettings(next);
    saveSettings(next).catch(() => {});
  }

  async function refreshCards() {
    setRefreshing(true);
    try {
      await importBulkData((_pct, msg) => setRefreshMsg(msg));
      setRefreshMsg('Card database updated.');
    } catch (err) {
      setRefreshMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="settings-row">
        <div className="settings-row-text">
          <span>Land background</span>
          <small>Artwork behind the table, changes each turn</small>
        </div>
        <select
          aria-label="land background"
          value={settings?.backgroundMode ?? 'all'}
          onChange={(e) => update(e.target.value as BackgroundMode)}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {game && (
        <div className="settings-row">
          <div className="settings-row-text">
            <span>Commander damage threshold</span>
            <small>Set per game on the New Game screen</small>
          </div>
          <span className="settings-value">{game.config.commanderDamageThreshold}</span>
        </div>
      )}

      <div className="settings-row">
        <div className="settings-row-text">
          <span>Card database</span>
          <small>{refreshMsg || 'Re-download when new sets come out (needs wifi)'}</small>
        </div>
        <button disabled={refreshing} onClick={refreshCards}>
          {refreshing ? 'Updating…' : 'Update'}
        </button>
      </div>
    </Sheet>
  );
}
