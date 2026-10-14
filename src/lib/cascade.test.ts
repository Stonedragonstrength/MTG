import { expect, test } from 'vitest';
import { cascade, markRebound, moveCard } from './cards';
import {
  cardManaValue,
  cascadeGrants,
  castsWithRebound,
  givesRebound,
  planCascade,
  planDiscover,
  reboundTurn,
  spellManaValue,
} from './cascade';
import { createGame } from './game';
import type { CardInstance, CardRecord, GameConfig, GameState } from './types';

function rec(id: string, name: string, typeLine: string, manaCost: string, oracleText = ''): CardRecord {
  return {
    id,
    name,
    nameLower: name.toLowerCase(),
    typeLine,
    oracleText,
    manaCost,
    power: null,
    toughness: null,
    colors: [],
    imageNormal: null,
    imageArtCrop: null,
    isToken: false,
    isBasicLand: false,
  };
}

const RECORDS: Record<string, CardRecord> = {
  forest: rec('forest', 'Forest', 'Basic Land — Forest', ''),
  giant: rec('giant', 'Hill Giant', 'Creature — Giant', '{3}{R}'),
  bolt: rec('bolt', 'Lightning Bolt', 'Instant', '{R}'),
  feeder: rec('feeder', 'Spike Feeder', 'Creature — Spike', '{1}{G}{G}', 'This creature enters with two +1/+1 counters on it.'),
  fireball: rec('fireball', 'Fireball', 'Sorcery', '{X}{R}'),
  bonecrusher: rec('bonecrusher', 'Bonecrusher Giant // Stomp', 'Creature — Giant // Instant — Adventure', '{2}{R} // {1}{R}'),
  fireice: rec('fireice', 'Fire // Ice', 'Instant // Instant', '{1}{R} // {1}{U}'),
  valakut: rec('valakut', 'Valakut Awakening // Valakut Stoneforge', 'Instant // Land', '{2}{R}'),
};
const card = (iid: string, cardId: string): CardInstance => ({ iid, cardId, name: RECORDS[cardId].name });
const read = async (c: CardInstance) => RECORDS[c.cardId];

// ---- mana values ----

test('a card’s mana value as it lies in a library: split halves add up, an Adventure counts its own half', () => {
  expect(cardManaValue(RECORDS.giant)).toBe(4);
  expect(cardManaValue(RECORDS.fireice)).toBe(4);
  expect(cardManaValue(RECORDS.bonecrusher)).toBe(3);
  expect(cardManaValue(RECORDS.valakut)).toBe(3);
  expect(cardManaValue(rec('room', 'Cramped Vents // Access Maze', 'Enchantment — Room // Enchantment — Room', '{3}{B} // {5}{B}{B}'))).toBe(11);
  expect(cardManaValue(rec('prep', 'Eiganjo Dynastorian // Replenish', 'Creature — Fox Advisor // Sorcery', '{2}{W} // {3}{W}'))).toBe(3);
  expect(cardManaValue(RECORDS.forest)).toBe(0);
});

test('a spell’s mana value as it is cast counts what was paid for X', () => {
  expect(spellManaValue(RECORDS.fireball)).toBe(1);
  expect(spellManaValue(RECORDS.fireball, 4)).toBe(5);
  expect(spellManaValue(rec('burn', 'Let the Galaxy Burn', 'Sorcery', '{X}{5}{R}'), 3)).toBe(9);
});

// ---- what a cascade finds ----

test('cascade exiles until a nonland card with lesser mana value: lands and bigger cards are passed over', async () => {
  const library = [card('l1', 'forest'), card('l2', 'giant'), card('l3', 'bolt'), card('l4', 'feeder')];
  expect(await planCascade(library, 4, read)).toEqual({
    exiled: [
      { iid: 'l1', cardId: 'forest', name: 'Forest' },
      { iid: 'l2', cardId: 'giant', name: 'Hill Giant' },
      { iid: 'l3', cardId: 'bolt', name: 'Lightning Bolt' },
    ],
    found: { iid: 'l3', cardId: 'bolt', name: 'Lightning Bolt', spell: true, x: false, brings: {} },
  });
  // Below 5 the Giant is it: a permanent, which enters with nothing.
  expect((await planCascade(library, 5, read))?.found).toMatchObject({ iid: 'l2', spell: false, brings: {} });
});

test('a permanent it finds brings the counters it enters with; a spell with X says so (it is cast for 0)', async () => {
  expect((await planCascade([card('l1', 'feeder')], 4, read))?.found).toMatchObject({ spell: false, brings: { p1p1: 2 } });
  expect((await planCascade([card('l1', 'fireball')], 4, read))?.found).toMatchObject({ spell: true, x: true });
});

