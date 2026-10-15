import { describe, expect, test } from 'vitest';
import { anthemsOf, keywordsAround, sizeAround, sizeWhen } from './anthems';
import { keywordsNow } from './attach';
import { readUnit, resolveCombat } from './combatEngine';
import { createGame } from './game';
import type { CardInstance, CardRecord, CombatState, GameState } from './types';

describe('keywords a lord hands out', () => {
  test('to its kind, with or without a size', () => {
    expect(anthemsOf('Other Goblin creatures you control have haste.')).toMatchObject([
      { other: true, whose: 'you', types: [['goblin']], keywords: ['haste'], power: 0, toughness: 0 },
    ]);
    expect(anthemsOf('Sliver creatures you control have flying.')[0]).toMatchObject({ types: [['sliver']], keywords: ['flying'] });
    expect(anthemsOf('Other Elf creatures get +1/+1 and have forestwalk.')[0]).toMatchObject({
      whose: 'all',
      power: 1,
      toughness: 1,
      keywords: ['forestwalk'],
    });
    expect(anthemsOf('All creatures have haste.')[0]).toMatchObject({ whose: 'all', types: [], keywords: ['haste'] });
  });

  test('the plain "creatures you control have…" is left to the grants combat already reads', () => {
    expect(anthemsOf('Creatures you control have haste.')).toEqual([]);
    expect(anthemsOf('Creatures you control get +1/+1 and have vigilance.')[0].keywords).toEqual([]);
  });

  test('a player is no creature: "You have hexproof" is not read', () => {
    expect(anthemsOf('You have hexproof.')).toEqual([]);
  });
});

describe('only in a fight', () => {
  test('"Attacking creatures you control get +1/+0" is for attackers; on the card at rest it is nothing', () => {
    expect(anthemsOf('Attacking creatures you control get +1/+0.')).toMatchObject([
      { when: 'attacking', whose: 'you', power: 1, toughness: 0 },
    ]);
    expect(anthemsOf('Attacking creatures you control get +1/+0 and have menace.')[0]).toMatchObject({
      when: 'attacking',
      keywords: ['menace'],
    });
  });

  test('"Creatures attacking you get -1/-0" names no attacker of its own: not read', () => {
    expect(anthemsOf('Creatures attacking you get -1/-0.')).toEqual([]);
  });
});

// ---- on the table ----

const rec = (id: string, name: string, typeLine: string, oracleText = '', pt: [string, string] = ['2', '2']): CardRecord => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  typeLine,
  oracleText,
  manaCost: '',
  power: /Creature/.test(typeLine) ? pt[0] : null,
  toughness: /Creature/.test(typeLine) ? pt[1] : null,
  colors: ['R'],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
});

const RECORDS: Record<string, CardRecord> = {
  warchief: rec('warchief', 'Goblin Warchief', 'Creature — Goblin Warrior', 'Goblin spells you cast cost {1} less to cast.\nGoblins you control have haste.'),
  goblin: rec('goblin', 'Goblin Piker', 'Creature — Goblin Warrior'),
  oriflamme: rec('oriflamme', 'Orcish Oriflamme', 'Enchantment', 'Attacking creatures you control get +1/+0.'),
  bear: rec('bear', 'Grizzly Bears', 'Creature — Bear'),
};

function table(mine: CardInstance[], theirs: CardInstance[]): GameState {
  const g = createGame({
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    mode: 'cards',
    profiles: [
      { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
      { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
    ],
  });
  const seat = (battlefield: CardInstance[]) => ({ library: [], hand: [], battlefield, graveyard: [], exile: [], command: [], mulligans: 0, deckName: 'D' });
  return { ...g, players: g.players.map((p, i) => ({ ...p, cards: seat(i === 0 ? mine : theirs) })) };
}

const card = (iid: string, cardId: string, more: Partial<CardInstance> = {}): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name, ...more });

describe('on the table', () => {
  test('a Goblin lord’s haste: the new Goblin has it, and may attack the turn it came', () => {
    const g = table([card('w', 'warchief'), card('g', 'goblin', { sick: true })], []);
    expect(keywordsAround(g, { seat: 0, kind: 'card', id: 'g' }, RECORDS).has('haste')).toBe(true);
    expect(keywordsNow(g, { seat: 0, kind: 'card', id: 'g' }, RECORDS).has('haste')).toBe(true);
    expect(readUnit(g, 0, { kind: 'card', id: 'g' }, RECORDS)!.canAttack).toBe(1);
  });

  test('attack-only bonuses count in the fight, not at rest', () => {
    const g = table([card('o', 'oriflamme'), card('b', 'bear')], [card('x', 'bear')]);
    expect(sizeAround(g, { seat: 0, kind: 'card', id: 'b' }, RECORDS)).toEqual({ power: 0, toughness: 0 });
    expect(sizeWhen(g, { seat: 0, kind: 'card', id: 'b' }, RECORDS, 'attacking')).toEqual({ power: 1, toughness: 0 });
    const combat: CombatState = {
      id: 'f',
      turn: g.turnNumber,
      active: 0,
      step: 'damage',
      attacks: [{ unit: { kind: 'card', id: 'b' }, target: 1, blockers: [{ kind: 'card', id: 'x' }] }],
    };
    const result = resolveCombat(g, combat, RECORDS);
    // 3/2 against 2/2: the blocker dies, and so does the attacker.
    expect(result.attacks[0].power).toBe(3);
    expect(result.outcome.deaths.map((d) => d.unit.id).sort()).toEqual(['b', 'x']);
  });
});
