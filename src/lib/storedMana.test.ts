import { describe, expect, test } from 'vitest';
import { tapManaFromText } from './mana';
import { planPayment, sourcesFrom, type PayCost } from './pay';
import { countersTaken, staysTapped, storedHere } from './storedMana';
import type { CardInstance, CardRecord } from './types';

const REEF =
  '{T}: Add {C}.\n{1}, {T}: Put a storage counter on this land.\n{1}, Remove X storage counters from this land: Add X mana in any combination of {U} and/or {B}.';
const BATTERY =
  '{2}, {T}: Put a charge counter on this artifact.\n{T}, Remove any number of charge counters from this artifact: Add {B}, then add an additional {B} for each charge counter removed this way.';
const VIVID = 'This land enters tapped with two charge counters on it.\n{T}: Add {B}.\n{T}, Remove a charge counter from this land: Add one mana of any color.';
const PRISM = 'Sunburst (This artifact enters with a charge counter on it for each color of mana spent to cast it.)\nRemove a charge counter from this artifact: Add one mana of any color.';
const VAULT =
  'This land enters tapped.\nYou may choose not to untap this land during your untap step.\nAt the beginning of your upkeep, if this land is tapped, put a storage counter on it.\n{T}, Remove any number of storage counters from this land: Add {B} for each storage counter removed this way.';

const RECORDS: Record<string, CardRecord> = Object.fromEntries(
  (
    [
      ['reef', 'Dreadship Reef', 'Land', REEF],
      ['battery', 'Black Mana Battery', 'Artifact', BATTERY],
      ['vivid', 'Vivid Marsh', 'Land', VIVID],
      ['prism', 'Pentad Prism', 'Artifact', PRISM],
      ['vault', 'Bottomless Vault', 'Land', VAULT],
      ['island', 'Island', 'Basic Land — Island', '{T}: Add {U}.'],
      ['swamp', 'Swamp', 'Basic Land — Swamp', '{T}: Add {B}.'],
      ['forest', 'Forest', 'Basic Land — Forest', '{T}: Add {G}.'],
      ['rasputin', 'Rasputin Dreamweaver', 'Legendary Creature — Human Wizard', 'Rasputin enters with seven dream counters on it.\nRemove a dream counter from Rasputin: Add {C}.'],
      ['workhorse', 'Workhorse', 'Artifact Creature — Horse', 'This creature enters with four +1/+1 counters on it.\nRemove a +1/+1 counter from this creature: Add {C}.'],
    ] as const
  ).map(([id, name, typeLine, oracleText]) => [
    id,
    { id, name, nameLower: name.toLowerCase(), typeLine, oracleText, manaCost: '', power: null, toughness: null, colors: [], imageNormal: null, imageArtCrop: null, isToken: false, isBasicLand: false },
  ]),
);

const card = (iid: string, id: string, more: Partial<CardInstance> = {}): CardInstance => ({ iid, cardId: id, name: RECORDS[id].name, ...more });
const cost = (generic: number, ...pips: string[]): PayCost => ({ generic, pips: pips.map((p) => p.split('') as PayCost['pips'][number]) });
const plan = (cards: CardInstance[], c: PayCost) => planPayment(c, sourcesFrom(cards, RECORDS, []));

describe('storedHere', () => {
  test('an untapped Dreadship Reef makes its counters in blue and black, its {C} paying the {1}', () => {
    const here = storedHere(REEF, { iid: 'r', counters: { storage: 3 } }, 'Dreadship Reef');
    expect(here.text.split('\n')).toEqual([
      '{T}: Add {C}.',
      '{1}, {T}: Put a storage counter on this land.',
      '{T}: Add 3 mana in any combination of {U} and/or {B}.',
    ]);
    expect(here.draw).toMatchObject({ kind: 'storage', take: 'X', plain: 1, plainColors: ['C'], pay: 0 });
    expect(here.apart).toEqual([]);
  });

  test('with none, it is a plain {C} land', () => {
    expect(storedHere(REEF, { iid: 'r' }, 'Dreadship Reef')).toMatchObject({ draw: null, apart: [] });
  });

  test('a tapped Reef still has its counters, less the {1} — a source apart from its tap', () => {
    const here = storedHere(REEF, { iid: 'r', tapped: true, counters: { storage: 3 } }, 'Dreadship Reef');
    expect(here.draw).toBeNull();
    expect(here.apart).toEqual([
      { line: 2, produces: ['U', 'B'], amount: 2, draw: expect.objectContaining({ iid: 'r', kind: 'storage', take: 'X', pay: 1, plain: 0 }) },
    ]);
  });

  test('a Mana Battery: its {B} and one more for each counter; tapped, only the {B}', () => {
    expect(storedHere(BATTERY, { iid: 'b', counters: { charge: 3 } }, 'Black Mana Battery').text).toContain('{T}: Add {B}{B}{B}{B}.');
    expect(storedHere(BATTERY, { iid: 'b', tapped: true, counters: { charge: 3 } }, 'Black Mana Battery').text).toContain('{T}: Add {B}.');
  });

  test('a Vivid land makes any color only while it has a charge counter', () => {
    expect(tapManaFromText(storedHere(VIVID, { iid: 'v', counters: { charge: 2 } }, 'Vivid Marsh').text)).toEqual({ produces: ['B', 'any'], amount: 1 });
    expect(tapManaFromText(storedHere(VIVID, { iid: 'v' }, 'Vivid Marsh').text)).toEqual({ produces: ['B'], amount: 1 });
  });

  test('Rasputin Dreamweaver speaks of itself by its first name', () => {
    expect(storedHere(RECORDS.rasputin.oracleText, { iid: 'r', counters: { dream: 7 } }, 'Rasputin Dreamweaver').apart).toEqual([
      { line: 1, produces: ['C'], amount: 7, draw: expect.objectContaining({ kind: 'dream', take: 1 }) },
    ]);
  });
});