test('an Adventure card is found by its own mana value; a spell with a land on its back is no land', async () => {
  expect((await planCascade([card('l1', 'bonecrusher')], 4, read))?.found).toMatchObject({ iid: 'l1', spell: false });
  expect((await planCascade([card('l1', 'bonecrusher')], 3, read))?.found).toBeNull();
  expect((await planCascade([card('l1', 'valakut')], 4, read))?.found).toMatchObject({ iid: 'l1', spell: true });
});

test('nothing to find: the whole library is exiled; a card it cannot read stops it (nothing is guessed)', async () => {
  const lands = [card('l1', 'forest'), card('l2', 'forest')];
  expect(await planCascade(lands, 4, read)).toEqual({ exiled: lands.map(({ iid, cardId, name }) => ({ iid, cardId, name })), found: null });
  expect(await planCascade([], 4, read)).toEqual({ exiled: [], found: null });
  expect(await planCascade([card('l1', 'forest'), { iid: 'l2', cardId: 'mystery', name: 'Mystery' }], 4, read)).toBeNull();
});

// ---- cascade given by other permanents ----

test('the cascade other permanents give their player’s spells is read; a condition the table cannot see is not', () => {
  const grant = (text: string) => cascadeGrants(rec('x', 'X', 'Creature', '', text));
  expect(grant('Cascade\nSliver spells you cast have cascade.')).toEqual([
    { kinds: [['sliver']], commander: false, fromHand: false, atLeast: 0, times: 1 },
  ]);
  expect(grant('Instant and sorcery spells you cast from your hand have cascade.')).toEqual([
    { kinds: [['instant'], ['sorcery']], commander: false, fromHand: true, atLeast: 0, times: 1 },
  ]);
  expect(grant('Spells you cast with mana value 6 or greater have cascade.')).toEqual([
    { kinds: [[]], commander: false, fromHand: false, atLeast: 6, times: 1 },
  ]);
  expect(grant('Commander spells you cast have cascade.')).toEqual([
    { kinds: [[]], commander: true, fromHand: false, atLeast: 0, times: 1 },
  ]);
  expect(grant('Colorless spells you cast from your hand with mana value 7 or greater have "Cascade, cascade."')).toEqual([
    { kinds: [['colorless']], commander: false, fromHand: true, atLeast: 7, times: 2 },
  ]);
  expect(grant('The first spell you cast each turn has cascade.')).toEqual([]);
  expect(grant('Delirium — This spell has cascade as long as there are four or more card types among cards in your graveyard.')).toEqual([]);
});

// ---- rebound ----

test('rebound: an instant or sorcery with it, or one a permanent gives it to — never a creature', () => {
  const stagger = rec('s', 'Staggershock', 'Instant', '{2}{R}', 'Staggershock deals 2 damage to any target.\nRebound (If you cast this spell from your hand, exile it as it resolves.)');
  const bolt = RECORDS.bolt;
  const castThrough = rec('ctt', 'Cast Through Time', 'Enchantment', '{4}{U}{U}{U}', 'Instant and sorcery spells you control have rebound.');
  const ojer = rec('ojer', 'Ojer Pakpatiq, Deepest Epoch', 'Legendary Creature — God', '{2}{U}{U}', 'Flying\nWhenever you cast an instant spell from your hand, it gains rebound.');
  const taigam = rec('taigam', 'Taigam, Ojutai Master', 'Legendary Creature — Human Monk', '', 'Whenever you cast an instant or sorcery spell from your hand, if Taigam attacked this turn, that spell gains rebound.');
  expect(castsWithRebound(stagger, [])).toBe(true);
  expect(castsWithRebound(bolt, [])).toBe(false);
  expect(castsWithRebound(bolt, [castThrough])).toBe(true);
  expect(castsWithRebound(RECORDS.fireball, [castThrough])).toBe(true);
  expect(castsWithRebound(bolt, [ojer])).toBe(true);
  expect(castsWithRebound(RECORDS.fireball, [ojer])).toBe(false); // a sorcery
  expect(givesRebound(taigam, 'Instant')).toBe(false);
  expect(castsWithRebound(rec('baller', 'Jeskai Baller', 'Creature — Human Athlete', '{2}{W}', 'Rebound'), [])).toBe(false);
});

test('rebound comes back on its owner’s next turn: later in the round for a seat after the active one, else next round', () => {
  expect(reboundTurn(0, { turn: 1, active: 0 })).toBe(2); // cast on its own turn
  expect(reboundTurn(1, { turn: 1, active: 0 })).toBe(1); // an instant on Nathan's turn: Sam's turn is next
  expect(reboundTurn(0, { turn: 3, active: 2 })).toBe(4);
  expect(reboundTurn(2, { turn: 3, active: 1 })).toBe(3);
});

// ---- the moves ----

