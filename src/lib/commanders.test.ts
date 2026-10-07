import { describe, expect, test } from 'vitest';
import { createCustomToken } from './board';
import { buildSeatCards, moveCard, seedSeat } from './cards';
import { attackerLabel, commanderKey, seatCommanders } from './commanders';
import { addCard, changeCardCount, createDeck, setCommander, setPartner } from './deck';
import { applyCommanderDamage, createGame } from './game';
import type { CardRecord, GameConfig, GameState } from './types';

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
    const [thrasios, tymna] = g.players[1].cards!.command;
    g = moveCard(g, 1, thrasios.iid, 'command', 'battlefield', { row: 'front' }); // one is out fighting
    // The plain key goes to whichever instance id sorts first (see the round-trip test below).
    const inOrder = thrasios.iid < tymna.iid ? ['Thra', 'Tymn'] : ['Tymn', 'Thra'];
    expect(seatCommanders(g, 1).map((a) => [a.key, a.short])).toEqual([
      ['p1', inOrder[0]],
      ['p1#2', inOrder[1]],
    ]);
  });

  test('a seat dealt a single-commander deck stays one attacker under the player’s name', () => {
    const solo = setCommander(createDeck('Solo'), record('c-ashaya', 'Ashaya', 'Legendary Creature'));
    const g = seedSeat(createGame({ ...config, mode: 'cards' }), 0, buildSeatCards(solo, 1));
    expect(seatCommanders(g, 0)).toEqual([{ key: 'p0', label: 'Nathan', short: 'Nath' }]);
  });

  // ---- which key is whose: the same on every device, whatever order the table hands the seat back in ----

  /** Seat 1 dealt the pair, with instance ids chosen so that deck order (Thrasios, Tymna)
   * is NOT their sorted order; `order` is the order the `cmd` object lists them in. */
  function pairSeat(order: 'dealt' | 'jsonb'): GameState {
    const g = seedSeat(createGame({ ...config, mode: 'cards' }), 1, buildSeatCards(pairDeck(), 42));
    const cards = g.players[1].cards!;
    const command = [
      { ...cards.command[0], iid: 'zz-thrasios' },
      { ...cards.command[1], iid: 'aa-tymna' },
    ];
    const cmd =
      order === 'dealt'
        ? { 'zz-thrasios': 0, 'aa-tymna': 0 } // commander first, as buildSeatCards writes it
        : { 'aa-tymna': 0, 'zz-thrasios': 0 }; // as a jsonb column hands it back: keys in byte order
    return { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, cards: { ...cards, command, cmd } } : p)) };
  }
  const keysByName = (g: GameState) =>
    Object.fromEntries(seatCommanders(g, 1).map((a) => [a.short, a.key]));

  test('a pair’s keys go by instance id, so a trip through the online table cannot swap the gauges', () => {
    const dealt = pairSeat('dealt');
    const back = pairSeat('jsonb');
    expect(Object.keys(dealt.players[1].cards!.cmd!)).not.toEqual(Object.keys(back.players[1].cards!.cmd!));
    expect(keysByName(dealt)).toEqual({ Tymn: 'p1', Thra: 'p1#2' });
    expect(keysByName(back)).toEqual(keysByName(dealt));
    expect(seatCommanders(back, 1)).toEqual(seatCommanders(dealt, 1)); // same gauges, same order, same labels
    expect(attackerLabel(back, 'p1#2')).toBe('Sam — Thrasios, Triton Hero');
  });

  test('commanderKey names a dealt commander’s gauge by its instance, and agrees with the gauges', () => {
    for (const g of [pairSeat('dealt'), pairSeat('jsonb')]) {
      expect(commanderKey(g, 1, { kind: 'card', id: 'aa-tymna' })).toBe('p1');
      expect(commanderKey(g, 1, { kind: 'card', id: 'zz-thrasios' })).toBe('p1#2');
      for (const a of seatCommanders(g, 1)) {
        const iid = a.short === 'Tymn' ? 'aa-tymna' : 'zz-thrasios';
        expect(commanderKey(g, 1, { kind: 'card', id: iid })).toBe(a.key);
      }
    }
  });

  test('commanderKey: a dealt seat’s other cards and its stacks are no commanders, whatever they are called', () => {
    const g = pairSeat('dealt');
    const other = g.players[1].cards!.hand[0];
    expect(commanderKey(g, 1, { kind: 'card', id: other.iid })).toBeNull();
    expect(commanderKey(g, 1, { kind: 'card', id: 'nope' })).toBeNull();
    // a hand-made tile with the commander's name on a seat that tracks its commanders by card
    const tile = { ...createCustomToken('Thrasios, Triton Hero', 1, 3, 'G'), id: 'tile' };
    const withTile = { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, board: [tile] } : p)) };
    expect(commanderKey(withTile, 1, { kind: 'stack', id: 'tile' })).toBeNull();
  });

  test('commanderKey: a single dealt commander has the player’s plain key', () => {
    const solo = setCommander(createDeck('Solo'), record('c-ashaya', 'Ashaya', 'Legendary Creature'));
    const g = seedSeat(createGame({ ...config, mode: 'cards' }), 0, buildSeatCards(solo, 1));
    const [ashaya] = g.players[0].cards!.command;
    expect(commanderKey(g, 0, { kind: 'card', id: ashaya.iid })).toBe('p0');
    expect(commanderKey(g, 0, { kind: 'card', id: g.players[0].cards!.hand[0]?.iid ?? 'x' })).toBeNull();
  });

  /** A tracker table: Sam's profile names his commander(s), and his creatures are tiles added by hand. */
  function trackerGame(partnerName: string | null, tiles: { id: string; name: string }[]): GameState {
    const g = createGame({
      ...config,
      profiles: [config.profiles[0], { ...config.profiles[1], partnerName }],
    });
    const board = tiles.map((t) => ({ ...createCustomToken(t.name, 2, 2, 'G'), id: t.id }));
    return { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, board } : p)) };
  }

  test('commanderKey: on a tracker seat a tile is the commander when it carries the profile’s commander name', () => {
    const g = trackerGame(null, [
      { id: 't-cmd', name: 'Thrasios, Triton Hero' },
      { id: 't-case', name: 'thrasios, triton hero' }, // typed by hand
      { id: 't-bear', name: 'Grizzly Bears' },
    ]);
    expect(commanderKey(g, 1, { kind: 'stack', id: 't-cmd' })).toBe('p1');
    expect(commanderKey(g, 1, { kind: 'stack', id: 't-case' })).toBe('p1');
    expect(commanderKey(g, 1, { kind: 'stack', id: 't-bear' })).toBeNull(); // plain damage, an ordinary death
    expect(commanderKey(g, 1, { kind: 'stack', id: 'gone' })).toBeNull();
    expect(commanderKey(g, 0, { kind: 'stack', id: 't-cmd' })).toBeNull(); // not that seat's tile
    expect(commanderKey(g, 7, { kind: 'stack', id: 't-cmd' })).toBeNull(); // no such seat
  });

  test('commanderKey: a profile’s pair keeps the keys the gauges already use — commander, then partner', () => {
    const g = trackerGame('Tymna the Weaver', [
      { id: 't-thrasios', name: 'Thrasios, Triton Hero' },
      { id: 't-tymna', name: 'Tymna the Weaver' },
    ]);
    expect(commanderKey(g, 1, { kind: 'stack', id: 't-thrasios' })).toBe('p1');
    expect(commanderKey(g, 1, { kind: 'stack', id: 't-tymna' })).toBe('p1#2');
    expect(seatCommanders(g, 1).map((a) => a.key)).toEqual(['p1', 'p1#2']);
  });

  test('commanderKey: a seat without a commander on its profile has none', () => {
    const g = trackerGame(null, []);
    const tile = { ...createCustomToken('Thrasios, Triton Hero', 1, 3, 'G'), id: 'tile' };
    const nathan = { ...g, players: g.players.map((p, i) => (i === 0 ? { ...p, board: [tile] } : p)) };
    expect(commanderKey(nathan, 0, { kind: 'stack', id: 'tile' })).toBeNull(); // Nathan's profile names no commander
  });

  test('commanderKey: a seat dealt before commanders were tracked per card goes by the front-face name', () => {
    const g = seedSeat(createGame({ ...config, mode: 'cards' }), 1, buildSeatCards(pairDeck(), 42));
    const { cmd: _cmd, ...legacy } = g.players[1].cards!;
    const battlefield = [
      { iid: 'b-cmd', cardId: 'c-thrasios', name: 'Thrasios, Triton Hero', row: 'front' as const },
      { iid: 'b-elf', cardId: 'c-elf', name: 'Llanowar Elves', row: 'front' as const },
    ];
    const old = {
      ...g,
      players: g.players.map((p, i) => (i === 1 ? { ...p, cards: { ...legacy, battlefield } } : p)),
    };
    expect(commanderKey(old, 1, { kind: 'card', id: 'b-cmd' })).toBe('p1');
    expect(commanderKey(old, 1, { kind: 'card', id: 'b-elf' })).toBeNull(); // not every creature of that seat
  });

  test('commanderKey: a two-faced commander is known by its front face', () => {
    const g = createGame({
      ...config,
      profiles: [config.profiles[0], { ...config.profiles[1], commanderName: 'Esika, God of the Tree // The Prismatic Bridge' }],
    });
    const tile = { ...createCustomToken('Esika, God of the Tree', 1, 4, 'G'), id: 'tile' };
    const withTile = { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, board: [tile] } : p)) };
    expect(commanderKey(withTile, 1, { kind: 'stack', id: 'tile' })).toBe('p1');
  });

  test('commanderKey: only a commander game has commander damage — in Standard the same tile and the same card are plain creatures', () => {
    const tiles = trackerGame(null, [{ id: 't-cmd', name: 'Thrasios, Triton Hero' }]);
    expect(commanderKey(tiles, 1, { kind: 'stack', id: 't-cmd' })).toBe('p1');
    const standard = { ...tiles, config: { ...tiles.config, format: 'standard' as const } };
    expect(commanderKey(standard, 1, { kind: 'stack', id: 't-cmd' })).toBeNull();
    // a dealt seat as well: a deck with a commander in it, played in a Standard game
    const dealt = pairSeat('dealt');
    const dealtStandard = { ...dealt, config: { ...dealt.config, format: 'standard' as const } };
    expect(commanderKey(dealt, 1, { kind: 'card', id: 'aa-tymna' })).toBe('p1');
    expect(commanderKey(dealtStandard, 1, { kind: 'card', id: 'aa-tymna' })).toBeNull();
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
