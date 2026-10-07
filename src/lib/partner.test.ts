import { describe, expect, test } from 'vitest';
import { canPartner, partnerKinds, partnerOffer } from './partner';

function card(name: string, typeLine: string, oracleText: string) {
  return { name, typeLine, oracleText };
}

const thrasios = card(
  'Thrasios, Triton Hero',
  'Legendary Creature — Merfolk Wizard',
  '{4}: Scry 1, then reveal the top card of your library.\nPartner (You can have two commanders if both have partner.)',
);
const tymna = card(
  'Tymna the Weaver',
  'Legendary Creature — Human Cleric',
  'Lifelink\nAt the beginning of each of your postcombat main phases, you may pay X life.\nPartner (You can have two commanders if both have partner.)',
);
const toothy = card(
  'Toothy, Imaginary Friend',
  'Legendary Creature — Illusion',
  'Partner with Pir, Imaginative Rascal (When this creature enters, target player may put Pir into their hand from their library, then shuffle.)\nWhenever you draw a card, put a +1/+1 counter on Toothy.',
);
const pir = card(
  'Pir, Imaginative Rascal',
  'Legendary Creature — Human',
  'Partner with Toothy, Imaginary Friend (When this creature enters, target player may put Toothy into their hand from their library, then shuffle.)',
);
const will = card(
  'Will the Wise',
  'Legendary Creature — Human',
  'Friends forever (You can have two commanders if both have friends forever.)',
);
const max = card(
  'Max, the Daredevil',
  'Legendary Creature — Human',
  'Friends forever (You can have two commanders if both have friends forever.)',
);
const wilson = card(
  'Wilson, Refined Grizzly',
  'Legendary Creature — Bear Warrior',
  'Vigilance, reach, trample\nChoose a Background (You can have a Background as a second commander.)',
);
const raised = card(
  'Raised by Giants',
  'Legendary Enchantment — Background',
  'Commander creatures you own have base power and toughness 10/10.',
);
const tenth = card('The Tenth Doctor', 'Legendary Creature — Time Lord Doctor', 'Allons-y!');
const rose = card(
  'Rose Tyler',
  'Legendary Creature — Human',
  'Doctor’s companion (You can have two commanders if the other is the Doctor.)',
);
const survivorA = card(
  'Survivor A',
  'Legendary Creature — Human',
  'Partner—Survivors (You can have two commanders if both have this ability.)',
);
const survivorB = card(
  'Survivor B',
  'Legendary Creature — Human',
  'Menace\nPartner—Survivors (You can have two commanders if both have this ability.)',
);
// The one card (so far) with two pairing abilities: its owner picks one.
const amy = card(
  'Amy Pond',
  'Legendary Creature — Human',
  "Partner with Rory Williams (When this creature enters, target player may put Rory into their hand from their library, then shuffle.)\nWhenever Amy Pond deals combat damage to a player, choose a suspended card you own and remove that many time counters from it.\nDoctor's companion (You can have two commanders if the other is the Doctor.)",
);
const rory = card(
  'Rory Williams',
  'Legendary Creature — Human Soldier',
  'Partner with Amy Pond (When this creature enters, target player may put Amy into their hand from their library, then shuffle.)\nFirst strike, lifelink',
);
const ashaya = card(
  'Ashaya, Soul of the Wild',
  'Legendary Creature — Elemental',
  'Nontoken creatures you control are Forest lands in addition to their other types.',
);

describe('partnerKinds', () => {
  test('reads each way two commanders can share a deck', () => {
    expect(partnerKinds(thrasios)).toEqual([{ type: 'partner' }]);
    expect(partnerKinds(toothy)).toEqual([{ type: 'with', name: 'Pir, Imaginative Rascal' }]);
    expect(partnerKinds(will)).toEqual([{ type: 'friends' }]);
    expect(partnerKinds(wilson)).toEqual([{ type: 'background' }]);
    expect(partnerKinds(rose)).toEqual([{ type: 'companion' }]);
    expect(partnerKinds(tenth)).toEqual([{ type: 'doctor' }]);
    expect(partnerKinds(survivorA)).toEqual([{ type: 'group', group: 'Survivors' }]);
  });

  test('an ordinary commander has no partner ability', () => {
    expect(partnerKinds(ashaya)).toEqual([]);
  });

  test('a card with two pairing abilities keeps both', () => {
    expect(partnerKinds(amy)).toEqual([{ type: 'with', name: 'Rory Williams' }, { type: 'companion' }]);
  });
});

describe('canPartner', () => {
  test('plain partners pair with each other, not with named pairs', () => {
    expect(canPartner(thrasios, tymna)).toBe(true);
    expect(canPartner(thrasios, toothy)).toBe(false);
    expect(canPartner(thrasios, ashaya)).toBe(false);
  });

  test('"partner with" pairs only with the card it names', () => {
    expect(canPartner(toothy, pir)).toBe(true);
    expect(canPartner(pir, toothy)).toBe(true);
    expect(canPartner(toothy, thrasios)).toBe(false);
  });

  test('friends forever, backgrounds, and the Doctor each follow their own rule', () => {
    expect(canPartner(will, max)).toBe(true);
    expect(canPartner(will, thrasios)).toBe(false);
    expect(canPartner(wilson, raised)).toBe(true);
    expect(canPartner(wilson, tymna)).toBe(false);
    expect(canPartner(rose, tenth)).toBe(true);
    expect(canPartner(tenth, rose)).toBe(true);
    expect(canPartner(rose, tymna)).toBe(false);
  });

  test('named partner groups pair within the same group only', () => {
    expect(canPartner(survivorA, survivorB)).toBe(true);
    expect(canPartner(survivorA, thrasios)).toBe(false);
  });

  test('a card with two pairing abilities may use either one', () => {
    expect(canPartner(amy, rory)).toBe(true); // "Partner with Rory Williams"
    expect(canPartner(rory, amy)).toBe(true);
    expect(canPartner(amy, tenth)).toBe(true); // "Doctor's companion"
    expect(canPartner(tenth, amy)).toBe(true);
    expect(canPartner(amy, rose)).toBe(false); // two companions, no Doctor
    expect(canPartner(amy, thrasios)).toBe(false);
  });

  test('a commander with no partner ability pairs with nothing', () => {
    expect(canPartner(ashaya, thrasios)).toBe(false);
  });

  test('a card never partners with itself', () => {
    expect(canPartner(thrasios, thrasios)).toBe(false);
  });
});

describe('partnerOffer', () => {
  test('names what the second slot is for', () => {
    expect(partnerOffer(partnerKinds(thrasios))).toBe('Add partner');
    expect(partnerOffer(partnerKinds(toothy))).toBe('Add Pir, Imaginative Rascal');
    expect(partnerOffer(partnerKinds(wilson))).toBe('Add Background');
    expect(partnerOffer(partnerKinds(rose))).toBe('Add the Doctor');
    expect(partnerOffer(partnerKinds(tenth))).toBe('Add companion');
    expect(partnerOffer(partnerKinds(ashaya))).toBeNull();
  });

  test('with a choice of abilities the slot does not presume one', () => {
    expect(partnerOffer(partnerKinds(amy))).toBe('Add partner');
  });
});
