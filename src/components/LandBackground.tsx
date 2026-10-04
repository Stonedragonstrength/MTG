import { useEffect, useRef, useState } from 'react';
import { kvGet } from '../data/db';
import { LAND_TYPES, pickLandArtPack, type LandArtPack } from '../data/images';
import { useAppStore } from '../state/store';

interface Layer {
  url: string;
  key: number;
}

const TARGET_PACK_SIZE = 100;

export default function LandBackground() {
  const turnNumber = useAppStore((s) => s.game?.turnNumber ?? 1);
  const { backgroundMode: mode, backgroundIntensity, cycleSeconds, fadeSeconds } = useAppStore(
    (s) => s.settings,
  );
  const [pack, setPack] = useState<LandArtPack | null>(null);
  const [tick, setTick] = useState(0);
  const [layers, setLayers] = useState<Layer[]>([]);
  const keyRef = useRef(0);

  useEffect(() => {
    kvGet<LandArtPack>('landArtPack').then(async (stored) => {
      const total = stored ? Object.values(stored).flat().length : 0;
      if (stored && total >= TARGET_PACK_SIZE) {
        setPack(stored);
        return;
      }
      // Older installs have a smaller pack; regrow it from the card db.
      try {
        const fresh = await pickLandArtPack();
        setPack(Object.values(fresh).flat().length > 0 ? fresh : (stored ?? null));
      } catch {
        setPack(stored ?? null);
      }
    });
  }, []);

  // Timed loop mode: advance on an interval instead of turn passes.
  useEffect(() => {
    if (cycleSeconds <= 0) return;
    const id = window.setInterval(() => setTick((t) => t + 1), cycleSeconds * 1000);
    return () => window.clearInterval(id);
  }, [cycleSeconds]);

  const step = cycleSeconds > 0 ? tick : turnNumber - 1;

  useEffect(() => {
    if (!pack || mode === 'off') return;
    const types = mode === 'all' ? [...LAND_TYPES] : [mode];
    const typesWithArt = types.filter((t) => (pack[t] ?? []).length > 0);
    if (typesWithArt.length === 0) return;
    const type = typesWithArt[step % typesWithArt.length];
    const urls = pack[type];
    const url = urls[Math.floor(step / typesWithArt.length) % urls.length];

    setLayers((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].url === url) return prev;
      keyRef.current += 1;
      // Keep at most two layers: the one fading out and the one fading in.
      return [...prev.slice(-1), { url, key: keyRef.current }];
    });
  }, [step, pack, mode]);

  return (
    <div className="land-bg" data-mode={mode}>
      {mode !== 'off' &&
        layers.map((layer, i) => (
          <div
            key={layer.key}
            className={`land-layer${i === layers.length - 1 ? ' land-layer--current' : ''}`}
            style={{
              backgroundImage: `url(${layer.url})`,
              filter: `brightness(${backgroundIntensity / 100}) saturate(0.9)`,
              transitionDuration: `${fadeSeconds}s`,
            }}
          />
        ))}
    </div>
  );
}
