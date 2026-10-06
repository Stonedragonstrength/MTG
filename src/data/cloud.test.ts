import { beforeEach, describe, expect, test } from 'vitest';
import { getDb } from './db';
import { getCloudConfig, normalizeProjectUrl, sendMagicLink, setCloudConfig } from './cloud';

beforeEach(async () => {
  await getDb().kv.clear();
});

describe('normalizeProjectUrl', () => {
  test('adds https and strips trailing slashes', () => {
    expect(normalizeProjectUrl('xyz.supabase.co/')).toBe('https://xyz.supabase.co');
    expect(normalizeProjectUrl('https://xyz.supabase.co')).toBe('https://xyz.supabase.co');
    expect(normalizeProjectUrl('  ')).toBe('');
  });
});

describe('sendMagicLink', () => {
  test('without a config it asks for one instead of silence', async () => {
    const msg = await sendMagicLink('nate@example.com');
    expect(msg).toMatch(/project url and key first/i);
  });

  test('a hopeless URL yields a readable message, not a hang', async () => {
    await setCloudConfig({ url: 'not a url at all', anonKey: 'k' });
    const msg = await sendMagicLink('nate@example.com');
    expect(typeof msg).toBe('string');
    expect(msg).not.toBe('');
  });

  test('setCloudConfig stores the normalized URL', async () => {
    await setCloudConfig({ url: 'xyz.supabase.co/', anonKey: 'k' });
    expect((await getCloudConfig())?.url).toBe('https://xyz.supabase.co');
  });
});
