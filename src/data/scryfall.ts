import type { CardRecord } from '../lib/types';
import { getDb, kvGet, kvSet } from './db';

const BULK_INDEX_URL = 'https://api.scryfall.com/bulk-data';
const CHUNK_SIZE = 2000;

type Raw = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function slimCard(raw: Raw): CardRecord | null {
  const name = str(raw.name);
  if (!name) return null;
  if (raw.layout === 'art_series') return null;

  const faces = Array.isArray(raw.card_faces) ? (raw.card_faces as Raw[]) : null;
  const face0 = faces?.[0] ?? {};

  const oracleText =
    str(raw.oracle_text) ??
    (faces ? faces.map((f) => str(f.oracle_text) ?? '').join('\n//\n') : '');
  const typeLine = str(raw.type_line) ?? str(face0.type_line) ?? '';
  const imageUris = (raw.image_uris ?? face0.image_uris ?? {}) as Record<string, unknown>;
  const layout = str(raw.layout) ?? '';
  // Collection pricing: regular printing first, foil as the fallback.
  const prices = (raw.prices ?? {}) as Record<string, unknown>;
  const priceStr = str(prices.usd) ?? str(prices.usd_foil);
  const parsedPrice = priceStr ? Number.parseFloat(priceStr) : NaN;

  return {
    id: str(raw.id) ?? name,
    colorIdentity: (raw.color_identity as string[] | undefined) ?? [],
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost: str(raw.mana_cost) ?? str(face0.mana_cost) ?? '',
    power: str(raw.power) ?? str(face0.power),
    toughness: str(raw.toughness) ?? str(face0.toughness),
    colors: (raw.colors as string[] | undefined) ?? (face0.colors as string[] | undefined) ?? [],
    imageNormal: str(imageUris.normal),
    imageArtCrop: str(imageUris.art_crop),
    isToken: layout === 'token' || layout === 'double_faced_token' || typeLine.includes('Token'),
    isBasicLand: typeLine.startsWith('Basic Land'),
    priceUsd: Number.isFinite(parsedPrice) ? parsedPrice : null,
  };
}

interface BulkEntry {
  type?: unknown;
  jsonl_download_uri?: unknown;
  download_uri?: unknown;
  compressed_size?: unknown;
}

export async function importBulkData(
  onProgress: (pct: number, msg: string) => void,
): Promise<number> {
  onProgress(0, 'Contacting Scryfall…');
  const indexResp = await fetch(BULK_INDEX_URL, { headers: { Accept: 'application/json' } });
  if (!indexResp.ok) throw new Error(`Scryfall bulk index failed: ${indexResp.status}`);
  const index = (await indexResp.json()) as { data: BulkEntry[] };
  const oracle = index.data.find((d) => d.type === 'oracle_cards');
  if (!oracle) throw new Error('oracle_cards bulk entry not found');

  // No upfront clear: bulkPut upserts by id, so a failed re-download
  // leaves the previous database usable instead of bricking search.
  const db = getDb();

  const names: { id: string; name: string }[] = [];
  let imported = 0;
  let batch: CardRecord[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await db.cards.bulkPut(batch);
    imported += batch.length;
    batch = [];
    onProgress(Math.min(99, 80), `Storing cards… ${imported}`);
    // Yield a macrotask so the UI can paint progress between batches.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const addRaw = (raw: Raw) => {
    const card = slimCard(raw);
    if (card) {
      batch.push(card);
      names.push({ id: card.id, name: card.name });
    }
  };

  if (typeof oracle.jsonl_download_uri === 'string') {
    // Current API: gzipped JSON Lines, streamed and parsed line by line
    // (~25MB over the wire, no giant JSON.parse blocking the UI).
    onProgress(5, 'Downloading card database…');
    const resp = await fetch(oracle.jsonl_download_uri);
    if (!resp.ok || !resp.body) throw new Error(`Card download failed: ${resp.status}`);

    const total = typeof oracle.compressed_size === 'number' ? oracle.compressed_size : 0;
    let received = 0;
    const netReader = resp.body.getReader();
    const counted = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await netReader.read();
        if (done) {
          controller.close();
          return;
        }
        received += value.byteLength;
        if (total > 0) {
          const pct = 5 + Math.min(70, Math.round((received / total) * 70));
          onProgress(pct, 'Downloading card database…');
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        return netReader.cancel(reason);
      },
    });

    const lines = counted
      .pipeThrough(new DecompressionStream('gzip'))
      .pipeThrough(new TextDecoderStream())
      .getReader();

    let buffer = '';
    for (;;) {
      const { value, done } = await lines.read();
      if (value !== undefined) buffer += value;
      // Scan with a cursor and slice the remainder once per chunk —
      // re-slicing the buffer per line is quadratic on big chunks.
      let start = 0;
      let nl: number;
      while ((nl = buffer.indexOf('\n', start)) !== -1) {
        const line = buffer.slice(start, nl).trim();
        start = nl + 1;
        if (line) addRaw(JSON.parse(line) as Raw);
        if (batch.length >= CHUNK_SIZE) await flush();
      }
      buffer = start > 0 ? buffer.slice(start) : buffer;
      if (done) break;
    }
    const tail = buffer.trim();
    if (tail) addRaw(JSON.parse(tail) as Raw);
  } else if (typeof oracle.download_uri === 'string') {
    // Legacy API: one large JSON array.
    onProgress(5, 'Downloading card database…');
    const resp = await fetch(oracle.download_uri);
    if (!resp.ok) throw new Error(`Card download failed: ${resp.status}`);
    const rawCards = (await resp.json()) as Raw[];
    onProgress(75, 'Processing cards…');
    for (const raw of rawCards) {
      addRaw(raw);
      if (batch.length >= CHUNK_SIZE) await flush();
    }
  } else {
    throw new Error('No usable bulk download URI in Scryfall response');
  }

  await flush();
  await kvSet('nameIndex', names);
  await kvSet('cardsImportedAt', Date.now());
  onProgress(100, 'Done');
  return imported;
}

export async function getCardById(id: string): Promise<CardRecord | undefined> {
  return getDb().cards.get(id);
}

export async function findCardByName(name: string): Promise<CardRecord | undefined> {
  const matches = await getDb().cards.where('nameLower').equals(name.toLowerCase()).toArray();
  return matches.find((c) => c.imageNormal) ?? matches[0];
}

export async function findBasicLand(name: string): Promise<CardRecord | undefined> {
  const matches = await getDb().cards.where('nameLower').equals(name.toLowerCase()).toArray();
  const basics = matches.filter((c) => c.isBasicLand);
  return basics.find((c) => c.imageNormal) ?? basics[0];
}

export async function loadNameIndex(): Promise<{ id: string; name: string }[]> {
  const stored = await kvGet<{ id: string; name: string }[]>('nameIndex');
  if (stored) return stored;
  const cards = await getDb().cards.toArray();
  return cards.map((c) => ({ id: c.id, name: c.name }));
}
