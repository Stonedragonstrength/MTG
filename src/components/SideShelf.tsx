import { useState, type CSSProperties } from 'react';
import { isSummoningSick, permanentTexts } from '../lib/keywords';
import { shelfOf } from '../lib/shelf';
import { useAppStore } from '../state/store';
import BattlefieldCardSheet from './BattlefieldCardSheet';
import { useCardRecords } from './useCardRecords';
import { useSeatCombat } from './useCombat';
import VCard from './VCard';

interface Props {
  playerIdx: number;
  /** false on the phone's hand view: no picking there, a tap is always a tap. */
  picks?: boolean;
}

/** The side shelf: a seat's permanents that are neither creatures nor
 * there for mana — artifacts, enchantments, planeswalkers (lib/shelf.ts
 * sorts them). Small cards, so the field stays the creatures'; each one
 * still taps on a tap and opens its sheet on a hold, exactly as it would
 * in the field. Nothing is drawn while the shelf is empty. */
export default function SideShelf({ playerIdx, picks = true }: Props) {
  const game = useAppStore((s) => s.game);
  const tapVirtualCard = useAppStore((s) => s.tapVirtualCard);
  const combat = useSeatCombat(playerIdx, picks);
  const [cardSheet, setCardSheet] = useState<string | null>(null);
  const player = game?.players[playerIdx];
  const seat = player?.cards;
  const records = useCardRecords(seat?.battlefield ?? []);
  if (!game || !player || !seat) return null;

  const side = seat.battlefield.filter((c) => shelfOf(c, records[c.cardId]) === 'side');
  // A creature someone put here by hand still wears its summoning sickness.
  const texts = permanentTexts(seat.battlefield, records, player.board);
  const names = game.config.profiles.map((p) => p.name);

  return (
    <>
      {side.length > 0 && (
        <div
          className="bf-side"
          role="group"
          aria-label="artifacts and enchantments"
          // How many cards: the board shares a crowded shelf line by it.
          style={{ '--n': side.length } as CSSProperties}
        >
          {side.map((c) => (
            <VCard
              key={c.iid}
              card={c}
              art={records[c.cardId]?.imageNormal ?? null}
              sick={isSummoningSick(c, records[c.cardId], texts)}
              look={combat?.look({ kind: 'card', id: c.iid }) ?? null}
              names={names}
              onTap={() => tapVirtualCard(playerIdx, c.iid)}
              onDetail={() => setCardSheet(c.iid)}
            />
          ))}
        </div>
      )}
      {cardSheet && (
        <BattlefieldCardSheet
          playerIdx={playerIdx}
          iid={cardSheet}
          picks={picks}
          onClose={() => setCardSheet(null)}
        />
      )}
    </>
  );
}
