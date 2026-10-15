import { useEffect, useState } from 'react';
import { backView, faceNames } from '../lib/faces';
import { asksLife, entryLife } from '../lib/lands';
import { asksAtCast } from '../lib/pay';
import { hasLandBack, isLandCard } from '../lib/turnRules';
import { useAppStore } from '../state/store';
import LandLifeSheet from './LandLifeSheet';
import PayWithSheet from './PayWithSheet';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import XCostSheet from './XCostSheet';

interface Props {
  playerIdx: number;
  iid: string;
  /** Why a tap would not play this card: the land rule, or the mana gate.
   * Said here, with the way around it — "Play anyway" — right below. */
  why?: string | null;
  onClose: () => void;
}

/** Hold on a hand card: everything that isn't playing it. */
export default function HandCardSheet({ playerIdx, iid, why = null, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  // A build behind the table cannot write, so its reveal could not announce itself.
  const stale = useAppStore((s) => s.online?.status.kind === 'stale-build');
  const revealCards = useAppStore((s) => s.revealCards);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const playCard = useAppStore((s) => s.playCard);
  const [askX, setAskX] = useState(false);
  const [paying, setPaying] = useState(false);
  // A land that asks for life as it comes in (a shock land; the land on the
  // back of a Zendikar Rising spell): the question, in this sheet's place.
  const [lifeFor, setLifeFor] = useState<{ asLand: boolean } | null>(null);
  const card = game?.players[playerIdx]?.cards?.hand.find((c) => c.iid === iid);
  const records = useCardRecords(card ? [card] : []);
  // The card left the hand (drawn away, discarded remotely): really close.
  const gone = !card;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (!card) return null;
  const record = records[card.cardId];
  // Playing a card with {X} always asks how much first, override or not.
  if (askX) return <XCostSheet playerIdx={playerIdx} iid={iid} from="hand" onClose={onClose} />;
  // Choosing the lands that pay takes this sheet's place; Back returns here.
  if (paying)
    return (
      <PayWithSheet
        playerIdx={playerIdx}
        iid={iid}
        from="hand"
        onBack={() => setPaying(false)}
        onClose={onClose}
      />
    );
  if (lifeFor) {
    const land = lifeFor.asLand && record ? backView(record) : record;
    return (
      <LandLifeSheet
        name={(lifeFor.asLand ? faceNames(record, card.name).back : null) ?? card.name}
        life={entryLife(land)}
        onAnswer={(pay) => {
          void playCard(playerIdx, iid, { ...(lifeFor.asLand ? { asLand: true as const } : {}), landEntry: pay ? 'life' : 'tapped' });
          onClose();
        }}
        onClose={onClose}
      />
    );
  }

  const go = (to: 'graveyard' | 'exile', posTo?: never) => () => {
    void posTo;
    moveVirtualCard(playerIdx, iid, 'hand', to);
    onClose();
  };

  return (
    <Sheet title={card.name} onClose={onClose}>
      <div className="card-hero">
        {record?.imageNormal && <img className="card-image" src={record.imageNormal} alt={card.name} />}
        {record?.typeLine && <p className="type-line">{record.typeLine}</p>}
      </div>
      {why && <p className="hint refusal-hint">{why}</p>}
      <div className="chip-row">
        {why && (
          <button
            className="chip"
            onClick={() => {
              if (asksAtCast(record, 'hand')) {
                setAskX(true);
                return;
              }
              if (isLandCard(record?.typeLine ?? '') && asksLife(record)) {
                setLifeFor({ asLand: false });
                return;
              }
              void playCard(playerIdx, iid); // free spells, reducers, treasure math, a land the rules do allow
              onClose();
            }}
          >
            Play anyway
          </button>
        )}
        {!isLandCard(record?.typeLine ?? '') && (
          // Cast it with the lands the player picks instead of the table's
          // choice. A card that asks something first (X, a kicker) asks it
          // first here too: its cast sheet has the same way on.
          <button
            className="chip"
            onClick={() => (asksAtCast(record, 'hand') ? setAskX(true) : setPaying(true))}
          >
            Pay with…
          </button>
        )}
        {hasLandBack(record?.typeLine ?? '') && (
          // A tap casts the front face; the land on the back is played from
          // here, and is counted as the turn's land like any other.
          <button
            className="chip"
            onClick={() => {
              if (record && asksLife(backView(record))) {
                setLifeFor({ asLand: true });
                return;
              }
              void playCard(playerIdx, iid, { asLand: true });
              onClose();
            }}
          >
            Play as land
          </button>
        )}
        <button className="chip" onClick={go('graveyard')}>Discard</button>
        <button className="chip" onClick={go('exile')}>Exile</button>
        <button
          className="chip"
          onClick={() => {
            moveVirtualCard(playerIdx, iid, 'hand', 'library', { pos: 'top' });
            onClose();
          }}
        >
          Top of library
        </button>
        <button
          className="chip"
          onClick={() => {
            moveVirtualCard(playerIdx, iid, 'hand', 'library', { pos: 'bottom' });
            onClose();
          }}
        >
          Bottom
        </button>
        <button
          className="chip"
          disabled={stale}
          onClick={() => {
            revealCards(playerIdx, [iid], 'hand'); // shown to the table by name; it stays in hand
            onClose(); // out of the way: the table's banner sits under this sheet
          }}
        >
          Reveal
        </button>
      </div>
    </Sheet>
  );
}
