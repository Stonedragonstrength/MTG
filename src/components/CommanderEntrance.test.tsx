import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../data/settings';
import { createGame } from '../lib/game';
import type { CardInstance, GameState, SeatCards } from '../lib/types';
import { useAppStore } from '../state/store';
import CommanderEntrance, { ENTRANCE_MS } from './CommanderEntrance';

const cmd: CardInstance = { iid: 'c1', cardId: 'ashaya', name: 'Ashaya, Soul of the Wild' };
const seat = (where: 'command' | 'battlefield'): SeatCards => ({
  library: [],
  hand: [],
  battlefield: where === 'battlefield' ? [cmd] : [],
  graveyard: [],
  exile: [],
  command: where === 'command' ? [cmd] : [],
  mulligans: 0,
  deckName: 'Stompy',
  cmd: { c1: 0 },
});
const game = (where: 'command' | 'battlefield'): GameState => {
  const g = createGame({
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    profiles: [
      { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
    ],
  });
  g.players[0] = { ...g.players[0], cards: seat(where) };
  return g;
};
const edges = (s: number) => (s === 0 ? 'bottom' : 'top');

beforeEach(() => {
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, soundOn: false }, game: game('command') });
});

test('a commander arriving on the battlefield takes the stage, then leaves it', async () => {
  render(<CommanderEntrance edgeOf={edges} flipped={() => false} />);
  expect(screen.queryByTestId('commander-entrance')).toBeNull();
  act(() => useAppStore.setState({ game: game('battlefield') }));
  expect(screen.getByTestId('commander-entrance')).toHaveTextContent('Ashaya, Soul of the Wild');
  expect(document.querySelector('.cmd-entrance-panel--bottom')).not.toBeNull();
  await act(() => new Promise((r) => setTimeout(r, ENTRANCE_MS + 50)));
  expect(screen.queryByTestId('commander-entrance')).toBeNull();
});

test('a game picked up with the commander already out shows nothing', () => {
  useAppStore.setState({ game: game('battlefield') });
  render(<CommanderEntrance edgeOf={edges} flipped={() => false} />);
  expect(screen.queryByTestId('commander-entrance')).toBeNull();
});
