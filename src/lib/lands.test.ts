import { describe, expect, test } from 'vitest';
import { landEntry, type LandContext } from './lands';

const ctx = (over: Partial<LandContext> = {}): LandContext => ({
  mine: [],
  hand: [],
  opponents: 3,
  lives: [40, 40, 40, 40],
  opponentLands: 10,
  ...over,
});
const land = (name: string, oracleText: string) => ({ name, oracleText });

describe('landEntry', () => {
  test('a plain "enters tapped" land, old and new wordings, counters or not', () => {
    expect(landEntry(land('Selesnya Guildgate', 'This land enters tapped.\n{T}: Add {G} or {W}.'), ctx())).toBe('tapped');
    expect(landEntry(land('Bojuka Bog', 'Bojuka Bog enters tapped.\nWhen Bojuka Bog enters, exile target player’s graveyard.\n{T}: Add {B}.'), ctx())).toBe('tapped');
    expect(landEntry(land('Gate to Seatower', 'Gate to Seatower enters the battlefield tapped.'), ctx())).toBe('tapped');
    expect(landEntry(land('Vivid Grove', 'This land enters tapped with two charge counters on it.\n{T}: Add {G}.'), ctx())).toBe('tapped');
  });

  test('a basic, Command Tower, a fetch land: untapped', () => {
    expect(landEntry(land('Forest', '({T}: Add {G}.)'), ctx())).toBe('untapped');
    expect(landEntry(land('Command Tower', "{T}: Add one mana of any color in your commander's color identity."), ctx())).toBe('untapped');
  });

  test('check lands look for the land types it names', () => {
    const glade = land('Sunpetal Grove', 'This land enters tapped unless you control a Forest or a Plains.\n{T}: Add {G} or {W}.');
    expect(landEntry(glade, ctx({ mine: ['Basic Land — Forest'] }))).toBe('untapped');
    expect(landEntry(glade, ctx({ mine: ['Land — Island Swamp'] }))).toBe('tapped');
  });

  test('fast lands and slow lands count the other lands', () => {
    const fast = land('Blooming Marsh', 'This land enters tapped unless you control two or fewer other lands.');
    const slow = land('Shipwreck Marsh', 'This land enters tapped unless you control two or more other lands.');
    const two = ['Basic Land — Swamp', 'Basic Land — Island'];
    expect(landEntry(fast, ctx({ mine: two }))).toBe('untapped');
    expect(landEntry(fast, ctx({ mine: [...two, 'Land'] }))).toBe('tapped');
    expect(landEntry(slow, ctx({ mine: ['Basic Land — Swamp'] }))).toBe('tapped');
    expect(landEntry(slow, ctx({ mine: two }))).toBe('untapped');
  });

  test('battlebond lands in a pod, and the rest of the table’s conditions', () => {
    const promenade = land('Bountiful Promenade', 'This land enters tapped unless you have two or more opponents.');
    expect(landEntry(promenade, ctx({ opponents: 3 }))).toBe('untapped');
    expect(landEntry(promenade, ctx({ opponents: 1 }))).toBe('tapped');
    const carnival = land('Raucous Carnival', 'This land enters tapped unless a player has 13 or less life.');
    expect(landEntry(carnival, ctx({ lives: [40, 12] }))).toBe('untapped');
    expect(landEntry(carnival, ctx())).toBe('tapped');
    const rivendell = land('Rivendell', 'Rivendell enters tapped unless you control a legendary creature.');
    expect(landEntry(rivendell, ctx({ mine: ['Legendary Creature — Elf Noble'] }))).toBe('untapped');
    expect(landEntry(rivendell, ctx({ mine: ['Creature — Elf'] }))).toBe('tapped');
  });

  test('a shock land asks; a reveal land looks in the hand', () => {
    const pool = land('Breeding Pool', '({T}: Add {G} or {U}.)\nAs Breeding Pool enters, you may pay 2 life. If you don’t, it enters tapped.');
    expect(landEntry(pool, ctx())).toBe('life');
    const snarl = land('Vineglimmer Snarl', 'As this land enters, you may reveal a Forest or Island card from your hand. If you don’t, this land enters tapped.\n{T}: Add {G} or {U}.');
    expect(landEntry(snarl, ctx({ hand: ['Basic Land — Island'] }))).toBe('untapped');
    expect(landEntry(snarl, ctx({ hand: ['Creature — Elf'] }))).toBe('tapped');
  });

  test('"If you control two or more other lands, this land enters tapped"', () => {
    const lair = land('Lair of the Hydra', 'If you control two or more other lands, this land enters tapped.');
    expect(landEntry(lair, ctx({ mine: ['Land'] }))).toBe('untapped');
    expect(landEntry(lair, ctx({ mine: ['Land', 'Land'] }))).toBe('tapped');
  });

  test('a legend called by its first name, and a Dragon revealed or controlled', () => {
    expect(landEntry(land('Boseiju, Who Shelters All', 'Boseiju enters tapped.\n{T}, Pay 2 life: Add {G}.'), ctx())).toBe('tapped');
    const temple = land(
      'Temple of the Dragon Queen',
      'As this land enters, you may reveal a Dragon card from your hand. This land enters tapped unless you revealed a Dragon card this way or you control a Dragon.',
    );
    expect(landEntry(temple, ctx({ hand: ['Creature — Dragon'] }))).toBe('untapped');
    expect(landEntry(temple, ctx({ mine: ['Legendary Creature — Elder Dragon'] }))).toBe('untapped');
    expect(landEntry(temple, ctx())).toBe('tapped');
  });

  test('a condition the app cannot judge leaves it untapped', () => {
    expect(landEntry(land('Odd Land', 'This land enters tapped unless you cast a spell this turn.'), ctx())).toBe('untapped');
  });
});
