import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import App from './App';
import { getDb } from './data/db';

beforeEach(async () => {
  await getDb().kv.clear();
});

test('boots into the setup gate before the card database is downloaded', async () => {
  render(<App />);
  expect(await screen.findByText('MTG Companion')).toBeInTheDocument();
  expect(
    await screen.findByRole('button', { name: /download card database/i }),
  ).toBeInTheDocument();
});
