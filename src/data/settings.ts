import { kvGet, kvSet } from './db';

export type BackgroundMode =
  | 'all'
  | 'plains'
  | 'island'
  | 'swamp'
  | 'mountain'
  | 'forest'
  | 'off';

export interface Settings {
  backgroundMode: BackgroundMode;
  backgroundIntensity: number; // 10–100, % brightness of the art
  cycleSeconds: number; // 0 = art changes on turn pass; otherwise a timed loop
  fadeSeconds: number; // crossfade duration
  soundOn: boolean;
  turnTimerOn: boolean;
  autoFocusOn: boolean; // active player's zone takes the screen each turn
}

export const DEFAULT_SETTINGS: Settings = {
  backgroundMode: 'all',
  backgroundIntensity: 35,
  cycleSeconds: 0,
  fadeSeconds: 2,
  soundOn: false,
  turnTimerOn: true,
  autoFocusOn: false,
};

export async function getSettings(): Promise<Settings> {
  const stored = await kvGet<Partial<Settings>>('settings');
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await kvSet('settings', settings);
}
