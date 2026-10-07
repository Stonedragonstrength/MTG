import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { getDb } from '../data/db';
import { DEFAULT_SETTINGS, getSettings } from '../data/settings';
import { flushPersistence, useAppStore } from '../state/store';
import SettingsSheet from './SettingsSheet';

beforeEach(async () => {
  await flushPersistence();
  await getDb().kv.clear();
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

test('"Turn bar stays put" is off until ticked, and the choice is saved on this device', async () => {
  const user = userEvent.setup();
  render(<SettingsSheet onClose={() => {}} />);
  expect(screen.getByText('Turn bar stays put')).toBeInTheDocument();
  expect(
    screen.getByText('Keeps Pass turn at the near edge instead of following the active player'),
  ).toBeInTheDocument();
  const pin = screen.getByRole('checkbox', { name: 'pin turn bar' });
  expect(pin).not.toBeChecked();

  await user.click(pin);
  expect(pin).toBeChecked();
  expect(useAppStore.getState().settings.hubPinned).toBe(true);
  await flushPersistence();
  expect((await getSettings()).hubPinned).toBe(true); // a reload keeps it

  await user.click(pin);
  expect(useAppStore.getState().settings.hubPinned).toBe(false);
  // Ticking it touched nothing else.
  expect(useAppStore.getState().settings).toEqual(DEFAULT_SETTINGS);
});
