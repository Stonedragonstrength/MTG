import { hasKeyword, readUnits, type CardRecords } from './combatEngine';
import { seatIdentity } from './commanders';
import type { CreatureRead, TableRead } from './manaHere';
import { sourcesFrom, type ManaSource } from './pay';
import type { BoardItem, CardInstance, GameState } from './types';

/** Copies of a stack counted one by one, never without end. */
const copiesOf = (count: number) => Math.max(0, Math.min(count, 60));

/** What a seat's mana abilities read off the table: its creatures sized the
 * way a fight sizes them, and every seat's permanents. Each is gathered the
 * first time a card asks, and once. */
export function tableRead(game: GameState, seat: number, records: CardRecords): TableRead {
  let creatures: CreatureRead[] | undefined;
  let everyone: string[] | undefined;
  return {
    creatures() {
      if (creatures) return creatures;
      const player = game.players[seat];
      creatures = [];
      for (const u of readUnits(game, seat, records)) {
        if (!u.creature) continue;
        const sized = { power: u.power, toughness: u.toughness, defender: hasKeyword(u, 'defender'), unread: u.unread };
        if (u.unit.kind === 'card') {
          const card = player?.cards?.battlefield.find((c) => c.iid === u.unit.id);
          creatures.push({ key: u.unit.id, ...sized, fresh: !!card?.sick });
        } else {
          const fresh = player?.board.find((it) => it.id === u.unit.id)?.sick ?? 0;
          for (let i = 0; i < copiesOf(u.count); i++) creatures.push({ key: u.unit.id, ...sized, fresh: i < fresh });
        }
      }
      return creatures;
    },
    everyone() {
      if (everyone) return everyone;
      everyone = [];
      for (const p of game.players) {
        for (const c of p.cards?.battlefield ?? []) {
          const record = records[c.cardId];
          if (record) everyone.push(record.typeLine);
        }
        for (const it of p.board) for (let i = 0; i < copiesOf(it.count); i++) everyone.push(it.typeLine);
      }
      return everyone;
    },
  };
}

/** Everything a seat can draw mana from right now (pay.ts sourcesFrom), read
 * with what the table knows about it: its commander's colors (Command
 * Tower), its creatures' sizes (Marwyn), every seat's permanents (Priest of
 * Titania). `view` reads another battlefield or board in place of the
 * seat's own — Pay with's "all of it untapped". */
export function seatSources(
  game: GameState,
  seat: number,
  records: CardRecords,
  view?: { battlefield?: CardInstance[]; board?: BoardItem[] },
): ManaSource[] {
  const player = game.players[seat];
  return sourcesFrom(
    view?.battlefield ?? player?.cards?.battlefield ?? [],
    records,
    view?.board ?? player?.board ?? [],
    seatIdentity(game, seat),
    tableRead(game, seat, records),
  );
}
