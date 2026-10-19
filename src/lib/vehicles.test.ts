import { describe, expect, test } from 'vitest';
import { sizeAround } from './anthems';
import { tappedToAttack } from './attackDraft';
import { crewCard, moveCard } from './cards';
import { readUnit, type CardRecords } from './combatEngine';
import { createGame } from './game';
import { shelfOf } from './shelf';
import { spellChoices, spellPrompts } from './spellEffects';
import type { BoardItem, CardInstance, CardRecord, GameConfig, GameState } from './types';
import { asCreatureType, crewedNow, crewOf } from './vehicles';
import { wardOf, wardsPrinted, wardWords } from './ward';

const rec = (id: string, name: string, typeLine: string, oracleText: string, size: [string, string] | null = null, more: Partial<CardRecord> = {}): CardRecord => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  typeLine,
  oracleText,
  manaCost: '{2}',
  power: size?.[0] ?? null,
  toughness: size?.[1] ?? null,
  colors: [],
  imageNormal: null,
  imageArtCrop: null,
  isToken: false,
  isBasicLand: false,
  ...more,
});

const RECORDS: CardRecords = {
  copter: rec('copter', "Smuggler's Copter", 'Artifact — Vehicle', 'Flying\nWhenever this Vehicle attacks or blocks, you may draw a card. If you do, discard a card.\nCrew 1', ['3', '3']),
  throne: rec('throne', 'Roaming Throne', 'Artifact Creature — Golem', 'Ward {2}\nAs this creature enters, choose a creature type.', ['4', '4']),
  bears: rec('bears', 'Grizzly Bears', 'Creature — Bear', '', ['2', '2']),
  anthem: rec('anthem', 'Glorious Anthem', 'Enchantment', 'Creatures you control get +1/+1.'),
  koma: rec('koma', 'Koma, World-Eater', 'Legendary Creature — Serpent', "This spell can't be countered.\nTrample, ward {4}", ['24', '24']),
  squelcher: rec('squelcher', 'Hexing Squelcher', 'Creature — Goblin Sorcerer', 'This spell can\'t be countered.\nWard—Pay 2 life.\nSpells you control can\'t be countered.\nOther creatures you control have "Ward—Pay 2 life."', ['2', '2']),
  maha: rec('maha', 'Maha, Its Feathers Night', 'Legendary Creature — Elemental Bird', 'Flying, trample\nWard—Discard a card.', ['6', '5']),
  armor: rec('armor', 'Plate Armor', 'Artifact — Equipment', 'Equipped creature gets +3/+3 and has ward {1}.\nEquip {3}'),
  codsworth: rec('codsworth', 'Codsworth, Handy Helper', 'Legendary Artifact Creature — Robot', 'Commanders you control have ward {2}.', ['2', '3']),
};

function config(): GameConfig {
  return {
    format: 'commander',
    startingLife: 40,
    commanderDamageThreshold: 21,
    mode: 'cards',
    profiles: ['Nathan', 'Sam'].map((name, i) => ({ id: `p${i}`, name, avatarUrl: null, commanderName: null })),
  };
}

function table(mine: Record<string, string>, theirs: Record<string, string> = {}, wear: Record<string, Partial<CardInstance>> = {}, board: BoardItem[] = [], cmd: string[] = []): GameState {
  const base = createGame(config());
  const side = (cards: Record<string, string>): CardInstance[] =>
    Object.entries(cards).map(([iid, id]) => ({ iid, cardId: id, name: RECORDS[id]!.name, ...wear[iid] }));
  return {
    ...base,
    turnNumber: 4,
    activePlayerIndex: 0,
    players: base.players.map((p, i) => ({
      ...p,
      board: i === 0 ? board : [],
      cards: {
        library: [],
        hand: [],
        battlefield: side(i === 0 ? mine : theirs),
        graveyard: [],
        exile: [],
        command: [],
        mulligans: 0,
        deckName: 'Test',
        ...(i === 0 && cmd.length ? { cmd: Object.fromEntries(cmd.map((c) => [c, 0])) } : {}),
      },
    })),
  };
}

const NOW = { turn: 4, active: 0 };

