import { useEffect, useState } from 'react';
import { importBulkData } from '../data/scryfall';
import {
  getSettings,
  saveSettings,
  type BackgroundMode,
  type Settings,
} from '../data/settings';
import { useAppStore } from '../state/store';

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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label>
          Background
          <select
            value={settings?.backgroundMode ?? 'all'}
            onChange={(e) => update(e.target.value as BackgroundMode)}
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {game && (
          <p className="hint">
            Commander damage threshold this game: {game.config.commanderDamageThreshold}
          </p>
        )}
        <div>
          <button disabled={refreshing} onClick={refreshCards}>
            {refreshing ? 'Updating…' : 'Re-download card data'}
          </button>
          {refreshMsg && <p className="hint">{refreshMsg}</p>}
        </div>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
