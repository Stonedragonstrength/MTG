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

  return {
    id: str(raw.id) ?? name,
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
  };
}

export async function importBulkData(
  onProgress: (pct: number, msg: string) => void,
): Promise<number> {
  onProgress(0, 'Contacting Scryfall…');
  const indexResp = await fetch(BULK_INDEX_URL, { headers: { Accept: 'application/json' } });
  if (!indexResp.ok) throw new Error(`Scryfall bulk index failed: ${indexResp.status}`);
  const index = (await indexResp.json()) as { data: { type: string; download_uri: string }[] };
  const oracle = index.data.find((d) => d.type === 'oracle_cards');
  if (!oracle) throw new Error('oracle_cards bulk entry not found');

  onProgress(5, 'Downloading card database (~150MB)…');
  const dataResp = await fetch(oracle.download_uri);
  if (!dataResp.ok) throw new Error(`Card download failed: ${dataResp.status}`);
  const rawCards = (await dataResp.json()) as Raw[];

  onProgress(40, 'Processing cards…');
  const records: CardRecord[] = [];
  for (const raw of rawCards) {
    const card = slimCard(raw);
    if (card) records.push(card);
  }

  const db = getDb();
  await db.cards.clear();
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    await db.cards.bulkPut(records.slice(i, i + CHUNK_SIZE));
    const pct = 40 + Math.min(59, Math.round(((i + CHUNK_SIZE) / records.length) * 60));
    onProgress(pct, `Storing cards… ${Math.min(i + CHUNK_SIZE, records.length)} / ${records.length}`);
  }

  await kvSet('nameIndex', records.map((r) => ({ id: r.id, name: r.name })));
  await kvSet('cardsImportedAt', Date.now());
  onProgress(100, 'Done');
  return records.length;
}

export async function getCardById(id: string): Promise<CardRecord | undefined> {
  return getDb().cards.get(id);
}

export async function loadNameIndex(): Promise<{ id: string; name: string }[]> {
  const stored = await kvGet<{ id: string; name: string }[]>('nameIndex');
  if (stored) return stored;
  const cards = await getDb().cards.toArray();
  return cards.map((c) => ({ id: c.id, name: c.name }));
}
