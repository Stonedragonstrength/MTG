import { useState } from 'react';
import { abilitiesOf, type Ability } from '../lib/abilities';
import { isCommander } from '../lib/cards';
import { reboundTurn } from '../lib/cascade';
import { castCosts, hasX } from '../lib/pay';
import { seatSources } from '../lib/seatMana';
import type { CardInstance, CardZone } from '../lib/types';
import { useAppStore } from '../state/store';
import AbilityRow, { type AbilityUse } from './AbilityRow';
import DiscoverSheet from './DiscoverSheet';
import Sheet from './Sheet';
import { useCardRecords } from './useCardRecords';
import { useTableRecords } from './useCombat';
import XCostSheet from './XCostSheet';

interface Props {
  playerIdx: number;
  zone: Extract<CardZone, 'graveyard' | 'exile' | 'command'>;
  /** Command zone only: the commanders the mana gate refused — casting
   * one of these is an explicit override. */
  short?: string[];
  onClose: () => void;
}

const TITLES = { graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone' };
const NONE: string[] = [];

/** Public pile browser: graveyard (top first), exile, command. */
export default function PileSheet({ playerIdx, zone, short = NONE, onClose }: Props) {
  const game = useAppStore((s) => s.game);
  const moveVirtualCard = useAppStore((s) => s.moveVirtualCard);
  const castCommander = useAppStore((s) => s.castCommander);
  const commanderReturned = useAppStore((s) => s.commanderReturned);
  const castFromExile = useAppStore((s) => s.castFromExile);
  const activateAbility = useAppStore((s) => s.activateAbility);
  const [xFor, setXFor] = useState<string | null>(null); // the commander being cast for X
  // A Discover from a card's graveyard ability (Buried Treasure), in this sheet's place.
  const [discovering, setDiscovering] = useState<{ card: CardInstance; ability: Ability; use: AbilityUse } | null>(null);
  const seat = game?.players[playerIdx]?.cards;
  const cards = seat?.[zone] ?? [];
  const shown = zone === 'graveyard' ? [...cards].reverse() : cards;
  const records = useCardRecords(shown);
  const tableRecords = useTableRecords();
  // "{5}, Exile this card from your graveyard: Discover 5": used from here.
  const graveAbilities = (c: CardInstance) => (zone === 'graveyard' ? abilitiesOf(records[c.cardId]).filter((a) => a.graveyard) : []);
  const sources =
    zone === 'graveyard' && seat && game && shown.some((c) => graveAbilities(c).length > 0)
      ? seatSources(game, playerIdx, tableRecords)
      : [];
  // CR 903.9: a commander stranded here can go home — and only a
  // commander. Seats dealt before commanders were tracked keep the old
  // rule: an empty command zone takes whatever is sent.
  const goesHome = (iid: string) =>
    zone !== 'command' && !!seat && (isCommander(seat, iid) ?? seat.command.length === 0);
  // A card cast with rebound: 'now' all through its owner's next turn (it
  // may be cast from here, should its banner have gone by), 'waiting' until then.
  const rebounding = (c: CardInstance): 'now' | 'waiting' | null => {
    if (zone !== 'exile' || !c.rebound || !game) return null;
    const due = reboundTurn(playerIdx, c.rebound);
    if (game.turnNumber === due && game.activePlayerIndex === playerIdx) return 'now';
    const before = game.turnNumber < due || (game.turnNumber === due && game.activePlayerIndex < playerIdx);
    return before ? 'waiting' : null;
  };

  // A commander with {X} in its cost: "Cast" asks how much, in this sheet's
  // place. Closing that question closes the lot, like a cast does.
  if (xFor) return <XCostSheet playerIdx={playerIdx} iid={xFor} from="command" onClose={onClose} />;
  if (discovering) {
    const { card, ability, use } = discovering;
    const n = ability.effect.kind === 'discover' ? ability.effect.n : 0;
    return (
      <DiscoverSheet
        playerIdx={playerIdx}
        n={n === 'exiled' ? null : n}
        source={card.name}
        carryOut={(plan, take, value) => activateAbility(playerIdx, card.iid, ability.key, { ...use, discover: { plan, take, n: value } })}
        onClose={() => onClose()}
      />
    );
  }

  return (
    <Sheet title={TITLES[zone]} onClose={onClose} size="wide">
      {zone === 'command' && shown.some((c) => short.includes(c.iid)) && (
        <p className="hint">Not enough mana ready (tax included) — cast it anyway?</p>
      )}
      {shown.length === 0 ? (
        <p className="hint">Empty.</p>
      ) : (
        <ul className="pile-list">
          {shown.map((c) => (
            <li key={c.iid} className={graveAbilities(c).length > 0 ? 'pile-row pile-row--abilities' : 'pile-row'}>
              {records[c.cardId]?.imageNormal ? (
                <img className="pile-art" src={records[c.cardId]!.imageNormal!} alt="" loading="lazy" />
              ) : (
                <span className="pile-art pile-art--empty" />
              )}
              <span className="pile-name">
                {c.name}
                {rebounding(c) && (
                  <small className="pile-note">{rebounding(c) === 'now' ? ' · rebound: cast it free' : ' · rebounds next turn'}</small>
                )}
              </span>
              <span className="pile-actions">
                {rebounding(c) === 'now' && (
                  <button
                    onClick={() => {
                      void castFromExile(playerIdx, c.iid, 'rebound');
                      onClose();
                    }}
                  >
                    Cast
                  </button>
                )}
                {zone === 'command' ? (
                  <button
                    onClick={() => {
                      if (hasX(castCosts(records[c.cardId], 'command'))) {
                        setXFor(c.iid);
                        return;
                      }
                      castCommander(playerIdx, c.iid);
                      onClose();
                    }}
                  >
                    {short.includes(c.iid) ? 'Cast anyway' : 'Cast'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => moveVirtualCard(playerIdx, c.iid, zone, 'hand')}
                    >
                      Hand
                    </button>
                    <button
                      onClick={() =>
                        moveVirtualCard(playerIdx, c.iid, zone, 'battlefield', { row: 'front' })
                      }
                    >
                      Battlefield
                    </button>
                    <button
                      onClick={() =>
                        moveVirtualCard(playerIdx, c.iid, zone, zone === 'graveyard' ? 'exile' : 'graveyard')
                      }
                    >
                      {zone === 'graveyard' ? 'Exile' : 'Graveyard'}
                    </button>
                    <button
                      onClick={() =>
                        moveVirtualCard(playerIdx, c.iid, zone, 'library', { pos: 'bottom' })
                      }
                    >
                      Bottom
                    </button>
                    {goesHome(c.iid) && (
                      <button
                        onClick={() =>
                          commanderReturned(playerIdx, c.iid, zone as 'graveyard' | 'exile')
                        }
                      >
                        Command
                      </button>
                    )}
                  </>
                )}
              </span>
              {graveAbilities(c).map((ability) => (
                <AbilityRow
                  key={ability.key}
                  playerIdx={playerIdx}
                  card={c}
                  ability={ability}
                  sources={sources}
                  onDiscover={(use) => setDiscovering({ card: c, ability, use })}
                />
              ))}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
