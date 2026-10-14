import { expect, test } from 'vitest';
import { comesAttached, equipWay, equipWays } from './equip';

const eq = (oracleText: string, typeLine = 'Artifact — Equipment', name = 'Thing') => ({ name, typeLine, oracleText });

test('the equip cost is read off the card as it prints it', () => {
  expect(equipWays(eq('Equipped creature gets +2/+0.\nEquip {1}'))).toEqual([
    { printed: '{1}', cost: { generic: 1, pips: [] }, only: null },
  ]);
  expect(equipWays(eq('Equipped creature has haste and shroud.\nEquip {0}'))[0].cost).toEqual({ generic: 0, pips: [] });
  expect(equipWays(eq('Equip {1}{W}'))[0].cost).toEqual({ generic: 1, pips: [['W']] });
});

test('reminder text after the cost is not part of it', () => {
  const ways = equipWays(eq('Equip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)'));
  expect(ways).toHaveLength(1);
  expect(ways[0].printed).toBe('{2}');
});

test('a card with two equip abilities has two ways, each with whom it is for', () => {
  const ways = equipWays(eq('Equipped creature gets +1/+1 for each land you control.\nEquip legendary creature {3}\nEquip {7}'));
  expect(ways.map((w) => [w.only, w.printed])).toEqual([
    ['legendary creature', '{3}'],
    [null, '{7}'],
  ]);
});

test('a cost that is not mana, or holds an X, is not read: the table never guesses it', () => {
  expect(equipWays(eq('Equip—Pay 3 life.'))).toEqual([]);
  expect(equipWays(eq('Equip—Sacrifice a creature.'))).toEqual([]);
  expect(equipWays(eq('Equip {X}'))).toEqual([]);
});

test('a sentence about equip abilities is not an equip ability', () => {
  expect(equipWays(eq('Equip abilities you activate cost {1} less to activate.'))).toEqual([]);
  expect(equipWays(eq('Equipped creature gets +1/+1.'))).toEqual([]);
});

test('only an Equipment has an equip cost — and only on the face that is up', () => {
  expect(equipWays(eq('Equip {2}', 'Artifact'))).toEqual([]);
  expect(equipWays(null)).toEqual([]);
  expect(equipWays(eq('Flying\n//\nEquip {2}', 'Creature — Bird // Artifact — Equipment'))).toEqual([]);
});

test('Reconfigure is paid the same way', () => {
  const ways = equipWays(eq('Equipped creature gets +2/+2.\nReconfigure {2}', 'Artifact Creature — Equipment Fox'));
  expect(ways[0].cost).toEqual({ generic: 2, pips: [] });
});

test('the way a host pays is the cheapest one it may use', () => {
  const blade = eq('Equip legendary creature {3}\nEquip {7}');
  expect(equipWay(blade, { typeLine: 'Legendary Creature — Human Knight' })?.printed).toBe('{3}');
  expect(equipWay(blade, { typeLine: 'Creature — Bear' })?.printed).toBe('{7}');
  // A host this device cannot read is given the cheaper way: never charge too much.
  expect(equipWay(blade, null)?.printed).toBe('{3}');
});

test('"Equip commander" is for a commander; a creature type is read off the type line', () => {
  const plate = eq('Equip commander {3}\nEquip {5}');
  expect(equipWay(plate, { typeLine: 'Legendary Creature — Elf', commander: true })?.printed).toBe('{3}');
  expect(equipWay(plate, { typeLine: 'Legendary Creature — Elf' })?.printed).toBe('{5}');
  const staff = eq('Equip Shaman, Warlock, or Wizard {1}\nEquip {3}');
  expect(equipWay(staff, { typeLine: 'Creature — Human Wizard' })?.printed).toBe('{1}');
  expect(equipWay(staff, { typeLine: 'Token Creature — Soldier' })?.printed).toBe('{3}');
});

test('a card with no way for that host has no cost to ask', () => {
  expect(equipWay(eq('Equip legendary creature {3}'), { typeLine: 'Creature — Bear' })).toBeNull();
  expect(equipWay(eq('Equip—Pay 3 life.'), { typeLine: 'Creature — Bear' })).toBeNull();
});

test('an Equipment that attaches itself as it enters comes in attached', () => {
  expect(comesAttached(eq('When this Equipment enters, attach it to target creature you control.\nEquip {2}'))).toBe(true);
  expect(
    comesAttached(eq('When this Equipment enters, create a 2/2 red Rebel creature token, then attach this Equipment to it.\nEquip {1}{R}')),
  ).toBe(true);
  expect(comesAttached(eq('Living weapon\nEquip {2}'))).toBe(true);
  expect(comesAttached(eq("When Maul of the Skyclaves enters the battlefield, attach it to target creature you control.\nEquip {2}{W}{W}", 'Artifact — Equipment', 'Maul of the Skyclaves'))).toBe(true);
  expect(comesAttached(eq('Equipped creature gets +2/+0.\nEquip {1}'))).toBe(false);
});
