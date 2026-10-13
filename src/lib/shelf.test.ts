import { describe, expect, it } from 'vitest';
import { isManaRock, shelfOf } from './shelf';

const rec = (typeLine: string, oracleText = '') => ({ typeLine, oracleText });

describe('shelfOf', () => {
  it('keeps the field for creatures', () => {
    expect(shelfOf({}, rec('Creature — Bear'))).toBe('field');
    expect(shelfOf({ row: 'front' }, rec('Artifact Creature — Thopter', 'Flying'))).toBe('field');
    // A mana dork is a creature first: it attacks and blocks.
    expect(shelfOf({ row: 'front' }, rec('Creature — Elf Druid', '{T}: Add {G}.'))).toBe('field');
  });

  it('puts mana rocks with the lands', () => {
    expect(shelfOf({ row: 'front' }, rec('Artifact', '{T}: Add {C}{C}.'))).toBe('lands');
    expect(
      shelfOf(
        { row: 'front' },
        rec('Artifact', "{T}: Add one mana of any color in your commander's color identity."),
      ),
    ).toBe('lands');
    expect(shelfOf({}, rec('Artifact', '{1}, {T}: Add {U}{B}.'))).toBe('lands');
  });

  it('puts every other permanent on the side shelf', () => {
    expect(shelfOf({ row: 'front' }, rec('Enchantment', 'Whenever an opponent casts a spell…'))).toBe('side');
    expect(shelfOf({ row: 'front' }, rec('Artifact — Equipment', 'Equip {0}'))).toBe('side');
    expect(shelfOf({ row: 'front' }, rec('Legendary Planeswalker — Liliana', '+1: …'))).toBe('side');
    expect(shelfOf({ row: 'front' }, rec('Artifact — Vehicle', 'Flying\nCrew 1'))).toBe('side');
    // Sacrificed for mana, not tapped for it: no rock.
    expect(shelfOf({ row: 'front' }, rec('Artifact', 'Sacrifice a creature: Add {C}{C}.'))).toBe('side');
    expect(
      shelfOf({}, rec('Artifact', '{T}, Sacrifice this artifact: Add one mana of any color.')),
    ).toBe('side');
  });

  it('reads the front face only', () => {
    // An enchantment that turns into a land later is not a land yet.
    expect(
      shelfOf({ row: 'front' }, rec('Legendary Enchantment // Legendary Land', 'At the beginning…\n//\n{T}: Add {G}.')),
    ).toBe('side');
    expect(shelfOf({}, rec('Creature — Human // Creature — Vampire'))).toBe('field');
    expect(isManaRock(rec('Legendary Enchantment // Legendary Land', 'x\n//\n{T}: Add {G}.'))).toBe(false);
  });

  it('a land that reached the battlefield some other way still sits with the lands', () => {
    expect(shelfOf({ row: 'front' }, rec('Land', '{T}: Add {B}.'))).toBe('lands');
    expect(shelfOf({}, rec('Basic Land — Swamp', '({T}: Add {B}.)'))).toBe('lands');
  });

  it('lets a place chosen by hand win over the type', () => {
    expect(shelfOf({ row: 'lands' }, rec('Creature — Bear'))).toBe('lands');
    expect(shelfOf({ row: 'side' }, rec('Creature — Bear'))).toBe('side');
    expect(shelfOf({ row: 'field' }, rec('Artifact', '{T}: Add {C}{C}.'))).toBe('field');
    expect(shelfOf({ row: 'field' }, rec('Land', '{T}: Add {G}.'))).toBe('field');
  });

  it('never hides a card it cannot read', () => {
    expect(shelfOf({}, null)).toBe('field');
    expect(shelfOf({ row: 'front' }, undefined)).toBe('field');
    expect(shelfOf({ row: 'lands' }, null)).toBe('lands');
  });
});
