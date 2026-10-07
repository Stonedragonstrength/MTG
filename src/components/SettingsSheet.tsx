import { useEffect, useRef, useState } from 'react';
import {
  DECKS_PLAYERS_SQL,
  getCloudConfig,
  sendMagicLink,
  setCloudConfig,
  setupPending,
  signedInEmail,
  syncAll,
} from '../data/cloud';
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
  const refreshSynced = useAppStore((s) => s.refreshSynced);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudKey, setCloudKey] = useState('');
  const [cloudEmail, setCloudEmail] = useState('');
  const [cloudUser, setCloudUser] = useState<string | null>(null);
  const [cloudMsg, setCloudMsg] = useState('');
  // The one-time step for decks and players: shown only while a sync has
  // found their tables missing in the project.
  const [setupStep, setSetupStep] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');
  const sqlBox = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getCloudConfig().then((cfg) => {
      if (cfg) {
        setCloudUrl(cfg.url);
        setCloudKey(cfg.anonKey);
      }
    });
    signedInEmail().then(setCloudUser);
    void setupPending().then(setSetupStep);
  }, []);

  async function saveCloud() {
    await setCloudConfig({ url: cloudUrl.trim(), anonKey: cloudKey.trim() });
    setCloudMsg('Saved. Now send yourself the sign-in link.');
  }

  async function magicLink() {
    setCloudMsg('Sending…');
    try {
      const err = await sendMagicLink(cloudEmail.trim());
      setCloudMsg(err ?? `Link sent to ${cloudEmail.trim()} — check spam, open it on this device.`);
    } catch (err) {
      setCloudMsg(err instanceof Error ? err.message : 'Something went wrong sending the link.');
    }
  }

  async function syncNow() {
    setCloudMsg('Syncing…');
    const status = await syncAll();
    await refreshSynced();
    setSetupStep(await setupPending());
    setCloudMsg(status);
  }

  async function copySql() {
    try {
      await navigator.clipboard.writeText(DECKS_PLAYERS_SQL);
      setCopyMsg('Copied');
    } catch {
      // No clipboard to write to (an older browser, a page it does not
      // trust): select the text so it can be copied by hand.
      sqlBox.current?.focus();
      sqlBox.current?.select();
      setCopyMsg('Selected — copy it');
    }
  }

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
          <span>Turn bar stays put</span>
          <small>Keeps Pass turn at the near edge instead of following the active player</small>
        </div>
        <input
          type="checkbox"
          aria-label="pin turn bar"
          checked={settings.hubPinned}
          onChange={(e) => updateSettings({ ...settings, hubPinned: e.target.checked })}
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

      <div className="settings-section-label">Cloud sync</div>
      <p className="hint">
        Syncs your Curation, decks and players across devices through your own Supabase project.
        {cloudUser ? ` Signed in as ${cloudUser}.` : ' Not signed in on this device yet.'}
      </p>
      <div className="settings-row">
        <input
          className="cloud-field"
          placeholder="Project URL (https://xyz.supabase.co)"
          value={cloudUrl}
          onChange={(e) => setCloudUrl(e.target.value)}
        />
      </div>
      <div className="settings-row">
        <input
          className="cloud-field"
          placeholder="anon public key"
          value={cloudKey}
          onChange={(e) => setCloudKey(e.target.value)}
        />
        <button disabled={!cloudUrl.trim() || !cloudKey.trim()} onClick={() => void saveCloud()}>
          Save
        </button>
      </div>
      <div className="settings-row">
        <input
          className="cloud-field"
          type="email"
          placeholder="your email for the sign-in link"
          value={cloudEmail}
          onChange={(e) => setCloudEmail(e.target.value)}
        />
        <button disabled={!cloudEmail.includes('@')} onClick={() => void magicLink()}>
          Send link
        </button>
      </div>
      <div className="settings-row cloud-status">
        <div className="settings-row-text">
          <small>{cloudMsg || 'Changes sync a few seconds after you make them.'}</small>
        </div>
        <button onClick={() => void syncNow()}>Sync now</button>
      </div>
      {setupStep && (
        <div className="cloud-setup">
          <p className="hint">
            One more step before decks and players can sync. In Supabase, open the SQL editor,
            paste this and press Run. Supabase will warn about a destructive query because of the
            drop-policy lines — that is expected, run it. Then tap Sync now.
          </p>
          <textarea
            ref={sqlBox}
            className="paste-box paste-box--sql"
            aria-label="setup SQL for decks and players"
            readOnly
            rows={8}
            spellCheck={false}
            value={DECKS_PLAYERS_SQL}
          />
          <button onClick={() => void copySql()}>{copyMsg || 'Copy'}</button>
        </div>
      )}
    </Sheet>
  );
}
