import { useState } from 'react';
import { importBulkData } from '../data/scryfall';
import type { BackgroundMode } from '../data/settings';
import { useAppStore } from '../state/store';
import { invalidateNameIndex } from './nameIndexCache';
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
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');

  async function refreshCards() {
    setRefreshing(true);
    try {
      await importBulkData((_pct, msg) => setRefreshMsg(msg));
      invalidateNameIndex();
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
          <small>Artwork behind the table</small>
        </div>
        <select
          aria-label="land background"
          value={settings.backgroundMode}
          onChange={(e) =>
            updateSettings({ ...settings, backgroundMode: e.target.value as BackgroundMode })
          }
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span>Background intensity</span>
          <small>How bright the art shows through</small>
        </div>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          aria-label="background intensity"
          value={settings.backgroundIntensity}
          onChange={(e) =>
            updateSettings({ ...settings, backgroundIntensity: Number(e.target.value) })
          }
        />
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span>Art changes</span>
          <small>Loops through ~100 land paintings</small>
        </div>
        <select
          aria-label="art cycle"
          value={settings.cycleSeconds}
          onChange={(e) => updateSettings({ ...settings, cycleSeconds: Number(e.target.value) })}
        >
          <option value={0}>On turn pass</option>
          <option value={30}>Every 30 seconds</option>
          <option value={60}>Every minute</option>
          <option value={120}>Every 2 minutes</option>
          <option value={180}>Every 3 minutes</option>
          <option value={300}>Every 5 minutes</option>
        </select>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span>Fade speed</span>
          <small>{settings.fadeSeconds}s crossfade</small>
        </div>
        <input
          type="range"
          min={1}
          max={30}
          aria-label="fade speed"
          value={settings.fadeSeconds}
          onChange={(e) => updateSettings({ ...settings, fadeSeconds: Number(e.target.value) })}
        />
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
          <span>Sound & haptics</span>
          <small>Soft ticks and chimes on changes</small>
        </div>
        <input
          type="checkbox"
          aria-label="sound"
          checked={settings.soundOn}
          onChange={(e) => updateSettings({ ...settings, soundOn: e.target.checked })}
        />
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span>Turn timer</span>
          <small>Shows how long the current turn is taking</small>
        </div>
        <input
          type="checkbox"
          aria-label="turn timer"
          checked={settings.turnTimerOn}
          onChange={(e) => updateSettings({ ...settings, turnTimerOn: e.target.checked })}
        />
      </div>


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