describe('countersTaken', () => {
  const reef = storedHere(REEF, { iid: 'r', counters: { storage: 3 } }, 'Dreadship Reef').draw!;
  test('nothing while its {C} covers it; a counter for each mana once it does not', () => {
    expect(countersTaken(reef, 1, [])).toBe(0);
    expect(countersTaken(reef, 1, [['U']])).toBe(1);
    expect(countersTaken(reef, 3, [])).toBe(3);
  });
  test('a Battery: its first {B} is free', () => {
    const battery = storedHere(BATTERY, { iid: 'b', counters: { charge: 3 } }, 'x').draw!;
    expect(countersTaken(battery, 1, [['B']])).toBe(0);
    expect(countersTaken(battery, 4, [])).toBe(3);
  });
});

describe('paying with them', () => {
  test('a Reef with three counters and an Island pay {U}{U}{B}: two counters off', () => {
    expect(plan([card('r', 'reef', { counters: { storage: 3 } }), card('i', 'island')], cost(0, 'U', 'U', 'B'))).toEqual({
      spend: { i: 1, r: 2 },
      boardTaps: {},
      taken: [{ iid: 'r', kind: 'storage', n: 2 }],
    });
  });

  test('{1} is paid by the Island, and the counters stay', () => {
    expect(plan([card('r', 'reef', { counters: { storage: 3 } }), card('i', 'island')], cost(1))).toEqual({ spend: { i: 1 }, boardTaps: {} });
  });

  test('a tapped Reef: the {1} comes out of its counters too', () => {
    const cards = [card('r', 'reef', { tapped: true, spent: 999, counters: { storage: 3 } }), card('i', 'island')];
    expect(plan(cards, cost(0, 'U', 'U'))).toEqual({ spend: { i: 1, 'r#2': 1 }, boardTaps: {}, taken: [{ iid: 'r', kind: 'storage', n: 2 }] });
  });

  test('a Vivid land gives its own color for nothing, any other for a counter', () => {
    const cards = [card('v', 'vivid', { counters: { charge: 2 } }), card('f', 'forest')];
    expect(plan(cards, cost(1, 'G'))).toEqual({ spend: { f: 1, v: 1 }, boardTaps: {} });
    expect(plan(cards, cost(0, 'G', 'G'))).toEqual({ spend: { f: 1, v: 1 }, boardTaps: {}, taken: [{ iid: 'v', kind: 'charge', n: 1 }] });
    expect(plan([card('v', 'vivid'), card('f', 'forest')], cost(0, 'G', 'G'))).toBeNull();
  });

  test('a Battery beside a Swamp: the Swamp first, then the Battery and its counters', () => {
    const cards = [card('b', 'battery', { counters: { charge: 3 } }), card('s', 'swamp')];
    expect(plan(cards, cost(0, 'B'))).toEqual({ spend: { s: 1 }, boardTaps: {} });
    expect(plan(cards, cost(3, 'B'))).toEqual({ spend: { s: 1, b: 3 }, boardTaps: {}, taken: [{ iid: 'b', kind: 'charge', n: 2 }] });
  });

  test('generic mana comes from the card it costs fewest counters: the Reef’s own {C}, then the Prism', () => {
    const cards = [card('r', 'reef', { counters: { storage: 3 } }), card('p', 'prism', { counters: { charge: 2 } })];
    expect(plan(cards, cost(2))).toEqual({ spend: { r: 1, 'p#1': 1 }, boardTaps: {}, taken: [{ iid: 'p', kind: 'charge', n: 1 }] });
  });

  test('Pentad Prism and Workhorse pay from their counters, untapped and summoning sick alike', () => {
    const cards = [card('p', 'prism', { counters: { charge: 2 } }), card('w', 'workhorse', { sick: true, counters: { p1p1: 4 } })];
    expect(plan(cards, cost(1, 'R', 'U'))).toEqual({
      spend: { 'p#1': 2, 'w#1': 1 },
      boardTaps: {},
      taken: [
        { iid: 'p', kind: 'charge', n: 2 },
        { iid: 'w', kind: 'p1p1', n: 1 },
      ],
    });
  });
});

test('Bottomless Vault may stay tapped; a basic land may not', () => {
  expect(staysTapped(RECORDS.vault)).toBe(true);
  expect(staysTapped({ name: 'Vedalken Shackles', oracleText: 'You may choose not to untap Vedalken Shackles during your untap step.' })).toBe(true);
  expect(staysTapped(RECORDS.island)).toBe(false);
});

test('"two mana in any combination of {U}, {B}, and/or {R}" is two of those', () => {
  expect(tapManaFromText('{T}: Add two mana in any combination of {U}, {B}, and/or {R}.')).toEqual({ produces: ['U', 'B', 'R'], amount: 2 });
});
