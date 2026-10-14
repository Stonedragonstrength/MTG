import type { CardRecord } from './types';

// ---- which face of a double-faced card is up ----
// A card on the battlefield that lies on its back says so in its `cardId`:
// the front id with BACK on the end. Everything that reads a card looks its
// record up by that id, and for a back id the lookup hands over a record
// that IS the back face (backView) — so every reader keeps reading "the
// front face" and gets the face that is up. Nothing else in the game state
// knows about faces, and a build that does not know the suffix finds no
// card by that id and falls back to the name: it shows the front.

/** What a back id ends in. No Scryfall id holds a '~'. */
export const BACK = '~back';

export function isBackId(id: string): boolean {
  return id.endsWith(BACK);
}

/** The id of the card itself, whichever face the given id names. */
export function frontId(id: string): string {
  return isBackId(id) ? id.slice(0, -BACK.length) : id;
}

export function backId(id: string): string {
  return isBackId(id) ? id : id + BACK;
}

type Read = CardRecord | null | undefined;

const TYPE_SPLIT = ' // ';
const TEXT_SPLIT = '\n//\n';

/** The second face's type line of a record that predates `back`. */
const oldBackType = (record: CardRecord) => record.typeLine.split(TYPE_SPLIT)[1] ?? '';

/** Can this card be turned over? One that is on its back already can (it
 * turns back). Otherwise the record says: back-face data means yes, and a
 * `back` of null means it was looked at and has none (a split card, an
 * adventure). A record stored before faces were kept has to be judged by
 * its type line: a second face that is a permanent turns over; an Instant
 * or a Sorcery there is the other half of a split card, an adventure or
 * an omen, and the two doors of a Room are one face. */
export function turnsOver(record: Read): boolean {
  if (!record) return false;
  if (isBackId(record.id)) return true;
  if (record.back !== undefined) return record.back !== null;
  const second = oldBackType(record);
  return second !== '' && !/\b(Instant|Sorcery|Room)\b/.test(second);
}

/** The names of the two faces: off the record where it has them, else off
 * the full name ("Front // Back"). `back` is null when nothing says. */
export function faceNames(record: Read, fullName: string): { front: string; back: string | null } {
  const [front, second] = (record?.name ?? fullName).split(TYPE_SPLIT);
  return { front, back: record?.back?.name ?? second ?? null };
}

/** The record of a card lying on its back: the back face, laid out the way
 * a single-faced card is, so nothing that reads it needs to know. Its id is
 * the back id; its name stays the card's whole name (the instance carries
 * that too). A record with no back-face data gives what its joined type
 * line and rules text hold — the second half of each — with the front
 * picture and no power or toughness, until the card is read again. */
export function backView(record: CardRecord): CardRecord {
  if (isBackId(record.id)) return record;
  const { back, ...front } = record;
  const view: CardRecord = back
    ? {
        ...front,
        typeLine: back.typeLine,
        oracleText: back.oracleText,
        power: back.power,
        toughness: back.toughness,
        colors: back.colors,
        // A flip card has one picture for both faces.
        imageNormal: back.imageNormal ?? record.imageNormal,
        imageArtCrop: back.imageArtCrop ?? record.imageArtCrop,
        loyalty: back.loyalty,
      }
    : {
        ...front,
        typeLine: oldBackType(record) || record.typeLine.split(TYPE_SPLIT)[0],
        oracleText: record.oracleText.split(TEXT_SPLIT)[1] ?? '',
        power: null,
        toughness: null,
        loyalty: undefined,
      };
  return { ...view, id: backId(record.id), isBasicLand: view.typeLine.startsWith('Basic Land') };
}
