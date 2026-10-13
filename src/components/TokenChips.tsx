import { useEffect, useState } from 'react';
import { createBoardItem } from '../lib/board';
import { bestToken, tokensMadeBy, type TokenWant } from '../lib/deckTokens';
import { frontId } from '../lib/faces';
import type { CardRecord } from '../lib/types';
import { useAppStore } from '../state/store';
import { useCardRecords } from './useCardRecords';

/** No more than this many deck tokens get a chip: the shelf is one line. */
const CHIP_CAP = 6;

/** The token cards the wants resolve to on this device, best fit each,
 * no card twice. A want this device has no token for is simply left out. */
async function resolveTokens(wants: TokenWant[]): Promise<CardRecord[]> {
  const { findCardsNamed } = await import('../data/scryfall');
  const out: CardRecord[] = [];
  for (const want of wants) {
    const hit = bestToken(want, await findCardsNamed(want.name));
    if (hit && !out.some((card) => card.id === hit.id)) out.push(hit);
    if (out.length >= CHIP_CAP) break;
  }
  return out;
}

interface Props {
  playerIdx: number;
  /** The "+" at the end: anything the chips do not cover. */
  onMore: () => void;
  /** How many columns the chips stand in (two chips to a column): the
   * shelf they sit on shares out its width by it. */
  onColumns?: (columns: number) => void;
}

/** One tap makes one token. The chips are the tokens this seat's own deck
 * says it creates — read off the rules text of every card it was dealt,
 * wherever each one is now — so the usual ones never need a search. */
export default function TokenChips({ playerIdx, onMore, onColumns }: Props) {
  const player = useAppStore((s) => s.game?.players[playerIdx]);
  const addItem = useAppStore((s) => s.addItem);
  const changeCount = useAppStore((s) => s.changeCount);
  const [tokens, setTokens] = useState<CardRecord[]>([]);
  const columns = Math.ceil((tokens.length + 1) / 2); // the "+" is a chip too
  useEffect(() => onColumns?.(columns), [columns, onColumns]);

  const seat = player?.cards;
  // The deck: one entry per different card, in an order that does not
  // change as cards move between zones — or as one is turned onto its back
  // face: the card is read whole, by its front id.
  const deck = new Map<string, { cardId: string; name: string }>();
  if (seat) {
    for (const zone of [seat.library, seat.hand, seat.battlefield, seat.graveyard, seat.exile, seat.command])
      for (const c of zone) {
        const cardId = frontId(c.cardId);
        if (!deck.has(cardId)) deck.set(cardId, { cardId, name: c.name });
      }
  }
  const cards = [...deck.values()].sort((a, b) => a.cardId.localeCompare(b.cardId));
  const records = useCardRecords(cards);
  const wants = tokensMadeBy(cards.flatMap((c) => records[c.cardId]?.oracleText ?? []));
  const wantsKey = JSON.stringify(wants);

  useEffect(() => {
    let cancelled = false;
    const asked: TokenWant[] = JSON.parse(wantsKey);
    if (asked.length === 0) {
      setTokens([]);
      return;
    }
    // A read that fails leaves the chips as they were: the "+" still works.
    resolveTokens(asked)
      .then((found) => {
        if (!cancelled) setTokens(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wantsKey]);

  if (!player) return null;

  function make(card: CardRecord) {
    // One more of a token already on the board joins its stack — the plain
    // one: a stack somebody has put counters on is its own thing.
    const stack = player!.board.find(
      (it) => it.cardId === card.id && it.zone === 'board' && Object.keys(it.counters).length === 0,
    );
    if (stack) changeCount(playerIdx, stack.id, 1);
    else addItem(playerIdx, createBoardItem(card, 'board'));
  }

  return (
    <div className="token-chips">
      {tokens.map((card) => (
        <button
          key={card.id}
          className="token-chip"
          aria-label={`make a ${card.name} token`}
          title={`Make a ${card.name} token`}
          onClick={() => make(card)}
        >
          {(card.imageArtCrop ?? card.imageNormal) && (
            <img src={(card.imageArtCrop ?? card.imageNormal)!} alt="" loading="lazy" />
          )}
          <span className="token-chip-name">{card.name}</span>
          <span className="token-chip-plus" aria-hidden="true">
            +
          </span>
        </button>
      ))}
      <button className="token-chip token-chip--more" aria-label="add a card" onClick={onMore}>
        <span className="token-chip-plus" aria-hidden="true">
          +
        </span>
        <span className="token-chip-name">token</span>
      </button>
    </div>
  );
}