describe('Vehicles', () => {
  test('reads Crew N; a crewed one reads as an artifact creature', () => {
    expect(crewOf(RECORDS.copter)).toBe(1);
    expect(crewOf(RECORDS.bears)).toBeNull();
    expect(asCreatureType('Legendary Artifact — Vehicle')).toBe('Legendary Artifact Creature — Vehicle');
    expect(asCreatureType('Artifact Creature — Golem')).toBe('Artifact Creature — Golem');
  });

  test('crewed only through the turn it was crewed in', () => {
    const g = table({});
    expect(crewedNow(g, { crewed: NOW })).toBe(true);
    expect(crewedNow({ ...g, activePlayerIndex: 1 }, { crewed: NOW })).toBe(false);
    expect(crewedNow(g, {})).toBe(false);
  });

  test('a Vehicle waits in the field with the creatures', () => {
    expect(shelfOf({}, RECORDS.copter)).toBe('field');
  });

  test('crewing taps the crew without making them attackers, and the Vehicle is a creature that can attack', () => {
    const g = table({ v: 'copter', b: 'bears' });
    expect(readUnit(g, 0, { kind: 'card', id: 'v' }, RECORDS)?.creature).toBe(false);
    const crewed = crewCard(g, 0, 'v', [{ kind: 'card', id: 'b', n: 1 }]);
    const v = crewed.players[0].cards!.battlefield.find((c) => c.iid === 'v')!;
    const b = crewed.players[0].cards!.battlefield.find((c) => c.iid === 'b')!;
    expect(v.crewed).toEqual(NOW);
    expect(b.tapped).toBe(true);
    expect(readUnit(crewed, 0, { kind: 'card', id: 'v' }, RECORDS)).toMatchObject({ creature: true, canAttack: 1, power: 3 });
    // Tapping the Bears to crew is not an attack; tapping the crewed Copter is.
    const tappedV = { ...crewed, players: crewed.players.map((p, i) => (i ? p : { ...p, cards: { ...p.cards!, battlefield: p.cards!.battlefield.map((c) => (c.iid === 'v' ? { ...c, tapped: true } : c)) } })) };
    expect(tappedToAttack(tappedV, RECORDS).map((d) => d.unit.id)).toEqual(['v']);
  });

  test('a token stack crews with so many copies', () => {
    const soldiers: BoardItem = { id: 'sol', cardId: null, name: 'Soldier', imageNormal: null, imageArtCrop: null, typeLine: 'Token Creature — Soldier', oracleText: '', basePower: 1, baseToughness: 1, count: 3, counters: {}, color: null, zone: 'board' };
    const crewed = crewCard(table({ v: 'copter' }, {}, {}, [soldiers]), 0, 'v', [{ kind: 'stack', id: 'sol', n: 1 }]);
    expect(crewed.players[0].board[0]).toMatchObject({ tapped: 1, spent: 1 });
  });

  test('a Vehicle that came in this turn, crewed, cannot attack yet', () => {
    const g = crewCard(table({ v: 'copter', b: 'bears' }, {}, { v: { sick: true } }), 0, 'v', [{ kind: 'card', id: 'b', n: 1 }]);
    expect(readUnit(g, 0, { kind: 'card', id: 'v' }, RECORDS)).toMatchObject({ creature: true, canAttack: 0 });
  });

  test('crewed, anthems reach it and "destroy target creature" can point at it', () => {
    const g = table({ v: 'copter', a: 'anthem' }, {}, { v: { crewed: NOW } });
    expect(sizeAround(g, { seat: 0, kind: 'card', id: 'v' }, RECORDS)).toEqual({ power: 1, toughness: 1 });
    const murder = spellPrompts({ typeLine: 'Instant', oracleText: 'Destroy target creature.' })[0];
    expect(spellChoices(g, 0, murder, 1, RECORDS).map((c) => c.name)).toContain("Smuggler's Copter");
    const plain = table({ v: 'copter' });
    expect(spellChoices(plain, 0, murder, 1, RECORDS).map((c) => c.name)).not.toContain("Smuggler's Copter");
  });

  test('a Vehicle that leaves the battlefield forgets it was crewed', () => {
    const g = moveCard(table({ v: 'copter' }, {}, { v: { crewed: NOW } }), 0, 'v', 'battlefield', 'hand');
    expect(g.players[0].cards!.hand[0].crewed).toBeUndefined();
  });
});

describe('ward', () => {
  test('reads the printed wards: mana, life, and what the app cannot pay', () => {
    expect(wardsPrinted(RECORDS.throne!.oracleText)).toEqual({ mana: 2, life: 0, other: [] });
    expect(wardsPrinted(RECORDS.koma!.oracleText)).toEqual({ mana: 4, life: 0, other: [] });
    expect(wardsPrinted(RECORDS.squelcher!.oracleText)).toEqual({ mana: 0, life: 2, other: [] });
    expect(wardsPrinted('Ward—{2}, Pay 2 life.')).toEqual({ mana: 2, life: 2, other: [] });
    expect(wardsPrinted(RECORDS.maha!.oracleText)).toEqual({ mana: 0, life: 0, other: ['Discard a card'] });
    expect(wardsPrinted(RECORDS.bears!.oracleText)).toEqual({ mana: 0, life: 0, other: [] });
    expect(wardWords({ mana: 2, life: 2, other: [] })).toBe('{2} and 2 life');
  });

  test('what it wears and what its controller hands out count too; "other" leaves the giver out', () => {
    const g = table({}, { b: 'bears', s: 'squelcher', p: 'armor', c: 'codsworth', t: 'throne' }, { p: { on: { seat: 1, kind: 'card', id: 'b' } } });
    // The Bears: Plate Armor's {1}, the Squelcher's 2 life.
    expect(wardOf(g, { seat: 1, kind: 'card', id: 'b' }, RECORDS)).toEqual({ mana: 1, life: 2, other: [] });
    // The Squelcher: only its own.
    expect(wardOf(g, { seat: 1, kind: 'card', id: 's' }, RECORDS)).toEqual({ mana: 0, life: 2, other: [] });
    // Codsworth's ward is for commanders: the Throne is none.
    expect(wardOf(g, { seat: 1, kind: 'card', id: 't' }, RECORDS)).toEqual({ mana: 2, life: 2, other: [] });
    expect(wardOf(table({}, { b: 'bears' }), { seat: 1, kind: 'card', id: 'b' }, RECORDS)).toBeNull();
  });

  test('a commander gets Codsworth’s ward', () => {
    const g = table({ k: 'koma', c: 'codsworth' }, {}, {}, [], ['k']);
    expect(wardOf(g, { seat: 0, kind: 'card', id: 'k' }, RECORDS)).toEqual({ mana: 6, life: 0, other: [] });
  });
});
