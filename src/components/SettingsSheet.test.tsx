import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DECKS_PLAYERS_SQL, _resetForTests, deps } from '../data/cloud';
import { getDb } from '../data/db';
import { DEFAULT_SETTINGS, getSettings } from '../data/settings';
import { flushPersistence, useAppStore } from '../state/store';
import SettingsSheet from './SettingsSheet';

const realDeps = { ...deps };

beforeEach(async () => {
  await flushPersistence();
  const db = getDb();
  await Promise.all([db.kv.clear(), db.decks.clear(), db.profiles.clear(), db.garage.clear()]);
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS }, decks: [], profiles: [], garage: [] });
});

afterEach(() => {
  Object.assign(deps, realDeps);
  _resetForTests();
  vi.restoreAllMocks();
});

/** The owner's project, signed in, holding whichever tables were created. */
function project(tables: string[]) {
  const held = new Map(tables.map((name) => [name, [] as Record<string, unknown>[]]));
  const gone = (table: string) => ({
    code: 'PGRST205',
    message: `Could not find the table 'public.${table}' in the schema cache`,
  });
  deps.blocked = async () => null;
  deps.select = async (table) => (held.has(table) ? { rows: [] } : { error: gone(table) });
  deps.upsert = async (table, rows) => {
    if (!held.has(table)) return gone(table);
    held.get(table)!.push(...rows);
    return null;
  };
  return { held, create: (...names: string[]) => names.forEach((n) => held.set(n, [])) };
}

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

test('the section is "Cloud sync", and says it covers the Curation, decks and players', () => {
  render(<SettingsSheet onClose={() => {}} />);
  expect(screen.getByText('Cloud sync')).toBeInTheDocument();
  expect(screen.queryByText(/curation cloud sync/i)).not.toBeInTheDocument();
  expect(
    screen.getByText(/Syncs your Curation, decks and players across devices through your own Supabase project\./),
  ).toBeInTheDocument();
});

test('"Sync now" syncs all three, shows one status line and re-reads the lists', async () => {
  const cloud = project(['garage_cards', 'decks', 'player_profiles']);
  const store = useAppStore.getState();
  await store.saveDeck({ id: 'd1', name: 'Stompy', commander: null, colors: [], cards: [], updatedAt: 1 });
  await store.saveProfile({ id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null });
  const reread = vi.fn(async () => {});
  useAppStore.setState({ refreshSynced: reread });

  const user = userEvent.setup();
  render(<SettingsSheet onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Sync now' }));
  expect(await screen.findByText('Synced 0 cards · 1 deck · 1 player')).toBeInTheDocument();
  expect(reread).toHaveBeenCalled();
  expect(cloud.held.get('decks')).toHaveLength(1);
  expect(cloud.held.get('player_profiles')).toHaveLength(1);
  expect(screen.queryByLabelText(/setup sql/i)).not.toBeInTheDocument(); // the tables are there
});

test('while the tables are missing the one-time step shows: the words, the SQL, and a Copy that works', async () => {
  const cloud = project(['garage_cards']);
  const user = userEvent.setup(); // brings a clipboard to copy into
  render(<SettingsSheet onClose={() => {}} />);
  expect(screen.queryByLabelText(/setup sql/i)).not.toBeInTheDocument(); // nothing is known to be missing yet

  await user.click(screen.getByRole('button', { name: 'Sync now' }));
  expect(
    await screen.findByText('Synced 0 cards · decks and players need one more setup step'),
  ).toBeInTheDocument();
  const sql = (await screen.findByLabelText(/setup sql/i)) as HTMLTextAreaElement;
  expect(sql.value).toBe(DECKS_PLAYERS_SQL);
  expect(sql).toHaveAttribute('readonly');
  expect(screen.getByText(/SQL editor/)).toBeInTheDocument();
  expect(
    screen.getByText(/warn about a destructive query because of the drop-policy lines — that is expected, run it/),
  ).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Copy' }));
  expect(await navigator.clipboard.readText()).toBe(DECKS_PLAYERS_SQL);
  expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();

  // The owner pasted it: the next sync finds the tables and the step is gone.
  cloud.create('decks', 'player_profiles');
  await user.click(screen.getByRole('button', { name: 'Sync now' }));
  expect(await screen.findByText('Synced 0 cards · 0 decks · 0 players')).toBeInTheDocument();
  expect(screen.queryByLabelText(/setup sql/i)).not.toBeInTheDocument();
});

test('the step is already there when Settings opens, if the last background sync found the tables missing', async () => {
  await getDb().kv.put({ key: 'cloudSetupPending', value: true });
  render(<SettingsSheet onClose={() => {}} />);
  expect(await screen.findByLabelText(/setup sql/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
});

test('where there is no clipboard to write to, Copy selects the SQL for a copy by hand', async () => {
  await getDb().kv.put({ key: 'cloudSetupPending', value: true });
  const user = userEvent.setup();
  render(<SettingsSheet onClose={() => {}} />);
  const sql = (await screen.findByLabelText(/setup sql/i)) as HTMLTextAreaElement;
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('not allowed'));
  await user.click(screen.getByRole('button', { name: 'Copy' }));
  expect(await screen.findByRole('button', { name: /selected/i })).toBeInTheDocument();
  expect(sql.selectionStart).toBe(0);
  expect(sql.selectionEnd).toBe(DECKS_PLAYERS_SQL.length);
});
