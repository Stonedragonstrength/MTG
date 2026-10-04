import { useEffect, useRef, useState } from 'react';
import { kvGet } from '../data/db';
import { LAND_TYPES, type LandArtPack } from '../data/images';
import { getSettings, type BackgroundMode } from '../data/settings';
import { useAppStore } from '../state/store';

interface Layer {
  url: string;
  key: number;
}

export default function LandBackground() {
  const turnNumber = useAppStore((s) => s.game?.turnNumber ?? 1);
  const [mode, setMode] = useState<BackgroundMode | null>(null);
  const [pack, setPack] = useState<LandArtPack | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const keyRef = useRef(0);

  useEffect(() => {
    getSettings().then((s) => setMode(s.backgroundMode));
    kvGet<LandArtPack>('landArtPack').then((p) => setPack(p ?? null));
  }, []);

  useEffect(() => {
    if (!pack || !mode || mode === 'off') return;
    const types = mode === 'all' ? [...LAND_TYPES] : [mode];
    const typesWithArt = types.filter((t) => (pack[t] ?? []).length > 0);
    if (typesWithArt.length === 0) return;
    const step = turnNumber - 1;
    const type = typesWithArt[step % typesWithArt.length];
    const urls = pack[type];
    const url = urls[Math.floor(step / typesWithArt.length) % urls.length];

    setLayers((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].url === url) return prev;
      keyRef.current += 1;
      // Keep at most two layers: the one fading out and the one fading in.
      return [...prev.slice(-1), { url, key: keyRef.current }];
    });
  }, [turnNumber, pack, mode]);

  return (
    <div className="land-bg" data-mode={mode ?? 'loading'}>
      {mode !== 'off' &&
        layers.map((layer, i) => (
          <div
            key={layer.key}
            className={`land-layer${i === layers.length - 1 ? ' land-layer--current' : ''}`}
            style={{ backgroundImage: `url(${layer.url})` }}
          />
        ))}
    </div>
  );
}
