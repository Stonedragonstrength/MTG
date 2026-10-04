import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { getDb, kvSet } from '../data/db';
import { createGame } from '../lib/game';
import type { GameConfig } from '../lib/types';
import { useAppStore } from '../state/store';
import LandBackground from './LandBackground';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'A', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'B', avatarUrl: null, commanderName: null },
  ],
};

const pack = {
  plains: ['https://art.example/plains.jpg'],
  island: ['https://art.example/island.jpg'],
  swamp: ['https://art.example/swamp.jpg'],
  mountain: ['https://art.example/mountain.jpg'],
  forest: ['https://art.example/forest.jpg'],
};

const baseSettings = {
  backgroundMode: 'all' as const,
  backgroundIntensity: 35,
  cycleSeconds: 0,
  fadeSeconds: 2,
  soundOn: false,
  turnTimerOn: true,
  autoFocusOn: false,
};

beforeEach(async () => {
  await getDb().kv.clear();
  await kvSet('landArtPack', pack);
  useAppStore.setState({ game: createGame(config), settings: baseSettings });
});

test('mode off renders no art layer', async () => {
  useAppStore.setState({ settings: { ...baseSettings, backgroundMode: 'off' } });
  const { container } = render(<LandBackground />);
  await waitFor(() => expect(container.querySelector('[data-mode="off"]')).not.toBeNull());
  expect(container.querySelector('.land-layer')).toBeNull();
});

test('turn passes advance the art through the land cycle', async () => {
  const { container } = render(<LandBackground />);

  await waitFor(() => {
    const layer = container.querySelector('.land-layer') as HTMLElement;
    expect(layer?.style.backgroundImage).toContain('plains.jpg');
  });

  const game = useAppStore.getState().game!;
  useAppStore.setState({ game: { ...game, turnNumber: 2 } });

  await waitFor(() => {
    const layers = container.querySelectorAll('.land-layer');
    const current = layers[layers.length - 1] as HTMLElement;
    expect(current.style.backgroundImage).toContain('island.jpg');
  });
});

test('turning the background off mid-game takes effect immediately', async () => {
  const { container } = render(<LandBackground />);
  await waitFor(() => expect(container.querySelector('.land-layer')).not.toBeNull());

  useAppStore.setState({ settings: { ...baseSettings, backgroundMode: 'off' } });

  await waitFor(() => expect(container.querySelector('.land-layer')).toBeNull());
});

test('intensity and fade settings drive the layer style', async () => {
  useAppStore.setState({
    settings: { ...baseSettings, backgroundIntensity: 60, fadeSeconds: 5 },
  });
  const { container } = render(<LandBackground />);
  await waitFor(() => {
    const layer = container.querySelector('.land-layer') as HTMLElement;
    expect(layer).not.toBeNull();
    expect(layer.style.filter).toContain('brightness(0.6)');
    expect(layer.style.transitionDuration).toBe('5s');
  });
});

test('timed cycling advances the art without turn passes', async () => {
  useAppStore.setState({ settings: { ...baseSettings, cycleSeconds: 0.1 } });
  const { container } = render(<LandBackground />);

  await waitFor(() => {
    const layer = container.querySelector('.land-layer') as HTMLElement;
    expect(layer?.style.backgroundImage).toContain('plains.jpg');
  });

  await waitFor(
    () => {
      const layers = container.querySelectorAll('.land-layer');
      const current = layers[layers.length - 1] as HTMLElement;
      expect(current.style.backgroundImage).not.toContain('plains.jpg');
    },
    { timeout: 2000 },
  );
});
