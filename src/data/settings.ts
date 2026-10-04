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
}

export const DEFAULT_SETTINGS: Settings = { backgroundMode: 'all' };

export async function getSettings(): Promise<Settings> {
  const stored = await kvGet<Partial<Settings>>('settings');
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await kvSet('settings', settings);
}
