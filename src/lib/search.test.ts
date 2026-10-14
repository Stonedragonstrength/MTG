import { describe, expect, test } from 'vitest';
import { fitsSearch, searchAsk } from './search';

const card = (name: string, typeLine: string, oracleText: string) => ({ name, typeLine, oracleText });
const of = (typeLine: string, name = 'Some Card') => ({ name, typeLine });

describe('searchAsk', () => {
  test('a permanent that searches as it enters: what, how many, where to, and when', () => {
    const storm = card(
      'Encroaching Dragonstorm',
      'Enchantment',
      "When this enchantment enters, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.\nWhen a Dragon you control enters, return this enchantment to its owner's hand.",
    );
    expect(searchAsk(storm)).toEqual({
      what: 'up to two basic land cards',
      upTo: 2,
      fits: { supers: ['Basic'], types: ['Land'], named: null },
      to: ['tapped'],
      when: 'enters',
    });
  });

  test('one onto the battlefield and the other into the hand', () => {
    const cultivate = card(
      'Cultivate',
      'Sorcery',
      'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    );
    expect(searchAsk(cultivate)).toMatchObject({ upTo: 2, to: ['tapped', 'hand'], when: 'cast' });
  });

  test('a tutor: any card, to the hand, on top, or into the graveyard', () => {
    expect(searchAsk(card('Demonic Tutor', 'Sorcery', 'Search your library for a card, put that card into your hand, then shuffle.'))).toEqual({
      what: 'a card',
      upTo: 1,
      fits: null,
      to: ['hand'],
      when: 'cast',
    });
    expect(
      searchAsk(card('Vampiric Tutor', 'Instant', 'Search your library for a card, then shuffle and put that card on top. You lose 2 life.')),
    ).toMatchObject({ to: ['top'] });
    expect(
      searchAsk(card('Entomb', 'Instant', 'Search your library for a card, put that card into your graveyard, then shuffle.')),
    ).toMatchObject({ to: ['graveyard'] });
  });

  test('land types, card types, a name', () => {
    expect(
      searchAsk(card('Farseek', 'Sorcery', 'Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.'))?.fits,
    ).toEqual({ supers: [], types: ['Plains', 'Island', 'Swamp', 'Mountain'], named: null });
    expect(
      searchAsk(card('Wood Elves', 'Creature — Elf Scout', 'When this creature enters, search your library for a Forest card, put that card onto the battlefield, then shuffle.')),
    ).toMatchObject({ fits: { types: ['Forest'] }, to: ['battlefield'], when: 'enters' });
    expect(
      searchAsk(card('Enlightened Tutor', 'Instant', 'Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top.'))?.fits?.types,
    ).toEqual(['Artifact', 'Enchantment']);
    expect(
      searchAsk(card('Squadron Hawk', 'Creature — Bird', 'Flying\nWhen this creature enters, you may search your library for up to three cards named Squadron Hawk, reveal them, put them into your hand, then shuffle.')),
    ).toMatchObject({ upTo: 3, fits: { named: 'Squadron Hawk' }, to: ['hand'], when: 'enters' });
  });

  test('an ability is a search for later, not one made as the card lands', () => {
    const wilds = card('Evolving Wilds', 'Land', '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.');
    expect(searchAsk(wilds)).toMatchObject({ upTo: 1, to: ['tapped'], when: 'later' });
    // An older wording names the card.
    const elves = card('Wood Elves', 'Creature — Elf Scout', 'When Wood Elves enters the battlefield, search your library for a Forest card and put that card onto the battlefield. Then shuffle.');
    expect(searchAsk(elves)).toMatchObject({ when: 'enters', to: ['battlefield'] });
  });

  test('a number nobody printed leaves the count open', () => {
    expect(searchAsk(card('Boundless Realms', 'Sorcery', 'Search your library for up to X basic land cards, where X is the number of lands you control, put them onto the battlefield tapped, then shuffle.'))?.upTo).toBeNull();
  });

  test('a card that searches no library of its own has nothing to ask', () => {
    expect(searchAsk(card('Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.'))).toBeNull();
    expect(searchAsk(card('Bribery', 'Sorcery', "Search target opponent's library for a creature card and put that card onto the battlefield under your control. Then that player shuffles."))).toBeNull();
    expect(searchAsk(null)).toBeNull();
    // The back face is not what is on the table.
    expect(searchAsk(card('Front // Back', 'Sorcery // Land', 'Draw a card.\n//\nSearch your library for a card.'))).toBeNull();
  });
});

describe('fitsSearch', () => {
  test('a supertype has to be there, and any one of the types', () => {
    const basics = { supers: ['Basic'], types: ['Land'], named: null };
    expect(fitsSearch(basics, of('Basic Land — Forest'))).toBe(true);
    expect(fitsSearch(basics, of('Basic Snow Land — Island'))).toBe(true);
    expect(fitsSearch(basics, of('Land — Forest Plains'))).toBe(false);
    expect(fitsSearch(basics, of('Creature — Bear'))).toBe(false);
    const either = { supers: [], types: ['Artifact', 'Enchantment'], named: null };
    expect(fitsSearch(either, of('Enchantment — Aura'))).toBe(true);
    expect(fitsSearch(either, of('Legendary Artifact'))).toBe(true);
    expect(fitsSearch(either, of('Instant'))).toBe(false);
    expect(fitsSearch({ supers: [], types: ['Forest'], named: null }, of('Land — Forest Plains'))).toBe(true);
  });

  test('a name is that card and no other; a card of two faces goes by its front', () => {
    const hawk = { supers: [], types: [], named: 'Squadron Hawk' };
    expect(fitsSearch(hawk, of('Creature — Bird', 'Squadron Hawk'))).toBe(true);
    expect(fitsSearch(hawk, of('Creature — Bird', 'Storm Crow'))).toBe(false);
    expect(fitsSearch({ supers: [], types: ['Land'], named: null }, of('Sorcery // Land', 'Spell // Land'))).toBe(false);
  });

  test('any card fits an open search, and a card nobody can read is never hidden', () => {
    expect(fitsSearch(null, of('Instant'))).toBe(true);
    expect(fitsSearch({ supers: ['Basic'], types: ['Land'], named: null }, null)).toBe(true);
  });
});
