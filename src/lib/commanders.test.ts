import { describe, expect, test } from 'vitest';
import { buildSeatCards, moveCard, seedSeat } from './cards';
import { attackerLabel, seatCommanders } from './commanders';
import { addCard, changeCardCount, createDeck, setCommander, setPartner } from './deck';
import { applyCommanderDamage, createGame } from './game';
import type { CardRecord, GameConfig } from './types';

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  profiles: [
    { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: 'Thrasios, Triton Hero' },
  ],
};

function record(id: string, name: string, typeLine: string): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText: '',
    manaCost: '',
    power: null,
    toughness: null,
    colors: [],
    colorIdentity: ['G'],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: typeLine.startsWith('Basic Land'),
  };
}

function pairDeck() {
  let d = setPartner(
    setCommander(createDeck('Pair'), record('c-thrasios', 'Thrasios, Triton Hero', 'Legendary Creature')),
    record('c-tymna', 'Tymna the Weaver', 'Legendary Creature'),
  );
  d = addCard(d, record('c-forest', 'Forest', 'Basic Land — Forest'));
  return changeCardCount(d, 'c-forest', 9);
}

describe('seatCommanders', () => {
  test('an ordinary seat is one attacker, known by the player’s name', () => {
    const g = createGame(config);
    expect(seatCommanders(g, 0)).toEqual([{ key: 'p0', label: 'Nathan', short: 'Nath' }]);
  });

  test('a partner pair named on the profile is two attackers, known by commander', () => {
    const g = createGame({
      ...config,
      profiles: [
        config.profiles[0],
        { ...config.profiles[1], partnerName: 'Tymna the Weaver' },
      ],
    });
    expect(seatCommanders(g, 1)).toEqual([
      { key: 'p1', label: 'Sam — Thrasios, Triton Hero', short: 'Thra' },
      { key: 'p1#2', label: 'Sam — Tymna the Weaver', short: 'Tymn' },
    ]);
  });

  test('a seat dealt a partner deck is two attackers wherever the commanders are', () => {
    let g = seedSeat(createGame({ ...config, mode: 'cards' }), 1, buildSeatCards(pairDeck(), 42));
    const [thrasios] = g.players[1].cards!.command;
    g = moveCard(g, 1, thrasios.iid, 'command', 'battlefield', { row: 'front' }); // one is out fighting
    expect(seatCommanders(g, 1).map((a) => [a.key, a.short])).toEqual([
      ['p1', 'Thra'],
      ['p1#2', 'Tymn'],
    ]);
  });

  test('a seat dealt a single-commander deck stays one attacker under the player’s name', () => {
    const solo = setCommander(createDeck('Solo'), record('c-ashaya', 'Ashaya', 'Legendary Creature'));
    const g = seedSeat(createGame({ ...config, mode: 'cards' }), 0, buildSeatCards(solo, 1));
    expect(seatCommanders(g, 0)).toEqual([{ key: 'p0', label: 'Nathan', short: 'Nath' }]);
  });
});

describe('commander damage from a pair', () => {
  const pairGame = () =>
    createGame({
      ...config,
      profiles: [config.profiles[0], { ...config.profiles[1], partnerName: 'Tymna the Weaver' }],
    });

  test('each commander’s damage is its own total: 11 + 11 is not lethal', () => {
    let g = pairGame();
    g = applyCommanderDamage(g, 0, 'p1', 11);
    g = applyCommanderDamage(g, 0, 'p1#2', 11);
    expect(g.players[0].commanderDamage).toEqual({ p1: 11, 'p1#2': 11 });
    expect(g.players[0].life).toBe(18);
    expect(g.players[0].eliminated).toBe(false);
  });

  test('21 from either one is lethal', () => {
    const g = applyCommanderDamage(pairGame(), 0, 'p1#2', 21);
    expect(g.players[0].eliminated).toBe(true);
  });

  test('attackerLabel names whichever commander a key belongs to', () => {
    const g = pairGame();
    expect(attackerLabel(g, 'p1#2')).toBe('Sam — Tymna the Weaver');
    expect(attackerLabel(g, 'p0')).toBe('Nathan');
    expect(attackerLabel(g, 'nobody')).toBe('?');
  });
});