const config: GameConfig = {
  format: 'commander',
  startingLife: 40,
  commanderDamageThreshold: 21,
  mode: 'cards',
  profiles: [
    { id: 'p0', name: 'Nathan', avatarUrl: null, commanderName: null },
    { id: 'p1', name: 'Sam', avatarUrl: null, commanderName: null },
  ],
};
function table(library: CardInstance[], exile: CardInstance[] = []): GameState {
  const g = createGame(config);
  g.players[0] = {
    ...g.players[0],
    cards: { library, hand: [], battlefield: [], graveyard: [], exile, command: [], mulligans: 0, deckName: 'Test' },
  };
  return g;
}
const zones = (g: GameState) => g.players[0].cards!;

test('cascade carried out: the card cast leaves, the rest go under the library; the same seed, the same order', () => {
  const g = table([card('l1', 'forest'), card('l2', 'giant'), card('l3', 'bolt'), card('l4', 'feeder')]);
  const spell = cascade(g, 0, ['l1', 'l2', 'l3'], { iid: 'l3', to: 'graveyard' }, 7);
  expect(zones(spell).graveyard.map((c) => c.iid)).toEqual(['l3']);
  expect(zones(spell).library[0].iid).toBe('l4');
  expect(zones(spell).library.slice(1).map((c) => c.iid).sort()).toEqual(['l1', 'l2']);
  expect(cascade(g, 0, ['l1', 'l2', 'l3'], { iid: 'l3', to: 'graveyard' }, 7)).toEqual(spell);

  const creature = cascade(g, 0, ['l1', 'l2'], { iid: 'l2', to: 'battlefield' }, 7);
  expect(zones(creature).battlefield).toEqual([{ iid: 'l2', cardId: 'giant', name: 'Hill Giant', row: 'front', sick: true }]);
  expect(zones(creature).library.map((c) => c.iid)).toEqual(['l3', 'l4', 'l1']);

  const none = cascade(g, 0, ['l1', 'l2', 'l3'], null, 7);
  expect(zones(none).library[0].iid).toBe('l4');
  expect(zones(none).library.slice(1).map((c) => c.iid).sort()).toEqual(['l1', 'l2', 'l3']);
  expect(zones(none).graveyard).toEqual([]);
});

test('cascade is called off when those cards are no longer the top of the library, in that order', () => {
  const g = table([card('l1', 'forest'), card('l2', 'bolt'), card('l3', 'giant')]);
  expect(cascade(g, 0, ['l2'], { iid: 'l2', to: 'graveyard' }, 1)).toBe(g);
  expect(cascade(g, 0, ['l2', 'l1'], { iid: 'l1', to: 'graveyard' }, 1)).toBe(g);
  expect(cascade(g, 0, ['l1', 'l2'], { iid: 'l3', to: 'graveyard' }, 1)).toBe(g);
  expect(cascade(g, 0, [], null, 1)).toBe(g);
});

test('a card cast with rebound is marked in exile; the mark goes as the card moves on', () => {
  const g = table([], [card('x1', 'bolt')]);
  const marked = markRebound(g, 0, 'x1', { turn: 3, active: 1 });
  expect(zones(marked).exile).toEqual([{ iid: 'x1', cardId: 'bolt', name: 'Lightning Bolt', rebound: { turn: 3, active: 1 } }]);
  expect(markRebound(g, 0, 'nope', { turn: 3, active: 1 })).toBe(g);
  expect(zones(moveCard(marked, 0, 'x1', 'exile', 'graveyard')).graveyard).toEqual([{ iid: 'x1', cardId: 'bolt', name: 'Lightning Bolt' }]);
});

// ---- discover ----

test('discover N stops at a nonland card with mana value N or less — N itself included', async () => {
  const library = [card('l1', 'forest'), card('l2', 'giant'), card('l3', 'bolt')];
  expect((await planDiscover(library, 4, read))?.found).toMatchObject({ iid: 'l2', spell: false });
  expect((await planDiscover(library, 3, read))?.found).toMatchObject({ iid: 'l3', spell: true });
  expect((await planDiscover(library, 0, read))?.found).toBeNull();
});

test('the card discovered may go to its owner’s hand instead; the rest go under the library all the same', () => {
  const g = table([card('l1', 'forest'), card('l2', 'bolt'), card('l3', 'giant')]);
  const taken = cascade(g, 0, ['l1', 'l2'], { iid: 'l2', to: 'hand' }, 3);
  expect(zones(taken).hand).toEqual([{ iid: 'l2', cardId: 'bolt', name: 'Lightning Bolt' }]);
  expect(zones(taken).library.map((c) => c.iid)).toEqual(['l3', 'l1']);
  expect(zones(taken).graveyard).toEqual([]);
});
