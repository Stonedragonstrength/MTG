import { getDb, kvSet } from './db';

export const LAND_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'] as const;
export type LandType = (typeof LAND_TYPES)[number];

/** 'special' holds multicolor and utility land art — shocks, duals, Maze of Ith… */
export type LandArtPack = Record<LandType | 'special', string[]>;

const PER_TYPE = 40;
const SPECIAL_COUNT = 300; // ~500 arts total: outlasts the longest game night

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Must match the service worker's runtime cache (vite.config.ts) so
// pre-cached art is found offline even if the SW wasn't controlling
// the page during setup.
const PRECACHE_CACHE_NAME = 'scryfall-images';
const REQUEST_GAP_MS = 110; // stay under Scryfall's 10 req/sec guidance

const COMMON_TOKEN_NAMES = [
  'Treasure',
  'Clue',
  'Food',
  'Soldier',
  'Zombie',
  'Goblin',
  'Spirit',
  'Thopter',
  'Elemental',
  'Angel',
  'Beast',
  'Saproling',
];

export async function pickLandArtPack(): Promise<LandArtPack> {
  const lands = await getDb()
    .cards.filter((c) => !c.isToken && c.imageArtCrop !== null && /\bLand\b/.test(c.typeLine))
    .toArray();

  const pack = {} as LandArtPack;
  for (const type of LAND_TYPES) {
    const typeName = type[0].toUpperCase() + type.slice(1);
    pack[type] = shuffleArray(
      lands.filter((c) => c.isBasicLand && c.typeLine.includes(typeName)),
    )
      .slice(0, PER_TYPE)
      .map((c) => c.imageArtCrop!);
  }
  pack.special = shuffleArray(lands.filter((c) => !c.isBasicLand))
    .slice(0, SPECIAL_COUNT)
    .map((c) => c.imageArtCrop!);

  await kvSet('landArtPack', pack);
  return pack;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function precacheUrls(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (!('caches' in globalThis)) return;
  const cache = await caches.open(PRECACHE_CACHE_NAME);
  let done = 0;
  for (const url of urls) {
    try {
      const hit = await cache.match(url);
      if (!hit) {
        await cache.add(url);
        await sleep(REQUEST_GAP_MS);
      }
    } catch {
      // Individual image failures are non-fatal; it will load lazily later.
    }
    done++;
    onProgress?.(done, urls.length);
  }
}

export async function precacheCommonTokens(): Promise<void> {
  const db = getDb();
  const urls: string[] = [];
  for (const name of COMMON_TOKEN_NAMES) {
    const matches = await db.cards.where('nameLower').equals(name.toLowerCase()).toArray();
    const token = matches.find((c) => c.isToken && c.imageNormal);
    if (token?.imageNormal) urls.push(token.imageNormal);
  }
  await precacheUrls(urls);
}

/** Post-import artwork phase: land art pack + common token images. Failures are non-fatal. */
export async function prepareArtwork(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  try {
    const pack = await pickLandArtPack();
    // Pre-cache a fast subset; the rest cache lazily as they appear on screen.
    await precacheUrls(shuffleArray(Object.values(pack).flat()).slice(0, 120), onProgress);
    await precacheCommonTokens();
  } catch (err) {
    console.warn('Artwork preparation failed; art will load lazily instead.', err);
  }
}
