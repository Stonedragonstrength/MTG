import { expect, test } from 'vitest';
import { abilitiesOf, abilityBlocked, levelChange, levelNow, levelsOf } from './abilities';

const card = (name: string, oracleText: string) => ({ name, oracleText });

test('Monstrosity: its cost, how many counters, and that it happens once', () => {
  const [m] = abilitiesOf(card('Ember Swallower', '{5}{R}{R}: Monstrosity 3. (If this creature isn’t monstrous, put three +1/+1 counters on it and it becomes monstrous.)\nWhen this creature becomes monstrous, each player sacrifices three lands.'));
  expect(m).toMatchObject({ label: 'Monstrosity 3', cost: { generic: 5, pips: [['R'], ['R']] }, tap: false, effect: { kind: 'counters', n: 3, once: 'monstrous' } });
  const [x] = abilitiesOf(card('Polukranos, World Eater', '{X}{X}{G}: Monstrosity X.'));
  expect(x).toMatchObject({ label: 'Monstrosity X', cost: { generic: 0, pips: [['G']], x: 2 }, effect: { n: 'X' } });
});

test('Adapt, Outlast, and a plain "put a +1/+1 counter on this creature"', () => {
  expect(abilitiesOf(card('Incubation Druid', '{T}: Add one mana of any type that a land you control could produce.\n{3}{G}{G}: Adapt 3.'))).toMatchObject([
    { label: 'Adapt 3', effect: { kind: 'counters', n: 3, ifNone: true } },
  ]);
  expect(abilitiesOf(card('Abzan Battle Priest', 'Outlast {W} ({W}, {T}: Put a +1/+1 counter on this creature. Outlast only as a sorcery.)\nEach creature you control with a +1/+1 counter on it has lifelink.'))).toMatchObject([
    { label: 'Outlast', tap: true, cost: { generic: 0, pips: [['W']] }, effect: { kind: 'counters', n: 1 } },
  ]);
  expect(abilitiesOf(card('Fire Sages', '{1}{R}{R}: Put a +1/+1 counter on this creature.'))).toMatchObject([{ label: '+1/+1 counter', tap: false }]);
});

test('firebreathing and the like: until end of turn, as many times as it is paid for', () => {
  expect(abilitiesOf(card('Whispering Shade', 'Swampwalk\n{B}: This creature gets +1/+1 until end of turn.'))).toMatchObject([
    { label: '+1/+1 until end of turn', effect: { kind: 'boost', power: 1, toughness: 1, keywords: [] } },
  ]);
  expect(abilitiesOf(card('Spitfire Handler', '{R}: This creature gets +1/+0 and gains first strike until end of turn.'))[0].effect).toEqual({
    kind: 'boost',
    power: 1,
    toughness: 0,
    keywords: ['first strike'],
  });
  expect(abilitiesOf(card('Stromgald Crusader', 'Protection from white\n{B}: This creature gains flying until end of turn.\n{B}{B}: This creature gets +1/+0 until end of turn.'))).toMatchObject([
    { label: 'flying until end of turn' },
    { label: '+1/+0 until end of turn' },
  ]);
  // "Activate only once each turn" is taken on trust.
  expect(abilitiesOf(card('Mobile Fort', '{3}: This creature gets +3/-1 until end of turn. Activate only once each turn.'))).toMatchObject([{ effect: { power: 3, toughness: -1 } }]);
});

test('a cost that is not only mana and {T}, or an effect it does not know, is left to the players', () => {
  expect(abilitiesOf(card('Atog', 'Sacrifice an artifact: This creature gets +2/+2 until end of turn.'))).toEqual([]);
  expect(abilitiesOf(card('Cruel Sadist', '{B}, {T}, Pay 1 life: Put a +1/+1 counter on this creature.'))).toEqual([]);
  expect(abilitiesOf(card('Prodigal Sorcerer', '{T}: This creature deals 1 damage to any target.'))).toEqual([]);
  expect(abilitiesOf(null)).toEqual([]);
});

test('what would do nothing says why', () => {
  const [m] = abilitiesOf(card('Ember Swallower', '{5}{R}{R}: Monstrosity 3.'));
  expect(abilityBlocked(m, {})).toBeNull();
  expect(abilityBlocked(m, { counters: { monstrous: 1 } })).toBe('It is monstrous already.');
  const [adapt] = abilitiesOf(card('Druid', '{3}{G}{G}: Adapt 3.'));
  expect(abilityBlocked(adapt, { counters: { p1p1: 1 } })).toBe('It has +1/+1 counters already.');
  const [outlast] = abilitiesOf(card('Priest', 'Outlast {W}'));
  expect(abilityBlocked(outlast, { tapped: true })).toBe('It is tapped.');
});

// ---- Level up ----

const STUDENT = card(
  'Student of Warfare',
  'Level up {W} ({W}: Put a level counter on this. Level up only as a sorcery.)\nLEVEL 2-6\n3/3\nFirst strike\nLEVEL 7+\n4/4\nDouble strike',
);
const KARGAN = card(
  'Kargan Dragonlord',
  'Level up {R} ({R}: Put a level counter on this. Level up only as a sorcery.)\nLEVEL 4-7\n4/4\nFlying\nLEVEL 8+\n8/8\nFlying, trample\n{R}: This creature gets +1/+0 until end of turn.',
);

test('Level up is a button of its own; the level sections are read with their sizes', () => {
  expect(abilitiesOf(STUDENT)).toMatchObject([{ label: 'Level up', cost: { generic: 0, pips: [['W']] }, effect: { kind: 'level' } }]);
  expect(levelsOf(STUDENT).map((b) => [b.min, b.max, b.power, b.toughness, b.text])).toEqual([
    [2, 6, 3, 3, 'First strike'],
    [7, Infinity, 4, 4, 'Double strike'],
  ]);
  expect(levelNow(STUDENT, 1)).toBeNull();
  expect(levelNow(STUDENT, 2)?.power).toBe(3);
  expect(levelNow(STUDENT, 9)?.power).toBe(4);
  expect(levelChange({ ...STUDENT, power: '1', toughness: '1' }, 7)).toEqual({ power: 3, toughness: 3 });
  expect(levelChange({ ...STUDENT, power: '1', toughness: '1' }, 0)).toEqual({ power: 0, toughness: 0 });
});

test('an ability under a level is there only once the creature has reached it', () => {
  expect(abilitiesOf(KARGAN, 0).map((a) => a.label)).toEqual(['Level up']);
  expect(abilitiesOf(KARGAN, 8).map((a) => a.label)).toEqual(['Level up', '+1/+0 until end of turn']);
});
