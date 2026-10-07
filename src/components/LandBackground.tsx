import { useEffect, useMemo, useRef, useState } from 'react';
import { kvGet } from '../data/db';
import { pickLandArtPack, shuffleArray, type LandArtPack } from '../data/images';
import { useAppStore } from '../state/store';

interface Layer {
  url: string;
  key: number;
}

const TARGET_PACK_SIZE = 400;

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
    // The table can be left before the saved art answers: an answer that
    // arrives after that has nowhere to go, and must not go on to scan the
    // card db for a pack nobody will see.
    let gone = false;
    const show = (art: LandArtPack | null) => {
      if (!gone) setPack(art);
    };
    kvGet<LandArtPack>('landArtPack')
      .then(async (stored) => {
        if (gone) return;
        const total = stored ? Object.values(stored).flat().length : 0;
        if (stored && total >= TARGET_PACK_SIZE) {
          show(stored);
          return;
        }
        // Older installs have a smaller pack; regrow it from the card db.
        try {
          const fresh = await pickLandArtPack();
          show(Object.values(fresh).flat().length > 0 ? fresh : (stored ?? null));
        } catch {
          show(stored ?? null);
        }
      })
      .catch(() => {}); // no saved art to read: the table simply stays plain
    return () => {
      gone = true;
    };
  }, []);

  // Timed loop mode: advance on an interval instead of turn passes.
  useEffect(() => {
    if (cycleSeconds <= 0) return;
    const id = window.setInterval(() => setTick((t) => t + 1), cycleSeconds * 1000);
    return () => window.clearInterval(id);
  }, [cycleSeconds]);

  const step = cycleSeconds > 0 ? tick : turnNumber - 1;

  // A freshly shuffled playlist per session (and per mode change).
  const playlist = useMemo(() => {
    if (!pack || mode === 'off') return [];
    const urls = mode === 'all' ? Object.values(pack).flat() : (pack[mode] ?? []);
    return shuffleArray(urls);
  }, [pack, mode]);

  useEffect(() => {
    if (playlist.length === 0 || mode === 'off') return;
    const url = playlist[step % playlist.length];

    setLayers((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].url === url) return prev;
      keyRef.current += 1;
      // Keep at most two layers: the one fading out and the one fading in.
      return [...prev.slice(-1), { url, key: keyRef.current }];
    });
  }, [step, playlist, mode]);

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
